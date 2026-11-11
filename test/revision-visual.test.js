"use strict";

// REVISIÓN VISUAL (v4.7.6): la pregunta «revisa la landing y dime si las
// imágenes corresponden al negocio» falló en vivo TRES veces (P-3): el
// agente leía archivos y juzgaba por el nombre del archivo y el texto
// alt sin mirar jamás las imágenes — en la tercera, cerró con un
// listado de carpetas mientras el hero visible era gente saltando.
// Raíz probada en código: capture_preview_screenshot estaba FILTRADA
// del set ofrecido salvo _uiTask (construcción), y ni el flag ni la
// regla de mirar entraban en un turno de pregunta. Dato que manda en
// estas pruebas: la pregunta se clasifica ASK, y ASK cae en
// listOnlyMode dentro de runModelTask tras pasar por el explorador —
// el detector, el protocolo, la compuerta y el banner tienen que
// funcionar justo en ese camino, no en uno ideal.
// El arreglo: detector isVisualReviewRequest en handle() (sujeto
// visual + intención de revisión, sin intención de mutación), la
// captura ofrecida también con _visualReviewTask, el protocolo
// REVISIÓN VISUAL en el contexto del turno, compuerta de cierre que
// devuelve el turno si va a juzgar sin haber capturado, y banner
// honesto determinista si aun así cierra sin mirar.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-revision-visual-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "public", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!DOCTYPE html><html><head><title>Taller</title></head><body><div id=\"root\"></div></body></html>\n");
  fs.writeFileSync(path.join(root, "src", "App.tsx"), "export default function App() { return null; }\n");
  fs.writeFileSync(path.join(root, "public", "assets", "hero-taller.jpg"), "fake-jpeg-bytes");
  return root;
}

const P3 = "revisa la landing y dime si las imágenes corresponden al negocio";
// Veredicto «de etiquetas»: el modelo juzga leyendo el alt, sin mirar.
const VERDICT_BY_LABELS = "Sí, las imágenes corresponden al negocio: según el código, el hero usa hero-taller.jpg con un alt de mecánico trabajando y las tarjetas usan fotos de motor, frenos y suspensión.";

function capturingHelpers(calls, responder) {
  return {
    callChat: async (args) => {
      calls.push({
        tools: (args.tools || []).map((t) => t.function?.name || t.name).filter(Boolean),
        allText: (args.messages || []).map((m) => String(m.content || "")).join("\n"),
      });
      return responder(calls.length, args);
    },
  };
}

test("revisión visual: la pregunta por las imágenes OFRECE capture_preview_screenshot y viaja con el protocolo", async () => {
  const root = tmpProject();
  const calls = [];
  const helpers = capturingHelpers(calls, async () => ({ text: VERDICT_BY_LABELS, toolCalls: [], usage: {} }));

  const orch = new ChatOrchestrator();
  await orch.handle({
    message: P3,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(calls.length >= 1, "el modelo fue llamado");
  assert.ok(calls[0].tools.includes("capture_preview_screenshot"), "la captura del preview está en las herramientas ofrecidas del turno");
  assert.ok(calls[0].allText.includes("REVISIÓN VISUAL"), "el protocolo de revisión visual viaja en el contexto del turno");
  assert.ok(calls[0].allText.includes("PROHIBIDO juzgar por el nombre del archivo"), "el protocolo prohíbe juzgar por nombre/alt");
});

test("revisión visual: juzgar sin capturar devuelve el turno UNA vez y el cierre persistente lleva el banner de no verificado", async () => {
  const root = tmpProject();
  const calls = [];
  // Modelo terco: siempre cierra con el veredicto de etiquetas, jamás captura.
  const helpers = capturingHelpers(calls, async () => ({ text: VERDICT_BY_LABELS, toolCalls: [], usage: {} }));

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: P3,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(
    calls.slice(1).some((c) => c.allText.includes("REVISIÓN VISUAL y todavía no capturaste el preview")),
    "la compuerta devolvió el turno ordenando capturar el preview activo",
  );
  const text = String(out.text || "");
  assert.ok(text.includes("Este juicio sobre las imágenes NO se verificó con la vista"), "el cierre lleva el banner honesto de no verificado");
  assert.ok(text.includes("no se capturó el preview en este turno"), "el banner dice la causa exacta");
  assert.ok(text.includes("corresponden al negocio"), "el veredicto del modelo se conserva debajo del banner (no se fabrica otro)");
});

test("revisión visual: si el modelo SÍ captura el preview, no hay compuerta ni banner", async () => {
  const root = tmpProject();
  const calls = [];
  const helpers = capturingHelpers(calls, async (n) => {
    if (n === 1) {
      return {
        text: "",
        toolCalls: [{ id: "cap1", type: "function", function: { name: "capture_preview_screenshot", arguments: JSON.stringify({}) } }],
        usage: {},
      };
    }
    // En el entorno de prueba la captura real falla (no hay preview en
    // 127.0.0.1:4568): lo que importa es que el paso EXISTA en steps.
    return { text: "Ya llamé a la captura del preview en este turno y cierro con lo que el paso reportó: sin preview activo no puedo certificar el hero; las tarjetas se ven de mecánica según la captura disponible.", toolCalls: [], usage: {} };
  });

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: P3,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok((out.steps || []).some((s) => s.name === "capture_preview_screenshot"), "el paso de captura quedó registrado en los steps del turno");
  assert.ok(!calls.some((c) => c.allText.includes("todavía no capturaste el preview")), "la compuerta no se disparó: el turno sí capturó");
  assert.ok(!String(out.text || "").includes("NO se verificó con la vista"), "sin banner: hubo captura en el turno");
});

test("revisión visual: una orden de CONSTRUCCIÓN con fotos NO se clasifica como revisión (sin protocolo ni compuerta)", async () => {
  const root = tmpProject();
  const calls = [];
  const helpers = capturingHelpers(calls, async () => ({ text: "Listo: landing creada con sus fotos.", toolCalls: [], usage: {} }));

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "crea una landing con fotos de mecánicos para un taller",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(!calls.some((c) => c.allText.includes("REVISIÓN VISUAL — este turno PREGUNTA")), "el protocolo de revisión no entra en construcción");
  assert.ok(!calls.some((c) => c.allText.includes("todavía no capturaste el preview")), "la compuerta de revisión no se dispara en construcción");
  assert.ok(!String(out.text || "").includes("NO se verificó con la vista"), "sin banner en un turno de construcción");
});

test("revisión visual: la redacción de la M-7 («mirándolas de verdad, no por el nombre») también ofrece la captura", async () => {
  const root = tmpProject();
  const calls = [];
  const helpers = capturingHelpers(calls, async () => ({ text: VERDICT_BY_LABELS, toolCalls: [], usage: {} }));

  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "Revisa las imágenes de este proyecto como revisaste las del otro taller: mirándolas de verdad, no por el nombre del archivo",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(calls.length >= 1, "el modelo fue llamado");
  assert.ok(calls[0].tools.includes("capture_preview_screenshot"), "la captura está ofrecida también con la redacción de la M-7");
  assert.ok(calls[0].allText.includes("REVISIÓN VISUAL"), "el protocolo también viaja con la redacción de la M-7");
});
