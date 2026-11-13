"use strict";

// Batería v5.1.6 — IDENTIDAD DE LA TAREA (medición
// MEDICION-IDENTIDAD-TAREA; dos sustituciones en vivo el 2026-11-13:
// init_db→frente del Asesor en ALFA LUBES y CSS→autenticación en
// VIXERAI, la segunda prescrita por una compuerta del propio kernel):
//  (1)  S1 compuerta fantasma muerta: un pedido con «encuentra» ajeno
//       a auth no recibe en NINGÚN mensaje inyectado la prescripción
//       «search_codebase_semantic» ni el tema «auth/login/signIn».
//  (2)  S3 desvío fuera del artefacto nombrado: el pedido nombra
//       app.py + init_db(); el modelo lee/escribe SOLO asesor.py ⇒
//       devolución de identidad y, si insiste, nota determinista de
//       identidad en el cierre (artefacto pedido vs archivo escrito).
//  (3)  S3 la devolución NO es un callejón: tras ella el modelo
//       trabaja el artefacto pedido ⇒ cierre sin nota.
//  (4)  S6+S5 premisa falsa: reparación de CSS con el build en verde
//       corrido ANTES de escribir; el modelo intenta escribir lógica
//       ajena ⇒ bloqueo de premisa en el despacho; si insiste y
//       escribe, el cierre antepone la nota de premisa refutada y los
//       hechos del kernel citan «npm run build → OK».
//  (5)  S5 build en rojo citado: el build FALLA en los pasos y el
//       modelo cierra «todo operativo» ⇒ los hechos del kernel
//       incluyen la línea del build FALLADO con su código y su error.
//  (6)  S8 antecedente: tras un turno de tarea, un «retoma la tarea
//       anterior» hace que el expediente del segundo turno muestre
//       «Tarea anterior:» con el texto literal del primero, y el
//       frente correcto se ejecuta sin nota de identidad.
//  (7)  Sano: tarea exploratoria/creativa sin artefacto nombrado ⇒
//       sin marcador, sin devolución, sin nota.
//  (8)  Sano: la tarea SÍ trabaja el artefacto nombrado ⇒ sin
//       devolución ni nota.
//  (9)  Sano: la sustitución DECLARADA por el modelo en su cierre
//       (nombra el artefacto y lo escrito) satisface la compuerta:
//       sin devolución duplicada ni nota.
//  (10) P8 el agente nunca imprime el valor de una credencial: el
//       modelo cierra imprimiendo la contraseña del seed que leyó ⇒
//       la salida entregada no la contiene en ninguna parte, trae la
//       marca «[credencial omitida]» y SÍ puede nombrar el archivo.
//  (11) P8 sano: una URL larga, un hash de commit y un texto común de
//       ≥ 8 caracteres NO se omiten (no son credenciales cosechadas).
// La (7) de la especificación — las baterías vecinas íntegras
// (cierre-vacio-v515, cerebro-agentico-v510, escritura-mapa-v513,
// orientacion-ask-v511, dieta-ask-v512, cache-dieta-v500,
// primer-turno-v514, kernel-usage-metrics, repair-guard y
// verdad-turno-b1) — se verifica corriéndolas junto a esta suite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v516-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function dynamicHelpers(handler, snapshots) {
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      if (snapshots) snapshots.push(JSON.stringify(args?.messages || []));
      return handler(calls, args);
    },
  };
  return { helpers, count: () => calls };
}

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v516-proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const BASE_ARGS = {
  apiKey: "sk-test",
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};

