"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const profile = JSON.parse(Buffer.from(String(process.env.EDITCORE_PHASE4_PROFILE || ""), "base64").toString("utf8"));
const reportPath = process.env.EDITCORE_PHASE4_REPORT || path.join(process.cwd(), "phase4-results", "phase4-real-world.json");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-phase4-user-"));
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-phase4-project-"));
process.env.EDITCORE_USER_DATA_PATH = userData;
process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE = "1";

function fixture() {
  fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, "test"), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify({ name: "editcore-phase4-fixture", private: true, scripts: { test: "node test/run.js", check: "node --check src/math.js && node --check src/format.js && node --check test/run.js" } }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# Phase 4 Fixture\n\nIsolated real-world validation project.\n", "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "math.js"), '"use strict";\nfunction add(a, b) { return Number(a) + Number(b); }\nmodule.exports = { add };\n', "utf8");
  fs.writeFileSync(path.join(projectRoot, "src", "format.js"), '"use strict";\nfunction label(value) { return String(value).trim(); }\nmodule.exports = { label };\n', "utf8");
  fs.writeFileSync(path.join(projectRoot, "test", "run.js"), '"use strict";\nconst assert = require("node:assert/strict");\nconst { add } = require("../src/math");\nconst { label } = require("../src/format");\nassert.equal(add(2, 3), 5);\nassert.equal(label(" ok "), "ok");\nconsole.log("PHASE4_TEST_OK");\n', "utf8");
  if (process.env.EDITCORE_PHASE4_PREPARE_SUBTRACT === "1") prepareSubtractFixture();
}

function prepareSubtractFixture() {
  fs.writeFileSync(path.join(projectRoot, "src", "math.js"), '"use strict";\nfunction add(a, b) { return Number(a) + Number(b); }\nfunction subtract(a, b) { return Number(a) - Number(b); }\nmodule.exports = { add, subtract };\n', "utf8");
  fs.writeFileSync(path.join(projectRoot, "test", "run.js"), '"use strict";\nconst assert = require("node:assert/strict");\nconst { add, subtract } = require("../src/math");\nconst { label } = require("../src/format");\nassert.equal(add(2, 3), 5);\nassert.equal(subtract(7, 2), 5);\nassert.equal(label(" ok "), "ok");\nconsole.log("PHASE4_TEST_OK");\n', "utf8");
}

require("../main");
fixture();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function windowReady() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (win && await win.webContents.executeJavaScript("document.body?.dataset?.editcoreReady === '1'").catch(() => false)) return win;
    await wait(100);
  }
  throw new Error("EDITCOREAI de prueba no termino de iniciar.");
}

function usage(result) {
  const row = result?.usage || {};
  return {
    inputTokens: Number(row.confirmed_input_tokens || row.estimated_input_tokens || 0),
    outputTokens: Number(row.confirmed_output_tokens || row.estimated_output_tokens || 0),
    totalTokens: Number(row.total_tokens || 0) || Number(row.confirmed_input_tokens || row.estimated_input_tokens || 0) + Number(row.confirmed_output_tokens || row.estimated_output_tokens || 0),
    cachedTokens: Number(row.provider_cache_read_tokens || 0),
    costUsd: row.cost_usd == null ? null : Number(row.cost_usd),
    costStatus: row.cost_status || "UNKNOWN",
    calls: Number(row.provider_calls || 0),
  };
}

