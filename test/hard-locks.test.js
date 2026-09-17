"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { ActionRegistry } = require("../runtime/action-registry");
const {
  looksLikePromptEcho,
} = require("../runtime/editcore-claude-adapter");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");
const { preferSourceOverAsar, isInsideAsar } = require("../project-path-policy");
const ProjectAnalysis = require("../project-analysis");

const appRoot = path.join(__dirname, "..");
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(appRoot, "runtime", "editcore-claude-adapter.js"), "utf8");

test("H1: ActionRegistry cachea read_file por path normalizado (no 3 lecturas a disco)", () => {
  const registry = new ActionRegistry();
  const root = "D:/PROGRAMAS IA/EDITCOREAI";
  const a = { name: "read_file", input: { path: "resources\\app\\runtime\\agent-runtime.js" }, projectRoot: root };
  const b = { name: "read_file", input: { path: "resources/app/runtime/agent-runtime.js" }, projectRoot: root };
  const c = { name: "read_file", input: { path: "./resources/app/runtime/agent-runtime.js" }, projectRoot: root };
  registry.record(a, { content: "ok-1" }, true);
  assert.equal(registry.wasExecuted(b), true);
  assert.equal(registry.wasExecuted(c), true);
  assert.equal(registry.getResult(b).content, "ok-1");
  assert.equal(registry.hash(a), registry.hash(b));
});

test("H1b: adapter usa CACHE HIT en vez de error en repeats>=1", () => {
  assert.match(adapterSource, /CACHE HIT: mismo archivo/);
  assert.match(adapterSource, /cachedResult = this\.actionRegistry\.getResult\(action\)/);
  assert.doesNotMatch(adapterSource, /repeats >= 1[\s\S]{0,80}error/);
});

test("H2: analysisMode / NO MODIFICAR deniega write en authorize", () => {
  assert.match(mainSource, /readonlyDiagnostic/);
  assert.match(mainSource, /if \(readonlyDiagnostic && tool\.write\) return false/);
  assert.match(mainSource, /NO\s+MODIFICAR/);
});

test("H2b: evidenceFinalText en analysisMode no es Verificacion completada", () => {
  assert.match(adapterSource, /if \(input\?\.analysisMode === true\) \{\s*return this\.buildAnalysisFallbackReport/);
  assert.match(adapterSource, /PROHIBIDO "Verificacion completada/);
});

test("H2c: eco del prompt se rechaza", () => {
  const prompt = "EDITCOREAI — AUTOAUDITORÍA FORENSE DE SU PROPIO RUNTIME\nMODO: DIAGNÓSTICO — NO MODIFICAR ARCHIVOS\nQuiero que audites el proyecto";
  assert.equal(looksLikePromptEcho(prompt, prompt), true);
  assert.equal(looksLikePromptEcho(prompt, `${prompt}\n\nextra`), true);
  assert.equal(looksLikePromptEcho(prompt, "## Qué sí funcionó\n\nLa app abre."), false);
  assert.match(adapterSource, /looksLikePromptEcho/);
});

test("H3: un agente por projectRoot + steer de nudges", () => {
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PORQUE NO AVANZAS"), true);
  assert.match(rendererSource, /sameProject/);
  assert.match(rendererSource, /un solo agente con tools por projectRoot/);
});

test("H3b: analisis no pone skipBrain", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "AUDITORIA FORENSE MODO DIAGNOSTICO NO MODIFICAR. Analiza el runtime y dame reporte.",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    cursorParityEnabled: true,
  });
  assert.equal(plan.mode, MODES.DISCOVER);
  assert.equal(plan.analysisMode, true);
  assert.equal(plan.skipBrain, false);
  assert.ok(plan.allowedTools.includes("brain_search"));
  assert.match(adapterSource, /brainRequiredNudgeSent/);
});

test("H4: Limpiar restaura Bienvenido", () => {
  const start = rendererSource.indexOf("function clearActiveProject");
  const clearFn = rendererSource.slice(start, start + 800);
  assert.match(clearFn, /chatCleared = false/);
  assert.match(clearFn, /Bienvenido a EditCoreAI/i);
});

test("H4b: preferSourceOverAsar evita app-progress.asar", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-asar-"));
  const appDir = path.join(tmp, "app");
  fs.mkdirSync(appDir);
  const fakeAsar = path.join(tmp, "app-progress.asar");
  fs.writeFileSync(fakeAsar, "fake");
  // En Node puro .asar no es directory; preferSourceOverAsar debe preferir app/ si existe.
  const preferred = preferSourceOverAsar(fakeAsar);
  assert.equal(preferred.toLowerCase(), appDir.toLowerCase());
  assert.equal(isInsideAsar(preferred), false);
  fs.rmSync(tmp, { recursive: true, force: true });
});
