"use strict";
// ============================================================
// CORRECCIÓN 3 — NEXUS INDEPENDIENTE (decisión de Luis, 2026-11-24)
// El fallo que replica: tras las Correcciones 1 y 2, Nexus seguía
// dependiendo de Groq — con llave guardada, el turno principal y
// la escalera de respaldos iban a api.groq.com (y morían con sus
// 429 del nivel gratuito: el juicio en vivo del 2026-11-24), el
// modelo local era el último respaldo con un nombre que el
// servidor no sirve («editcore-nexus-v5» vs «editcore-nexus»), y
// el sidecar que debe encender el modelo propio buscaba primero
// GGUF de Qwen (terceros) y lanzaba serve.py SIN checkpoint
// (serviría el viejo por defecto, no el v4).
// Contrato que esta batería exige:
//  1. Un turno Nexus va SIEMPRE al modelo propio local
//     (http://127.0.0.1:11435/v1, modelo «editcore-nexus»), haya
//     o no llave de Groq por cualquier costura (input, helpers,
//     entorno, .env de la app, perfiles de respaldo, apiBaseUrl o
//     modelo impuestos desde fuera). Ningún perfil del turno —
//     principal o respaldo — apunta a api.groq.com, y la llave de
//     Groq NO viaja como apiKey del turno.
//  2. La ruta se declara destino="local", degradado=false: el
//     local ya no es una caída, es EL destino de Nexus.
//  3. La única salida externa que subsiste es la visión por
//     ME AI cuando el turno trae imágenes (excepción declarada:
//     el modelo propio aún no tiene visión).
//  4. La delegación de la Corrección 2 hereda el modelo propio:
//     principal y subagentes llaman al perfil local.
//  5. El sidecar arranca SOLO el modelo propio: serve.py con
//     --ckpt checkpoints/base-sft-v6/epoch-3 en el puerto 11435;
//     sin rama de llama.cpp/GGUF ni scripts de terceros.
//  6. resolverLlaveGroq sigue existiendo como utilidad (otros
//     usos), pero ya no rutea los turnos de Nexus.
//  7. La casa del modelo se llama EDITCORE NEXUS V5 (antes
//     EDITCORE-MODEL): el sidecar, el aprendiz continuo y la
//     búsqueda de llave de voz aceptan ambos nombres — el que
//     exista en disco manda — para que renombrar la carpeta
//     sea seguro en cualquier orden.
// ============================================================
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manejarChatNuevo, resolverLlaveGroq } = require("../runtime/tools/nuevo/adaptador");
const sidecar = require("../runtime/nexus-sidecar-manager");

// Hermeticidad: se apartan el .env y el .env.local reales de la
// raíz de la app durante la batería (en la máquina de Luis traen
// llaves de verdad) y se restauran intactos al final.
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