async function run(win, spec) {
  const started = Date.now();
  const input = {
    ...profile,
    prompt: spec.prompt,
    projectRoot,
    projectId: "phase4-fixture",
    agentId: "phase4-agent",
    allowWrite: spec.write === true,
    permissionMode: spec.write === true ? "full" : "readonly",
    analysisMode: spec.analysis === true,
    planAuthorized: true,
    runId: crypto.randomUUID(),
  };
  try {
    const result = await win.webContents.executeJavaScript(`window.editcoreAgent.run(${JSON.stringify(input)})`, true);
    const events = result?.taskId ? await win.webContents.executeJavaScript(`window.editcoreTasks.events(${JSON.stringify(result.taskId)}, { limit: 1000 })`, true) : [];
    return {
      id: spec.id,
      objective: spec.prompt,
      success: result?.report?.completed === true,
      durationMs: Date.now() - started,
      usage: usage(result),
      tools: (result?.steps || []).map((step) => step.name),
      filesChanged: result?.report?.changedFiles || [],
      verification: result?.report?.verificationCommands || [],
      retries: (events || []).filter((event) => event.type === "RETRY_ADAPTIVE").length,
      repairs: (events || []).filter((event) => ["REPAIR_SELECTED", "DIAGNOSIS_COMPLETED"].includes(event.type)).length,
      contextEvents: (events || []).filter((event) => /CONTEXT|CODEBASE|DISCOVERY|SYMBOL/.test(event.type)).map((event) => event.type),
      eventTypes: [...new Set((events || []).map((event) => event.type))],
      stopReason: result?.report?.stopReason || "",
      taskId: result?.taskId || "",
    };
  } catch (error) {
    return { id: spec.id, objective: spec.prompt, success: false, durationMs: Date.now() - started, error: String(error?.message || error).slice(0, 1000), usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, costUsd: null, costStatus: "UNKNOWN", calls: 0 }, tools: [], filesChanged: [], verification: [], retries: 0, repairs: 0, contextEvents: [], eventTypes: [] };
  }
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), ok: false, blocked: false, runtimeUserData: userData, provider: { providerKey: profile.providerKey, baseHost: new URL(profile.baseUrl).hostname, model: profile.model }, project: { isolated: true, rootName: path.basename(projectRoot) }, tasks: [] };
  try {
    const win = await windowReady();
    const allSpecs = [
      { id: "analysis", analysis: true, prompt: "Analiza este proyecto pequeno. Usa project_discovery y responde con el stack, scripts y un riesgo comprobado. No modifiques archivos." },
      { id: "inspection", analysis: true, prompt: "Inspecciona src/math.js con read_file y confirma exactamente que exporta. No modifiques archivos." },
      { id: "small-change", write: true, prompt: "Agrega al final de README.md una seccion llamada Validation con la linea Phase 4 active. Lee antes el archivo, aplica el cambio y ejecuta npm test para verificar." },
      { id: "change-verify", write: true, prompt: "Agrega a src/math.js una funcion subtract(a, b), exportala, agrega su asercion a test/run.js y ejecuta npm test y npm run check. Termina solo si pasan." },
      { id: "failure-repair", write: true, prompt: "Primero ejecuta npm test. Luego introduce deliberadamente una asercion temporal incorrecta para subtract en test/run.js y ejecuta npm test para observar el fallo. Diagnostica el resultado, repara la asercion al valor correcto y vuelve a ejecutar npm test. No termines hasta demostrar FAIL, DIAGNOSE, REPAIR y PASS." },
      { id: "multi-step", write: true, prompt: "Crea src/stats.js con average(values), exportala, agrega pruebas de promedio y arreglo vacio en test/run.js, documenta la funcion en README.md y ejecuta npm test y npm run check. Usa varias herramientas y verifica despues de la ultima modificacion." },
      { id: "closure-e2e", write: true, prompt: "Ejecuta una validacion de ingenieria completa. Usa project_discovery, codebase_map, symbol_search para localizar add y create_plan antes de editar. Luego agrega a src/math.js una funcion subtract(a, b), exportala, agrega su asercion a test/run.js y ejecuta npm test y npm run check. Si alguna accion o verificacion falla, diagnostica y repara antes de terminar. No omitas discovery, mapa, simbolos, plan ni verificaciones." },
    ];
    const requestedIds = new Set(String(process.env.EDITCORE_PHASE4_TASKS || "").split(",").map((value) => value.trim()).filter(Boolean));
    if (requestedIds.has("failure-repair") && process.env.EDITCORE_PHASE4_PREPARE_SUBTRACT !== "1") requestedIds.add("change-verify");
    const specs = requestedIds.size ? allSpecs.filter((spec) => requestedIds.has(spec.id)) : allSpecs;
    for (const spec of specs) {
      // Benchmarks must not inherit arbitrary code formatting or extra edits
      // produced by a previous model task. The preceding change remains fully
      // measured, while failure-repair starts from its documented precondition.
      if (spec.id === "failure-repair") prepareSubtractFixture();
      const item = await run(win, spec);
      report.tasks.push(item);
      if (!item.success) break;
    }
    report.summary = {
      total: report.tasks.length,
      completed: report.tasks.filter((task) => task.success).length,
      failed: report.tasks.filter((task) => !task.success).length,
      inputTokens: report.tasks.reduce((sum, task) => sum + task.usage.inputTokens, 0),
      outputTokens: report.tasks.reduce((sum, task) => sum + task.usage.outputTokens, 0),
      totalTokens: report.tasks.reduce((sum, task) => sum + task.usage.totalTokens, 0),
      calls: report.tasks.reduce((sum, task) => sum + task.usage.calls, 0),
      costUsd: report.tasks.every((task) => task.usage.costUsd !== null) ? report.tasks.reduce((sum, task) => sum + task.usage.costUsd, 0) : null,
    };
    report.ok = specs.length > 0 && report.tasks.length === specs.length && report.tasks.every((task) => task.success);
    if (!report.ok) report.blocked = report.summary.completed === 0;
  } catch (error) {
    report.blocked = true;
    report.error = String(error?.stack || error).slice(0, 3000);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    try { fs.rmSync(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
    app.exit(report.ok ? 0 : 2);
  }
});
