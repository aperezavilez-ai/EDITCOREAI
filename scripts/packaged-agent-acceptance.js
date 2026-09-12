"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..", "..", "..");
const executable = path.resolve(process.env.EDITCORE_PACKAGED_EXE || path.join(root, "EDITCOREAI.exe"));
let debugPort = 0;
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-packaged-agent-"));
const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-packaged-profile-"));
const fixtureName = "fixture.js";
const fixturePath = path.join(fixtureRoot, fixtureName);
const authorizationFixtureName = "authorization-flow.js";
const authorizationFixturePath = path.join(fixtureRoot, authorizationFixtureName);
const steeringFixtureName = "steering-flow.js";
const steeringFixturePath = path.join(fixtureRoot, steeringFixtureName);
const analysisFiles = Array.from({ length: 10 }, (_, index) => `analysis-${index + 1}.js`);
const expectedText = "const status = 'EDITCORE_AGENT_OK';\n";
let requestNumber = 0;
let analysisRequestNumber = 0;
let missingPathRequestNumber = 0;
let authorizationRequestNumber = 0;
let steeringRequestNumber = 0;
let sendAnalysisPlanRequests = 0;
let sendAnalysisAgentRequests = 0;
let server;
let appProcess;
const providerBodies = [];
const acceptanceKey = process.env.EDITCORE_ACCEPTANCE_API_KEY || ["local", "acceptance", "key"].join("-");

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function availablePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForPage() {
  for (let attempt = 0; attempt < 320; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = await response.json();
      const page = pages.find((item) => item.type === "page" && item.webSocketDebuggerUrl && /(?:index\.html|app\.asar)/i.test(String(item.url || "")));
      if (page && await evaluate(page, 'document.body?.dataset?.editcoreReady === "1" && typeof secureState !== "undefined"').catch(() => false)) return page;
    } catch {}
    await wait(250);
  }
  throw new Error("El ejecutable no expuso una pagina para la prueba CDP.");
}

function sendProviderResponse(response, payload) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  }));
}

function sendProviderTextResponse(response, content) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 12, completion_tokens: 8 },
  }));
}

