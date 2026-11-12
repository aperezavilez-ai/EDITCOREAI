"use strict";

// [EDITCORE-V491-A] VISIÓN REAL (corrección v4.9.1, bloque A): hasta la
// v4.9.0, capture_preview_screenshot devolvía solo metadatos de texto
// (vision-inspector) y el PNG capturado JAMÁS llegaba al modelo en
// ninguna ruta: el agente decía «no tengo acceso a la captura PNG (soy
// texto)» y pedía al usuario que describiera la imagen (P-3 en vivo).
// Ahora el PNG se adjunta como parte de imagen (formato multimodal de
// los adjuntos del usuario) en el siguiente mensaje al modelo dentro
// del mismo turno, en rutas AGENTE y ASK/ANALYZE; sin modelo con
// visión, el resultado lo declara («captura sin visión»).
//
// Camino completo: handle → runModelTask → despacho de la herramienta
// → payload que recibe el proveedor simulado (helpers.callChat). El
// fake de visión se instala ANTES de cargar el orquestador (tools.js y
// orchestrator.js desestructuran la función al cargarse).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// PNG real de 1×1 (bytes conocidos: la prueba exige que el payload al
// proveedor contenga EXACTAMENTE estos bytes en base64).
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const vision = require("../editcore-chat-kernel/vision-inspector");
vision.capture_preview_screenshot = async (opts = {}) => {
  const root = opts.projectRoot || process.cwd();
  const dir = path.join(root, ".editcore", "vision");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, "preview-fake-v491.png");
  fs.writeFileSync(abs, PNG_BYTES);
  return {
    ok: true,
    engine: "fake-v491",
    url: opts.url || "http://127.0.0.1:5442/",
    viewport: opts.viewport || "desktop",
    screenshotPath: ".editcore/vision/preview-fake-v491.png",
    screenshotAbs: abs,
    screenshotBytes: PNG_BYTES.length,
    diagnostics: { issues: [], consoleErrors: [], renderOk: true, headings: ["Taller Prueba"] },
    renderOk: true,
  };
};

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v491-vision-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!DOCTYPE html><html><head><title>Taller</title></head><body><div id=\"root\"></div></body></html>\n");
  fs.writeFileSync(path.join(root, "src", "App.tsx"), "export default function App() { return null; }\n");
  return root;
}

// Proveedor guionado: la primera llamada pide la captura; las demás
// cierran con texto. Guarda una FOTO (JSON) de los mensajes de cada
// llamada, porque el array del bucle se muta entre llamadas.
function capturingHelpers(calls) {
  let n = 0;
  return {
    callChat: async (args) => {
      n += 1;
      calls.push(JSON.parse(JSON.stringify(args.messages || [])));
      if (n === 1) {
        return {
          text: "Capturo el preview para verificar con la vista.",
          toolCalls: [{ id: "cap1", type: "function", function: { name: "capture_preview_screenshot", arguments: "{}" } }],
          usage: {},
        };
      }
      return { text: "Veredicto: el hero se ve correcto y las tarjetas corresponden al negocio.", toolCalls: [], usage: {} };
    },
  };
}

function imageParts(messages) {
  const parts = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part && part.type === "image_url" && part.image_url && part.image_url.url) parts.push(part);
    }
  }
  return parts;
}

test("V491-A1 ruta AGENTE con modelo con visión: el PNG de la captura llega al proveedor como parte image_url en el mismo turno", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "Captura el preview de la landing, mira cómo se ve y corrige lo que esté mal",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "gpt-5",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: capturingHelpers(calls), history: [],
  });

  assert.ok(calls.length >= 2, "el proveedor recibió la llamada posterior a la captura");
  const parts = imageParts(calls[1]);
  assert.equal(parts.length, 1, "exactamente una parte de imagen viaja en el siguiente mensaje al modelo");
  assert.ok(parts[0].image_url.url.startsWith("data:image/png;base64,"), "la parte es un PNG en data URL");
  const sent = Buffer.from(parts[0].image_url.url.split(",")[1], "base64");
  assert.ok(sent.equals(PNG_BYTES), "los bytes enviados son EXACTAMENTE el PNG capturado, no un marcador");

  const shotStep = (out.steps || []).find((s) => s.name === "capture_preview_screenshot");
  assert.ok(shotStep, "el paso de captura quedó registrado");
  assert.equal(shotStep.result.visionAttached, true, "el resultado declara visionAttached:true");
});

test("V491-A2 sin modelo con visión: NO se adjunta imagen y el resultado declara «captura sin visión» (nadie finge el juicio)", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "Captura el preview de la landing, mira cómo se ve y corrige lo que esté mal",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: capturingHelpers(calls), history: [],
  });

  assert.ok(calls.length >= 2, "el proveedor recibió la llamada posterior a la captura");
  assert.equal(imageParts(calls[1]).length, 0, "sin visión no viaja ninguna parte de imagen");
  const shotStep = (out.steps || []).find((s) => s.name === "capture_preview_screenshot");
  assert.ok(shotStep, "el paso de captura quedó registrado");
  assert.equal(shotStep.result.visionAttached, false, "el resultado declara visionAttached:false");
  assert.match(String(shotStep.result.visionNote || ""), /captura sin visión/i, "la degradación se declara en el resultado, en español");
});

test("V491-A3 ruta ASK en SOLO LECTURA (la forma de la P-3): la imagen también llega al modelo", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "revisa la landing y dime si las imágenes corresponden al negocio",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "gpt-5",
    permissionMode: "readonly", allowWrite: false, fullAccess: false,
    helpers: capturingHelpers(calls), history: [],
  });

  assert.ok(calls.length >= 2, "el proveedor recibió la llamada posterior a la captura");
  const parts = imageParts(calls[1]);
  assert.equal(parts.length, 1, "en la ruta ASK la captura también viaja como imagen");
  const sent = Buffer.from(parts[0].image_url.url.split(",")[1], "base64");
  assert.ok(sent.equals(PNG_BYTES), "los bytes son el PNG capturado");
});
