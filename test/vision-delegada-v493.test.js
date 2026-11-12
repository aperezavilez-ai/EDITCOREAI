"use strict";

// [EDITCORE-V493] JUICIO VISUAL DELEGADO (corrección v4.9.3, punto
// único): la compuerta de la v4.9.1 adjunta el PNG de la captura solo
// si el NOMBRE del modelo del turno pasa el patrón de visión. Con
// «Auto», el turno puede caer en un modelo sin visión y la revisión
// visual terminaba ciega (en vivo, P-3 de la v4.9.2: «la captura se ha
// hecho… pero no se adjuntó al modelo», juicio leído de los
// diagnósticos de texto). Ahora, si el modelo del turno no tiene
// visión y la captura es legible, un modelo CON visión del catálogo
// conectado dictamina la captura y su veredicto entra al turno como
// hecho (visionReview, visionDelegated:true). Sin juez alcanzable se
// conserva EXACTA la declaración honesta de la v4.9.1.
//
// Camino completo: handle → runModelTask → despacho de la herramienta
// → llamada delegada por la MISMA costura del proveedor
// (helpers.callChat) → payload que recibe el modelo principal. El fake
// de captura se instala ANTES de cargar el orquestador, igual que en
// vision-real-v491.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const VERDICT = "En el hero se ve un collage en blanco y negro de bailarines saltando; las fotos NO corresponden a un taller mecánico. Las tarjetas de servicios sí muestran motores y herramientas.";

const vision = require("../editcore-chat-kernel/vision-inspector");
vision.capture_preview_screenshot = async (opts = {}) => {
  const root = opts.projectRoot || process.cwd();
  const dir = path.join(root, ".editcore", "vision");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, "preview-fake-v493.png");
  fs.writeFileSync(abs, PNG_BYTES);
  return {
    ok: true,
    engine: "fake-v493",
    url: opts.url || "http://127.0.0.1:5442/",
    viewport: opts.viewport || "desktop",
    screenshotPath: ".editcore/vision/preview-fake-v493.png",
    screenshotAbs: abs,
    screenshotBytes: PNG_BYTES.length,
    diagnostics: { issues: [], consoleErrors: [], renderOk: true, headings: ["Taller Prueba"] },
    renderOk: true,
  };
};

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const { modelSupportsVision } = require("../runtime/vision-intake");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v493-vision-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!DOCTYPE html><html><head><title>Taller</title></head><body><div id=\"root\"></div></body></html>\n");
  fs.writeFileSync(path.join(root, "src", "App.tsx"), "export default function App() { return null; }\n");
  return root;
}

// Proveedor guionado: las llamadas del modelo del turno piden primero
// la captura y después cierran apoyándose en el dictamen; cualquier
// llamada a OTRO modelo es la delegada y devuelve el dictamen visual.
// Cada llamada se guarda con su modelo, endpoint, clave y una foto
// (JSON) de sus mensajes.
function scriptedHelpers(calls, turnModel) {
  let mainCalls = 0;
  return {
    callChat: async (args) => {
      const callKey = args.apiKey;
      calls.push({
        model: args.model,
        apiBaseUrl: args.apiBaseUrl,
        apiKey: callKey,
        messages: JSON.parse(JSON.stringify(args.messages || [])),
      });
      if (args.model !== turnModel) {
        return { text: VERDICT, toolCalls: [], usage: {} };
      }
      mainCalls += 1;
      if (mainCalls === 1) {
        return {
          text: "Capturo el preview para verificar con la vista.",
          toolCalls: [{ id: "cap1", type: "function", function: { name: "capture_preview_screenshot", arguments: "{}" } }],
          usage: {},
        };
      }
      return { text: `Veredicto: ${VERDICT}`, toolCalls: [], usage: {} };
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

const AGENT_MESSAGE = "Captura el preview de la landing, mira cómo se ve y corrige lo que esté mal";

test("V493-1 modelo del turno SIN visión + perfil con visión conectado: el juicio se delega y el dictamen entra al turno como hecho", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: AGENT_MESSAGE,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "deepseek-chat",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    fallbackProfiles: [{ providerKey: "test", baseUrl: "https://vision.invalid", apiKey: "sk-vision", model: "gpt-4o" }],
    helpers: scriptedHelpers(calls, "deepseek-chat"), history: [],
  });

  const delegated = calls.filter((c) => c.model === "gpt-4o");
  assert.equal(delegated.length, 1, "hubo exactamente una llamada delegada al modelo con visión del catálogo conectado");
  assert.equal(delegated[0].apiBaseUrl, "https://vision.invalid", "la delegada usa el endpoint del perfil conectado");
  const parts = imageParts(delegated[0].messages);
  assert.equal(parts.length, 1, "la delegada recibe la captura como parte de imagen");
  const sent = Buffer.from(parts[0].image_url.url.split(",")[1], "base64");
  assert.ok(sent.equals(PNG_BYTES), "la imagen delegada es EXACTAMENTE el PNG capturado");

  const shotStep = (out.steps || []).find((s) => s.name === "capture_preview_screenshot");
  assert.ok(shotStep, "el paso de captura quedó registrado");
  assert.equal(shotStep.result.visionAttached, false, "la imagen NO se adjuntó al modelo principal (honestidad de procedencia)");
  assert.equal(shotStep.result.visionDelegated, true, "el resultado declara la delegación");
  assert.match(String(shotStep.result.visionReview || ""), /bailarines/, "el dictamen del juez visual quedó en el resultado");
  assert.match(String(shotStep.result.visionNote || ""), /visión delegada/i, "la nota declara la procedencia del juicio");

  const mainCalls = calls.filter((c) => c.model === "deepseek-chat");
  assert.ok(mainCalls.length >= 2, "el modelo principal recibió la llamada posterior a la captura");
  assert.match(JSON.stringify(mainCalls[1].messages), /bailarines/, "el dictamen llegó al modelo principal en el payload de la herramienta");
  assert.match(String(out.text || ""), /bailarines/, "la respuesta final del turno contiene el juicio visual delegado");
  assert.doesNotMatch(String(out.text || ""), /captura sin visión/i, "la respuesta final NO declara la ceguera de la v4.9.1");
});

