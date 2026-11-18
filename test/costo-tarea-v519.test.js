"use strict";

// Batería v5.1.9 — M4: cortes de costo de los turnos de TAREA tras
// la medición MEDICION-M4 (la sobrecarga fija por llamada — no la
// zona de pasos — pasó a mandar: 65-72 % del turno):
//  (K1) DESCRIPCIONES A PRIMERA FRASE EN EL PAYLOAD: el JSON de
//      definiciones medía 19.340 caracteres por llamada y el 48 %
//      era prosa. La copia que viaja al proveedor lleva cada
//      descripción ceñida a su primera frase; el SET queda intacto
//      (nombres, parámetros y esquemas idénticos — no es la dieta
//      C6 excluida en M3) y las definiciones de origen no se
//      mutan. Byte-estable entre llamadas.
//  (K3) INFORMES DE DELEGACIÓN SIN ECO: el resultado de
//      delegate_parallel que entra al contexto del padre ya no
//      trae el bloque «Memoria compartida» que los subagentes
//      devolvían como eco (78 % del informe medido): el retiro se
//      hace sobre la copia del mensaje, con marca declarada; el
//      step conserva el resultado íntegro y el subagente sigue
//      RECIBIENDO la memoria (B5 de la v5.1.0 intacta).
//  (K4a) El resultado de delegate_parallel pasa a stub con ≥3
//      pasos más nuevos (ventana propia), no a los 6 generales; el
//      stub declara la ventana que de verdad se le aplicó.
//  (K4b) DETENIDO TRAS MEDIRLO en esta misma construcción: la
//      sustitución en tandas (solo stubbear al juntar ≥3
//      elegibles, para romper el prefijo menos veces) costó
//      +26.071 caracteres brutos en el escenario S1 del harness
//      M4 a cambio de un beneficio condicional a que el gateway
//      honre prefijos (en vivo lee el 27-35 % del potencial). La
//      pasada sigue siendo inmediata, como en la v5.1.7; el caso
//      (K4b-detenido) lo deja fijado.
//  (K2') DEDUPE EXPEDIENTE↔MAPA POR SECCIONES (segunda pasada,
//      decisión de Lu 2026-11-14): la primera tentativa omitía el
//      bloque ENTERO del expediente en aperturas EXECUTE y rompió
//      (S8) de identidad-tarea-v516 — el expediente carga las
//      líneas de identidad «Tarea en curso:»/«Tarea anterior:»
//      (v5.1.6-S8, blindadas) que el Mapa NO destila. La variante
//      por secciones (la original de la medición M4) poda SOLO la
//      sección que el Mapa ya declara — «Decisiones:» — cuando el
//      Mapa viaja en el mismo turno EXECUTE, conservando
//      identidad, objetivo, archivos, verificados y notas. La
//      puerta dura fue (S8) SIN MODIFICAR: pasa. El carril de
//      preguntas no se toca (la puerta es EXECUTE y el expediente
//      ASK sale íntegro).
//  (K5) B1 CONSCIENTE DEL RANGO (segunda pasada, decisión de Lu
//      2026-11-14): el stub del índice del hilo solo sale si el
//      rango pedido SOLAPA la cobertura registrada; un rango
//      disjunto es información nueva y la lectura es real. El
//      invariante de la v5.1.8 se conserva: lo cubierto o solapado
//      jamás se reenvía. El corte exigió la ÚNICA re-delimitación
//      de esta versión: (B1) de correcciones-v518 — que fijaba el
//      stub por archivo afirmándolo con un rango disjunto — pasa
//      a afirmar el stub para un rango SOLAPADO, y el caso nuevo
//      (B1-bis) de esa misma batería afirma la lectura real del
//      rango disjunto, con la justificación escrita en el propio
//      test (precedente v5.1.7). Aquí el caso (K5) fija la
//      semántica a nivel del harness dueño del stub.
//  (K6) DETENIDO por la misma regla: mover la marca de
//      presupuesto de C3 del historial al mensaje del turno rompe
//      la aserción (b2) de costo-ejecucion-v517 («la marca
//      declarada viaja en el primer mensaje retenido», sobre la
//      rebanada de historial que excluye el mensaje del turno).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v519-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

