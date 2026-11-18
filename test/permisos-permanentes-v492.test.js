"use strict";

// [EDITCORE-V492-1] ACCESO COMPLETO PERMANENTE (regla de producto de
// Luis, 2026-11-11: «que quede con todos los permisos y ya»): los modos
// restrictivos (solo lectura/Charla, Pregunta antes/paso a paso)
// desaparecen como estados ALCANZABLES de la superficie. La
// normalización vive en la costura app→kernel (runtime/chat-kernel-
// bridge) y en main; la compuerta del kernel NO se toca (sus pruebas
// — permission-modes-kernel, permisos-flujo-b5 — siguen verdes sin
// cambios: la app simplemente nunca le entrega un modo restrictivo).
//
// Camino completo probado aquí: bridge → kernel → herramientas →
// disco, con el proveedor guionado y la visión falsa instaladas antes
// de cargar los módulos (tools.js desestructura al cargar).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-perm-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

// Visión falsa: la captura «funciona» sin Electron (mismo truco que
// vision-real-v491) para probar que capture tampoco se bloquea por modo.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const vision = require("../editcore-chat-kernel/vision-inspector");
vision.capture_preview_screenshot = async (opts = {}) => {
  const root = opts.projectRoot || process.cwd();
  const dir = path.join(root, ".editcore", "vision");
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, "preview-fake-v492.png");
  fs.writeFileSync(abs, PNG_BYTES);
  return {
    ok: true,
    engine: "fake-v492",
    url: opts.url || "http://127.0.0.1:5442/",
    viewport: opts.viewport || "desktop",
    screenshotPath: ".editcore/vision/preview-fake-v492.png",
    screenshotAbs: abs,
    screenshotBytes: PNG_BYTES.length,
    diagnostics: { issues: [], consoleErrors: [], renderOk: true, headings: ["Taller Prueba"] },
    renderOk: true,
  };
};

const { handleChatKernel } = require("../runtime/chat-kernel-bridge");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-perm-proj-"));
}

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedHelpers(script) {
  return { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } };
}

test("V492-1a un chat con modo guardado «solo lectura» ejecuta escritura y comando: el acceso completo permanente llega al disco", async () => {
  // [FASE2-RUTA-UNICA] Re-conducida por el kernel nuevo. El contrato
  // de producto no cambia — un chat guardado en «solo lectura»
  // ejecuta la ORDEN completa (el TALLE PRUEBA que quedó en Charla
  // y debía desbloquearse solo) — y se afirma por EFECTOS en disco,
  // no por la forma de pasos del orquestador viejo. Dos diferencias
  // declaradas: la captura de preview ya no entra en esta prueba
  // (su costura en la ruta nueva son los helpers del IDE —
  // startPreview/capturePreview —, no el modo; su no-bloqueo se
  // prueba en la batería C-12 de inspect_preview), y el anuncio
  // «Modo de este chat:» no existe en el kernel nuevo porque no hay
  // modos que anunciar.
  const root = tmpProject();
  const script = [
    {
      text: "Aplico lo pedido.",
      toolCalls: [
        toolCall("write_file", { path: "saludo.txt", content: "hola\n" }),
        toolCall("run_command", { command: "node -e \"require('fs').writeFileSync('cmd-ok.txt','ok\\n')\"" }),
      ],
      usage: {},
    },
    { text: "Listo: creé saludo.txt y ejecuté la comprobación.", toolCalls: [], usage: {} },
  ];
  const out = await handleChatKernel({
    message: "crea el archivo saludo.txt y corre la comprobación",
    history: [],
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "gpt-5",
    helpers: scriptedHelpers(script),
    // El estado guardado que trae el chat (Charla/solo lectura, sin
    // permiso de escritura, chat nuevo): exactamente el TALLE PRUEBA
    // que quedó en Charla y debía desbloquearse solo.
    permissionMode: "readonly",
    allowWrite: false,
    fullAccess: false,
    permissionFull: false,
    isNewChat: true,
  });

  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(path.join(root, "saludo.txt"), "utf8"), "hola\n", "la escritura se aplicó pese al modo guardado «solo lectura»");
  assert.equal(fs.readFileSync(path.join(root, "cmd-ok.txt"), "utf8"), "ok\n", "el comando se ejecutó pese al modo guardado");
  assert.ok(!/Modo de este chat:/.test(String(out.text || "")), "ningún anuncio de modo restrictivo en la respuesta");
});

test("V492-1b (ruta única) el opt-out del Inspector ya no conserva modo restrictivo: la compuerta de modos cesó con el kernel viejo", async () => {
  // [REDELIMITADO A PROPÓSITO — FASE 2, v5.2.7] La versión anterior
  // afirmaba que con respectRestrictiveMode el modo SÍ llegaba al
  // kernel y su compuerta cortaba la escritura. Esa compuerta era
  // del kernel viejo y se retiró con él: el kernel nuevo no tiene
  // modos de permiso (los carriles por FORMA son su única
  // disciplina: una pregunta jamás recibe herramientas de
  // escritura). Esta prueba afirma la verdad nueva, declarada:
  // ni con el opt-out histórico un turno de ORDEN se frena por
  // modo. Las corridas internas del Inspector quedan gobernadas
  // por la forma de su pedido, como todo turno.
  const root = tmpProject();
  const script = [
    { text: "", toolCalls: [toolCall("write_file", { path: "saludo.txt", content: "hola\n" })], usage: {} },
    { text: "Escribí saludo.txt.", toolCalls: [], usage: {} },
  ];
  const out = await handleChatKernel({
    message: "crea el archivo saludo.txt",
    history: [],
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "gpt-5",
    helpers: scriptedHelpers(script),
    permissionMode: "readonly",
    allowWrite: false,
    fullAccess: false,
    respectRestrictiveMode: true,
  });
  assert.equal(out.ok, true);
  assert.equal(fs.existsSync(path.join(root, "saludo.txt")), true, "declarado: en la ruta única no hay compuerta de modos que conservar");
});

test("V492-1c el plan de ejecución del renderer-analysis con el modo que la app ya siempre envía («full») no produce ruta de solo lectura", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "corrige el texto del footer de la landing",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
  });
  assert.equal(plan.directReadOnly, false, "sin ruta directReadOnly");
  assert.equal(plan.analysisMode, false, "sin modo análisis forzado por permiso");
  assert.equal(plan.mode, MODES.EXECUTE, "la ruta es de ejecución, no de descubrimiento");
});
