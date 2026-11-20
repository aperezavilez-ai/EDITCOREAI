"use strict";
// ============================================================
// EJECUCIÓN AUTORIZADA — LA CAUSA RAÍZ, probada con el
// registro de turnos en la máquina de Luis (2026-11-17):
// en «sistemas contino» cada «procede» del usuario lo
// intercepta el flujo viejo de análisis del proyecto
// (project-analysis.js) y lo sustituye por un texto enlatado
// «AUTORIZACION DE EJECUCION (PROCEDE): … ## Evidencia de
// correccion». Ese texto, clasificado por su forma, cae en
// CONVERSACION — herramientas: ninguna — y el modelo, sin
// herramientas que invocar, narra la construcción en prosa
// siguiendo el guion del propio texto enlatado. El registro
// lo probó: UNA respuesta, 0 llamadas estructurales, 0
// rescatadas, finishReason «stop».
// La autorización real viaja como DATO estructurado
// (planAuthorizedExecution) desde el renderer y main, pero el
// puente NO la reenviaba al kernel y el kernel no la miraba.
// Corrección: el puente la reenvía; con ella presente, el
// carril es ORDEN por definición — una ejecución autorizada
// ES una orden — sin depender de la forma del texto.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");
const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");
const { decidirTurno } = require("../editcore-chat-kernel/nuevo/despacho");

const BLOB = [
  "AUTORIZACION DE EJECUCION (PROCEDE): las reglas de DIAGNOSTICO / NO MODIFICAR del analisis previo quedan ANULADAS para esta corrida.",
  "Puedes usar write_file y replace_in_file sobre codigo real del proyecto abierto.",
  "INSTRUCCION DE EJECUCION:",
  "El usuario ya autorizo con procede/continua/adelante. Ejecuta cambios reales con herramientas ahora.",
  "Narra en el chat cada avance en ESPAÑOL (que revisas, que cambias, que verificas) sin pegar codigo fuente.",
  "Al terminar incluye ## Evidencia de correccion.",
  "Usa herramientas hasta completar y verificar los cambios.",
].join("\n\n");

test("el mecanismo, documentado: el texto enlatado clasifica CONVERSACION (sin herramientas)", () => {
  const d = decidirTurno(BLOB, {});
  assert.equal(d.carril, "CONVERSACION");
  assert.equal(d.herramientas, "ninguna");
});

test("turno: con carrilForzado ORDEN, el mismo texto ejecuta herramientas", async () => {
  let llamada = 0;
  const llamarModelo = async () => {
    llamada += 1;
    if (llamada === 1) return { texto: "", toolCalls: [{ id: "w1", nombre: "write_file", argumentos: { path: "package.json", content: "{}" } }], uso: { total: 100 } };
    return { texto: "package.json creado.", toolCalls: [], uso: { total: 50 } };
  };
  const r = await ejecutarTurno({
    texto: BLOB,
    carrilForzado: "ORDEN",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true, resumen: "escrito", archivoAplicado: "package.json" }),
    herramientasCompletas: ["write_file"],
  });
  assert.equal(r.carril, "ORDEN");
  assert.equal(r.herramientasEjecutadas, 1);
  assert.deepEqual(r.hechos.aplicados, ["package.json"]);
});

const DEFS = [{ type: "function", function: { name: "write_file", description: "Escribe un archivo.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }];

function depsBase(ejecuciones) {
  let llamada = 0;
  return {
    callChat: async () => {
      llamada += 1;
      if (llamada === 1) {
        return {
          content: "",
          toolCalls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "package.json", content: "{}" }) } }],
          usage: { input_tokens: 20, output_tokens: 10 },
        };
      }
      return { content: "Listo: package.json creado en la raíz.", toolCalls: [], usage: { input_tokens: 20, output_tokens: 10 } };
    },
    getToolDefinitions: () => DEFS,
    execute: async () => { ejecuciones.push(1); return { ok: true, resumen: "escrito package.json", archivoAplicado: "package.json", saved_path: "package.json" }; },
    construirMemoria: async () => "",
  };
}