// [FASE2-RUTA-UNICA] El orquestador viejo se retiró. De esta
// batería sobreviven: K1-a (slimToolDefinitions vive en tools.js,
// infraestructura compartida), K1-b re-conducida por la entrada
// única del kernel nuevo — que desde esta fase aplica la dieta EN
// EL CABLE en su adaptador — y K5 (threadReadStub vive en
// runtime/agent-token-harness, módulo vivo). Se retiran con el
// orquestador: K2' (el recorte del expediente por carril era una
// pasada de su prefijo; el kernel nuevo construye la memoria en
// index.js con Mapa acotado + Cerebro, batería kernel-nuevo-bridge),
// K3 (stripSharedMemoryEcho: pasada suya sin contraparte; el bucle
// nuevo acota cada resultado a 2.000 caracteres en el adaptador) y
// K4 (stubAgedToolResults: su higiene de envejecimiento; la del
// kernel nuevo son los presupuestos duros por carril de turno.js).
const kernelIndex = require("../editcore-chat-kernel/index");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const orientationMap = require("../editcore-chat-kernel/orientation-map");
const tokenHarness = require("../runtime/agent-token-harness");
const tools = require("../editcore-chat-kernel/tools");

const BASE_ARGS = {
  apiKey: ["sk", "fake", "v519"].join("-"),
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 };

let callSeq = 0;
function toolCall(name, args) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// callChat falso que captura mensajes Y herramientas tal cual
// salen del kernel en cada llamada (copia profunda: el kernel muta
// los mensajes entre llamadas — stubs — y la captura debe ser la
// foto de ESA llamada).
function capturingHelpers(script, captures) {
  const queue = [...script];
  return {
    callChat: async (args) => {
      captures.push({
        messages: JSON.parse(JSON.stringify(args?.messages || [])),
        tools: JSON.parse(JSON.stringify(args?.tools || [])),
      });
      return queue.shift() || { text: "Listo.", toolCalls: [], usage: USAGE };
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

const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

// ------------------------------------------------------------ (K1-a)
test("(K1-a) slimToolDefinitions: mismo set y esquemas, descripciones a primera frase, origen intacto y byte-estable", () => {
  const raw = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true });
  const slim = tools.slimToolDefinitions(raw);
  assert.equal(slim.length, raw.length, "el set no pierde ni una herramienta");
  assert.deepEqual(
    slim.map((d) => d.function?.name),
    raw.map((d) => d.function?.name),
    "mismos nombres en el mismo orden",
  );
  // Esquemas idénticos salvo el texto de las descripciones.
  const blank = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "description" ? "" : v)));
  assert.deepEqual(blank(slim), blank(raw), "parámetros y esquemas intactos: solo cambia la prosa");
  // La dieta medida: el JSON completo baja de 30.794 a ≤24.000.
  // [REDELIMITADO A PROPÓSITO, 2026-11-16] La línea base M4 era
  // 19.340 con 34 herramientas y el tope dietado ≤14.000. Las 4
  // herramientas de documentos (create_pdf / create_word /
  // create_excel / create_csv), hechas reales por orden de Luis,
  // suman 1.391 caracteres en crudo y 685 ya dietadas: la base
  // pasa a 20.731 y el tope a ≤15.000. La dieta sigue vigente
  // (el payload baja ~29%) y byte-estable entre llamadas.
  // [REDELIMITADO A PROPÓSITO, FASE 2 v5.2.7] La cirugía
  // conectar-o-borrar hizo reales las 27 herramientas fantasma que
  // la clasificación ya prometía (Grupos 1A/1B + graphify, ingest,
  // web_scrape, delete_file): el set servido pasa de 38 a 65, la
  // base cruda a 30.794 y la dietada medida a 23.386 — el tope
  // pasa a ≤24.000. La dieta sigue vigente (el payload baja ~24%)
  // y byte-estable entre llamadas; lo que se mueve es el tamaño
  // del set REAL, no la disciplina de la dieta.
  const rawJson = JSON.stringify(raw);
  const slimJson = JSON.stringify(slim);
  assert.equal(rawJson.length, 30794, "la línea base con 65 herramientas es 30.794");
  assert.ok(slimJson.length <= 24000, `el payload de definiciones bajó a ${slimJson.length} caracteres`);
  // Primera frase exacta en los casos con historia:
  const byName = Object.fromEntries(slim.map((d) => [d.function.name, d.function]));
  assert.equal(byName.read_file.description, "Lee el contenido de un archivo.");
  assert.ok(
    byName.search_files.description.includes("p. ej. 'hero-taller.jpg', aunque sea binario)."),
    "la abreviatura «p. ej.» no corta la frase a la mitad: la primera frase sale completa",
  );
  assert.ok(byName.search_files.description.length < raw.find((d) => d.function.name === "search_files").function.description.length, "y aun así es más corta que la original");
  // Una descripción que ya es una sola frase queda byte a byte.
  assert.equal(byName.search_brain.description, raw.find((d) => d.function.name === "search_brain").function.description);
  // El origen NO se muta: las definiciones completas siguen ahí.
  assert.ok(raw.find((d) => d.function.name === "read_file").function.description.length > 200, "DEFINITIONS conserva el texto completo");
  // Byte-estable: dos pasadas producen el mismo JSON.
  assert.equal(JSON.stringify(tools.slimToolDefinitions(raw)), slimJson, "la transformación es determinista y estable entre llamadas");
});

