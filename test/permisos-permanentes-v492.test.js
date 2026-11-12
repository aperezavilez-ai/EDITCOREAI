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

test("V492-1a un chat con modo guardado «solo lectura» ejecuta escritura, comando y captura: el bridge normaliza a acceso completo", async () => {
  const root = tmpProject();
  const events = [];
  // El mensaje menciona la captura y el turno nace con la compuerta de
  // evidencia: el modelo captura primero y después escribe/ejecuta
  // (orden real de trabajo; la compuerta no es de modo, es de evidencia).
  const script = [
    { text: "Primero capturo el preview.", toolCalls: [toolCall("capture_preview_screenshot", {})], usage: {} },
    {
      text: "Ahora aplico lo pedido.",
      toolCalls: [
        toolCall("write_file", { path: "saludo.txt", content: "hola\n" }),
        toolCall("run_command", { command: "node -e \"process.exit(0)\"" }),
      ],
      usage: {},
    },
    { text: "Listo: creé saludo.txt, ejecuté el comando y capturé el preview.", toolCalls: [], usage: {} },
  ];
  const out = await handleChatKernel({
    message: "crea el archivo saludo.txt, corre la comprobación y captura el preview",
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
    onProgress: (ev) => events.push(ev),
  });

  assert.equal(fs.readFileSync(path.join(root, "saludo.txt"), "utf8"), "hola\n", "la escritura se aplicó pese al modo guardado «solo lectura»");
  const blocked = (out.steps || []).filter((s) => s.result && (s.result.blockedReadOnly || s.result.needsAuthorization));
  assert.equal(blocked.length, 0, "ningún paso quedó bloqueado por modo (ni blockedReadOnly ni needsAuthorization)");
  const capture = (out.steps || []).find((s) => s.name === "capture_preview_screenshot");
  assert.ok(capture && capture.ok !== false && capture.result?.ok === true, "la captura se ejecutó (no bloqueada por modo)");
  const command = (out.steps || []).find((s) => s.name === "run_command");
  assert.ok(command && command.ok !== false, "el comando se ejecutó (no bloqueado por modo)");
  assert.ok(
    !events.some((e) => /Modo de este chat:/.test(String(e.text || ""))),
    "el anuncio de modo restrictivo nunca se disparó (sin línea «Modo de este chat: …» en el progreso)",
  );
  assert.ok(!/Modo de este chat:/.test(String(out.text || "")), "ni en la respuesta final");
});

test("V492-1b el opt-out del Inspector (respectRestrictiveMode) conserva el modo explícito: la compuerta del kernel sigue intacta", async () => {
  const root = tmpProject();
  const script = [
    { text: "", toolCalls: [toolCall("write_file", { path: "saludo.txt", content: "hola\n" })], usage: {} },
    { text: "No pude escribir en modo solo lectura.", toolCalls: [], usage: {} },
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
  assert.equal(fs.existsSync(path.join(root, "saludo.txt")), false, "con el opt-out interno el modo restrictivo SÍ llega al kernel y la compuerta corta: no se escribió");
  assert.ok((out.steps || []).some((s) => s.result && (s.result.blockedReadOnly || s.result.needsAuthorization)), "el corte vino de la compuerta del kernel, no de la superficie");
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