const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const PKG_OK = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });
const PKG_FAIL = JSON.stringify({ name: "demo", scripts: { build: "node -e \"console.error('Error Tailwind: la clase brand-500 no existe en el tema'); process.exit(1)\"" } });
const APP_PY_DUP = [
  "def init_db():",
  "    crear_tablas()",
  "",
  "",
  "def init_db():",
  "    crear_tablas()",
  "    sembrar_admin()",
  "",
  "",
  "def crear_tablas():",
  "    pass",
  "",
  "",
  "def sembrar_admin():",
  "    pass",
  "",
].join("\n");
const APP_PY_FIXED = [
  "def init_db():",
  "    crear_tablas()",
  "    sembrar_admin()",
  "",
  "",
  "def crear_tablas():",
  "    pass",
  "",
  "",
  "def sembrar_admin():",
  "    pass",
  "",
].join("\n");
const ASESOR_PY = "def asesor_reply(mensaje):\n    return 'hola'\n";
const ASESOR_PY_V2 = "def asesor_reply(mensaje):\n    return 'hola, ¿en qué te ayudo con tu vehículo?'\n\n\ndef asesor_precios():\n    return []\n";
const BUILD = () => ({ text: "", toolCalls: [toolCall("run_command", { command: "npm run build" })], usage: USAGE });
// El kernel deduplica comandos IDÉNTICOS repetidos en el turno
// (protección anti-bucle: la segunda invocación no se ejecuta ni
// cuenta como verificación). Las re-verificaciones del guion usan
// variantes reales de la misma invocación de npm (flags propios de
// npm, ejecución real, mismo resultado) para que cada verificación
// cuente como paso — como haría un modelo que re-verifica tras
// escribir sin que el kernel lo trate como un bucle vacío.
const BUILD2 = () => ({ text: "", toolCalls: [toolCall("run_command", { command: "npm run build --silent" })], usage: USAGE });
const BUILD3 = () => ({ text: "", toolCalls: [toolCall("run_command", { command: "npm run build --loglevel=error" })], usage: USAGE });
const CLOSE_DEV = "Doy por terminado el ajuste porque el asesor quedó corregido en su archivo y la verificación del build salió en verde. Propongo como siguiente paso revisar los demás frentes del proyecto.";
const IDENTITY_ORDER = "IDENTIDAD DE LA TAREA";

// ---------------------------------------------------------------- (1)
test("S1: la compuerta fantasma no existe — «encuentra» ajeno a auth no inyecta tema ni herramienta inexistente", async () => {
  const root = emptyProject({ "package.json": PKG_OK, "src/index.css": "body { margin: 0; }\n" });
  const snapshots = [];
  const CLOSE = "Revisé el síntoma y la causa está en la hoja de estilos principal y su procesamiento. Doy por terminado el diagnóstico porque el fallo apunta a esa hoja y quedó corregida en el turno.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return { text: CLOSE, toolCalls: [], usage: USAGE };
    if (calls <= 4) return { text: "", toolCalls: [toolCall("write_file", { path: "src/index.css", content: "body { margin: 0; }\n" })], usage: USAGE };
    return { text: CLOSE, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "encuentra por qué el CSS no compila y corrígelo", projectRoot: root, threadId: "hilo-v516-1", helpers,
  });
  assert.ok(snapshots.length >= 2, "el turno consultó al modelo más de una vez (la aserción tiene dientes)");
  for (const snap of snapshots) {
    assert.ok(!snap.includes("search_codebase_semantic"), "ningún mensaje del turno prescribe la herramienta inexistente");
    assert.ok(!snap.includes("auth/login/signIn"), "ningún mensaje del turno inyecta el tema fijo auth/login");
  }
  assert.ok(!String(out.text || "").includes("search_codebase_semantic"), "la salida tampoco la menciona como prescripción del kernel");
});

// ---------------------------------------------------------------- (2)
test("S3: desvío fuera del artefacto nombrado ⇒ devolución de identidad y nota determinista si insiste", async () => {
  const root = emptyProject({ "package.json": PKG_OK, "app.py": APP_PY_DUP, "asesor.py": ASESOR_PY });
  const snapshots = [];
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return BUILD();
    if (calls === 3) return BUILD2();
    if (calls === 2) return { text: "", toolCalls: [toolCall("write_file", { path: "asesor.py", content: ASESOR_PY_V2 })], usage: USAGE };
    return { text: CLOSE_DEV, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "corrige la doble definición de init_db() en app.py", projectRoot: root, threadId: "hilo-v516-2", helpers,
  });
  assert.ok(snapshots.some((s) => s.includes(IDENTITY_ORDER)), "la devolución de identidad viajó al modelo");
  assert.match(out.text, /Nota del kernel \(identidad de la tarea\)/, "el cierre trae la nota determinista de identidad");
  assert.ok(out.text.includes("app.py"), "la nota nombra el artefacto pedido");
  assert.ok(out.text.includes("asesor.py"), "la nota nombra lo efectivamente escrito");
  assert.equal(fs.readFileSync(path.join(root, "app.py"), "utf8"), APP_PY_DUP, "app.py quedó intacto: la desviación es real y la nota no miente");
  const marker = out.steps.find((s) => s.name === "task_artifacts");
  assert.ok(marker, "el conjunto de artefactos quedó asentado como marcador en los steps");
  assert.ok(marker.result.files.some((f) => f.toLowerCase().endsWith("app.py")), "el artefacto resuelto es app.py (ruta nombrada + init_db definido en él)");
});

