"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const electron = require("electron");
const outputRoot = path.join(appRoot, String(process.env.EDITCORE_BASELINE_OUTPUT || "phase1-results"));
const results = [];

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function writeFixture(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

function providerFor(actions) {
  const bodies = [];
  let index = 0;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
      bodies.push(body);
      const action = actions[Math.min(index++, actions.length - 1)];
      if (action?.timeout) return;
      const content = JSON.stringify(action);
      const promptTokens = Math.ceil(JSON.stringify(body).length / 4);
      const completionTokens = Math.ceil(content.length / 4);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
      }));
    });
  });
  return { server, bodies, calls: () => index };
}

async function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function waitForPage(port) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await wait(100);
  }
  throw new Error("Electron no expuso una pagina CDP para la baseline.");
}

async function evaluate(page, expression, timeoutMs = 30_000) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("Runtime.evaluate timeout")); }, timeoutMs);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.close();
      if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || "Runtime.evaluate fallo"));
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
}

function stopProcess(child) {
  if (!child?.pid) return;
  spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function removeTemporaryTree(target) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      return;
    } catch (error) {
      if (!error || !["EPERM", "EBUSY", "ENOTEMPTY"].includes(error.code) || attempt === 19) throw error;
      await wait(150 + attempt * 50);
    }
  }
}

