"use strict";

// [EDITCORE-V492-5] DIETA DE LLAMADAS (en vivo, ediciones simples
// tomaron 7–10 llamadas y 67k–171k tokens por turno; el costo POR
// llamada ya era bajo desde la B2): se recorta la redundancia sin
// bajar la evidencia:
//  (a) la verificación captura UNA vista por defecto (desktop); la
//      móvil solo para layout/responsive o a petición — las
//      instrucciones que mandaban DOS capturas (descripción de la
//      herramienta, protocolo de base, política élite) ya dicen una.
//  (b) releer en el mismo turno un archivo ya leído devuelve un
//      comprobante corto, no el contenido completo otra vez; la
//      lectura forzada (force:true) sí relee, y una escritura
//      invalida la caché de lecturas de ese archivo.
//  (c) fetch_stock_photo devuelve las candidatas en una llamada
//      (probado en bancos-imagenes-v492).
// NO se debilita: la compuerta de verificación real ni la captura en
// turnos de revisión visual (última prueba: ahí la imagen es el punto).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-dieta-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

// Visión falsa instalada ANTES de cargar el orquestador (tools.js
// desestructura la captura al cargar), como en vision-real-v491.
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

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedHelpers(script, payloads) {
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      if (payloads) payloads.push(JSON.stringify(args?.messages || []));
      return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
    },
  };
  return { helpers, count: () => calls };
}

const MARKER = "MARCA-UNICA-DEL-CONTENIDO";

function projectWithNotes() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-dieta-proj-"));
  const lines = [`${MARKER} — primera línea con la marca`];
  for (let i = 2; i <= 30; i += 1) lines.push(`línea ${i} de relleno del archivo de notas`);
  fs.writeFileSync(path.join(root, "notas.txt"), `${lines.join("\n")}\n`);
  return root;
}

test("V492-5a releer el mismo archivo en el turno devuelve un comprobante corto; la lectura forzada sí relee de disco", async () => {
  const root = projectWithNotes();
  const payloads = [];
  const script = [
    { text: "Leo el archivo.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Lo leo otra vez para confirmar.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Ahora lo releo forzado.", toolCalls: [toolCall("read_file", { path: "notas.txt", force: true })], usage: {} },
    { text: "Ya revisé notas.txt a fondo.", toolCalls: [], usage: {} },
  ];
  const { helpers } = scriptedHelpers(script, payloads);
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "revisa notas.txt a fondo antes de actualizarlo",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "gpt-5",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  const reads = (out.steps || []).filter((s) => s.name === "read_file");
  assert.equal(reads.length, 3, "las tres lecturas quedaron registradas como pasos");
  assert.ok(String(reads[0].result?.content || "").includes(MARKER), "la primera lectura trajo el contenido completo");
  assert.equal(reads[1].result?.alreadyReadThisTurn, true, "la segunda lectura es el comprobante «ya leído en este turno»");
  assert.equal(reads[1].result?.content, undefined, "el comprobante NO repite el contenido completo");
  assert.match(String(reads[1].result?.note || ""), /ya leíste/i, "el comprobante lo dice en español y nombra el remedio (force:true)");
  assert.ok(String(reads[2].result?.content || "").includes(MARKER), "la lectura forzada trajo el contenido de disco otra vez");
  // En el payload que vio el modelo al cerrar, la marca aparece solo
  // por las lecturas REALES (primera + forzada), no por la repetida.
  const lastPayload = payloads[payloads.length - 1] || "";
  assert.equal((lastPayload.match(new RegExp(MARKER, "g")) || []).length, 2, "el contenido completo se pagó dos veces (lectura + forzada), no tres");
});