// ------------------------------------------------------------ (K1-b)
test("(K1-b) en un turno EXECUTE real el payload lleva el set completo con descripciones cortas, idéntico entre llamadas", async () => {
  const root = emptyProject({ "package.json": PKG });
  const captures = [];
  await kernelIndex.handleChat({
    ...BASE_ARGS,
    message: "crea el archivo saludo.txt con el texto hola y verifica que quedó bien",
    projectRoot: root, threadId: "hilo-v519-k1",
    helpers: capturingHelpers([
      { text: "", toolCalls: [toolCall("write_file", { path: "saludo.txt", content: "hola\n" })], usage: USAGE },
      { text: "Creé saludo.txt con el saludo y verifiqué su contenido. Propongo como siguiente paso seguir con el resto de la página.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  assert.ok(captures.length >= 2, "el turno hizo sus llamadas");
  const payloadTools = captures[0].tools;
  const names = payloadTools.map((t) => t.function?.name);
  for (const expected of ["read_file", "write_file", "replace_in_file", "search_files", "delegate_parallel", "read_skill", "search_brain"]) {
    assert.ok(names.includes(expected), `el set del payload conserva ${expected} (contrato de turno: la vista no se recorta)`);
  }
  const readFile = payloadTools.find((t) => t.function?.name === "read_file");
  assert.equal(readFile.function.description, "Lee el contenido de un archivo.", "la descripción que viaja es la primera frase");
  // Tope redelimitado a 24.000 junto con la base (ver K1-a, Fase 2).
  assert.ok(JSON.stringify(payloadTools).length <= 24000, "el JSON de herramientas del payload quedó dietado");
  assert.equal(
    JSON.stringify(captures[1].tools), JSON.stringify(captures[0].tools),
    "las herramientas son byte-idénticas entre llamadas del turno (prefijo estable)",
  );
});

// ------------------------------------------------------------ (K3-a)
test("(K5) threadReadStub consciente del rango: solapado→stub, disjunto→null (lectura real), sin rango→stub, force:true→null", () => {
  const lines = [];
  for (let i = 1; i <= 60; i += 1) lines.push(`# relleno ${i}`);
  const root = emptyProject({ "package.json": PKG, "app.py": `${lines.join("\n")}\n` });
  const threadId = "hilo-v519-k5";
  // Una lectura real 1-10 alimenta el índice del hilo (huella real
  // de disco, como hace el orquestador tras despachar read_file).
  tokenHarness.noteThreadRead(root, threadId, "app.py", { startLine: 1, endLine: 10 }, { totalLines: 60 });
  // Solapado (5-15 toca 1-10): stub, y declara la cobertura.
  const stub = tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 5, endLine: 15 });
  assert.ok(stub?.threadReadStub === true, "un rango solapado con la cobertura devuelve el stub del hilo");
  assert.ok(String(stub.note || "").includes("1-10"), "el stub declara los rangos ya cubiertos");
  assert.ok(String(stub.note || "").includes("force:true"), "el stub declara la vía de escape");
  // Disjunto (40-60 no toca 1-10): null — la lectura será REAL.
  // Es el refinamiento de K5: información nueva no se castiga con
  // el desvío stub→búsqueda→force:true que midió M4.
  assert.strictEqual(
    tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 40, endLine: 60 }),
    null,
    "un rango disjunto (jamás leído) no devuelve stub: la lectura es real",
  );
  // Sin rango explícito el pedido es el archivo entero: solapa
  // cualquier cobertura y el stub manda, como en la v5.1.8.
  assert.ok(tokenHarness.threadReadStub(root, threadId, "app.py")?.threadReadStub === true, "sin rango (archivo entero) el stub sigue saliendo");
  // force:true: null siempre, haya o no cobertura.
  assert.strictEqual(
    tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 5, endLine: 15, force: true }),
    null,
    "con force:true nunca hay stub",
  );
  // La cobertura crece con cada lectura real: tras leer 40-60, ese
  // rango pasa a stubbear (el invariante: lo cubierto no se repite).
  tokenHarness.noteThreadRead(root, threadId, "app.py", { startLine: 40, endLine: 60 }, { totalLines: 60 });
  assert.ok(
    tokenHarness.threadReadStub(root, threadId, "app.py", { startLine: 45, endLine: 55 })?.threadReadStub === true,
    "tras la lectura real del rango disjunto, releer DENTRO de él vuelve a ser stub",
  );
});