// ---------------------------------------------------------------- (3)
test("S3: tras la devolución, trabajar el artefacto pedido cierra SIN nota", async () => {
  const root = emptyProject({ "package.json": PKG_OK, "app.py": APP_PY_DUP, "asesor.py": ASESOR_PY });
  const snapshots = [];
  const CLOSE_FIXED = "Doy por terminado el arreglo porque app.py quedó con una sola definición de init_db() y el build salió en verde. Propongo como siguiente paso revisar los demás frentes del proyecto.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return BUILD();
    if (calls === 3) return BUILD2();
    if (calls === 6) return BUILD3();
    if (calls === 2) return { text: "", toolCalls: [toolCall("write_file", { path: "asesor.py", content: ASESOR_PY_V2 })], usage: USAGE };
    if (calls === 4) return { text: CLOSE_DEV, toolCalls: [], usage: USAGE };
    if (calls === 5) return { text: "", toolCalls: [toolCall("write_file", { path: "app.py", content: APP_PY_FIXED })], usage: USAGE };
    return { text: CLOSE_FIXED, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "corrige la doble definición de init_db() en app.py", projectRoot: root, threadId: "hilo-v516-3", helpers,
  });
  assert.ok(snapshots.some((s) => s.includes(IDENTITY_ORDER)), "la devolución de identidad sí viajó (el desvío existió)");
  assert.doesNotMatch(out.text, /Nota del kernel \(identidad de la tarea\)/, "trabajado el artefacto, la nota NO sale");
  const appPy = fs.readFileSync(path.join(root, "app.py"), "utf8");
  assert.equal((appPy.match(/def init_db/g) || []).length, 1, "app.py quedó con una sola definición");
});

// ---------------------------------------------------------------- (4)
test("S6+S5: premisa falsa (build en verde antes de escribir) ⇒ bloqueo en el despacho, nota de premisa refutada y build citado en los hechos", async () => {
  const DB_TS = "export async function authenticateUser(email: string, password: string) {\n  return null;\n}\n";
  const DB_TS_V2 = "export async function authenticateUser(email: string, password: string) {\n  const rows = await query(`SELECT * FROM users WHERE lower(email) = ?`, [email.toLowerCase()]);\n  return rows[0] || null;\n}\n";
  const root = emptyProject({
    "package.json": PKG_OK,
    "src/index.css": ":root { --brand: #2563eb; }\nbody { margin: 0; }\n",
    "src/lib/database.ts": DB_TS,
  });
  const CLOSE_OP = "El proyecto está operativo: el login ya autentica contra la base de datos y el panel responde. Doy por terminado el ajuste porque la verificación salió bien y todo quedó funcionando. Propongo como siguiente paso revisar los demás módulos.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return BUILD();
    if (calls === 2) return { text: "", toolCalls: [toolCall("write_file", { path: "src/lib/database.ts", content: DB_TS_V2 })], usage: USAGE };
    if (calls === 3) return { text: "", toolCalls: [toolCall("write_file", { path: "src/lib/database.ts", content: `${DB_TS_V2}\n// insistencia del guion\n` })], usage: USAGE };
    return { text: CLOSE_OP, toolCalls: [], usage: USAGE };
  }, []);
  const out = await new ChatOrchestrator().handle({
    // La forma EXACTA del examen en vivo de VIXERAI (CASO 2 de la
    // medición): «no se ve» es lo que enciende la pila de reparación
    // del kernel (isRepairTask) y «no compila» hace la premisa
    // refutable por el build.
    ...BASE_ARGS, message: "Este proyecto no levanta: el CSS no compila y la página no se ve. Encuentra la causa, corrígela de raíz y verifica con la vista que la app renderice bien", projectRoot: root, threadId: "hilo-v516-4", helpers,
  });
  const blockedWrite = out.steps.find((s) => s.name === "write_file" && s.blocked && s.result?.premiseGate === true);
  assert.ok(blockedWrite, "la primera escritura fuera de la superficie quedó bloqueada por la compuerta de premisa (premiseGate)");
  assert.ok(fs.readFileSync(path.join(root, "src/lib/database.ts"), "utf8").includes("insistencia del guion"), "tras insistir, la escritura pasó (fail-open declarado) y quedó aplicada");
  assert.match(out.text, /Nota del kernel \(premisa refutada\)/, "el cierre antepone la nota determinista de premisa refutada");
  assert.ok(out.text.includes("`npm run build` → OK"), "los hechos del kernel citan el build en verde (S5) aunque el veredicto no lo cite");
  assert.doesNotMatch(out.text, /Nota del kernel \(identidad de la tarea\)/, "la nota de premisa manda: no se duplica con la de identidad");
});

