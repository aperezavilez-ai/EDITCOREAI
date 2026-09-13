"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appRoot = path.join(__dirname, "..");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");
const ProjectAnalysis = require("../project-analysis");
const AutoModel = require("../auto-model-selection");
const { resolveUnifiedAgentPlan, MODES, PHASES } = require("../runtime/intent-orchestrator");

function sendFunctionSource() {
  const start = rendererSource.indexOf("async function send(event)");
  assert.ok(start >= 0, "falta send()");
  const next = rendererSource.indexOf("\nfunction promptJobFingerprint", start);
  return rendererSource.slice(start, next > start ? next : start + 4000);
}

test("C1: el recuadro se vacia al enviar, antes de await", () => {
  const send = sendFunctionSource();
  const clearAt = send.indexOf("promptField.value = \"\"");
  const firstAwait = send.indexOf("await ");
  assert.ok(clearAt > 0, "send() debe asignar promptField.value = \"\"");
  assert.ok(firstAwait > 0, "send() es async");
  assert.ok(clearAt < firstAwait, "el input debe vaciarse ANTES del primer await");
});

test("C2: nudges mid-run hacen steer; un solo agente por projectRoot", () => {
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PROCEDE"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("alto"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PORQUE NO AVANZAS?"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PORQUE TARDAS MAS DE LO NORMAL?"), true);
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("dime una respuesta"), false);
  assert.match(rendererSource, /shouldSteerLiveAgent\(effectivePrompt\)/);
  assert.match(rendererSource, /MAX_PARALLEL_AGENTS = 4/);
  const parallel = rendererSource.slice(
    rendererSource.indexOf("function canLaunchParallelAgent"),
    rendererSource.indexOf("function canLaunchPromptJob"),
  );
  assert.match(parallel, /countActiveAgents\(active\) < MAX_PARALLEL_AGENTS/);
  assert.match(parallel, /sameProject/);
  assert.match(parallel, /normalizeProjectRoot\(job\.projectRoot/);
});

test("C3: PROCEDE ejecuta, no reabre analisis", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "procede",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    planAuthorizedExecution: true,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.runProfile.phase, PHASES.EXECUTE);
  assert.match(mainSource, /analysisMode = input\.planAuthorized === true/);
  assert.match(mainSource, /\? false/);
  assert.match(rendererSource, /planAuthorizedExecution[\s\S]{0,80}isAgentAuthorization/);
});

test("C4: tope duro de minutos e iteraciones (no 25 min / 120 loops)", () => {
  assert.match(mainSource, /resolveRunDeadlineMs/);
  assert.match(mainSource, /runtime\/analysis-depth/);
  assert.doesNotMatch(mainSource, /1_500_000/);
  assert.doesNotMatch(mainSource, /runDeadlineMs = analysisMode \? 600_000 : 1_500_000/);
  const { resolveRunDeadlineMs } = require("../runtime/analysis-depth");
  assert.equal(resolveRunDeadlineMs({ analysisMode: true, prompt: "analisis forense completo" }), 900_000);
  assert.equal(resolveRunDeadlineMs({ analysisMode: true, prompt: "analiza el proyecto" }), 720_000);
  assert.equal(resolveRunDeadlineMs({ analysisMode: false }), 480_000);
  assert.ok(resolveRunDeadlineMs({ analysisMode: true, prompt: "forense" }) <= 900_000);
  assert.match(adapterSource, /const hardCap = listOnly/);
  assert.doesNotMatch(adapterSource, /input\.allowWrite && input\.analysisMode !== true \? 80 : 36/);
});

test("C5: npm run lint no es fallo de la herramienta run_command", () => {
  assert.match(mainSource, /function isDiagnosticProjectCommand/);
  assert.match(mainSource, /lint\|test\|test:unit/);
  assert.match(mainSource, /Esto NO es un fallo de la herramienta run_command/);
  assert.match(mainSource, /passed:\s*code === 0/);
  assert.match(mainSource, /diagnostic:\s*true/);
  assert.match(rendererSource, /evidencia de verificacion; no es fallo de la herramienta/);
});

