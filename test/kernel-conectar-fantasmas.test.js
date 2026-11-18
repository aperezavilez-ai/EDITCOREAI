"use strict";
// [FASE2-CONECTAR] Batería de vuelta completa de las herramientas
// fantasma del kernel conectadas en la Fase 2 (mapa de conectividad):
// C-1 graphify_project, C-4 web_scrape, C-5 ingest_to_brain,
// C-8 delete_file, C-11 guardas de segunda capa y C-13 el Grupo 1B
// (funciones ya escritas que nadie envolvía). Cada prueba ejecuta la
// herramienta REAL vía tools.execute sobre un proyecto temporal y
// comprueba el efecto en disco o el dato devuelto — no la promesa.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const tools = require("../editcore-chat-kernel/tools");
const { READ_ONLY_TOOLS, WRITE_TOOLS } = require("../editcore-chat-kernel/classify");

function proyectoTemporal() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f2-conectar-"));
  fs.writeFileSync(path.join(tmp, "a.js"), "require(\"./b\");\n");
  fs.writeFileSync(path.join(tmp, "b.js"), "require(\"./a\");\n");
  fs.writeFileSync(path.join(tmp, "ROADMAP.md"), "# Mapa de prueba\n");
  fs.writeFileSync(path.join(tmp, ".env.example"), "CLAVE_A=\nCLAVE_B=\n");
  fs.writeFileSync(path.join(tmp, ".env"), "CLAVE_A=1\n");
  fs.mkdirSync(path.join(tmp, "supabase", "migrations"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "supabase", "migrations", "001.sql"), "create table t(x int);\n");
  fs.writeFileSync(path.join(tmp, "doc.md"), "# Documento de prueba para ingerir\n");
  return tmp;
}

const CONECTADAS_FASE2 = [
  "graphify_project", "ingest_to_brain", "web_scrape", "delete_file",
  "list_snapshots", "analyze_circular_dependencies", "read_roadmap",
  "audit_env", "supabase_migrate", "clone_repo",
];

test("las conectadas de la Fase 2 están clasificadas y servidas (a∩cobertura de b)", () => {
  const clasificadas = new Set([...READ_ONLY_TOOLS, ...WRITE_TOOLS]);
  const servidas = new Set(tools.getToolDefinitions({ allowWrite: true, isFullAccess: true }).map((d) => d.function.name));
  for (const nombre of CONECTADAS_FASE2) {
    assert.ok(clasificadas.has(nombre), `${nombre} debe estar clasificada`);
    assert.ok(servidas.has(nombre), `${nombre} debe estar servida por getToolDefinitions`);
  }
  // Y los nombres muertos de B-3 ya no se prometen en ningún conjunto.
  assert.ok(!clasificadas.has("update_roadmap"), "update_roadmap fuera de la clasificación");
  assert.ok(!clasificadas.has("capture_preview"), "capture_preview fuera de la clasificación");
  assert.ok(servidas.has("capture_preview_screenshot"), "la real sigue servida");
});

test("graphify_project: sin escritura no corre; con escritura genera graphify-out/", async () => {
  const tmp = proyectoTemporal();
  const sin = await tools.execute("graphify_project", {}, tmp, false, {});
  assert.equal(sin.ok, false);
  assert.ok(!fs.existsSync(path.join(tmp, "graphify-out")), "sin escritura no se escribe nada");
  const con = await tools.execute("graphify_project", {}, tmp, true, {});
  assert.equal(con.ok, true);
  assert.ok(fs.existsSync(path.join(tmp, "graphify-out")), "graphify-out/ creado de verdad");
});

test("ingest_to_brain: ingiere el documento y queda en el índice del Cerebro", async () => {
  const tmp = proyectoTemporal();
  const r = await tools.execute("ingest_to_brain", { path: "doc.md" }, tmp, true, {});
  assert.equal(r.ok, true);
  assert.equal(r.ingested, 1);
  const sin = await tools.execute("ingest_to_brain", { path: "doc.md" }, tmp, false, {});
  assert.equal(sin.ok, false, "sin escritura la guarda del case lo corta");
});