function readEvents(profile) {
  const file = path.join(profile, "phase1-audit", "phase1-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function summarize(name, scenario, providerBodies, events, result, durationMs, persistence = {}) {
  const requests = events.filter((event) => event.type === "llm_request");
  const responses = events.filter((event) => event.type === "llm_response");
  const tools = events.filter((event) => event.type === "tool");
  const checkpoints = events.filter((event) => event.type === "checkpoint");
  const input = responses.reduce((sum, event) => sum + event.confirmedInputTokens, 0);
  const output = responses.reduce((sum, event) => sum + event.confirmedOutputTokens, 0);
  let repeatedChars = 0;
  for (let index = 1; index < requests.length; index += 1) {
    const previous = new Map((requests[index - 1].messageFingerprints || []).map((hash, row) => [hash, requests[index - 1].messageChars?.[row] || 0]));
    repeatedChars += (requests[index].messageFingerprints || []).reduce((sum, hash) => sum + (previous.get(hash) || 0), 0);
    if (requests[index].toolFingerprint === requests[index - 1].toolFingerprint) repeatedChars += Number(requests[index].toolChars || 0);
  }
  const repeatBase = requests.slice(1).reduce((sum, request) => sum + Number(request.contextChars || 0), 0);
  const categoryChars = {};
  for (const request of requests) for (const [category, chars] of Object.entries(request.categories || {})) categoryChars[category] = (categoryChars[category] || 0) + Number(chars || 0);
  return {
    test: name,
    model: "phase1-local-model",
    provider: "local-simulated",
    calls: requests.length,
    inputTokensProviderReported: input,
    outputTokensProviderReported: output,
    totalTokensProviderReported: input + output,
    durationMs,
    toolCalls: tools.length,
    tools: tools.map((event) => event.name),
    filesRead: tools.filter((event) => ["read_file", "search_files", "list_files"].includes(event.name)).length,
    filesModified: Number(result?.report?.changedFiles?.length || persistence.changedFiles || 0),
    retries: responses.filter((event) => event.ok === false).length,
    errors: tools.filter((event) => event.ok === false).length + responses.filter((event) => event.ok === false).length,
    timeouts: responses.filter((event) => /abort|timeout|timed out/i.test(event.error || "")).length,
    segments: new Set(requests.map((event) => event.segmentId)).size,
    checkpoints: checkpoints.length,
    success: result?.report?.completed === true,
    stopReason: result?.report?.stopReason || persistence.stopReason || "",
    editCoreUsage: result?.usage || null,
    contextCategoryChars: categoryChars,
    repeatedContextChars: repeatedChars,
    repeatedContextPercent: repeatBase ? Math.min(100, Math.round((repeatedChars / repeatBase) * 10000) / 100) : 0,
    requestCountObservedByProvider: providerBodies.length,
    persistence,
    scenario,
  };
}

async function runScenario(scenario) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), `editcore-phase1-${scenario.id}-`));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `editcore-phase1-profile-${scenario.id}-`));
  writeFixture(fixture, scenario.files);
  const provider = providerFor(scenario.actions);
  const providerPort = await listen(provider.server);
  const debugPort = await freePort();
  const child = spawn(electron, [appRoot, `--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...process.env,
      EDITCORE_USER_DATA_PATH: profile,
      EDITCORE_ACCEPTANCE_HIDDEN: "1",
      EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1",
      EDITCORE_PHASE1_AUDIT: "1",
      EDITCORE_PHASE1_PROVIDER_TIMEOUT_MS: String(scenario.providerTimeoutMs || 300),
    },
  });
  const startedAt = Date.now();
  let result = null;
  let persistence = {};
  try {
    const page = await waitForPage(debugPort);
    await evaluate(page, "Boolean(window.editcoreAgent?.run)");
    const agentInput = `{
      baseUrl: ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)},
      apiKey: "local-phase1-key", model: "phase1-local-model",
      prompt: ${JSON.stringify(scenario.prompt)}, projectRoot: ${JSON.stringify(fixture)},
      projectId: ${JSON.stringify(scenario.id)}, permissionMode: "full", planAuthorized: true,
      runId: ${JSON.stringify(`phase1-${scenario.id}`)}, segmentId: 1,
      ...( ${JSON.stringify(scenario.extraInput || {})} )
    }`;
    const expression = scenario.autoResume
      ? `(async () => {
          const first = await window.editcoreAgent.run(${agentInput});
          if (first.report?.completed || first.report?.autoResumeRecommended !== true) return first;
          const second = await window.editcoreAgent.run({
            ...${agentInput},
            resumeSteps: first.steps || [], segmentId: 2,
            sessionProviderCalls: Number(first.usage?.provider_calls || 0),
            sessionNetInputTokens: Number(first.usage?.net_input_tokens_estimate || 0)
          });
          return {
            ...second,
            usage: {
              ...(second.usage || {}),
              provider_calls: Number(first.usage?.provider_calls || 0) + Number(second.usage?.provider_calls || 0),
              net_input_tokens_estimate: Number(first.usage?.net_input_tokens_estimate || 0) + Number(second.usage?.net_input_tokens_estimate || 0)
            },
            report: {
              ...(second.report || {}), autoResumeCount: 1,
              changedFiles: [...new Set([...(first.report?.changedFiles || []), ...(second.report?.changedFiles || [])])]
            }
          };
        })()`
      : `(async () => window.editcoreAgent.run(${agentInput}))()`;
    if (scenario.closeDuringRun) {
      const pending = evaluate(page, expression, 15_000).catch(() => null);
      for (let attempt = 0; attempt < 100 && provider.calls() < scenario.closeAfterCalls; attempt += 1) await wait(50);
      stopProcess(child);
      await pending;
      await wait(250);
      const events = readEvents(profile);
      persistence = {
        activeExecutionSurvived: false,
        traceSurvived: events.length > 0,
        checkpointSurvived: events.some((event) => event.type === "checkpoint"),
        brainDatabaseSurvived: fs.existsSync(path.join(profile, "editcore-brain", "memory.sqlite")),
        changedFiles: scenario.expectedChangedFiles || 0,
        stopReason: "Electron cerrado durante una solicitud activa",
      };
    } else {
      result = await evaluate(page, expression, 30_000);
    }
  } finally {
    stopProcess(child);
    provider.server.close();
  }
  await wait(200);
  const events = readEvents(profile);
  const summary = summarize(scenario.id, scenario.description, provider.bodies, events, result, Date.now() - startedAt, persistence);
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, `${scenario.id}-events.json`), `${JSON.stringify(events, null, 2)}\n`, "utf8");
  await removeTemporaryTree(fixture);
  await removeTemporaryTree(profile);
  return summary;
}

const scenarios = [
  {
    id: "test-1-simple", description: "Cambio simple de una propiedad existente",
    prompt: "Cambia la constante accent de app.js a green y verifica la sintaxis.",
    files: { "app.js": "const accent = 'blue';\nmodule.exports = accent;\n" },
    actions: [
      { type: "tool", name: "read_file", input: { path: "app.js" } },
      { type: "tool", name: "replace_in_file", input: { path: "app.js", oldText: "const accent = 'blue';", newText: "const accent = 'green';" } },
      { type: "tool", name: "run_command", input: { command: "node --check app.js" } },
      { type: "final", text: "Constante actualizada y sintaxis verificada." },
    ],
  },
  {
    id: "test-2-service", description: "Modificacion de servicio con dependencias",
    prompt: "Modifica calculateFare para agregar fee y verifica sus consumidores con pruebas.",
    files: {
      "service.js": "exports.calculateFare = (base) => base;\n",
      "consumer.js": "const { calculateFare } = require('./service');\nexports.total = calculateFare(10);\n",
      "service.test.js": "const test=require('node:test');const assert=require('node:assert/strict');const {calculateFare}=require('./service');test('fee',()=>assert.equal(calculateFare(10),12));\n",
    },
    actions: [
      { type: "tool", name: "search_files", input: { query: "calculateFare" } },
      { type: "tool", name: "read_file", input: { path: "service.js" } },
      { type: "tool", name: "read_file", input: { path: "consumer.js" } },
      { type: "tool", name: "replace_in_file", input: { path: "service.js", oldText: "exports.calculateFare = (base) => base;", newText: "exports.calculateFare = (base) => base + 2;" } },
      { type: "tool", name: "run_command", input: { command: "node --test service.test.js" } },
      { type: "final", text: "Servicio y consumidor revisados; pruebas aprobadas." },
    ],
  },
  {
    id: "test-3-medium", description: "Tarea mediana en dos capas",
    prompt: "Implementa la bandera active en el servicio y su consumidor, luego ejecuta pruebas.",
    files: {
      "api.js": "exports.user = () => ({ name: 'Ana' });\n",
      "client.js": "const {user}=require('./api');exports.label=()=>user().name;\n",
      "feature.test.js": "const test=require('node:test');const assert=require('node:assert/strict');const api=require('./api');const client=require('./client');test('feature',()=>{assert.equal(api.user().active,true);assert.equal(client.label(),'Ana:active')});\n",
    },
    actions: [
      { type: "tool", name: "list_files", input: { path: "" } },
      { type: "tool", name: "read_file", input: { path: "api.js" } },
      { type: "tool", name: "read_file", input: { path: "client.js" } },
      { type: "tool", name: "replace_in_file", input: { path: "api.js", oldText: "({ name: 'Ana' })", newText: "({ name: 'Ana', active: true })" } },
      { type: "tool", name: "replace_in_file", input: { path: "client.js", oldText: "user().name", newText: "`${user().name}:${user().active ? 'active' : 'inactive'}`" } },
      { type: "tool", name: "run_command", input: { command: "node --test feature.test.js" } },
      { type: "final", text: "Funcionalidad implementada en ambas capas y verificada." },
    ],
  },
  {
    id: "test-4-error", description: "Error controlado y recuperacion",
    prompt: "Corrige el estado de broken.js y verifica la sintaxis.",
    files: { "broken.js": "const state = 'broken';\nmodule.exports = state;\n" },
    actions: [
      { type: "tool", name: "read_file", input: { path: "broken.js" } },
      { type: "tool", name: "replace_in_file", input: { path: "broken.js", oldText: "texto inexistente", newText: "fixed" } },
      { type: "tool", name: "read_file", input: { path: "broken.js" } },
      { type: "tool", name: "replace_in_file", input: { path: "broken.js", oldText: "const state = 'broken';", newText: "const state = 'fixed';" } },
      { type: "tool", name: "run_command", input: { command: "node --check broken.js" } },
      { type: "final", text: "Error reproducido, estrategia corregida y sintaxis verificada." },
    ],
  },
  {
    id: "test-5-timeout", description: "Timeout controlado del proveedor",
    prompt: "Analiza timeout.js y reporta su estado.",
    providerTimeoutMs: 200,
    files: { "timeout.js": "module.exports = true;\n" },
    actions: [{ timeout: true }],
  },
  {
    id: "test-6-close", description: "Cierre de Electron durante una tarea",
    prompt: "Actualiza close.js, verifica el resultado y termina.",
    providerTimeoutMs: 10_000,
    closeDuringRun: true,
    closeAfterCalls: 3,
    expectedChangedFiles: 1,
    files: { "close.js": "const status = 'old';\n" },
    actions: [
      { type: "tool", name: "read_file", input: { path: "close.js" } },
      { type: "tool", name: "replace_in_file", input: { path: "close.js", oldText: "const status = 'old';", newText: "const status = 'new';" } },
      { timeout: true },
    ],
  },
  {
    id: "test-7-budget-zero", description: "Segmento reanudado cuyo presupuesto restante llega a cero",
    prompt: "Corrige budget.js y verifica su sintaxis.",
    files: { "budget.js": "const budget = 'pending';\n" },
    extraInput: { sessionProviderCalls: 1000000, sessionNetInputTokens: 1000000 },
    actions: [{ type: "final", text: "No debe llamarse al proveedor cuando el presupuesto es cero." }],
  },
  {
    id: "test-8-auto-resume", description: "Continuacion automatica entre dos segmentos",
    prompt: "Actualiza segment.js, inspecciona los archivos relacionados y verifica la sintaxis.",
    autoResume: true,
    files: Object.fromEntries([
      ["segment.js", "const segment = 'old';\n"],
      ...Array.from({ length: 10 }, (_, index) => [`related-${index + 1}.js`, `module.exports = ${index + 1};\n`]),
    ]),
    actions: [
      { type: "tool", name: "read_file", input: { path: "segment.js" } },
      { type: "tool", name: "replace_in_file", input: { path: "segment.js", oldText: "const segment = 'old';", newText: "const segment = 'new';" } },
      ...Array.from({ length: 10 }, (_, index) => ({ type: "tool", name: "read_file", input: { path: `related-${index + 1}.js` } })),
      { type: "tool", name: "run_command", input: { command: "node --check segment.js" } },
      { type: "final", text: "Tarea reanudada y verificada en el segundo segmento." },
    ],
  },
];

async function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const requested = new Set(process.argv.slice(2).map(String));
  const selected = requested.size ? scenarios.filter((scenario) => requested.has(scenario.id)) : scenarios;
  for (const scenario of selected) {
    const result = await runScenario(scenario);
    results.push(result);
    process.stdout.write(`${scenario.id}: ${result.success ? "SUCCESS" : "INCOMPLETE"} (${result.calls} calls)\n`);
  }
  const output = { generatedAt: new Date().toISOString(), sourceRoot: appRoot, model: "phase1-local-model", provider: "local-simulated", results };
  const outputFile = String(process.env.EDITCORE_BASELINE_FILE || "phase1-baseline.json");
  fs.writeFileSync(path.join(outputRoot, outputFile), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
