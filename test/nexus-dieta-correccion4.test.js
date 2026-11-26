"use strict";
// ============================================================
// CORRECCIÓN 4 — DIETA DEL TURNO PARA EL MODELO PROPIO
// (decisión de Luis, 2026-11-24)
// El fallo que replica, probado en vivo el 2026-11-24: con el
// servidor local sirviendo y la ruta correcta (Corrección 3),
// el turno Nexus real cerró con pasos:0 — el modelo propio
// (100M) devolvió texto libre sin emitir ni una llamada. La
// sonda directa mostró el mecanismo: con un prompt mínimo el
// modelo SÍ emite el dialecto (bloque json {"tool": …}), pero
// con el prompt completo del turno (sistema de 5.666 caracteres
// + definiciones slim de 7.129 + memoria + skills inyectadas)
// se ahoga y no emite nada.
// Contrato que esta batería exige:
//  1. Un turno Nexus (destino local) viaja con un sistema
//     COMPACTO que pone el contrato del dialecto al frente
//     (la forma {"tool": …, "args": …} y un ejemplo), con la
//     memoria del Cerebro acotada y SIN skills inyectadas
//     (las skills se piden con list_skills/read_skill, que
//     siguen ofrecidas: modelo de tirar, no de empujar).
//  2. Las definiciones ofrecidas al modelo propio van con la
//     dieta local (descripciones de una frase, esquemas sin
//     descripciones por propiedad) EXCEPTO delegate_parallel
//     e invoke_subagent, cuyo esquema es el contrato de la
//     delegación y viaja íntegro. El núcleo de herramientas
//     de la Corrección 2 se ofrece COMPLETO.
//  3. El bucle funciona con el dialecto de texto: si el modelo
//     responde con el bloque json de una herramienta, esta se
//     ejecuta y su resultado vuelve al modelo.
//  4. La dieta es SOLO del destino local: un turno con visión
//     (ME AI) y un turno que no es Nexus conservan el sistema
//     completo de siempre.
// ============================================================
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");
const toolsReales = require("../runtime/tools/index.js").tools;

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

const NUCLEO_C2 = [
  "delegate_parallel", "invoke_subagent", "search_brain", "list_skills", "read_skill",
  "delete_file", "build_project", "create_project", "publish_project",
  "read_file", "write_file", "replace_in_file", "list_files", "run_command", "search_files",
];

function entornoFalso(guion, opciones = {}) {
  const registro = { llamadas: [], ejecuciones: [] };
  const callChat = async (args) => {
    const mensajes = args.messages || [];
    const sistema = mensajes.filter((m) => m.role === "system").map((m) => String(m.content || "")).join("\n");
    const entrada = {
      apiBaseUrl: args.apiBaseUrl,
      model: args.model,
      tools: args.tools || [],
      nombresTools: (args.tools || []).map((x) => x?.function?.name).filter(Boolean),
      sistema,
      mensajes,
    };
    registro.llamadas.push(entrada);
    return guion(args, entrada, registro);
  };
  const toolsMod = {
    execute: async (nombre, args) => {
      registro.ejecuciones.push({ nombre, args });
      return { ok: true, output: `resultado de ${nombre}` };
    },
    getToolDefinitions: () => toolsReales.getToolDefinitions(),
    slimToolDefinitions: toolsReales.slimToolDefinitions,
  };
  return {
    registro,
    deps: {
      callChat,
      toolsMod,
      construirMemoria: async () => opciones.memoriaLarga ? "M".repeat(3000) : "",
      onAviso: () => {},
      onActividad: () => {},
    },
  };
}

const respuestaTexto = (texto) => ({
  text: texto,
  toolCalls: [],
  usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
  finishReason: "stop",
});

async function turno(deps, extraInput = {}, mensaje = "Analiza la arquitectura del proyecto") {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-dieta-"));
  return manejarChatNuevo({
    message: mensaje,
    history: [],
    projectRoot,
    providerKey: "nexus",
    model: "editcore-nexus-v5",
    helpers: {},
    ...extraInput,
  }, deps);
}