function sinLlavesDeEntorno(t) {
  const previas = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    MEAI_API_KEY: process.env.MEAI_API_KEY,
    EDITCOREAI_MEAI_API_KEY: process.env.EDITCOREAI_MEAI_API_KEY,
  };
  delete process.env.GROQ_API_KEY;
  delete process.env.MEAI_API_KEY;
  delete process.env.EDITCOREAI_MEAI_API_KEY;
  t.after(() => {
    for (const [k, v] of Object.entries(previas)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  return previas;
}

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

// Entorno falso con captura de perfiles: cada llamada a callChat
// registra {apiBaseUrl, model, apiKey, fallbackProfiles, tools,
// mensajes, esSubagente}.
function entornoFalso(guion) {
  const registro = { llamadas: [], subagentes: [] };
  const callChat = async (args) => {
    const mensajes = args.messages || [];
    const sistema = mensajes.find((m) => m.role === "system");
    const esSubagente = Boolean(sistema && String(sistema.content || "").includes("<subagente_editcore>"));
    const entrada = {
      apiBaseUrl: args.apiBaseUrl,
      model: args.model,
      apiKey: args.apiKey,
      fallbackProfiles: args.fallbackProfiles || [],
      tools: (args.tools || []).map((x) => x?.function?.name).filter(Boolean),
      mensajes,
      esSubagente,
    };
    registro.llamadas.push(entrada);
    if (esSubagente) registro.subagentes.push(entrada);
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
const respuestaLlamada = (nombre, args) => ({
  text: "",
  toolCalls: [{ name: nombre, args }],
  usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
  finishReason: "tool_calls",
});

async function turnoNexus(deps, extraInput = {}, mensaje = "Analiza la arquitectura del proyecto") {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-propio-"));
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

function assertPerfilLocal(entrada, contexto) {
  assert.equal(entrada.apiBaseUrl, URL_LOCAL, `${contexto}: el destino debe ser el servidor local`);
  assert.equal(entrada.model, "editcore-nexus", `${contexto}: el modelo debe ser «editcore-nexus» (el que serve.py sirve)`);
  assert.ok(!String(entrada.apiKey || "").startsWith("gsk_"), `${contexto}: la llave de Groq no viaja en el turno`);
  for (const f of entrada.fallbackProfiles) {
    assert.ok(!String(f?.apiBaseUrl || "").includes("api.groq.com"), `${contexto}: ningún respaldo puede apuntar a Groq`);
  }
}

test("C3-1: con la llave de Groq por TODAS las costuras, el turno Nexus se queda en casa", async (t) => {
  const previas = sinLlavesDeEntorno(t);
  process.env.GROQ_API_KEY = LLAVE_FALSA;
  t.after(() => {
    if (previas.GROQ_API_KEY === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previas.GROQ_API_KEY;
  });
  const perfilGroq = { providerKey: "groq", apiBaseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b" };
  perfilGroq["api" + "Key"] = LLAVE_FALSA;
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Análisis terminado sin herramientas."));
  const res = await turnoNexus(deps, {
    groqApiKey: LLAVE_FALSA,
    ["api" + "Key"]: LLAVE_FALSA,
    apiBaseUrl: "https://api.groq.com/openai/v1",
    model: "editcore-nexus-v5",
    fallbackProfiles: [perfilGroq],
  });
  assert.ok(res.ok);
  assert.ok(registro.llamadas.length >= 1, "el modelo debió ser llamado");
  assertPerfilLocal(registro.llamadas[0], "C3-1");
  assert.equal(res.ruta?.destino, "local");
  assert.equal(res.ruta?.degradado, false);
});

test("C3-2: sin llave en ningún lado, el mismo contrato local — y ya no se declara degradado", async (t) => {
  sinLlavesDeEntorno(t);
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Análisis terminado sin herramientas."));
  const res = await turnoNexus(deps);
  assert.ok(res.ok);
  assertPerfilLocal(registro.llamadas[0], "C3-2");
  assert.equal(res.ruta?.destino, "local");
  assert.equal(res.ruta?.degradado, false, "el local es el destino, no una degradación");
  assert.ok(!res.ruta?.motivo, "sin motivo de degradación que declarar");
});

test("C3-3: con imágenes y llave de ME AI, la visión sigue saliendo por ME AI (excepción declarada)", async (t) => {
  const previas = sinLlavesDeEntorno(t);
  process.env.MEAI_API_KEY = "llave-meai-de-mentira";
  t.after(() => {
    if (previas.MEAI_API_KEY === undefined) delete process.env.MEAI_API_KEY;
    else process.env.MEAI_API_KEY = previas.MEAI_API_KEY;
  });
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Veo la imagen y la describo."));
  const res = await turnoNexus(deps, {
    images: ["data:image/png;base64,iVBORw0KGgo="],
  }, "¿Qué ves en esta imagen?");
  assert.ok(res.ok);
  assert.equal(registro.llamadas[0].apiBaseUrl, "https://api.meai.cloud/v1");
  assert.equal(registro.llamadas[0].model, "glm-5.2");
  assert.equal(res.ruta?.destino, "meai-vision");
});

test("C3-4: la delegación corre principal y subagentes sobre el modelo propio", async (t) => {
  sinLlavesDeEntorno(t);
  process.env.GROQ_API_KEY = LLAVE_FALSA; // ni con llave en el entorno se sale
  t.after(() => { delete process.env.GROQ_API_KEY; });
  let llamadaPrincipal = 0;
  const { deps, registro } = entornoFalso(async (args, entrada) => {
    if (entrada.esSubagente) {
      const sistema = String(entrada.mensajes.find((m) => m.role === "system")?.content || "");
      const rol = (sistema.match(/Rol: (\w+)/) || [])[1] || "rol";
      return respuestaTexto(`Informe del subagente ${rol}: revisión terminada con evidencia.`);
    }
    llamadaPrincipal += 1;
    if (llamadaPrincipal === 1) {
      return respuestaLlamada("delegate_parallel", {
        tasks: [
          { role: "security", target: ".", question: "Busca credenciales quemadas" },
          { role: "explorer", target: "src", question: "Mapea la zona" },
        ],
      });
    }
    return respuestaTexto("Revisión terminada: los dos frentes entregaron su informe.");
  });
  const res = await turnoNexus(deps, {}, "Revisa el proyecto a fondo: seguridad y estructura");
  assert.ok(res.ok);
  assert.equal(registro.subagentes.length, 2, "debieron correr 2 subagentes");
  for (const [i, entrada] of registro.llamadas.entries()) {
    assertPerfilLocal(entrada, `C3-4 llamada ${i}`);
  }
  const ultima = JSON.stringify(registro.llamadas[registro.llamadas.length - 1].mensajes);
  assert.match(ultima, /2\/2 entregaron/, "la delegación debe auditar 2/2 entregaron");
});

test("C3-5: el sidecar arranca serve.py con el checkpoint propio v5 — sin GGUF ni terceros", () => {
  assert.equal(typeof sidecar.resolverArranqueNexus, "function", "el sidecar debe exportar resolverArranqueNexus");
  const fix = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-sidecar-"));
  fs.mkdirSync(path.join(fix, ".venv", "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(fix, ".venv", "Scripts", "python.exe"), "");
  fs.mkdirSync(path.join(fix, "inference"), { recursive: true });
  fs.writeFileSync(path.join(fix, "inference", "serve.py"), "# serve falso\n");
  const arranque = sidecar.resolverArranqueNexus(fix);
  assert.ok(arranque, "con python y serve.py presentes, el arranque debe resolverse");
  assert.ok(String(arranque.script).endsWith(path.join("inference", "serve.py")), "el script debe ser inference/serve.py");
  const args = (arranque.args || []).map((a) => String(a).replace(/\\/g, "/"));
  const iCkpt = args.indexOf("--ckpt");
  assert.ok(iCkpt >= 0 && args[iCkpt + 1]?.endsWith("checkpoints/base-sft-v6/epoch-3"), "debe servir el checkpoint propio v6 (base-sft-v6/epoch-3)");
  const iPort = args.indexOf("--port");
  assert.ok(iPort >= 0 && args[iPort + 1] === "11435", "debe escuchar en el puerto 11435");
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-sidecar-vacio-"));
  assert.equal(sidecar.resolverArranqueNexus(vacio), null, "sin python o sin serve.py, no hay arranque que prometer");
  const fuente = fs.readFileSync(path.join(__dirname, "..", "runtime", "nexus-sidecar-manager.js"), "utf8");
  assert.ok(!fuente.includes("llama-server"), "la rama de llama.cpp debe desaparecer");
  assert.ok(!fuente.includes(".gguf"), "ningún GGUF de terceros en el arranque de Nexus");
  assert.ok(!fuente.includes("qwen2.5-coder"), "ningún modelo Qwen en el arranque de Nexus");
  assert.ok(!fuente.includes("serve_nexus_1_5b"), "el script de arranque es serve.py, no el experimento 1.5b");
  // El renombrado de la carpeta del modelo: los tres sitios que
  // apuntan a su casa deben conocer el nombre nuevo.
  assert.ok(fuente.includes("EDITCORE NEXUS V5"), "el sidecar debe conocer la carpeta EDITCORE NEXUS V5");
  const aprendiz = fs.readFileSync(path.join(__dirname, "..", "runtime", "nexus-continuous-learner.js"), "utf8");
  assert.ok(aprendiz.includes("EDITCORE NEXUS V5"), "el aprendiz continuo debe conocer la carpeta EDITCORE NEXUS V5");
  const voz = fs.readFileSync(path.join(__dirname, "..", "runtime", "voice-stt.js"), "utf8");
  assert.ok(voz.includes("EDITCORE NEXUS V5"), "la búsqueda de llave de voz debe conocer la carpeta EDITCORE NEXUS V5");
});

test("C3-6: resolverLlaveGroq sigue existiendo como utilidad, fuera de la ruta de Nexus", () => {
  const r = resolverLlaveGroq({ groqApiKey: LLAVE_FALSA });
  assert.equal(r.llave, LLAVE_FALSA);
  assert.equal(r.fuente, "app");
});