test("V492-5b una escritura sobre el archivo invalida su caché: la siguiente lectura trae el contenido NUEVO, no el comprobante", async () => {
  const root = projectWithNotes();
  const script = [
    { text: "Leo el archivo.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Corrijo la marca.", toolCalls: [toolCall("replace_in_file", { path: "notas.txt", oldText: MARKER, newText: "MARCA-NUEVA-CORREGIDA" })], usage: {} },
    { text: "Confirmo el cambio releyendo.", toolCalls: [toolCall("read_file", { path: "notas.txt" })], usage: {} },
    { text: "Corregí la marca en notas.txt.", toolCalls: [], usage: {} },
  ];
  const { helpers } = scriptedHelpers(script);
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "actualiza el texto de notas.txt: sustituye la marca por la nueva redacción",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "gpt-5",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  const reads = (out.steps || []).filter((s) => s.name === "read_file");
  assert.equal(reads.length, 2);
  assert.notEqual(reads[1].result?.alreadyReadThisTurn, true, "tras escribir, la lectura NO es el comprobante viejo");
  assert.ok(String(reads[1].result?.content || "").includes("MARCA-NUEVA-CORREGIDA"), "la relectura trae el contenido ya corregido");
});

test("V492-5c un turno de edición simple (texto del footer) completa en ≤5 llamadas con verificación incluida y UNA captura", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-dieta-proj-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "taller-prueba", scripts: { build: "node -e \"process.exit(0)\"" } }, null, 2));
  fs.writeFileSync(
    path.join(root, "index.html"),
    "<!DOCTYPE html><html><head><title>Taller Prueba</title></head><body><h1>Taller Prueba</h1><footer><p>Horario: 9 a 6</p></footer></body></html>\n",
  );
  const script = [
    { text: "Leo la página.", toolCalls: [toolCall("read_file", { path: "index.html" })], usage: {} },
    { text: "Cambio el horario del footer.", toolCalls: [toolCall("replace_in_file", { path: "index.html", oldText: "Horario: 9 a 6", newText: "Horario: 9 a 8" })], usage: {} },
    { text: "Verifico con una captura.", toolCalls: [toolCall("capture_preview_screenshot", {})], usage: {} },
    { text: "Listo: el footer ahora dice Horario: 9 a 8 y lo verifiqué en el preview.", toolCalls: [], usage: {} },
  ];
  const { helpers, count } = scriptedHelpers(script);
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "cambia el texto del footer de index.html: el horario ahora es de 9 a 8",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "gpt-5",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(fs.readFileSync(path.join(root, "index.html"), "utf8").includes("Horario: 9 a 8"), "el cambio quedó aplicado en disco");
  assert.ok(count() <= 5, `el turno cerró en ${count()} llamadas al modelo (≤5, con verificación incluida)`);
  const captures = (out.steps || []).filter((s) => s.name === "capture_preview_screenshot");
  assert.equal(captures.length, 1, "la verificación del turno capturó UNA vista (desktop), no dos");
  // [EDITCORE-V492-2] Los Hechos del turno siguen existiendo en su
  // forma actual: el pliegue colapsado no es viable sin reescribir el
  // pintado del renderer (escapa todo HTML y no reconoce <details>
  // desde el texto del mensaje), así que el bloque queda como está.
  assert.ok(String(out.text || "").includes("## 🧾 Hechos del turno (kernel)"), "el bloque de Hechos del turno sigue presente en su forma actual");
});

test("V492-5d un turno de REVISIÓN VISUAL sigue capturando y adjuntando la imagen (la dieta no aplica ahí)", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-dieta-proj-"));
  fs.writeFileSync(
    path.join(root, "index.html"),
    "<!DOCTYPE html><html><head><title>Taller Prueba</title></head><body><h1>Taller Prueba</h1><img src=\"assets/hero.jpg\" alt=\"hero\"></body></html>\n",
  );
  const payloads = [];
  const script = [
    { text: "Capturo el preview para mirar.", toolCalls: [toolCall("capture_preview_screenshot", {})], usage: {} },
    { text: "Veredicto: en el hero se ve el taller con un mecánico trabajando; corresponde al negocio.", toolCalls: [], usage: {} },
  ];
  const { helpers } = scriptedHelpers(script, payloads);
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "revisa la landing y dime si las imágenes corresponden al negocio",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "gpt-5",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  const captures = (out.steps || []).filter((s) => s.name === "capture_preview_screenshot");
  assert.equal(captures.length, 1, "el turno de revisión capturó el preview");
  assert.ok(
    payloads.some((p) => p.includes("image_url")),
    "el PNG llegó al modelo como imagen en el mismo turno (la revisión visual no se dietó)",
  );
});
