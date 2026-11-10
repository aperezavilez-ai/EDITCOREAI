"use strict";

// Fase Calidad de creación: que EditCore construya webs/SaaS/apps con acabado
// profesional y no plantillas genéricas. Tres palancas verificadas aquí:
// C1 "ojos" (capture_preview_screenshot entra al bucle del agente en tareas
// de UI/construcción, con protocolo de verificación visual en la política
// élite), C2 arranque profesional (pickScaffoldTemplate elige la plantilla
// del catálogo según el pedido) y C3 diseño forzado (la política élite y las
// skills de diseño se inyectan en turnos de construcción aunque el mensaje
// no traiga palabras clave de diseño).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ProjectAnalysisRoot = require("../project-analysis");
const ProjectAnalysisRuntime = require("../runtime/project-analysis");
const tools = require("../editcore-chat-kernel/tools");
const elite = require("../runtime/elite-ui-policy");
const { skillsPrompt } = require("../editcore-chat-kernel/skills-catalog");
const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

const REPO_ROOT = path.join(__dirname, "..");

test("C2: pickScaffoldTemplate elige la plantilla profesional según el pedido (ambas copias)", () => {
  const cases = [
    ["créame un SaaS de reservas con suscripciones y pagos con stripe", "next-saas"],
    ["quiero una landing para mi taller mecánico", "pro-web-app"],
    ["créame una app de punto de venta para mi tienda", "pro-web-app"],
    ["una app de notas con login", "pro-web-app"],
    ["una API REST para consultar el inventario", "node"],
    ["un script de python para limpiar un csv", "blank"],
    ["un ERP para llevar mi empresa", "enterprise-erp-base"],
    ["una app de escritorio con tauri para mi tienda", "blank"],
    ["", "blank"],
  ];
  for (const PA of [ProjectAnalysisRoot, ProjectAnalysisRuntime]) {
    for (const [text, expected] of cases) {
      assert.equal(PA.pickScaffoldTemplate(text), expected, `«${text}» → ${expected}`);
    }
  }
});

test("C1: la herramienta de captura existe en el catálogo del agente y responde sin explotar", async () => {
  const defs = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true, isAnalysis: false });
  assert.ok(defs.some((t) => (t.function?.name || t.name) === "capture_preview_screenshot"), "la definición debe existir");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-quality-"));
  // Sin servidor en ese puerto: debe devolver ok:false con error, no lanzar.
  const res = await tools.execute("capture_preview_screenshot", { url: "http://127.0.0.1:9/", viewport: "desktop" }, tmp, true);
  assert.equal(typeof res, "object");
  assert.equal(res.ok, false);
});

test("C1+C3: la política élite trae el protocolo de verificación visual y detecta construcción", () => {
  const prompt = elite.eliteUiSystemPrompt();
  assert.match(prompt, /verificación visual/i);
  assert.match(prompt, /capture_preview_screenshot/);
  assert.equal(elite.isUiOrBuildTask("créame una app de citas para mi negocio"), true);
  assert.equal(elite.isUiOrBuildTask("corrige el cálculo de impuestos del servidor"), false);
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

test("C1+C3: en una construcción de UI el agente SÍ recibe la captura y la política élite", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-quality-"));
  const { out, capture } = await runKernel("crea una landing para mi taller mecánico con servicios y precios", tmp);
  assert.equal(out.kind, "EXECUTE");
  assert.ok(capture.length >= 1);
  assert.ok(capture[0].tools.includes("capture_preview_screenshot"), "el agente debe poder VER lo que construyó");
  assert.ok(capture[0].tools.includes("write_file"));
  assert.match(capture[0].allText, /ELITE UI/);
});

test("C1: en una tarea SIN UI la captura sigue fuera de la caja (sin regresión)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-quality-"));
  const { out, capture } = await runKernel("corrige el cálculo de impuestos en el servidor", tmp);
  assert.equal(out.kind, "EXECUTE");
  assert.ok(capture.length >= 1);
  assert.ok(!capture[0].tools.includes("capture_preview_screenshot"));
  assert.ok(capture[0].tools.includes("write_file"));
});

test("C3: las skills de diseño se inyectan en un pedido de construcción aunque no diga 'diseño'", () => {
  const prompt = skillsPrompt(REPO_ROOT, "EXECUTE", "créame una landing para mi taller mecánico");
  assert.match(prompt, /SKILL antislop-ui \(/);
  assert.match(prompt, /SKILL frontend-design \(/);
});

test("C3: en un turno sin UI las skills de diseño NO se fuerzan", () => {
  const prompt = skillsPrompt(REPO_ROOT, "EXECUTE", "corrige el error de sintaxis en el servidor de correo");
  assert.doesNotMatch(prompt, /SKILL antislop-ui \(/);
  assert.doesNotMatch(prompt, /SKILL frontend-design \(/);
});

test("C2: el renderer crea el proyecto desde la conversación con la plantilla elegida", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "renderer.js"), "utf8");
  assert.match(source, /ProjectAnalysis\.pickScaffoldTemplate\(templateText\)/);
  assert.match(source, /template, install: template !== "blank"/);
});