test("web_scrape: lee una URL real y devuelve su texto", async () => {
  const srv = http.createServer((_req, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<html><head><title>P</title></head><body><h1>Contenido scrapeable F2</h1></body></html>");
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/`;
    const out = await tools.execute("web_scrape", { url }, process.cwd(), false, {});
    assert.equal(out.ok, true);
    assert.ok(JSON.stringify(out).includes("Contenido scrapeable F2"));
  } finally {
    srv.close();
  }
});

test("delete_file: la guarda corta sin escritura; con escritura borra y deja snapshot", async () => {
  const tmp = proyectoTemporal();
  const target = path.join(tmp, "borrame.txt");
  fs.writeFileSync(target, "adios");
  const sin = await tools.execute("delete_file", { path: "borrame.txt" }, tmp, false, {});
  assert.equal(sin.ok, false);
  assert.ok(fs.existsSync(target), "sin escritura el archivo sigue");
  const con = await tools.execute("delete_file", { path: "borrame.txt" }, tmp, true, {});
  assert.equal(con.ok, true);
  assert.ok(!fs.existsSync(target), "el archivo se borró de verdad");
  const snaps = await tools.execute("list_snapshots", {}, tmp, false, {});
  assert.equal(snaps.ok, true);
  assert.ok(snaps.snapshots.length >= 1, "el snapshot previo al borrado quedó listado");
});

test("Grupo 1B: las funciones envueltas responden con datos reales", async () => {
  const tmp = proyectoTemporal();
  const circ = await tools.execute("analyze_circular_dependencies", {}, tmp, false, {});
  assert.equal(circ.ok, true);
  assert.ok(Array.isArray(circ.cycles) && circ.cycles.length >= 1, "detecta el ciclo a<->b");
  const road = await tools.execute("read_roadmap", {}, tmp, false, {});
  assert.equal(road.ok, true);
  assert.ok(String(road.content).includes("Mapa de prueba"));
  const env = await tools.execute("audit_env", {}, tmp, false, {});
  assert.equal(env.ok, true);
  assert.deepEqual(env.missing, ["CLAVE_B"]);
  const mig = await tools.execute("supabase_migrate", {}, tmp, true, {});
  assert.equal(mig.ok, true);
  assert.ok(Array.isArray(mig.files) && mig.files.length === 1, "previsualiza la migración real");
  const migSin = await tools.execute("supabase_migrate", {}, tmp, false, {});
  assert.equal(migSin.ok, false, "supabase_migrate exige escritura en su case");
  fs.mkdirSync(path.join(tmp, "destino-repo"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "destino-repo", "ya.txt"), "x");
  const clone = await tools.execute("clone_repo", { url: "https://github.com/x/y.git", path: "destino-repo" }, tmp, true, {});
  assert.equal(clone.ok, true);
  assert.ok(String(clone.note || "").includes("Ya existía") || String(clone.note || "").includes("ya existe"));
  const cloneSin = await tools.execute("clone_repo", { url: "https://github.com/x/y.git" }, tmp, false, {});
  assert.equal(cloneSin.ok, false, "clone_repo exige escritura en su case");
});

test("C-11: fetch_stock_photo y scaffold_project comprueban allowWrite en su case", async () => {
  const tmp = proyectoTemporal();
  const foto = await tools.execute("fetch_stock_photo", { query: "taller" }, tmp, false, {});
  assert.equal(foto.ok, false);
  assert.match(String(foto.error), /escribe la foto en disco/);
  const scaffold = await tools.execute("scaffold_project", { prompt: "app" }, tmp, false, {});
  assert.equal(scaffold.ok, false);
  assert.match(String(scaffold.error), /escribe la base del proyecto/);
});
