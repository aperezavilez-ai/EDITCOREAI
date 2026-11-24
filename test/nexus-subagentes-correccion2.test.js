"use strict";
// ============================================================
// CORRECCIÓN 2 — MOTOR DE SUBAGENTES REALES (auditoría 2026-11-24)
// El fallo que replica, verificado en v5.3.4 (origin/main):
//  1. delegate_parallel / invoke_subagent solo se OFRECEN si el
//     mensaje del usuario trae la palabra mágica (subagent|
//     paralel|deleg|agente) — adaptador.js:774. Sin ella, el
//     agente principal NO PUEDE delegar aunque la tarea lo pida.
//  2. Cuando delega, cae en tools.js → parallel-delegate con
//     «especialistas» que NO llaman a ningún modelo (0 llamadas
//     en los 7 archivos de runtime/tools/subagents/): son
//     heurísticas fs/regex con topes. El módulo bueno
//     (nuevo/subagentes.js, delegar() con modelo heredado)
//     tiene CERO llamantes.
//  3. El cierre miente: un subagente sin informe se convierte
//     en «sin hallazgos negativos» y la delegación marca ok
//     con que 1 de N entregue.
//  4. search_brain / list_skills / read_skill también viven
//     tras compuertas de palabra; delete_file / build_project /
//     create_project / publish_project jamás se ofrecen en
//     Nexus (regla del producto: todos los permisos, siempre).
//  5. El Cerebro corre con carrera de 8 s y silencio si tarda:
//     el turno trabaja sin recuerdos y nadie lo declara.
// Contrato que esta batería exige:
//  C2-1 Sin palabra mágica, el turno Nexus ofrece igual:
//       delegate_parallel, invoke_subagent, search_brain,
//       list_skills, read_skill, delete_file, build_project,
//       create_project, publish_project.
//  C2-2 delegate_parallel corre subagentes de VERDAD: llamadas
//       al modelo del turno, EN PARALELO, y el resultado trae
//       la auditoría «N/N entregaron» con los informes.
//  C2-3 Un subagente sin informe queda DECLARADO por nombre y
//       el paso de delegación marca ok:false — nunca humo.
//  C2-4 invoke_subagent con rol especialista (security) corre
//       como llamada al modelo con su prompt de rol.
//  C2-5 El prompt de sistema de Nexus declara la delegación y
//       las herramientas de conocimiento SIEMPRE disponibles.
//  C2-6 La ruta vieja (parallel-delegate) deja de fabricar
//       «sin hallazgos negativos»: sin informe se dice sin
//       informe y la delegación no se marca completa.
//  C2-7 Si el Cerebro no responde en su ventana, la memoria
//       del turno lo DECLARA en vez de callarlo.
// ============================================================
const test = require("node:test");
const { before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");
const { runDelegatedTasks } = require("../runtime/tools/parallel-delegate");
const { construirMemoria } = require("../runtime/tools/index");

// Hermeticidad: apartar el .env real de la máquina (ver C1).
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
  "git_status", "git_diff", "generate_image", "web_search",
];
const definicionesFalsas = () => NOMBRES_HERRAMIENTAS.map((n) => ({
  type: "function",
  function: { name: n, description: `Herramienta ${n}.`, parameters: { type: "object", properties: {} } },
}));

