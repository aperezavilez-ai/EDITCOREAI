"use strict";
// ============================================================
// CORRECCIÓN 5 — EL HISTORIAL NO DUPLICA EL MENSAJE ACTUAL
// (causa localizada en vivo, 2026-11-26)
// El fallo que replica: en la app, el turno «lista los archivos
// de la raíz del proyecto» llegaba al modelo propio con un
// prompt de 28 tokens cuando el encargo simple mide 17, y
// epoch-2 respondía el artefacto «Los archivos de la raíz del
// proyecto son:\n- [] \n- []» sin emitir el bloque de
// herramienta (turnos.jsonl: nEstructurales 0, pasos 0, tres
// veces idéntico). La sonda de replicación fuera de la app lo
// reprodujo EXACTO — mismos 28 tokens y el mismo texto — al
// mandar el encargo como DOS turnos de usuario seguidos: hay
// llamadores que incluyen el mensaje actual también como
// último mensaje del historial, y ejecutarTurno lo agrega
// otra vez. El modelo jamás vio en su entrenamiento dos
// turnos «Usuario:» seguidos con el mismo texto.
// Contrato que esta batería exige:
//  1. Si el historial TERMINA con el mensaje actual (una o
//     más copias), esas copias sobran: el proveedor recibe el
//     encargo UNA sola vez como turno de usuario.
//  2. El historial legítimo no se toca: turnos cerrados
//     (usuario+asistente) viajan completos.
//  3. Repetir el mismo encargo en un turno NUEVO es legítimo:
//     si el historial cierra con la respuesta del asistente,
//     nada se descarta y el encargo viaja dos veces en total
//     (la de aquel turno y la de este), como debe ser.
// ============================================================
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");

// Hermeticidad: se apartan el .env y el .env.local reales de la
// raíz de la app durante la batería y se restauran al final.
const RAIZ_APP = path.join(__dirname, "..");
const ARCHIVOS_ENV = [".env", ".env.local"].map((n) => ({
  ruta: path.join(RAIZ_APP, n),
  apartado: path.join(RAIZ_APP, n + ".bateria-bak"),
}));
before(() => {
  for (const a of ARCHIVOS_ENV) {
    if (fs.existsSync(a.ruta) && !fs.existsSync(a.apartado)) fs.renameSync(a.ruta, a.apartado);
    if (fs.existsSync(a.ruta)) throw new Error(`No se pudo apartar ${a.ruta}: la batería no es hermética en esta máquina.`);
  }
});
after(() => {
  for (const a of ARCHIVOS_ENV) {
    try {
      if (fs.existsSync(a.apartado)) {
        if (fs.existsSync(a.ruta)) fs.unlinkSync(a.ruta);
        fs.renameSync(a.apartado, a.ruta);
      }
    } catch { /* restaurar nunca tumba la batería */ }
  }
});

const NOMBRES_HERRAMIENTAS = [
  "read_file", "write_file", "replace_in_file", "list_files", "run_command", "search_files",
  "delegate_parallel", "invoke_subagent", "search_brain", "list_skills", "read_skill",
  "delete_file", "build_project", "create_project", "publish_project",
];
const definicionesFalsas = () => NOMBRES_HERRAMIENTAS.map((n) => ({
  type: "function",
  function: { name: n, description: `Herramienta ${n}.`, parameters: { type: "object", properties: {} } },
}));

function entornoFalso() {
  const registro = { llamadas: [] };
  const callChat = async (args) => {
    registro.llamadas.push({ mensajes: args.messages || [] });
    return {
      text: "Respuesta del modelo.",
      toolCalls: [],
      usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
      finishReason: "stop",
    };
  };
  const toolsMod = {
    execute: async () => ({ ok: true, output: "ok" }),
    getToolDefinitions: () => definicionesFalsas(),
  };
  return {
    registro,
    deps: {
      callChat,
      toolsMod,
      construirMemoria: async () => "",
      onAviso: () => {},
      onActividad: () => {},
    },
  };
}

const ENCARGO = "lista los archivos de la raíz del proyecto";

async function correrTurno(history) {
  const { registro, deps } = entornoFalso();
  await manejarChatNuevo(
    {
      providerKey: "nexus",
      model: "editcore-nexus-v5",
      message: ENCARGO,
      history,
      projectRoot: os.tmpdir(),
      helpers: {},
    },
    deps,
  );
  assert.ok(registro.llamadas.length >= 1, "el turno debe llamar al modelo al menos una vez");
  return registro.llamadas[0].mensajes;
}

const vecesComoUsuario = (mensajes, texto) =>
  mensajes.filter((m) => m.role === "user" && m.content === texto).length;

test("C5-1: el historial que ya trae el mensaje actual no lo duplica ante el modelo", async () => {
  const mensajes = await correrTurno([{ role: "user", content: ENCARGO }]);
  assert.equal(
    vecesComoUsuario(mensajes, ENCARGO),
    1,
    "el encargo debe llegar UNA sola vez como turno de usuario (el fallo en vivo lo mandaba dos)",
  );
});

test("C5-2: dos copias del mensaje actual al final del historial sobran igual", async () => {
  const mensajes = await correrTurno([
    { role: "user", content: ENCARGO },
    { role: "user", content: ENCARGO },
  ]);
  assert.equal(vecesComoUsuario(mensajes, ENCARGO), 1);
});

test("C5-3: el historial legítimo viaja completo y el encargo va una vez", async () => {
  const mensajes = await correrTurno([
    { role: "user", content: "¿qué es este proyecto?" },
    { role: "assistant", content: "Es una app de analítica." },
  ]);
  assert.equal(vecesComoUsuario(mensajes, "¿qué es este proyecto?"), 1);
  assert.equal(
    mensajes.filter((m) => m.role === "assistant" && m.content === "Es una app de analítica.").length,
    1,
  );
  assert.equal(vecesComoUsuario(mensajes, ENCARGO), 1);
});

test("C5-4: repetir el encargo en un turno nuevo es legítimo y no se descarta", async () => {
  const mensajes = await correrTurno([
    { role: "user", content: ENCARGO },
    { role: "assistant", content: "Aquí está el listado anterior." },
  ]);
  assert.equal(
    vecesComoUsuario(mensajes, ENCARGO),
    2,
    "la copia del turno anterior (cerrado con respuesta) se conserva; solo sobra la que duplica al actual",
  );
});
