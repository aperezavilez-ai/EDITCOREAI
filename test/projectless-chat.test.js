"use strict";

// Chat sin proyecto (conversación libre): abrir la app y platicar/preguntar
// sin carpeta abierta ya no choca con un muro. Las ideas/specs se conversan
// sin herramientas de disco; el proyecto se crea desde la conversación
// cuando el primer trabajo de agente llega (ensureDesktopProjectForAgent).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ProjectAnalysisRoot = require("../project-analysis");
const ProjectAnalysisRuntime = require("../runtime/project-analysis");
const { resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");
const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

const BRAINSTORM = "quiero crear una app de punto de venta para mi tienda, ¿por dónde empiezo?";
const SPEC = "créame una app de punto de venta completa con login, inventario y cortes de caja";

test("sin proyecto: una idea/spec nueva NO es missingProject (ambas copias de project-analysis)", () => {
  for (const PA of [ProjectAnalysisRoot, ProjectAnalysisRuntime]) {
    assert.equal(PA.resolveExecutionMode(BRAINSTORM, { requestedAgent: false, projectOpen: false }).missingProject, false);
    assert.equal(PA.resolveExecutionMode(SPEC, { requestedAgent: false, projectOpen: false }).missingProject, false);
    assert.equal(PA.resolveExecutionMode("quiero hacer una aplicación para llevar el control de mi negocio", { requestedAgent: false, projectOpen: false }).missingProject, false);
  }
});

test("sin proyecto: el trabajo sobre algo EXISTENTE sigue siendo missingProject", () => {
  for (const PA of [ProjectAnalysisRoot, ProjectAnalysisRuntime]) {
    assert.equal(PA.resolveExecutionMode("corrige este proyecto", { requestedAgent: false, projectOpen: false }).missingProject, true);
    assert.equal(PA.resolveExecutionMode("crea un archivo de configuración con las claves", { requestedAgent: false, projectOpen: false }).missingProject, true);
  }
});

test("sin proyecto: el plan unificado de una idea es conversación, no muro", () => {
  const plan = resolveUnifiedAgentPlan({ prompt: BRAINSTORM, requestedAgent: false, projectOpen: false, permissionMode: "step", allowWrite: true });
  assert.equal(plan.missingProject, false);
  assert.equal(plan.mode, "chat");
  assert.equal(plan.isAgent, false);
});

function fakeHelpers(capture) {
  return {
    callChat: async (args) => {
      capture.push({
        tools: (args.tools || []).map((t) => t.function?.name || t.name),
        allText: (args.messages || []).map((m) => String(m.content || "")).join("\n"),
      });
      return { text: "Respuesta simulada del modelo.", toolCalls: [], usage: {} };
    },
  };
}

async function runKernel(message, projectRoot) {
  const capture = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message, projectRoot, apiKey: "sk-test",
    apiBaseUrl: "https://example.invalid", model: "test-model",
    helpers: fakeHelpers(capture), history: [],
  });
  return { out, capture };
}

test("kernel sin proyecto: la idea se CONVERSA (antes: negativa sin llamar al modelo)", async () => {
  const { out, capture } = await runKernel(BRAINSTORM, "");
  assert.equal(out.kind, "CHAT");
  assert.equal(out.text, "Respuesta simulada del modelo.");
  assert.ok(capture.length >= 1, "el modelo sí fue llamado");
  for (const call of capture) assert.deepEqual(call.tools, [], "sin proyecto no se ofrece ninguna herramienta de disco");
  assert.match(capture[0].allText, /MODO CONVERSACIÓN SIN PROYECTO/);
});

test("kernel sin proyecto: una pregunta pura tampoco recibe herramientas (antes leía el CWD)", async () => {
  const { out, capture } = await runKernel("¿qué es un punto de venta?", "");
  assert.equal(out.kind, "CHAT");
  assert.ok(capture.length >= 1);
  for (const call of capture) assert.deepEqual(call.tools, []);
});

test("kernel sin proyecto: analizar un proyecto inexistente mantiene la negativa", async () => {
  const { out, capture } = await runKernel("analiza este proyecto", "");
  assert.equal(capture.length, 0, "sin modelo: la negativa es local");
  assert.match(String(out.text || ""), /Abrí un proyecto primero/);
});

test("kernel CON proyecto: la misma idea sigue siendo EXECUTE con herramientas (sin regresión)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-projectless-"));
  const { out, capture } = await runKernel(BRAINSTORM, tmp);
  assert.equal(out.kind, "EXECUTE");
  assert.ok(capture.length >= 1);
  assert.ok(capture[0].tools.includes("write_file"), "con proyecto el agente conserva sus herramientas");
});

test("renderer: el agente sin proyecto crea el proyecto desde la conversación (escritorio)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(source, /async function ensureDesktopProjectForAgent\(job\)/);
  assert.match(source, /!window\.EDITCORE_IS_WEB && typeof ensureDesktopProjectForAgent === "function"/);
  assert.match(source, /window\.editcoreProject\.create\(\{ name: candidate, parentPath, template, install: template !== "blank"/);
  assert.match(source, /project\.projectRoot = created\.root/);
  // El error clásico queda como último recurso cuando la creación falla.
  assert.match(source, /Indica una ruta absoluta \(ej\. D:\\\\PROGRAMAS IA\) con Acceso completo, o abre un proyecto\./);
});
