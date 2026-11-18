"use strict";

// Batería — ÍTEM 5 DEL PLAN: CONTABILIDAD ÚNICA DE «APLICADO».
// EL FALSO POSITIVO «NADA QUEDÓ APLICADO» EN TURNOS DE MEMORIA.
// Caso real (ALFA LUBES, 2026-11-15, sobre la v5.2.0): el turno de
// corrección de memoria EJECUTÓ la tarea literal — asentó 4 decisiones
// con note_map_decision (ok:true) y verificó con comando que
// _check_env.py no existía — y aun así el kernel imprimió la nota de
// cierre B1 («no registró ninguna escritura… Nada quedó aplicado»),
// los hechos dijeron «El kernel no registró ninguna escritura aplicada
// en este turno» y el recibo repartió «aplicados 0». Causa (auditoría
// B24+B28): successfulWritePaths solo cuenta RUTAS de archivo
// (write_file, replace_in_file, scaffold_project) y el filtro estaba
// triplicado a mano (resumen de hechos, predicado de settleIteration y
// subagent-distill); las herramientas del Mapa son escritura desde la
// v5.1.3-W3 (classify.js, WRITE_TOOLS) pero no producen rutas y eran
// invisibles para esa contabilidad. El falso positivo induce al
// usuario a repetir el turno (quemar tokens otra vez por un trabajo
// ya aplicado).
// La corrección: UNA sola fuente de «aplicado» — el predicado de
// escritura compartido (isSuccessfulWriteStep), la contabilidad
// hermana successfulMemoryWrites (mutaciones de memoria EFECTIVAS
// desde la forma de retorno: note_map_decision ok recorded:"decision",
// open_map_front ok recorded:"front", close_map_front SOLO con
// closed === true — sin match no cambió nada y NO salva al turno de
// la nota — e ingest_to_brain ok con ingested > 0) y
// successfulExternalActions (publish_project / deploy_one_click /
// connect_project con ok) — consumida por la nota B1 (condición de
// triple vacío: archivos, memoria y acciones externas), los hechos,
// la declaración de término, la constancia, el destilado al Mapa y el
// predicado de settleIteration (que además cuenta run_command con ok
// cuando el turno es de tarea, EXECUTE). La garantía de honestidad no
// se debilita: sin archivos, sin memoria efectiva y sin acción
// externa, la nota sale como siempre. La línea «Aplicado:» de la
// rendición B4 sigue listando rutas (superficie fuera de alcance).
// El ÍTEM 4 ya había traído la publicación a los hechos y al
// destilado con su propia lectura; esta batería cubre lo que faltaba:
// la memoria en TODAS las superficies y el recibo (settleIteration)
// para memoria, publicación y comandos de tarea.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-cierre-memoria-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

// [FASE2-RUTA-UNICA] De esta batería sobreviven las dos pruebas de
// módulo vivo: successfulMemoryWrites (mudada del orquestador a
// subagent-distill en esta fase, su consumidor) y el destilado al
// Mapa. Las demás afirmaban el formateador de hechos, la
// declaración de término y el recibo del orquestador viejo
// (buildKernelFactSummary / substantiveFallbackText /
// nextStepsClosingText / successfulExternalActions y los turnos
// (a)-(h)): se retiran con él; el cierre desde los hechos del
// kernel nuevo vive en cierre.js (batería kernel-nuevo-cierre).
const {
  successfulMemoryWrites,
} = require("../editcore-chat-kernel/subagent-distill");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const { distillTurnForBrain } = require("../editcore-chat-kernel/subagent-distill");

