"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-extra-tools-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmp, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
const projectRoot = path.join(tmp, "proyecto");
const docsDir = path.join(tmp, "docs-externos");
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(path.join(docsDir, "node_modules"), { recursive: true });
fs.writeFileSync(path.join(docsDir, "arquitectura.md"), "# Arquitectura\n\nEl backend de facturacion usa Postgres en el puerto 54322 y colas con pgmq.\n\nOtro parrafo sin relacion.");
fs.writeFileSync(path.join(docsDir, ".env.local"), "SECRETO=no-ingerir");
fs.writeFileSync(path.join(docsDir, "node_modules", "basura.md"), "no ingerir");

const provider = require("../editcore-chat-kernel/provider");
const calls = [];
let scripted = [];
provider.callChat = async (opts) => {
  calls.push(opts);
  return scripted.shift() || { text: "Listo.", toolCalls: [], usage: {} };
};

const tools = require("../editcore-chat-kernel/tools");
const extraTools = require("../editcore-chat-kernel/extra-tools");
// [FASE2-RUTA-UNICA] Las pruebas de turno de este archivo se
// re-conducen por la entrada única del kernel nuevo (index.js);
// el ChatOrchestrator viejo se retiró del árbol en la v5.2.7.
const { handleChat } = require("../editcore-chat-kernel/index");

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

test("read_pdf extrae el texto de un PDF pequeño aunque venga de un Buffer del pool y rechaza texto plano", async () => {
  const pdf = path.join(__dirname, "..", "web-portal", "assets", "guia-instalacion.pdf");
  const out = await tools.execute("read_pdf", { path: pdf }, projectRoot, false, {});
  assert.equal(out.ok, true);
  assert.match(out.text, /Guia de instalacion/);
  const txt = await tools.execute("read_pdf", { path: path.join(docsDir, "arquitectura.md") }, projectRoot, false, {});
  assert.equal(txt.ok, false);
});

test("docker_ps devuelve contenedores o un error claro", async () => {
  const out = await tools.execute("docker_ps", {}, projectRoot, false, {});
  if (out.ok) assert.ok(Array.isArray(out.containers));
  else assert.match(out.error, /Docker/);
});

test("screenshot_page rechaza URLs que no son http(s)", async () => {
  const out = await tools.execute("screenshot_page", { url: "file:///C:/Windows/win.ini" }, projectRoot, false, {});
  assert.equal(out.ok, false);
  assert.match(out.error, /http/);
});

test("screenshot_page captura una página y devuelve su texto", { timeout: 90_000 }, async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end("<title>Pagina de prueba</title><h1>Hola EditCore</h1><p>Contenido visible</p>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const out = await tools.execute("screenshot_page", { url }, projectRoot, false, {});
    if (!out.ok && /chrome|browser|executable/i.test(out.error || "")) { t.skip("Chrome de puppeteer no disponible"); return; }
    assert.equal(out.ok, true);
    assert.equal(out.title, "Pagina de prueba");
    assert.deepEqual(out.headings, ["Hola EditCore"]);
    assert.ok(fs.statSync(out.screenshot).size > 1000);
  } finally {
    server.close();
  }
});

test("ingest_to_brain con path ingesta la carpeta (sin .env ni node_modules) y search_brain la encuentra", async () => {
  fs.copyFileSync(path.join(__dirname, "..", "web-portal", "assets", "guia-instalacion.pdf"), path.join(docsDir, "guia.pdf"));
  const out = await tools.execute("ingest_to_brain", { path: docsDir }, projectRoot, true, {});
  assert.equal(out.ok, true);
  assert.equal(out.ingested, 2);
  assert.ok(!JSON.stringify(out).includes("SECRETO"));

  const found = await tools.execute("search_brain", { query: "puerto de postgres facturacion" }, projectRoot, false, {});
  assert.equal(found.ok, true);
  assert.match(found.documents[0].text, /54322/);
  const pdfHit = await tools.execute("search_brain", { query: "guia instalacion requisitos" }, projectRoot, false, {});
  assert.ok(pdfHit.documents.some((d) => /Requisitos/.test(d.text)));
});

