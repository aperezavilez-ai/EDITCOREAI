"use strict";
// ============================================================
// CORRECCIÓN 1 — RUTEO DE NEXUS (batería de la auditoría 2026-11-24)
// El fallo que replica: con el perfil Nexus elegido, el kernel
// solo encontraba la llave de Groq en el .env de OTRO proyecto
// (EDITCORE-MODEL) o en el entorno del proceso; la llave guardada
// en la configuración de la PROPIA app nunca llegaba al ruteo, el
// turno caía al modelo local chico en silencio, y la escalera de
// respaldos de Groq iba del chico al grande (20B antes que 120B).
// Contrato que esta batería exige:
//  1. La llave llega por las costuras de la app: input.groqApiKey
//     (lo que main resuelve desde la bóveda), la llave del propio
//     turno si ya es de Groq (gsk_), o un perfil Groq entre los
//     perfiles de respaldo que la app pasa.
//  2. Sin llave en ninguna costura, el turno va al local Y lo
//     DECLARA: resultado.ruta.destino="local", degradado=true.
//  3. Los respaldos de Groq van de mayor a menor: 120B, 20B, local.
//  4. El adaptador ya no lee el .env de EDITCORE-MODEL.
// ============================================================
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");

// Hermeticidad de la batería COMPLETA: si la máquina trae .env o
// .env.local en la raíz de la app (en la de Luis SÍ: su llave vive
// ahí), se apartan antes de las pruebas y se restauran intactos
// al final. El resolver lee AMBOS archivos: apartar solo el .env
// dejó la batería a merced del .env.local (fallo en vivo del
// parche C1B, C1-4). Si un archivo no se puede apartar, el hook
// lo dice en voz alta en vez de disfrazarlo de fallo de prueba.
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

test("C1-1: la llave de la configuración de la app (input.groqApiKey) enruta a Groq", async (t) => {
  sinLlaveDeEntorno(t);
  const { res, perfil } = await turnoNexus({ groqApiKey: LLAVE_FALSA });
  assert.ok(perfil, "callChat debió recibir el perfil");
  assert.equal(perfil.apiBaseUrl, "https://api.groq.com/openai/v1");
  assert.equal(perfil.apiKey, LLAVE_FALSA);
  assert.equal(res.ruta?.destino, "groq");
  assert.equal(res.ruta?.degradado, false);
});

test("C1-2: si la llave del propio turno ya es de Groq (gsk_), enruta a Groq", async (t) => {
  sinLlaveDeEntorno(t);
  const { perfil } = await turnoNexus({ ["api" + "Key"]: LLAVE_FALSA });
  assert.ok(perfil);
  assert.equal(perfil.apiBaseUrl, "https://api.groq.com/openai/v1");
  assert.equal(perfil.apiKey, LLAVE_FALSA);
});

test("C1-3: un perfil Groq entre los perfiles de respaldo de la app aporta la llave", async (t) => {
  sinLlaveDeEntorno(t);
  const llavePerfil = "gsk_" + "y".repeat(24);
  const perfilGroq = { providerKey: "groq", apiBaseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" };
  perfilGroq["api" + "Key"] = llavePerfil;
  const { perfil } = await turnoNexus({ fallbackProfiles: [perfilGroq] });
  assert.ok(perfil);
  assert.equal(perfil.apiBaseUrl, "https://api.groq.com/openai/v1");
  assert.equal(perfil.apiKey, llavePerfil);
});

test("C1-4: sin llave en ninguna costura, el turno va al local y lo DECLARA degradado", async (t) => {
  sinLlaveDeEntorno(t);
  const { res, perfil } = await turnoNexus();
  assert.ok(perfil);
  assert.equal(perfil.apiBaseUrl, "http://127.0.0.1:11435/v1");
  assert.equal(res.ruta?.destino, "local");
  assert.equal(res.ruta?.degradado, true);
  assert.match(String(res.ruta?.motivo || ""), /llave/i);
});

test("C1-5: los respaldos de Groq van de mayor a menor (120B, luego 20B, luego local)", async (t) => {
  sinLlaveDeEntorno(t);
  const { perfil } = await turnoNexus({ groqApiKey: LLAVE_FALSA });
  assert.ok(perfil);
  const modelos = (perfil.fallbackProfiles || []).map((f) => f.model);
  const i120 = modelos.indexOf("openai/gpt-oss-120b");
  const i20 = modelos.indexOf("openai/gpt-oss-20b");
  const iLocal = modelos.indexOf("editcore-nexus-v5");
  assert.ok(i120 >= 0, "debe existir el respaldo 120B");
  assert.ok(i20 > i120, "el 20B va DESPUÉS del 120B");
  assert.ok(iLocal > i20, "el local va al final");
  assert.equal(perfil.fallbackProfiles[perfil.fallbackProfiles.length - 1].apiBaseUrl, "http://127.0.0.1:11435/v1");
});

test("C1-6: la llave del entorno del proceso sigue funcionando (fuente: entorno)", async (t) => {
  const previa = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = LLAVE_FALSA;
  t.after(() => {
    if (previa === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previa;
  });
  const { res, perfil } = await turnoNexus();
  assert.ok(perfil);
  assert.equal(perfil.apiBaseUrl, "https://api.groq.com/openai/v1");
  assert.equal(res.ruta?.fuenteLlave, "entorno");
});

test("C1-7: el adaptador ya no lee el .env de EDITCORE-MODEL", () => {
  const fuente = fs.readFileSync(path.join(__dirname, "..", "runtime", "tools", "nuevo", "adaptador.js"), "utf8");
  assert.ok(!/path\.join\([^)]*EDITCORE-MODEL/.test(fuente), "ninguna ruta de lectura puede construirse hacia EDITCORE-MODEL");
  assert.ok(!fuente.includes('EDITCORE-MODEL", ".env"'), "la ruta cruzada al .env de EDITCORE-MODEL debe desaparecer");
});

test("C1-8: la llave en el .env de la RAIZ de la app enruta a Groq (fuente: archivo-app)", async (t) => {
  sinLlaveDeEntorno(t);
  // Regresión del juicio en vivo 2026-11-24: la llave estaba en el
  // .env de la raíz y el turno salió local con fuenteLlave vacía,
  // porque el lector subía 2 niveles desde runtime/tools/nuevo y
  // buscaba en runtime/.env — la raíz queda a 3 niveles.
  const raiz = path.join(__dirname, "..");
  const envPath = path.join(raiz, ".env");
  // El hook before() ya apartó el .env real de la máquina (si lo
  // había): aquí se escribe el de mentira y se borra al salir; el
  // real vuelve a su sitio en el hook after().
  fs.writeFileSync(envPath, "GROQ_API_KEY=" + "gsk_" + "w".repeat(24) + "\n", "utf8");
  t.after(() => { try { fs.unlinkSync(envPath); } catch {} });
  const { res, perfil } = await turnoNexus();
  assert.ok(perfil);
  assert.equal(perfil.apiBaseUrl, "https://api.groq.com/openai/v1");
  assert.equal(res.ruta?.destino, "groq");
  assert.equal(res.ruta?.fuenteLlave, "archivo-app");
});