function sinLlavesDeEntorno(t) {
  const previas = { MEAI_API_KEY: process.env.MEAI_API_KEY, EDITCOREAI_MEAI_API_KEY: process.env.EDITCOREAI_MEAI_API_KEY, GROQ_API_KEY: process.env.GROQ_API_KEY };
  delete process.env.MEAI_API_KEY;
  delete process.env.EDITCOREAI_MEAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  t.after(() => {
    for (const [k, v] of Object.entries(previas)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  return previas;
}

test("C4-1: el turno Nexus local viaja con sistema compacto y el dialecto al frente", async (t) => {
  sinLlavesDeEntorno(t);
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Listo."), { memoriaLarga: true });
  const res = await turno(deps, { skillsPrompt: "S".repeat(3000) });
  assert.ok(res.ok);
  const primera = registro.llamadas[0];
  assert.ok(primera, "el modelo debió ser llamado");
  assert.ok(primera.sistema.length <= 2600, `el sistema debe ir a dieta (llegó con ${primera.sistema.length} caracteres)`);
  assert.ok(primera.sistema.includes('{"tool"'), "el contrato del dialecto debe estar en el sistema");
  assert.ok(primera.sistema.includes("list_files"), "el sistema debe traer un ejemplo con list_files");
  assert.ok(primera.sistema.includes("delegate_parallel"), "el sistema debe hablar de delegar");
  assert.ok(!primera.sistema.includes("S".repeat(400)), "las skills NO se inyectan en el turno local (se piden con read_skill)");
});

test("C4-2: las definiciones van con dieta local y el núcleo C2 completo", async (t) => {
  sinLlavesDeEntorno(t);
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Listo."));
  await turno(deps);
  const primera = registro.llamadas[0];
  for (const nombre of NUCLEO_C2) {
    assert.ok(primera.nombresTools.includes(nombre), `la herramienta ${nombre} debe seguir ofrecida`);
  }
  const json = JSON.stringify(primera.tools);
  assert.ok(json.length <= 5900, `las definiciones deben ir a dieta (llegaron con ${json.length} caracteres)`);
  const delegate = primera.tools.find((d) => d?.function?.name === "delegate_parallel");
  const propsDelegate = delegate?.function?.parameters?.properties?.tasks;
  assert.ok(propsDelegate, "el esquema de delegate_parallel viaja íntegro (tasks presente)");
});

test("C4-3: si el modelo emite el dialecto de texto, la herramienta se ejecuta y el resultado vuelve", async (t) => {
  sinLlavesDeEntorno(t);
  let llamada = 0;
  const { deps, registro } = entornoFalso(async () => {
    llamada += 1;
    if (llamada === 1) {
      return respuestaTexto("```json\n{\"tool\": \"list_files\", \"args\": {\"path\": \".\"}}\n```");
    }
    return respuestaTexto("La carpeta contiene los archivos del proyecto.");
  });
  const res = await turno(deps, {}, "Lista los archivos de la carpeta actual");
  assert.ok(res.ok);
  assert.ok(registro.ejecuciones.some((e) => e.nombre === "list_files"), "list_files debió ejecutarse desde el dialecto de texto");
  const segunda = registro.llamadas[1];
  assert.ok(segunda, "debió haber una segunda llamada con el resultado");
  assert.ok(JSON.stringify(segunda.mensajes).includes("list_files"), "el resultado de la herramienta debe volver al modelo");
});

test("C4-4: el turno con visión NO va a dieta (ME AI conserva el sistema completo)", async (t) => {
  const previas = sinLlavesDeEntorno(t);
  process.env.MEAI_API_KEY = "llave-meai-de-mentira";
  t.after(() => {
    if (previas.MEAI_API_KEY === undefined) delete process.env.MEAI_API_KEY;
    else process.env.MEAI_API_KEY = previas.MEAI_API_KEY;
  });
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Veo la imagen."));
  const res = await turno(deps, { images: ["data:image/png;base64,iVBORw0KGgo="] }, "¿Qué ves en esta imagen?");
  assert.ok(res.ok);
  assert.equal(res.ruta?.destino, "meai-vision");
  assert.ok(registro.llamadas[0].sistema.length > 2600, "la visión conserva el sistema completo, sin dieta");
});

test("C4-5: un turno que NO es Nexus conserva su sistema de siempre", async (t) => {
  sinLlavesDeEntorno(t);
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Listo."));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-dieta-"));
  const res = await manejarChatNuevo({
    message: "Analiza la arquitectura del proyecto",
    history: [],
    projectRoot,
    providerKey: "otro",
    model: "modelo-x",
    helpers: {},
  }, deps);
  assert.ok(res.ok);
  assert.ok(registro.llamadas[0].sistema.includes("copiloto"), "el sistema no-Nexus es el de siempre (SISTEMA_NUCLEO)");
});