const BASE_ARGS = {
  apiKey: "sk-fake-cierre-memoria",
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

let callSeq = 0;
function toolCall(name, args) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedHelpers(script) {
  let calls = 0;
  return {
    callChat: async () => {
      calls += 1;
      const step = script[Math.min(calls - 1, script.length - 1)];
      return typeof step === "function" ? step(calls) : step;
    },
  };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(tmpBase, "proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// El pedido del caso real, con su intención de mutación: asentar
// decisiones en el Mapa y dejar la memoria corregida.
const CORRECTION_TEXT = "Corrección de memoria del proyecto: asienta en el Mapa estas decisiones y déjalas asentadas: (1) la publicación a producción ya se hizo el 2026-11-14 con commit cc75c0a y el alias www.alfalubes.com está en vivo; (2) las variables de Vercel ya se cargaron en Production y el redespliegue quedó probado; (3) el .env está completo con prefijo MEAI_ y app.py lo resuelve en las líneas 46-48; (4) no existe ninguna regla de publicar los lunes, elimínala si el Mapa la trae. Al terminar dime qué quedó asentado.";

const DECISIONS = [
  "Publicación completada el 2026-11-14: commit cc75c0a en main, alias www.alfalubes.com en vivo, HTTP 200.",
  "Variables de Vercel cargadas en Production y redespliegue probado.",
  ".env completo con prefijo MEAI_; app.py lo resuelve en las líneas 46-48.",
  "Sin regla de publicar los lunes: nunca estuvo establecida.",
];

function step(name, result, input = {}) {
  return { name, input, result, ok: result?.ok !== false };
}

// ------------------------------------------------------------ unidades
test("(U1) successfulMemoryWrites: cuenta solo mutaciones de memoria EFECTIVAS", () => {
  assert.equal(typeof successfulMemoryWrites, "function", "la contabilidad de memoria existe como única fuente exportada");
  const eff = successfulMemoryWrites([
    step("note_map_decision", { ok: true, recorded: "decision", text: "d1" }),
    step("open_map_front", { ok: true, recorded: "front", text: "f1" }),
    step("close_map_front", { ok: true, recorded: "front_closed", closed: true, text: "f0" }),
    step("ingest_to_brain", { ok: true, ingested: 2, documents: ["a.md", "b.md"] }),
  ]);
  assert.equal(eff.length, 4, "las cuatro mutaciones efectivas cuentan");
  assert.deepEqual(eff.map((w) => w.kind), ["decision", "front", "front_closed", "brain_ingest"]);

  const notEff = successfulMemoryWrites([
    step("close_map_front", { ok: true, recorded: "front_closed", closed: false, text: "sin match" }),
    step("note_map_decision", { ok: false, error: "sin autorización" }),
    step("open_map_front", { ok: false, error: "sin autorización" }),
    step("ingest_to_brain", { ok: false, ingested: 0, error: "sin documentos" }),
    step("write_file", { ok: true, path: "x.txt" }, { path: "x.txt" }),
    step("read_file", { ok: true, content: "..." }, { path: "x.txt" }),
  ]);
  assert.equal(notEff.length, 0, "closed:false, errores y archivos NO son mutaciones de memoria");
});

test("(U5) el destilado al Mapa de un turno de solo-memoria NO dice «Aplicado: nada»", () => {
  const out = distillTurnForBrain({
    userText: CORRECTION_TEXT,
    steps: [step("note_map_decision", { ok: true, recorded: "decision", text: DECISIONS[0] })],
    finalText: "Asenté la decisión en el Mapa.",
  });
  assert.ok(!out.includes("Aplicado: nada"), "el destilado no declara vacío un turno que asentó memoria");
  assert.ok(out.includes("memoria del proyecto"), "el destilado nombra lo aplicado en memoria");
  const outNone = distillTurnForBrain({
    userText: CORRECTION_TEXT,
    steps: [step("close_map_front", { ok: true, recorded: "front_closed", closed: false, text: "x" })],
    finalText: "Cerré frentes.",
  });
  assert.ok(outNone.includes("Aplicado: nada"), "sin mutación efectiva, el destilado conserva su línea de vacío");
});

// ------------------------------------------------------------ (a)