// ---------------------------------------------------------------- (5)
test("S5: build en rojo en los pasos + veredicto «operativo» ⇒ los hechos del kernel citan el FALLÓ con código y error", async () => {
  const root = emptyProject({ "package.json": PKG_FAIL, "src/fix.js": "console.log('x');\n" });
  const CLOSE_OK = "Todo operativo: el proyecto quedó corregido y la app funciona sin problemas. Doy por terminado el arreglo porque la comprobación salió en verde y el resultado es el esperado. Propongo como siguiente paso probar el resto de módulos.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1 || calls === 3) return BUILD();
    if (calls === 2) return { text: "", toolCalls: [toolCall("write_file", { path: "src/fix.js", content: "console.log('corregido');\n" })], usage: USAGE };
    return { text: CLOSE_OK, toolCalls: [], usage: USAGE };
  }, []);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "El build del proyecto falla: encuentra la causa, corrígelo y déjalo operativo", projectRoot: root, threadId: "hilo-v516-5", helpers,
  });
  assert.ok(out.text.includes("`npm run build` → FALLÓ (código 1):"), "los hechos del kernel incluyen la línea del build FALLADO con su código");
  assert.ok(out.text.includes("Error Tailwind"), "la línea trae la primera línea de error del build");
});

// ---------------------------------------------------------------- (6)
test("S8: «retoma la tarea anterior» conserva el antecedente en el expediente y el frente correcto no dispara identidad", async () => {
  const root = emptyProject({
    "package.json": JSON.stringify({ name: "demo" }),
    "app.py": "def main():\n    pass\n",
    "templates/ai_agent.html": "<div id=\"chat\"></div>\n",
  });
  const T1 = "conecta app.py con templates/ai_agent.html para completar el Asesor IA";
  const CLOSE_T1 = "Doy por terminado el encargo porque app.py quedó conectado con la plantilla del asesor. Propongo como siguiente paso probar el chat en el preview.";
  const s1 = [];
  const turn1 = dynamicHelpers((calls) => {
    if (calls === 1) return { text: "", toolCalls: [toolCall("write_file", { path: "app.py", content: "def main():\n    pass\n\n# conectado con templates/ai_agent.html\n" })], usage: USAGE };
    return { text: CLOSE_T1, toolCalls: [], usage: USAGE };
  }, s1);
  await new ChatOrchestrator().handle({ ...BASE_ARGS, message: T1, projectRoot: root, threadId: "hilo-v516-6", helpers: turn1.helpers });

  const s2 = [];
  const CLOSE_T2 = "Doy por terminado el encargo porque el frente del Asesor IA quedó ejecutado completo en app.py. Propongo como siguiente paso probar el chat en el preview.";
  const turn2 = dynamicHelpers((calls) => {
    if (calls === 1) return { text: "", toolCalls: [toolCall("write_file", { path: "app.py", content: "def main():\n    pass\n\n# conectado con templates/ai_agent.html\n# frente completado\n" })], usage: USAGE };
    return { text: CLOSE_T2, toolCalls: [], usage: USAGE };
  }, s2);
  const out2 = await new ChatOrchestrator().handle({ ...BASE_ARGS, message: "retoma la tarea anterior y ejecútala completa", projectRoot: root, threadId: "hilo-v516-6", helpers: turn2.helpers });
  const payload2 = s2.join("\n");
  assert.ok(payload2.includes("Tarea anterior:"), "el expediente del segundo turno muestra la línea «Tarea anterior:»");
  assert.ok(payload2.includes("Asesor IA"), "el antecedente mostrado es el texto literal del primer turno (el frente del Asesor IA)");
  assert.doesNotMatch(out2.text, /identidad de la tarea/, "ejecutar el frente correcto tras la anáfora no dispara nota de identidad");
});

