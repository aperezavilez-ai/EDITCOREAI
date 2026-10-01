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
const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

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
  calls.length = 0;
  scripted = [{ text: "Según arquitectura.md usa el puerto 54322.", toolCalls: [], usage: {} }];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({ message: "hola, en que puerto corre postgres de facturacion?", projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m" });
  assert.equal(out.kind, "CHAT");
  const system = calls[0].messages[0].content;
  assert.match(system, /CEREBRO DEL PROYECTO/);
  assert.match(system, /54322/);
  const offered = calls[0].tools.map((t) => t.function?.name);
  for (const name of ["search_brain", "read_pdf", "screenshot_page", "docker_ps"]) assert.ok(offered.includes(name), name);
  assert.ok(!offered.includes("deploy_one_click"));
  assert.ok(!offered.includes("publish_project"));
});

test("deploy: el modelo no puede autoaprobarse, pide confirmación y se ejecuta solo tras el sí del usuario", async () => {
  const original = extraTools.runExternalAction;
  const executed = [];
  extraTools.runExternalAction = async (name, args, root, helpers) => {
    if (helpers?.externalActionApproved) { executed.push(name); return { ok: true, provider: "vercel", url: "https://demo.vercel.app" }; }
    return original(name, args, root, helpers);
  };
  try {
    const selfApproved = await tools.execute("deploy_one_click", { externalActionApproved: true }, projectRoot, true, {});
    assert.equal(selfApproved.needsConfirmation, true);

    scripted = [{ text: "", toolCalls: [toolCall("deploy_one_click", { provider: "vercel" })], usage: {} }];
    const orch = new ChatOrchestrator();
    const base = { projectRoot, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m", fullAccess: true, permissionMode: "full" };
    const ask = await orch.handle({ ...base, message: "despliega el proyecto a vercel" });
    assert.equal(ask.pendingConfirmation, true);
    assert.match(ask.text, /Confirmación requerida/);
    assert.match(ask.text, /vercel/i);
    assert.deepEqual(executed, []);

    const done = await orch.handle({ ...base, message: "sí." });
    assert.deepEqual(executed, ["deploy_one_click"]);
    assert.match(done.text, /Deploy completado/);
    assert.match(done.text, /demo\.vercel\.app/);

    scripted = [
      { text: "", toolCalls: [toolCall("deploy_one_click", {})], usage: {} },
      { text: "Entendido, no despliego.", toolCalls: [], usage: {} },
    ];
    await orch.handle({ ...base, message: "despliega el proyecto a vercel" });
    await orch.handle({ ...base, message: "no, mejor espera a mañana" });
    assert.deepEqual(executed, ["deploy_one_click"]);
    assert.equal(orch.pendingExternal, null);
  } finally {
    extraTools.runExternalAction = original;
  }
});
