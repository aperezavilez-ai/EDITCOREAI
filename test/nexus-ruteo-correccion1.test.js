"use strict";
// ============================================================
// CORRECCIÓN 1 — RUTEO DE NEXUS (batería original 2026-11-24)
// [RE-APUNTADA POR LA CORRECCIÓN 3, decisión de Luis 2026-11-24]
// El contrato de ruteo cambió: Nexus V5 es independiente y corre
// SOLO con el modelo propio local. Esta batería conserva los
// montajes históricos de la Corrección 1 (la llave de Groq
// entrando por cada costura de la app) como guardias de regresión
// de la independencia: con la llave presente por cualquier
// costura, el turno Nexus AHORA se queda en casa (local,
// «editcore-nexus», sin Groq en principal ni respaldos, sin
// declararse degradado). El resolver de la llave sigue probado
// como utilidad (C1-1), fuera de la ruta de los turnos.
// ============================================================
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manejarChatNuevo, resolverLlaveGroq } = require("../runtime/tools/nuevo/adaptador");

// Hermeticidad de la batería COMPLETA: si la máquina trae .env o
// .env.local en la raíz de la app (en la de Luis SÍ: su llave vive
// ahí), se apartan antes de las pruebas y se restauran intactos
// al final.
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
const URL_LOCAL = "http://127.0.0.1:11435/v1";

function depsCaptura() {
  let capturedProfile = null;
  const fakeCallChat = async (profile) => {
    capturedProfile = profile;
    return {
      text: "Análisis de arquitectura completado con éxito sin requerir herramientas.",
      toolCalls: [],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      finishReason: "stop",
    };
  };
  const fakeToolsMod = {
    execute: async () => ({ ok: true, output: "ok" }),
    getToolDefinitions: () => [],
  };
  return {
    deps: {
      callChat: fakeCallChat,
      toolsMod: fakeToolsMod,
      construirMemoria: async () => "",
      onAviso: () => {},
      onActividad: () => {},
    },
    perfil: () => capturedProfile,
  };
}

async function turnoNexus(extraInput = {}) {
  const { deps, perfil } = depsCaptura();
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-ruteo-"));
  const res = await manejarChatNuevo({
    message: "Analiza la arquitectura del proyecto",
    history: [],
    projectRoot,
    providerKey: "nexus",
    model: "editcore-nexus-v5",
    helpers: {},
    ...extraInput,
  }, deps);
  return { res, perfil: perfil() };
}

function sinLlaveDeEntorno(t) {
  const previa = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  t.after(() => {
    if (previa === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previa;
  });
}

// El contrato nuevo, en una sola aserción reutilizable: el turno
// va al modelo propio, con su nombre real, sin la llave de Groq
// y sin declararse degradado.
function assertTurnoEnCasa(perfil, res) {
  assert.ok(perfil, "callChat debió recibir el perfil");
  assert.equal(perfil.apiBaseUrl, URL_LOCAL);
  assert.equal(perfil.model, "editcore-nexus");
  assert.ok(!String(perfil.apiKey || "").startsWith("gsk_"), "la llave de Groq no viaja en el turno");
  for (const f of perfil.fallbackProfiles || []) {
    assert.ok(!String(f?.apiBaseUrl || "").includes("api.groq.com"), "ningún respaldo apunta a Groq");
  }
  assert.equal(res.ruta?.destino, "local");
  assert.equal(res.ruta?.degradado, false);
}

test("C1-1: la llave de la configuración de la app ya NO enruta a Groq (el resolver sigue como utilidad)", async (t) => {
  sinLlaveDeEntorno(t);
  const utilidad = resolverLlaveGroq({ groqApiKey: LLAVE_FALSA });
  assert.equal(utilidad.llave, LLAVE_FALSA);
  assert.equal(utilidad.fuente, "app");
  const { res, perfil } = await turnoNexus({ groqApiKey: LLAVE_FALSA });
  assertTurnoEnCasa(perfil, res);
});

test("C1-2: la llave del propio turno (gsk_) ya no saca a Nexus de casa", async (t) => {
  sinLlaveDeEntorno(t);
  const { res, perfil } = await turnoNexus({ ["api" + "Key"]: LLAVE_FALSA });
  assertTurnoEnCasa(perfil, res);
});

test("C1-3: un perfil Groq entre los respaldos de la app queda fuera del turno", async (t) => {
  sinLlaveDeEntorno(t);
  const llavePerfil = "gsk_" + "y".repeat(24);
  const perfilGroq = { providerKey: "groq", apiBaseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" };
  perfilGroq["api" + "Key"] = llavePerfil;
  const { res, perfil } = await turnoNexus({ fallbackProfiles: [perfilGroq] });
  assertTurnoEnCasa(perfil, res);
});

test("C1-4: sin llave en ninguna costura, el turno va al local y NO se declara degradado", async (t) => {
  sinLlaveDeEntorno(t);
  const { res, perfil } = await turnoNexus();
  assertTurnoEnCasa(perfil, res);
  assert.ok(!res.ruta?.motivo, "el destino propio no lleva motivo de degradación");
});

test("C1-5: la escalera de respaldos de Groq desapareció de los turnos Nexus", async (t) => {
  sinLlaveDeEntorno(t);
  const { perfil } = await turnoNexus({ groqApiKey: LLAVE_FALSA });
  assert.ok(perfil);
  const modelos = (perfil.fallbackProfiles || []).map((f) => f.model);
  assert.ok(!modelos.includes("openai/gpt-oss-120b"), "sin respaldo 120B de Groq");
  assert.ok(!modelos.includes("openai/gpt-oss-20b"), "sin respaldo 20B de Groq");
});

test("C1-6: la llave del entorno ya no enruta (fuenteLlave queda vacía en la ruta)", async (t) => {
  const previa = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = LLAVE_FALSA;
  t.after(() => {
    if (previa === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previa;
  });
  const { res, perfil } = await turnoNexus();
  assertTurnoEnCasa(perfil, res);
  assert.ok(!res.ruta?.fuenteLlave, "la ruta ya no registra fuente de llave de Groq");
});

test("C1-7: el adaptador ya no lee el .env de EDITCORE-MODEL", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "runtime", "tools", "nuevo", "adaptador.js"), "utf8");
  assert.ok(!/path\.join\([^)]*EDITCORE-MODEL/.test(fuente), "ninguna ruta de lectura puede construirse hacia EDITCORE-MODEL");
  assert.ok(!fuente.includes('EDITCORE-MODEL", ".env"'), "la ruta cruzada al .env de EDITCORE-MODEL debe desaparecer");
});

test("C1-8: la llave en el .env de la RAÍZ de la app tampoco saca a Nexus de casa", async (t) => {
  sinLlaveDeEntorno(t);
  // Montaje histórico de la regresión C1B (la llave vivía en el
  // .env de la raíz y el lector subía 2 niveles en vez de 3):
  // el archivo se escribe con la llave y el turno, aun así, debe
  // quedarse en el modelo propio.
  const raiz = path.join(__dirname, "..");
  const envPath = path.join(raiz, ".env");
  fs.writeFileSync(envPath, "GROQ_API_KEY=" + LLAVE_FALSA + "\n");
  t.after(() => { try { fs.unlinkSync(envPath); } catch {} });
  const { res, perfil } = await turnoNexus();
  assertTurnoEnCasa(perfil, res);
});
