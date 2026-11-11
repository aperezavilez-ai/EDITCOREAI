"use strict";

// [EDITCORE-INTEGRAL-B10] La parte viva (ActionRegistry, kernel, planes,
// renderer, project-path-policy) sigue en la suite; H1b/H2b/H2c del
// adaptador salieron a test-quarantine/claude-adapter/extracted-hard-locks.test.js
// y la aserción del adaptador dentro de H3b se extrajo con ellos.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { ActionRegistry } = require("../runtime/action-registry");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");
const { preferSourceOverAsar, isInsideAsar } = require("../project-path-policy");
const ProjectAnalysis = require("../project-analysis");

const appRoot = path.join(__dirname, "..");
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");

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

test("H2: analysisMode / NO MODIFICAR deniega write en authorize", () => {
  // [COSECHA MODO AGENTE] La denegación ya no vive en el authorize() del
  // despachador legado (readonlyDiagnostic): vive en la guardia previa al
  // despacho del orquestador del kernel, que corta TODAS las WRITE_TOOLS
  // cuando el turno no puede escribir y marca el paso blockedReadOnly.
  const orchSource = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "orchestrator.js"), "utf8");
  assert.match(orchSource, /WRITE_TOOLS\.includes\(name\)/);
  assert.match(orchSource, /blockedReadOnly: true/);
  assert.match(orchSource, /Modo solo lectura: no se ejecutan herramientas de escritura/);
});

test("H3: un escritor por chat (paralelo entre chats) + steer de nudges", () => {
  // Contrato ACTUALIZADO a propósito (multiagente, 2026-11-10): el
  // candado por projectRoot se sustituyó por arbitraje por chat con
  // locks por archivo. Antes esto afirmaba el candado por proyecto.
  assert.equal(ProjectAnalysis.shouldSteerLiveAgent("PORQUE NO AVANZAS"), true);
  assert.match(rendererSource, /Concurrencia entre escritores: se arbitra POR CHAT/);
  assert.match(rendererSource, /chatId: project\?\.activeChatId/);
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