test("search_brain incluye memoria y código del índice global si está disponible", async () => {
  const helpers = { brainSearch: async () => ({ memory: [{ title: "Decision", type: "decision", content: "Usar pgmq" }], knowledge: [{ path: "src/db.ts", text: "export const db" }] }) };
  const out = await tools.execute("search_brain", { query: "pgmq" }, projectRoot, false, helpers);
  assert.equal(out.memory[0].title, "Decision");
  assert.equal(out.code[0].path, "src/db.ts");
});

test("el chat recibe el Cerebro del proyecto como contexto y tiene las tools nuevas de lectura", async () => {
  // [FASE2-RUTA-UNICA] Re-conducida por el kernel nuevo: la consulta
  // entra por la entrada única con la costura real del Cerebro
  // (helpers.brainSearch, la firma root/query/opciones). El
  // contrato afirmado es el mismo de siempre — la memoria llega al
  // turno y la consulta ofrece lecturas y NO acciones externas —
  // con las formas nuevas declaradas: la memoria viaja ENMARCADA
  // como referencia (corrección del juicio en vivo de la v5.2.6);
  // el carril es CONSULTA (localizar una entidad de código), no el
  // «CHAT» del clasificador viejo; y su set es de LECTURA DIRIGIDA
  // (list_files/read_file/search_files/read_pdf), no el catálogo
  // completo de lectura — es el diseño de carriles aprobado: la
  // pregunta general se responde desde la memoria, sin herramientas.
  calls.length = 0;
  scripted = [{ text: "Está en src/db.ts y usa el puerto 54322.", toolCalls: [], usage: {} }];
  const out = await handleChat({
    message: "¿dónde está la función conectarPostgres del backend de facturacion?",
    projectRoot,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "k",
    model: "m",
    helpers: {
      brainSearch: async () => [{ text: "arquitectura.md: el backend de facturacion usa Postgres en el puerto 54322" }],
    },
  });
  assert.equal(out.kind, "CONSULTA");
  assert.match(out.text, /54322/);
  const sistema = String(calls[0].messages[0].content || "");
  assert.match(sistema, /Material de referencia/, "la memoria llega enmarcada como referencia");
  assert.match(sistema, /54322/, "y el dato del Cerebro viaja dentro del marco");
  const offered = calls[0].tools.map((t) => t.function?.name);
  for (const name of ["list_files", "read_file", "search_files", "read_pdf"]) assert.ok(offered.includes(name), name);
  assert.ok(!offered.includes("deploy_one_click"));
  assert.ok(!offered.includes("publish_project"));
});

test("deploy: el modelo no puede autoaprobarse por argumentos (la aprobación no viaja en los args de la herramienta)", async () => {
  // [FASE2-RUTA-UNICA] Se conserva la mitad viva del contrato: a
  // nivel de herramienta, la aprobación de una acción externa llega
  // SOLO por helpers (la costura del llamante), nunca porque el
  // modelo la escriba en los argumentos. La otra mitad de la prueba
  // original — la máquina de confirmación por turno del orquestador
  // (pendingExternal, «¿procedo?» entre turnos) — era maquinaria del
  // kernel viejo y se retira con él: el kernel nuevo trabaja con
  // acceso completo permanente por regla de producto, y la compuerta
  // que queda es esta, la de la herramienta.
  const original = extraTools.runExternalAction;
  const executed = [];
  extraTools.runExternalAction = async (name, args, root, helpers) => {
    if (helpers?.externalActionApproved) { executed.push(name); return { ok: true, provider: "vercel", url: "https://demo.vercel.app" }; }
    return original(name, args, root, helpers);
  };
  try {
    const selfApproved = await tools.execute("deploy_one_click", { externalActionApproved: true }, projectRoot, true, {});
    assert.equal(selfApproved.needsConfirmation, true);
    assert.deepEqual(executed, [], "con la aprobación solo en los args, nada se ejecutó");
  } finally {
    extraTools.runExternalAction = original;
  }
});