// Entorno falso del turno: callChat guionizado. El guion recibe
// (args, registro) y devuelve la respuesta del "modelo".
// registro.llamadas: cada llamada con {tools:[nombres], mensajes}.
// registro.subagentes: llamadas cuyo sistema es de subagente.
function entornoFalso(guion) {
  const registro = { llamadas: [], subagentes: [], enVuelo: 0, maxEnVuelo: 0, ejecuciones: [] };
  const callChat = async (args) => {
    const mensajes = args.messages || [];
    const sistema = mensajes.find((m) => m.role === "system");
    const esSubagente = Boolean(sistema && String(sistema.content || "").includes("<subagente_editcore>"));
    const entrada = { tools: (args.tools || []).map((t) => t?.function?.name).filter(Boolean), mensajes, esSubagente };
    registro.llamadas.push(entrada);
    if (esSubagente) registro.subagentes.push(entrada);
    registro.enVuelo += 1;
    registro.maxEnVuelo = Math.max(registro.maxEnVuelo, registro.enVuelo);
    try {
      return await guion(args, entrada, registro);
    } finally {
      registro.enVuelo -= 1;
    }
  };
  const toolsMod = {
    execute: async (nombre, args) => {
      registro.ejecuciones.push({ nombre, args });
      return { ok: true, output: "ok" };
    },
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

async function turnoNexus(deps, mensaje) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-subag-"));
  return manejarChatNuevo({
    message: mensaje,
    history: [],
    projectRoot,
    providerKey: "nexus",
    model: "editcore-nexus-v5",
    helpers: {},
  }, deps);
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

test("C2-1: sin palabra mágica, Nexus ofrece delegación, cerebro, skills y creación/publicación", async () => {
  const { deps, registro } = entornoFalso(async () => respuestaTexto("El proyecto tiene una carpeta principal de código y otra de pruebas."));
  await turnoNexus(deps, "Examina la organización del proyecto y dime qué contiene cada carpeta principal");
  assert.ok(registro.llamadas.length >= 1, "el modelo debió ser llamado");
  const ofrecidas = new Set(registro.llamadas[0].tools);
  for (const nombre of ["delegate_parallel", "invoke_subagent", "search_brain", "list_skills", "read_skill", "delete_file", "build_project", "create_project", "publish_project"]) {
    assert.ok(ofrecidas.has(nombre), `la herramienta ${nombre} debe ofrecerse sin palabra mágica`);
  }
});

test("C2-2: delegate_parallel corre subagentes reales al modelo, en paralelo, con auditoría N/N", async () => {
  let llamadaPrincipal = 0;
  const { deps, registro } = entornoFalso(async (args, entrada) => {
    if (entrada.esSubagente) {
      await new Promise((r) => setTimeout(r, 60));
      const sistema = String(entrada.mensajes.find((m) => m.role === "system")?.content || "");
      const rol = (sistema.match(/Rol: (\w+)/) || [])[1] || "rol";
      return respuestaTexto(`Informe del subagente ${rol}: revisión terminada con evidencia.`);
    }
    llamadaPrincipal += 1;
    if (llamadaPrincipal === 1) {
      return respuestaLlamada("delegate_parallel", {
        tasks: [
          { role: "security", target: ".", question: "Busca credenciales quemadas" },
          { role: "analyst", target: "runtime", question: "Analiza la arquitectura" },
          { role: "explorer", target: "src", question: "Mapea la zona" },
        ],
      });
    }
    return respuestaTexto("Revisión terminada: los tres frentes entregaron su informe.");
  });
  const res = await turnoNexus(deps, "Revisa el proyecto a fondo: seguridad, arquitectura y estructura");
  assert.ok(res.ok);
  assert.ok(registro.subagentes.length >= 3, `debieron correr 3 subagentes al modelo; corrieron ${registro.subagentes.length}`);
  assert.ok(registro.maxEnVuelo >= 2, `los subagentes deben correr EN PARALELO (máx. en vuelo: ${registro.maxEnVuelo})`);
  const ultima = JSON.stringify(registro.llamadas[registro.llamadas.length - 1].mensajes);
  assert.match(ultima, /3\/3 entregaron/, "el resultado de la delegación debe auditar 3/3 entregaron");
  assert.match(ultima, /Informe del subagente security/);
  assert.match(ultima, /Informe del subagente analyst/);
});

test("C2-3: un subagente sin informe queda declarado por nombre y el paso marca fallo", async () => {
  let llamadaPrincipal = 0;
  const { deps, registro } = entornoFalso(async (args, entrada) => {
    if (entrada.esSubagente) {
      const sistema = String(entrada.mensajes.find((m) => m.role === "system")?.content || "");
      if (/Rol: analyst/.test(sistema)) return respuestaTexto(""); // sin informe
      return respuestaTexto("Informe del subagente security: sin credenciales quemadas.");
    }
    llamadaPrincipal += 1;
    if (llamadaPrincipal === 1) {
      return respuestaLlamada("delegate_parallel", {
        tasks: [
          { role: "security", target: ".", question: "Busca credenciales quemadas" },
          { role: "analyst", target: "runtime", question: "Analiza la arquitectura" },
        ],
      });
    }
    return respuestaTexto("Revisión terminada con un frente pendiente, declarado en el informe.");
  });
  const res = await turnoNexus(deps, "Revisa seguridad y arquitectura del proyecto");
  const ultima = JSON.stringify(registro.llamadas[registro.llamadas.length - 1].mensajes);
  assert.match(ultima, /1\/2 entregaron/, "la auditoría debe decir 1/2 entregaron");
  assert.match(ultima, /sin informe: analyst/, "el faltante debe nombrarse: analyst");
  const paso = (res.steps || []).find((p) => p.nombre === "delegate_parallel");
  assert.ok(paso, "el paso de delegación debe constar en los hechos del turno");
  assert.equal(paso.ok, false, "una delegación incompleta NO puede marcar ok");
});

test("C2-4: invoke_subagent con rol security corre al modelo con su prompt de rol", async () => {
  let llamadaPrincipal = 0;
  const { deps, registro } = entornoFalso(async (args, entrada) => {
    if (entrada.esSubagente) return respuestaTexto("Informe de seguridad: se revisaron las rutas sensibles.");
    llamadaPrincipal += 1;
    if (llamadaPrincipal === 1) {
      return respuestaLlamada("invoke_subagent", { role: "security", task: "Busca credenciales quemadas en el proyecto", target: "." });
    }
    return respuestaTexto("Revisión de seguridad terminada con el informe del especialista.");
  });
  const res = await turnoNexus(deps, "Haz una revisión de seguridad del proyecto");
  assert.ok(res.ok);
  assert.equal(registro.subagentes.length, 1, "debió correr exactamente un subagente al modelo");
  const sistema = String(registro.subagentes[0].mensajes.find((m) => m.role === "system")?.content || "");
  assert.match(sistema, /security/i, "el prompt del subagente debe llevar su rol especialista");
  const ultima = JSON.stringify(registro.llamadas[registro.llamadas.length - 1].mensajes);
  assert.match(ultima, /1\/1 entregaron/);
});

test("C2-5: el prompt de sistema de Nexus declara delegación y conocimiento siempre disponibles", async () => {
  const { deps, registro } = entornoFalso(async () => respuestaTexto("Respuesta directa sin herramientas."));
  await turnoNexus(deps, "Cuéntame cómo está el proyecto en una frase");
  const sistema = String(registro.llamadas[0].mensajes.find((m) => m.role === "system")?.content || "");
  assert.match(sistema, /delegate_parallel/, "el prompt debe hablar de delegate_parallel");
  assert.match(sistema, /siempre disponibles/i, "el prompt debe declarar las herramientas de delegación y conocimiento SIEMPRE disponibles");
  assert.match(sistema, /frentes independientes/i, "el prompt debe dar el criterio de cuándo delegar");
});

test("C2-6: la ruta vieja (parallel-delegate) ya no fabrica «sin hallazgos negativos»", async () => {
  const out = await runDelegatedTasks({
    projectRoot: os.tmpdir(),
    tasks: [
      { role: "explorer", target: ".", question: "Mapea la zona" },
      { role: "analyst", target: ".", question: "Analiza" },
    ],
    runners: {
      explorer: async () => ({ ok: true, summary: "Informe real de exploración." }),
      analyst: async () => ({}), // terminó sin entregar informe
    },
  });
  const delAnalyst = (out.results || []).find((r) => r.role === "analyst");
  assert.ok(delAnalyst, "debe constar el resultado del analyst");
  assert.doesNotMatch(String(delAnalyst.text || ""), /sin hallazgos negativos/i, "prohibido disfrazar la no-entrega como «sin hallazgos»");
  assert.match(String(delAnalyst.text || ""), /sin informe|no entregó/i, "la no-entrega debe decirse como lo que es");
  assert.equal(out.completa, false, "con un subagente sin informe la delegación NO es completa");
});

test("C2-7: si el Cerebro no responde en su ventana, la memoria del turno lo declara", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-cerebro-"));
  const memoria = await construirMemoria(
    { message: "¿qué decidimos ayer sobre el proyecto?", projectRoot },
    { brainSearch: () => new Promise(() => {}) } // nunca responde
  );
  assert.match(String(memoria || ""), /Cerebro no respondió|sin recuerdos semánticos/i,
    "el silencio del Cerebro debe declararse en la memoria del turno, no callarse");
});