function sendProviderTextStream(response, chunks) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
  response.end(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 8 } })}\n\ndata: [DONE]\n\n`);
}

function fixtureDigest(fileNames = fs.readdirSync(fixtureRoot)) {
  const digest = crypto.createHash("sha256");
  for (const name of [...fileNames].sort()) {
    const target = path.join(fixtureRoot, name);
    if (!fs.statSync(target).isFile()) continue;
    digest.update(name);
    digest.update(fs.readFileSync(target));
  }
  return digest.digest("hex");
}

function startProvider() {
  return new Promise((resolve, reject) => {
    server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
        providerBodies.push(body);
        const prompt = JSON.stringify(body.messages || []);
        if (body.model === "local-authorization-model" && /corrige authorization-flow\.js y verifica el resultado/i.test(prompt)) {
          if (!Array.isArray(body.tools) || !body.tools.length) {
            return sendProviderTextStream(response, ["Voy a corregir ", `${authorizationFixtureName} y verificare su sintaxis `, "sin modificar otros archivos."]);
          }
          authorizationRequestNumber += 1;
          if (authorizationRequestNumber === 1) return sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: authorizationFixtureName } });
          if (authorizationRequestNumber === 2) return sendProviderResponse(response, {
            type: "tool",
            name: "replace_in_file",
            input: { path: authorizationFixtureName, oldText: "const authorization = 'pending';", newText: "const authorization = 'EDITCORE_AUTHORIZATION_OK';" },
          });
          if (authorizationRequestNumber === 3) return sendProviderResponse(response, { type: "tool", name: "run_command", input: { command: `node --check ${authorizationFixtureName}` } });
          return sendProviderResponse(response, { type: "final", text: "La tarea autorizada se completo y verifico conservando su memoria durable." });
        }
        if (body.model === "local-send-analysis-model") {
          if (!Array.isArray(body.tools) || !body.tools.length) {
            sendAnalysisPlanRequests += 1;
            return sendProviderTextStream(response, ["Este plan no debe ejecutarse para una solicitud de solo lectura."]);
          }
          sendAnalysisAgentRequests += 1;
          if (sendAnalysisAgentRequests <= analysisFiles.length) {
            return sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: analysisFiles[sendAnalysisAgentRequests - 1] } });
          }
          return sendProviderResponse(response, { type: "final", text: "Reporte completo del analisis readonly con evidencia de diez archivos." });
        }
        if (body.model === "local-steering-model") {
          if (!/NUEVA INSTRUCCION DEL USUARIO/i.test(prompt)) {
            setTimeout(() => {
              if (!response.destroyed) sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: steeringFixtureName } });
            }, 1000);
            return;
          }
          steeringRequestNumber += 1;
          if (steeringRequestNumber === 1) return sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: steeringFixtureName } });
          if (steeringRequestNumber === 2) return sendProviderResponse(response, { type: "tool", name: "replace_in_file", input: { path: steeringFixtureName, oldText: "const steering = 'pending';", newText: "const steering = 'EDITCORE_STEERING_OK';" } });
          if (steeringRequestNumber === 3) return sendProviderResponse(response, { type: "tool", name: "run_command", input: { command: `node --check ${steeringFixtureName}` } });
          return sendProviderResponse(response, { type: "final", text: "Instruccion incorporada y verificada." });
        }
        if (/ANALYSIS_MISSING_PATH_FIXTURE/i.test(prompt)) {
          missingPathRequestNumber += 1;
          if (missingPathRequestNumber === 1) return sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: "src/main.tsx" } });
          if (missingPathRequestNumber <= 5) return sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: analysisFiles[missingPathRequestNumber - 2] } });
          return sendProviderResponse(response, { type: "final", text: "Reporte tras recuperar una ruta inexistente con el indice real." });
        }
        if (/ANALYSIS_REPEAT_FIXTURE/i.test(prompt)) {
          analysisRequestNumber += 1;
          if (analysisRequestNumber <= analysisFiles.length) {
            return sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: analysisFiles[analysisRequestNumber - 1] } });
          }
          return sendProviderResponse(response, { type: "final", text: "Analisis completado con evidencia de diez archivos distintos y reporte verificable." });
        }
        if (!Array.isArray(body.tools) || !body.tools.length) {
          response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          const value = /protocol/i.test(prompt) ? '<tool_call>{"name":"run_command"}</tool_call>' : "Respuesta clara desde el proveedor local.";
          const midpoint = Math.max(1, Math.floor(value.length / 2));
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: value.slice(0, midpoint) } }] })}\n\n`);
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: value.slice(midpoint) } }], usage: { prompt_tokens: 7, completion_tokens: 6 } })}\n\n`);
          response.end("data: [DONE]\n\n");
          return;
        }
        requestNumber += 1;
        if (requestNumber === 1) return sendProviderResponse(response, { type: "tool", name: "read_file", input: { path: fixtureName } });
        if (requestNumber === 2) return sendProviderResponse(response, {
          type: "tool",
          name: "replace_in_file",
          input: { path: fixtureName, oldText: "const status = 'old';", newText: "const status = 'EDITCORE_AGENT_OK';" },
        });
        if (requestNumber === 3) return sendProviderResponse(response, { type: "tool", name: "run_command", input: { command: `node --check ${fixtureName}` } });
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: "PROVIDER_TEMPORARILY_UNAVAILABLE", message: "Proveedor temporalmente no disponible despues de verificar." } }));
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const id = 1;
  const result = new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description || "Runtime.evaluate fallo."));
      else resolve(message.result?.result?.value);
      socket.close();
    });
  });
  socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  return result;
}

function stopApp() {
  if (!appProcess?.pid) return;
  spawnSync("taskkill", ["/pid", String(appProcess.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
}

async function main() {
  const providerPort = await startProvider();
  debugPort = await availablePort();
  fs.writeFileSync(fixturePath, "const status = 'old';\n", "utf8");
  fs.writeFileSync(authorizationFixturePath, "const authorization = 'pending';\n", "utf8");
  fs.writeFileSync(steeringFixturePath, "const steering = 'pending';\n", "utf8");
  for (const [index, fileName] of analysisFiles.entries()) {
    fs.writeFileSync(path.join(fixtureRoot, fileName), `export const value${index + 1} = ${index + 1};\n`, "utf8");
  }
  const readonlyHashBefore = fixtureDigest(analysisFiles);
  appProcess = spawn(executable, [`--remote-debugging-port=${debugPort}`, "--no-sandbox"], {
    windowsHide: true,
    stdio: "ignore",
    env: { ...process.env, EDITCORE_LOCAL_ACCEPTANCE: "1", EDITCORE_USER_DATA_PATH: profileRoot, EDITCORE_ACCEPTANCE_HIDDEN: "1", EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE: "1" },
  });
  const page = await waitForPage();
  const context = await evaluate(page, "({ href: location.href, ready: document.readyState, agent: Boolean(window.editcoreAgent?.run) })");
  if (!context?.agent) throw new Error(`El renderer no expuso editcoreAgent: ${JSON.stringify(context)}`);
  const expression = `(async () => {
    const result = await window.editcoreAgent.run({
      baseUrl: ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)},
      apiKey: ${JSON.stringify(acceptanceKey)},
      model: "local-fixture-model",
      prompt: "Corrige fixture.js y verifica que el archivo tenga sintaxis valida.",
      projectRoot: ${JSON.stringify(fixtureRoot)},
      projectId: "packaged-acceptance",
      agentId: "packaged-agent",
      permissionMode: "full",
      planAuthorized: true,
      runId: "packaged-acceptance-run"
    });
    return {
      text: result.text,
      completed: result.report?.completed,
      steps: (result.steps || []).map((step) => ({ name: step.name, ok: step.ok, path: step.input?.path || "", command: step.input?.command || "" })),
    };
  })()`;
  const result = await evaluate(page, expression);
  const chatAuthorizationFlow = await evaluate(page, `(async () => {
    window.__acceptancePlanDeltas = [];
    window.editcoreAgent.onProgress((progress) => {
      if (progress?.phase === "plan_delta") window.__acceptancePlanDeltas.push(String(progress.text || ""));
    });
    const root = ${JSON.stringify(fixtureRoot)};
    const providerKey = "acceptance-local";
    const profileId = "acceptance-local-profile";
    const model = "local-authorization-model";
    const baseUrl = ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)};
    const profile = { id: profileId, providerKey, model, baseUrl, apiKey: ${JSON.stringify(acceptanceKey)}, status: "active", agentToolOK: true, agentVerifiedAt: Date.now() };
    secureState["editcore-provider-profiles"] = [profile];
    secureState["editcore-providers"] = { [providerKey]: { baseUrl, model, apiKey: ${JSON.stringify(acceptanceKey)} } };
    const select = document.getElementById("chatModelSelect");
    const option = document.createElement("option");
    option.value = providerKey + ":" + profileId + ":" + model;
    option.textContent = model;
    option.dataset.model = model;
    option.dataset.providerKey = providerKey;
    option.dataset.profileId = profileId;
    select.replaceChildren(option);
    select.value = option.value;
    const project = projectForRoot(root, "Grupo Emergente");
    project.title = "Grupo Emergente";
    project.projectRoot = root;
    project.provider = providerKey;
    project.providerProfileId = profileId;
    project.model = model;
    project.permissionMode = "full";
    project.messages = [];
    delete project.agentWorkflow;
    state.activeProjectId = project.id;
    state.projectRoot = root;
    state.permissionMode = "full";
    state.allowWrite = true;
    document.getElementById("runMode").value = "agent";
    await window.editcoreAgent.setPermission("full");
    saveProjects();
    const waitFor = async (predicate, label) => {
      for (let attempt = 0; attempt < 600; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Timeout esperando " + label);
    };
    document.getElementById("prompt").value = "corrige authorization-flow.js y verifica el resultado";
    await send({ preventDefault() {} });
    await waitFor(() => project.agentWorkflow?.phase === "awaiting_authorization", "plan pendiente");
    const plannedTaskId = project.agentWorkflow.taskId;
    const plannedText = project.agentWorkflow.plan;
    const durableBefore = await window.editcoreTasks.status(plannedTaskId);
    document.getElementById("prompt").value = "procede con los cambios";
    await send({ preventDefault() {} });
    await waitFor(() => ["completed", "interrupted"].includes(project.agentWorkflow?.phase), "ejecucion autorizada");
    const durableAfter = await window.editcoreTasks.status(plannedTaskId);
    return {
      authorizationRecognized: isAgentAuthorization("procede con los cambios"),
      plannedTaskId,
      executedTaskId: project.agentWorkflow?.taskId || "",
      plannedText,
      persistedPlanBefore: durableBefore?.persistedPlan || "",
      persistedPlanAfter: durableAfter?.persistedPlan || "",
      durableState: durableAfter?.state || "",
      phase: project.agentWorkflow?.phase || "",
      completed: project.agentWorkflow?.report?.completed === true,
      changedFiles: project.agentWorkflow?.report?.changedFiles || [],
      verificationCommands: project.agentWorkflow?.report?.verificationCommands || [],
      planDeltaCount: window.__acceptancePlanDeltas.length,
    };
  })()`);
  const sendReadonlyAnalysisFlow = await evaluate(page, `(async () => {
    const root = ${JSON.stringify(fixtureRoot)};
    const providerKey = "acceptance-local";
    const profileId = "acceptance-send-analysis-profile";
    const model = "local-send-analysis-model";
    const baseUrl = ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)};
    const profile = { id: profileId, providerKey, model, baseUrl, apiKey: ${JSON.stringify(acceptanceKey)}, status: "active", agentToolOK: true, agentVerifiedAt: Date.now() };
    secureState["editcore-provider-profiles"] = [profile];
    secureState["editcore-providers"] = { [providerKey]: { baseUrl, model, apiKey: ${JSON.stringify(acceptanceKey)} } };
    const select = document.getElementById("chatModelSelect");
    const option = document.createElement("option");
    option.value = providerKey + ":" + profileId + ":" + model;
    option.textContent = model;
    option.dataset.model = model;
    option.dataset.providerKey = providerKey;
    option.dataset.profileId = profileId;
    select.replaceChildren(option);
    select.value = option.value;
    const project = projectForRoot(root, "Grupo Emergente");
    project.title = "Grupo Emergente";
    project.projectRoot = root;
    project.provider = providerKey;
    project.providerProfileId = profileId;
    project.model = model;
    project.permissionMode = "full";
    project.messages = [];
    project.analysisMemory = null;
    delete project.agentWorkflow;
    project.agentRuns = [];
    state.activeProjectId = project.id;
    state.projectRoot = root;
    state.permissionMode = "full";
    state.allowWrite = true;
    document.getElementById("runMode").value = "agent";
    await window.editcoreAgent.setPermission("full");
    saveProjects();
    renderFeed();
    const exactPrompt = "analiza el proyecto grupo emergente para encontrar errores y al finalizar dame un reporte completo";
    const previewJob = buildPromptJob(exactPrompt);
    document.getElementById("prompt").value = exactPrompt;
    await send({ preventDefault() {} });
    for (let attempt = 0; attempt < 900; attempt += 1) {
      if (!activePromptRequests.size && !promptQueue.length && project.analysisMemory?.completed === true) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const run = (project.agentRuns || []).at(-1) || {};
    const entries = [...document.querySelectorAll(".agent-narrative-entry")].map((item) => item.textContent.trim()).filter(Boolean);
    return {
      directReadOnly: previewJob?.directReadOnly === true,
      isAgent: previewJob?.isAgent === true,
      analysisCompleted: project.analysisMemory?.completed === true,
      workflowCreated: Boolean(project.agentWorkflow),
      runPhase: run.phase || "",
      runTaskId: run.taskId || "",
      checkpointNames: (run.checkpoints || []).map((item) => item.name),
      progressEntries: entries,
      feedText: document.getElementById("feed").textContent,
    };
  })()`);
  const steeringFlow = await evaluate(page, `(async () => {
    const runId = "packaged-steering-run";
    const running = window.editcoreAgent.run({
      baseUrl: ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)},
      apiKey: ${JSON.stringify(acceptanceKey)},
      model: "local-steering-model",
      providerKey: "acceptance-local",
      prompt: "Revisa el estado inicial y espera instrucciones.",
      projectRoot: ${JSON.stringify(fixtureRoot)},
      projectId: "packaged-steering-acceptance",
      agentId: "packaged-steering-agent",
      permissionMode: "full",
      planAuthorized: true,
      runId
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const directed = await window.editcoreAgent.steer({ runId, instruction: "Corrige steering-flow.js, conserva el avance y verifica con node --check." });
    const result = await running;
    return {
      directed,
      completed: result.report?.completed === true,
      changedFiles: result.report?.changedFiles || [],
      verificationCommands: result.report?.verificationCommands || [],
    };
  })()`);
  const continuation = await evaluate(page, `(async () => {
    let calls = 0;
    const runAgent = async () => {
      calls += 1;
      return {
        taskId: "continuation-task",
        text: calls >= 12 ? "Continuacion completa." : "Checkpoint.",
        usage: { provider_calls: 1, net_input_tokens_estimate: 10 },
        report: {
          completed: calls >= 12,
          autoResumeRecommended: calls < 12,
          remainingNetInputTokens: 100000 - calls * 10,
          progressMade: true,
        },
      };
    };
    const settled = await runAgentUntilSettled({ prompt: "continuidad" }, { targetRun: {}, thinking: null, runAgent });
    return { calls, completed: settled.report?.completed, autoResumeCount: settled.report?.autoResumeCount };
  })()`);
  const analysis = await evaluate(page, `(async () => {
    const result = await window.editcoreAgent.run({
      baseUrl: ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)},
      apiKey: ${JSON.stringify(acceptanceKey)},
      model: "local-analysis-model",
      prompt: "ANALYSIS_REPEAT_FIXTURE: analiza el fixture y entrega el reporte.",
      projectRoot: ${JSON.stringify(fixtureRoot)},
      projectId: "packaged-analysis-acceptance",
      agentId: "packaged-analysis-agent",
      permissionMode: "readonly",
      analysisMode: true,
      planAuthorized: false,
      runId: "packaged-analysis-acceptance-run"
    });
    return {
      text: result.text,
      completed: result.report?.completed,
      tools: (result.steps || []).map((step) => String(step.name || "")),
      providerCalls: result.usage?.provider_calls,
      stopReason: result.report?.stopReason,
      pathResolutions: result.report?.pathResolutions,
      pathMisses: result.report?.pathMisses,
    };
  })()`);
  const missingPath = await evaluate(page, `(async () => {
    const result = await window.editcoreAgent.run({
      baseUrl: ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)},
      apiKey: ${JSON.stringify(acceptanceKey)},
      model: "local-missing-path-model",
      prompt: "ANALYSIS_MISSING_PATH_FIXTURE: analiza el fixture y entrega el reporte.",
      projectRoot: ${JSON.stringify(fixtureRoot)},
      projectId: "packaged-missing-path-acceptance",
      agentId: "packaged-missing-path-agent",
      permissionMode: "readonly",
      analysisMode: true,
      planAuthorized: false,
      runId: "packaged-missing-path-acceptance-run"
    });
    return {
      text: result.text,
      completed: result.report?.completed,
      tools: (result.steps || []).map((step) => String(step.name || "")),
      errors: (result.steps || []).map((step) => String(step.result?.error || "")),
      stopReason: result.report?.stopReason,
      pathResolutions: result.report?.pathResolutions,
      pathMisses: result.report?.pathMisses,
    };
  })()`);
  const chat = await evaluate(page, `(async () => {
    const normalChunks = [];
    window.editcoreStream.offChunk();
    window.editcoreStream.onChunk((item) => { if (item?.delta || item?.text) normalChunks.push(item.delta || item.text); });
    const normal = await window.editcoreChat.chat({ baseUrl: ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)}, apiKey: ${JSON.stringify(acceptanceKey)}, model: "local-chat-model", prompt: "Responde una frase clara.", history: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const protocolChunks = [];
    window.editcoreStream.offChunk();
    window.editcoreStream.onChunk((item) => { if (item?.delta || item?.text) protocolChunks.push(item.delta || item.text); });
    const protocol = await window.editcoreChat.chat({ baseUrl: ${JSON.stringify(`http://127.0.0.1:${providerPort}/v1`)}, apiKey: ${JSON.stringify(acceptanceKey)}, model: "local-chat-model", prompt: "protocol", history: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.editcoreStream.offChunk();
    return { normalText: normal.text, normalChunks, protocolText: protocol.text, protocolChunks };
  })()`);
  const content = fs.readFileSync(fixturePath, "utf8");
  const authorizationContent = fs.readFileSync(authorizationFixturePath, "utf8");
  const steeringContent = fs.readFileSync(steeringFixturePath, "utf8");
  const readonlyHashAfter = fixtureDigest(analysisFiles);
  const analysisOk = Boolean(analysis?.completed)
    && analysis.tools.includes("read_file")
    && !analysis.tools.includes("run_command")
    && Number(analysis.providerCalls || 0) >= analysisFiles.length
    && /reporte|evidencia/i.test(String(analysis.text || ""));
  const continuationOk = continuation?.completed === true
    && continuation?.calls === 12
    && continuation?.autoResumeCount === 11;
  const missingPathOk = missingPath?.completed === true
    && missingPath.tools.includes("read_file")
    && missingPath.errors.filter((error) => /ENOENT|no such file/i.test(error)).length === 1
    && !/ENOENT|no such file/i.test(String(missingPath.text || ""))
    && /recuperar una ruta inexistente/i.test(String(missingPath.text || ""));
  const chatAuthorizationOK = chatAuthorizationFlow?.authorizationRecognized === true
    && chatAuthorizationFlow?.plannedTaskId
    && chatAuthorizationFlow.executedTaskId === chatAuthorizationFlow.plannedTaskId
    && chatAuthorizationFlow.phase === "completed"
    && chatAuthorizationFlow.completed === true
    && chatAuthorizationFlow.durableState === "COMPLETED"
    && chatAuthorizationFlow.plannedText.includes(chatAuthorizationFlow.persistedPlanBefore)
    && chatAuthorizationFlow.persistedPlanAfter === chatAuthorizationFlow.persistedPlanBefore
    && authorizationContent === "const authorization = 'EDITCORE_AUTHORIZATION_OK';\n"
    && chatAuthorizationFlow.changedFiles.includes(authorizationFixtureName)
    && chatAuthorizationFlow.verificationCommands.some((command) => String(command).includes(`node --check ${authorizationFixtureName}`));
  const steeringOK = steeringFlow?.directed?.accepted === true
    && steeringFlow.completed === true
    && steeringContent === "const steering = 'EDITCORE_STEERING_OK';\n"
    && steeringFlow.changedFiles.includes(steeringFixtureName)
    && steeringFlow.verificationCommands.some((command) => String(command).includes(`node --check ${steeringFixtureName}`));
  const sendReadonlyAnalysisOK = sendAnalysisPlanRequests === 0
    && sendAnalysisAgentRequests >= analysisFiles.length
    && sendReadonlyAnalysisFlow?.directReadOnly === true
    && sendReadonlyAnalysisFlow?.isAgent === true
    && sendReadonlyAnalysisFlow?.analysisCompleted === true
    && sendReadonlyAnalysisFlow?.workflowCreated === false
    && sendReadonlyAnalysisFlow?.runPhase === "completed"
    && sendReadonlyAnalysisFlow.checkpointNames.filter((name) => name === "read_file").length >= analysisFiles.length
    && sendReadonlyAnalysisFlow.progressEntries.some((text) => /Solicitud de analisis recibida/i.test(text))
    && sendReadonlyAnalysisFlow.progressEntries.some((text) => /read file|archivo/i.test(text))
    && /Verificacion completada con evidencia real|Reporte completo del analisis readonly/i.test(String(sendReadonlyAnalysisFlow.feedText || ""))
    && readonlyHashAfter === readonlyHashBefore;
  const ok = Boolean(result?.completed)
    && content === expectedText
    && result.steps?.some((step) => step.name === "replace_in_file" && step.ok === true && step.path === fixtureName)
    && result.steps?.some((step) => step.name === "run_command" && step.ok === true && step.command.includes("node --check"))
    && providerBodies.some((body) => body.tools?.some((tool) => tool?.function?.name === "brain_search"))
    && String(result?.text || "").trim().length > 0
    && !/<tool_call>|<function=|<parameter=|function_execute_command/i.test(String(result?.text || ""))
    && Boolean(chat?.normalText) && chat.normalChunks.length >= 2
    && Boolean(chat?.protocolText)
    && !/<tool_call>|<function=|<parameter=|function_execute_command/i.test(String(chat.protocolText || ""))
    && !/<tool_call>|<function=|<parameter=|function_execute_command/i.test(String(chat.protocolChunks?.join("") || ""))
    && analysisOk
    && continuationOk
    && missingPathOk
    && chatAuthorizationOK
    && chatAuthorizationFlow.planDeltaCount >= 2
    && steeringOK
    && sendReadonlyAnalysisOK;
  console.log(JSON.stringify({ ok, providerRequests: requestNumber, analysisProviderRequests: analysisRequestNumber, missingPathRequestNumber, authorizationRequestNumber, steeringRequestNumber, sendAnalysisPlanRequests, sendAnalysisAgentRequests, analysisOk, continuationOk, missingPathOk, chatAuthorizationOK, steeringOK, sendReadonlyAnalysisOK, sendReadonlyAnalysisFlow, readonlyHashBefore, readonlyHashAfter, chatAuthorizationFlow, steeringFlow, continuation, analysis, missingPath, providerBodies: providerBodies.map((body) => ({ model: body.model, stream: body.stream, hasTools: Boolean(body.tools?.length), hasBrainTools: Boolean(body.tools?.some((tool) => tool?.function?.name === "brain_search")) })), result, chat, fixtureContent: content, authorizationFixtureContent: authorizationContent, steeringFixtureContent: steeringContent }, null, 2));
  if (!ok) process.exitCode = 2;
}

main()
  .catch((error) => { console.error(error?.stack || error); process.exitCode = 2; })
  .finally(() => {
    stopApp();
    server?.close();
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    try { fs.rmSync(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }); } catch {}
  });