const INPUT_BASE = { projectRoot: "/tmp/x", threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m", history: [] };

test("adaptador: sin bandera y sin enlatado, SIN proyecto (charla), no se ejecuta nada", async () => {
  // [Re-delimitada 2026-11-18] Esta prueba nació contra el
  // veto de la cascada: con proyecto abierto, la capacidad ya
  // es estructural y un pedido del modelo SÍ ejecuta (lo
  // cubre kernel-nuevo-capacidad-estructural). Sin proyecto
  // no hay herramientas sobre la mesa y la charla no ejecuta:
  // eso es lo que esta prueba sigue garantizando.
  const ejecuciones = [];
  const out = await manejarChatNuevo({ ...INPUT_BASE, projectRoot: "", message: "hola, ¿cómo va el proyecto?" }, depsBase(ejecuciones));
  assert.equal(out.kind, "CONVERSACION");
  assert.equal(ejecuciones.length, 0);
});

test("adaptador: el enlatado SOLO (sin bandera) ya es autorización — solo lo produce la ruta autorizada", async () => {
  const ejecuciones = [];
  const out = await manejarChatNuevo({ ...INPUT_BASE, message: BLOB }, depsBase(ejecuciones));
  assert.equal(out.kind, "ORDEN");
  assert.equal(ejecuciones.length, 1);
});

test("adaptador: CON planAuthorizedExecution, el mismo texto es ORDEN y el archivo se escribe", async () => {
  const ejecuciones = [];
  const out = await manejarChatNuevo({ ...INPUT_BASE, message: BLOB, planAuthorizedExecution: true }, depsBase(ejecuciones));
  assert.equal(out.kind, "ORDEN");
  assert.equal(ejecuciones.length, 1);
  assert.deepEqual(out.mutations, ["package.json"]);
});

const BLOB_CON_PLAN_AJENO = [
  "AUTORIZACION DE EJECUCION (PROCEDE): las reglas de DIAGNOSTICO / NO MODIFICAR del analisis previo quedan ANULADAS para esta corrida.",
  "Puedes usar write_file y replace_in_file sobre codigo real del proyecto abierto.",
  "SOLICITUD ORIGINAL (sanitizada):\nnecesito un saas donde los clientes levanten reportes de fallas y pidan toner con folio",
  "PLAN YA AUTORIZADO POR EL USUARIO:\nseguir construyendo sobre rental-equipment-saas e instalar sus dependencias",
  "INSTRUCCION DE EJECUCION:",
  "Al terminar incluye ## Evidencia de correccion.",
].join("\n\n");

test("adaptador: el enlatado NO llega al modelo — manda la conversación, no el plan guardado", async () => {
  const ejecuciones = [];
  const deps = depsBase(ejecuciones);
  const vistos = [];
  const callChatBase = deps.callChat;
  deps.callChat = async (opts) => { vistos.push(JSON.stringify(opts.messages || [])); return callChatBase(opts); };
  const out = await manejarChatNuevo(
    {
      ...INPUT_BASE,
      message: BLOB_CON_PLAN_AJENO,
      planAuthorizedExecution: true,
      history: [
        { role: "user", content: "necesito un saas donde los clientes levanten reportes de fallas y pidan toner con folio" },
        { role: "assistant", content: "Propuesta: SaaS en la raíz del proyecto con package.json, app/, prisma/. ¿Apruebas esta propuesta o quieres ajustar algo?" },
      ],
    },
    deps,
  );
  assert.equal(out.kind, "ORDEN");
  assert.equal(ejecuciones.length, 1);
  const todo = vistos.join("\n");
  assert.ok(!todo.includes("rental-equipment-saas"), "el plan guardado ajeno no debe llegar al modelo");
  assert.ok(!todo.includes("Evidencia de correccion"), "el guion del enlatado no debe llegar al modelo");
  assert.ok(todo.includes("reportes de fallas"), "la petición original del usuario sí llega");
});

test("una PREGUNTA con el flag puesto NO se fuerza a ORDEN (permiso != autorización)", async () => {
  // Registro 2026-11-18T19:27Z: «cual es la capital de
  // francia?» corrió como ORDEN (aviso «Manos a la obra», 0
  // pasos) porque main.js metía fullAccess en el OR de
  // planAuthorizedExecution — TODO turno de un usuario con
  // acceso completo llegaba «autorizado». La pregunta se
  // responde como conversación aunque el flag venga puesto.
  const deps = {
    callChat: async () => ({ content: "La capital de Francia es París.", toolCalls: [], usage: { input_tokens: 10, output_tokens: 8 } }),
    getToolDefinitions: () => [],
    execute: async () => ({ ok: true }),
    construirMemoria: async () => "",
  };
  const out = await manejarChatNuevo(
    { projectRoot: "/tmp/x", threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m", message: "cual es la capital de francia?", planAuthorizedExecution: true, history: [] },
    deps,
  );
  assert.equal(out.kind, "CONVERSACION");
  assert.match(out.text, /París/);
});

test("el «procede» con flag SIGUE forzando ORDEN (la fuerza legítima se conserva)", async () => {
  const DEFS = [{ type: "function", function: { name: "write_file", description: "Escribe.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } }];
  let llamada = 0;
  const deps = {
    callChat: async () => {
      llamada += 1;
      if (llamada === 1) return { content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "package.json", content: "{}" }) } }], usage: { input_tokens: 10, output_tokens: 5 } };
      return { content: "package.json creado en la raíz.", toolCalls: [], usage: { input_tokens: 10, output_tokens: 5 } };
    },
    getToolDefinitions: () => DEFS,
    execute: async () => ({ ok: true, resumen: "escrito", archivoAplicado: "package.json", saved_path: "package.json" }),
    construirMemoria: async () => "",
  };
  const out = await manejarChatNuevo(
    {
      projectRoot: "/tmp/x", threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m",
      message: "procede", planAuthorizedExecution: true,
      history: [
        { role: "user", content: "necesito un saas de reportes" },
        { role: "assistant", content: "Propuesta: SaaS en la raíz con package.json y app/. ¿Apruebas esta propuesta o quieres ajustar algo?" },
      ],
    },
    deps,
  );
  assert.equal(out.kind, "ORDEN");
  assert.deepEqual(out.mutations, ["package.json"]);
});

test("main.js: ningún handler vuelve a meter el permiso en la autorización", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.ok(!/planAuthorizedExecution:\s*fullAccess/.test(main), "el handler de chat no OR-ea fullAccess");
  assert.ok(!/planAuthorizedExecution:\s*permissionHint/.test(main), "el handler agente no OR-ea permissionHint");
});
