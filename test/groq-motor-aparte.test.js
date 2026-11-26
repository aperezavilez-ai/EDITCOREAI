"use strict";
// ============================================================
// GROQ COMO MOTOR APARTE (decisión de Luis, 2026-11-26)
// Luis aprobó agregar Groq con sus modelos a EditCoreAI SIN
// mezclarlo con Nexus V5: un motor de nube más en el registro
// de proveedores, con su propia llave de la bóveda y su propia
// ruta — Nexus sigue 100 % local (Corrección 3 intacta).
// Contrato que esta batería exige:
//  1. Un turno del motor Groq (providerKey «groq») llega al
//     proveedor TAL CUAL: apiBaseUrl de Groq, su modelo y su
//     llave gsk_ — nunca se reescribe al local ni a Nexus, y
//     recibe el juego COMPLETO de herramientas (vía nativa,
//     como cualquier motor de nube; la dieta es solo del local).
//  2. La separación es de raíz: un turno Nexus con la llave y
//     un perfil de Groq como respaldo sigue en casa (esto ya lo
//     guarda la C3; aquí se re-afirma como blindaje del motor
//     nuevo: agregar Groq no reabre la puerta que la C3 cerró).
//  3. El cableado de superficie existe: el renderer registra el
//     proveedor «groq» con nombre de producto («EditCore Nube»),
//     como proveedor principal de llave única, con su catálogo
//     de modelos de Groq.
//  4. main.js resuelve la llave de Groq desde la bóveda cuando
//     el turno es del motor Groq (las dos rutas: chat y agente),
//     igual que ya hace con ME AI — el turno no depende de que
//     el renderer haya cargado la llave en el perfil.
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

const LLAVE_FALSA = "gsk_" + "x".repeat(24);
const URL_GROQ = "https://api.groq.com/openai/v1";
const URL_LOCAL = "http://127.0.0.1:11435/v1";

const NOMBRES_HERRAMIENTAS = [
  "read_file", "write_file", "replace_in_file", "list_files", "run_command", "search_files",
  "delegate_parallel", "invoke_subagent", "search_brain", "list_skills", "read_skill",
  "delete_file", "build_project", "create_project", "publish_project",
  "git_status", "git_diff", "generate_image", "web_search",
];
const definicionesFalsas = () => NOMBRES_HERRAMIENTAS.map((n) => ({
  type: "function",
  function: { name: n, description: `Herramienta ${n}.`, parameters: { type: "object", properties: {} } },
}));