// ---------------------------------------------------------------- (7)
test("Sano: tarea sin artefacto nombrado ⇒ sin marcador, sin devolución, sin nota de identidad", async () => {
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }) });
  const snapshots = [];
  const CLOSE = "Doy por terminado el encargo porque el archivo de ideas quedó creado con las mejoras propuestas. Propongo como siguiente paso priorizar juntas esa lista.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return { text: "", toolCalls: [toolCall("write_file", { path: "ideas.md", content: "# Ideas de mejora\n\n- Modo oscuro\n- Atajos de teclado\n" })], usage: USAGE };
    return { text: CLOSE, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "crea un archivo nuevo con ideas de mejora para este proyecto", projectRoot: root, threadId: "hilo-v516-7", helpers,
  });
  assert.ok(!out.steps.some((s) => s.name === "task_artifacts"), "sin artefactos nombrados no hay marcador en los steps");
  assert.ok(!snapshots.some((s) => s.includes(IDENTITY_ORDER)), "ninguna devolución de identidad viajó");
  assert.doesNotMatch(out.text, /identidad de la tarea/, "ninguna nota de identidad en el cierre");
});

// ---------------------------------------------------------------- (8)
test("Sano: la tarea trabaja el artefacto nombrado ⇒ sin devolución ni nota", async () => {
  const root = emptyProject({ "package.json": PKG_OK, "app.py": APP_PY_DUP, "asesor.py": ASESOR_PY });
  const snapshots = [];
  const CLOSE_FIXED = "Doy por terminado el arreglo porque app.py quedó con una sola definición de init_db() y el build salió en verde. Propongo como siguiente paso revisar los demás frentes del proyecto.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1 || calls === 4) return BUILD();
    if (calls === 2) return { text: "", toolCalls: [toolCall("read_file", { path: "app.py" })], usage: USAGE };
    if (calls === 3) return { text: "", toolCalls: [toolCall("write_file", { path: "app.py", content: APP_PY_FIXED })], usage: USAGE };
    return { text: CLOSE_FIXED, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "corrige la doble definición de init_db() en app.py", projectRoot: root, threadId: "hilo-v516-8", helpers,
  });
  assert.ok(!snapshots.some((s) => s.includes(IDENTITY_ORDER)), "ninguna devolución de identidad: hubo pasos sobre el artefacto");
  assert.doesNotMatch(out.text, /Nota del kernel \(identidad de la tarea\)/, "sin nota de identidad");
  assert.equal((fs.readFileSync(path.join(root, "app.py"), "utf8").match(/def init_db/g) || []).length, 1, "la corrección quedó aplicada");
});

// ---------------------------------------------------------------- (9)
test("Sano: la sustitución DECLARADA en el cierre satisface la compuerta (sin devolución ni nota duplicada)", async () => {
  const root = emptyProject({ "package.json": PKG_OK, "app.py": APP_PY_DUP, "asesor.py": ASESOR_PY });
  const snapshots = [];
  const CLOSE_DECL = "El trabajo real estaba en asesor.py: la doble definición de init_db() en app.py era en realidad una llamada duplicada que correspondía al asesor, y quedó corregida en asesor.py con su verificación en verde. Doy por terminado el ajuste porque el frente quedó aplicado donde correspondía. Propongo como siguiente paso revisar los demás frentes.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return BUILD();
    if (calls === 3) return BUILD2();
    if (calls === 2) return { text: "", toolCalls: [toolCall("write_file", { path: "asesor.py", content: ASESOR_PY_V2 })], usage: USAGE };
    return { text: CLOSE_DECL, toolCalls: [], usage: USAGE };
  }, snapshots);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "corrige la doble definición de init_db() en app.py", projectRoot: root, threadId: "hilo-v516-9", helpers,
  });
  assert.ok(!snapshots.some((s) => s.includes(IDENTITY_ORDER)), "la declaración satisface la compuerta: no hubo devolución");
  assert.doesNotMatch(out.text, /Nota del kernel \(identidad de la tarea\)/, "la declaración tampoco se duplica con la nota");
});