test("C5b: lint/test con exit != 0 no cuenta como verificacion pasada", () => {
  const { validateAgentCompletion } = require("../agent-runtime");
  const result = validateAgentCompletion(
    "corrige el login y verifica con lint",
    [
      { name: "write_file", ok: true, input: { path: "src/a.js", content: "x" }, result: { ok: true } },
      {
        name: "run_command",
        ok: true,
        input: { command: "npm run lint" },
        result: { diagnostic: true, toolOk: true, passed: false, exitCode: 1, output: "Comando de verificacion finalizado con exit 1." },
      },
    ],
    true,
    { planAuthorized: true },
  );
  assert.equal(result.ok, false);
  assert.equal(result.hasVerification, false);
  assert.equal(result.verificationFailed, true);
  assert.match(result.reason, /FALLO|exit/i);
});

test("C6: Auto usa el pool verificado completo, no el recorte del picker", () => {
  const resolveFn = rendererSource.slice(
    rendererSource.indexOf("function resolveActiveChatProfile"),
    rendererSource.indexOf("function rememberAutoResolvedProfile"),
  );
  assert.match(resolveFn, /isChatModelAutoMode\(\)/);
  assert.match(resolveFn, /const options = verifiedChatModelOptions\(\)/);
  assert.doesNotMatch(resolveFn, /visibleChatModelOptions/);
  assert.equal(typeof AutoModel.pickLeastUsedEntry, "function");
  assert.equal(typeof AutoModel.pickEquitableEntry, "function");

  const meai = { model: "meai/claude-haiku-4-5", providerKey: "custom:gafcore-gateway" };
  const api = { model: "apicredits/claude-sonnet-5", providerKey: "custom:gafcore-gateway" };
  const usage = { "meai/claude-haiku-4-5": 9, "apicredits/claude-sonnet-5": 0 };
  const picked = AutoModel.pickLeastUsedEntry([meai, api], { autoModelUsage: usage });
  assert.equal(picked.model, "apicredits/claude-sonnet-5");
});

test("C7: Acceso completo autoriza proyecto + ruta que el usuario da", () => {
  assert.match(mainSource, /crossProjectAccess = selectedPermission === "full"/);
  assert.match(mainSource, /collectFullAccessRoots\(rootPath, task/);
  assert.match(mainSource, /resolveAccessibleTarget/);
  const policy = fs.readFileSync(path.join(appRoot, "project-path-policy.js"), "utf8");
  assert.match(policy, /function extractAuthorizedPaths/);
  assert.match(policy, /function collectFullAccessRoots/);
  assert.match(policy, /ruta absoluta que indiques/);
});

test("C8: Acceso completo no traga listados en chat; fallos de modelo ocultos", () => {
  const orch = fs.readFileSync(path.join(appRoot, "runtime", "intent-orchestrator.js"), "utf8");
  assert.match(orch, /isGreenfieldContinuationRequest\(effectivePrompt, \{ scaffoldIncomplete \}\)/);
  assert.match(orch, /wantsExplicitFilesystemWork\(effectivePrompt\) && !userAuth/);
  assert.doesNotMatch(orch, /wantsExplicitFilesystemWork\(effectivePrompt\) && !userAuth && !cursorParityMode/);
  assert.match(mainSource, /EMPTY_PROVIDER_RESPONSE/);
  assert.match(mainSource, /nunca mostrar hostname ni nombre de modelo/i);
  assert.match(rendererSource, /No pude completar la respuesta\. Intenta de nuevo/);
  assert.match(rendererSource, /sanitizeLiveActivityLabel|Trabajando…/);
  assert.doesNotMatch(rendererSource, /omitido; Auto usará otro modelo/);
});