test("V493-2 ruta cloud (modelo del catálogo ME AI, sin perfiles): la delegada sale del MISMO endpoint y la MISMA clave del turno", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: AGENT_MESSAGE,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "meai/deepseek-v4-flash",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: scriptedHelpers(calls, "meai/deepseek-v4-flash"), history: [],
  });

  const delegated = calls.filter((c) => c.model !== "meai/deepseek-v4-flash");
  assert.equal(delegated.length, 1, "hubo exactamente una llamada delegada");
  assert.equal(modelSupportsVision(delegated[0].model), true, "el modelo delegado SÍ pasa la compuerta de visión");
  assert.equal(delegated[0].apiBaseUrl, "https://example.invalid", "la delegada usa el endpoint del turno (ruta cloud)");
  assert.equal(delegated[0].apiKey, "sk-test", "la delegada usa la clave del turno");
  assert.equal(imageParts(delegated[0].messages).length, 1, "la delegada recibe la captura como imagen");

  const shotStep = (out.steps || []).find((s) => s.name === "capture_preview_screenshot");
  assert.equal(shotStep.result.visionDelegated, true, "el resultado declara la delegación");
  assert.match(String(out.text || ""), /bailarines/, "la respuesta final contiene el juicio visual");
});

test("V493-3 control con modelo CON visión: adjunción directa como hoy, SIN delegación aunque haya juez disponible", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: AGENT_MESSAGE,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "gpt-5",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    fallbackProfiles: [{ providerKey: "test", baseUrl: "https://vision.invalid", apiKey: "sk-vision", model: "gpt-4o" }],
    helpers: scriptedHelpers(calls, "gpt-5"), history: [],
  });

  assert.equal(calls.filter((c) => c.model === "gpt-4o").length, 0, "no hubo llamada delegada");
  const mainCalls = calls.filter((c) => c.model === "gpt-5");
  assert.ok(mainCalls.length >= 2, "el proveedor recibió la llamada posterior a la captura");
  const parts = imageParts(mainCalls[1].messages);
  assert.equal(parts.length, 1, "la imagen viaja adjunta al modelo del turno, como en la v4.9.1");
  const sent = Buffer.from(parts[0].image_url.url.split(",")[1], "base64");
  assert.ok(sent.equals(PNG_BYTES), "los bytes adjuntos son el PNG capturado");

  const shotStep = (out.steps || []).find((s) => s.name === "capture_preview_screenshot");
  assert.equal(shotStep.result.visionAttached, true, "el resultado declara visionAttached:true");
  assert.notEqual(shotStep.result.visionDelegated, true, "el resultado NO declara delegación");
});

test("V493-4 sin NINGÚN modelo con visión alcanzable: se conserva exacta la declaración honesta de la v4.9.1", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: AGENT_MESSAGE,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "deepseek-chat",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: scriptedHelpers(calls, "deepseek-chat"), history: [],
  });

  assert.ok(calls.length >= 2, "el proveedor recibió la llamada posterior a la captura");
  assert.ok(calls.every((c) => c.model === "deepseek-chat"), "no se llamó a ningún otro modelo: no hubo delegación posible");
  assert.equal(imageParts(calls[1].messages).length, 0, "ninguna imagen viajó al modelo");
  const shotStep = (out.steps || []).find((s) => s.name === "capture_preview_screenshot");
  assert.ok(shotStep, "el paso de captura quedó registrado");
  assert.equal(shotStep.result.visionAttached, false, "el resultado declara visionAttached:false");
  assert.notEqual(shotStep.result.visionDelegated, true, "el resultado NO declara delegación");
  assert.match(String(shotStep.result.visionNote || ""), /captura sin visión/i, "la degradación se declara como en la v4.9.1, en español");
});