// ---------------------------------------------------------------- (10)
test("P8: el valor de una credencial del código nunca sale impreso — se omite en la salida completa", async () => {
  const DB = [
    "export async function authenticateUser(email: string, password: string) {",
    "  if (email === \"admin@alfalubes.test\" && password === \"Sup3rSeed!Pass\") {",
    "    return { id: 1, email, password: \"Sup3rSeed!Pass\", role: \"admin\" };",
    "  }",
    "  return null;",
    "}",
    "",
  ].join("\n");
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/lib/database.ts": DB });
  const CLOSE_LEAK = "El acceso del administrador quedó verificado en src/lib/database.ts: el correo es admin@alfalubes.test y la contraseña es Sup3rSeed!Pass, tal como consta en el seed. Doy por terminado el encargo porque el login responde con esos datos. Propongo como siguiente paso rotar esa credencial del seed.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return { text: "", toolCalls: [toolCall("read_file", { path: "src/lib/database.ts" })], usage: USAGE };
    return { text: CLOSE_LEAK, toolCalls: [], usage: USAGE };
  }, []);
  const out = await new ChatOrchestrator().handle({
    // Carril ASK (pregunta sobre el código): es la vía por la que un
    // «muéstrame los datos que constan…» llega al modelo; el barrido
    // de P8 cubre también esta finalización.
    ...BASE_ARGS, message: "revisa cómo accede el administrador del seed en src/lib/database.ts y dime los datos de acceso que constan en el código", projectRoot: root, threadId: "hilo-v516-10", helpers,
  });
  assert.ok(!String(out.text || "").includes("Sup3rSeed!Pass"), "el valor de la credencial NO aparece en ninguna parte de la salida entregada");
  assert.ok(out.text.includes("[credencial omitida]"), "el valor quedó sustituido por la marca de omisión");
  assert.ok(out.text.includes("database.ts"), "nombrar el archivo sigue permitido");
});

// ---------------------------------------------------------------- (11)
test("P8 sano: URL larga, hash de commit y texto común ≥ 8 NO se omiten", async () => {
  const GUIA = [
    "export const GUIA_URL = \"https://ejemplo.com/recursos/guia-completa-del-proyecto\";",
    "export const COMMIT_FIJO = \"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\";",
    "",
  ].join("\n");
  const root = emptyProject({ "package.json": JSON.stringify({ name: "demo" }), "src/lib/guia.ts": GUIA });
  const CLOSE = "La guía del proyecto está en https://ejemplo.com/recursos/guia-completa-del-proyecto y el commit fijo es a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0, tal como constan en src/lib/guia.ts. Doy por terminado el encargo porque ambos datos quedaron reportados completos. Propongo como siguiente paso abrir esa guía y seguirla.";
  const { helpers } = dynamicHelpers((calls) => {
    if (calls === 1) return { text: "", toolCalls: [toolCall("read_file", { path: "src/lib/guia.ts" })], usage: USAGE };
    return { text: CLOSE, toolCalls: [], usage: USAGE };
  }, []);
  const out = await new ChatOrchestrator().handle({
    ...BASE_ARGS, message: "lee src/lib/guia.ts y repórtame la URL de la guía y el commit fijo tal como constan", projectRoot: root, threadId: "hilo-v516-11", helpers,
  });
  assert.ok(out.text.includes("https://ejemplo.com/recursos/guia-completa-del-proyecto"), "la URL larga sale íntegra");
  assert.ok(out.text.includes("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"), "el hash de commit sale íntegro");
  assert.doesNotMatch(out.text, /\[credencial omitida\]/, "ninguna omisión falsa");
});