function entornoFalso(guion) {
  const registro = { llamadas: [] };
  const callChat = async (args) => {
    const entrada = {
      apiBaseUrl: args.apiBaseUrl,
      model: args.model,
      apiKey: args["api" + "Key"],
      fallbackProfiles: args.fallbackProfiles || [],
      tools: (args.tools || []).map((x) => x?.function?.name).filter(Boolean),
      mensajes: args.messages || [],
    };
    registro.llamadas.push(entrada);
    return guion(args, entrada, registro);
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

const respuestaTexto = (texto) => ({
  text: texto,
  toolCalls: [],
  usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
  finishReason: "stop",
});

test("G-1: el turno del motor Groq llega al proveedor tal cual, con herramientas completas", async () => {
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Respuesta del motor de nube."));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "groq-motor-"));
  const res = await manejarChatNuevo({
    message: "Analiza la arquitectura del proyecto",
    history: [],
    projectRoot,
    providerKey: "groq",
    apiBaseUrl: URL_GROQ,
    ["api" + "Key"]: LLAVE_FALSA,
    model: "llama-3.3-70b-versatile",
    helpers: {},
  }, deps);
  assert.ok(res.ok);
  assert.ok(registro.llamadas.length >= 1, "el modelo debió ser llamado");
  const llamada = registro.llamadas[0];
  assert.equal(llamada.apiBaseUrl, URL_GROQ, "el destino debe ser Groq, no el local");
  assert.equal(llamada.model, "llama-3.3-70b-versatile", "el modelo de Groq viaja sin reescribir");
  assert.equal(llamada.apiKey, LLAVE_FALSA, "la llave del turno es la de Groq");
  assert.ok(llamada.tools.includes("delegate_parallel"), "el motor de nube recibe delegación (juego completo)");
  assert.ok(llamada.tools.includes("write_file"), "el motor de nube recibe escritura (juego completo)");
});

test("G-2: agregar Groq no reabre Nexus — con llave y respaldo de Groq, Nexus se queda en casa", async () => {
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Análisis terminado sin herramientas."));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "groq-motor-"));
  const perfilGroq = { providerKey: "groq", apiBaseUrl: URL_GROQ, model: "openai/gpt-oss-120b" };
  perfilGroq["api" + "Key"] = LLAVE_FALSA;
  const res = await manejarChatNuevo({
    message: "Analiza la arquitectura del proyecto",
    history: [],
    projectRoot,
    providerKey: "nexus",
    model: "editcore-nexus-v5",
    groqApiKey: LLAVE_FALSA,
    fallbackProfiles: [perfilGroq],
    helpers: {},
  }, deps);
  assert.ok(res.ok);
  assert.ok(registro.llamadas.length >= 1, "el modelo debió ser llamado");
  const llamada = registro.llamadas[0];
  assert.equal(llamada.apiBaseUrl, URL_LOCAL, "Nexus va al local aunque Groq exista");
  assert.equal(llamada.model, "editcore-nexus", "Nexus sirve su modelo propio");
  assert.ok(!String(llamada.apiKey || "").startsWith("gsk_"), "la llave de Groq no viaja en el turno Nexus");
  for (const f of llamada.fallbackProfiles) {
    assert.ok(!String(f?.apiBaseUrl || "").includes("api.groq.com"), "ningún respaldo de Nexus apunta a Groq");
  }
  assert.equal(res.ruta?.destino, "local");
  assert.equal(res.ruta?.degradado, false);
});

test("G-3: el renderer registra Groq como «EditCore Nube», principal y de llave única, con su catálogo", () => {
  const renderer = fs.readFileSync(path.join(RAIZ_APP, "renderer.js"), "utf8");
  assert.match(renderer, /groq:\s*\{\s*label:\s*"EditCore Nube",\s*baseUrl:\s*"https:\/\/api\.groq\.com\/openai\/v1",\s*model:\s*"llama-3\.3-70b-versatile"\s*\}/, "PROVIDERS debe registrar groq con nombre de producto y su endpoint");
  assert.match(renderer, /const PRIMARY_PROVIDER_KEYS = \[[^\]]*"groq"[^\]]*\]/, "groq debe ser proveedor principal (perfiles automáticos)");
  assert.match(renderer, /const SINGLE_KEY_PROVIDER_KEYS = \[[^\]]*"groq"[^\]]*\]/, "groq debe ser de llave única (una gsk_ para todos sus modelos)");
  assert.match(renderer, /groq:\s*\[\s*"llama-3\.3-70b-versatile",\s*"openai\/gpt-oss-120b",\s*"llama-3\.1-8b-instant"\s*\]/, "PROVIDER_MODELS.groq debe listar los modelos de Groq");
});

test("G-4: main.js resuelve la llave de Groq desde la bóveda en las rutas de chat y de agente", () => {
  const main = fs.readFileSync(path.join(RAIZ_APP, "main.js"), "utf8");
  const guardas = main.match(/\[GROQ MOTOR APARTE — 2026-11-26\]/g) || [];
  assert.equal(guardas.length, 2, "debe haber guarda de llave Groq en editcore:chat y en la ruta agente");
  assert.match(main, /providerKey === "groq"[\s\S]{0,300}resolveGroqKeyFromSecureState\(\)/, "la guarda debe resolver la llave desde la bóveda");
});
