"use strict";
// [FASE2-CONECTAR] Batería de vuelta completa del portado del Grupo
// 1A (C-12) y del cierre de skills (C-3/C-10, S-5): las herramientas
// que existían completas en superficies que no alimentan el chat
// (dispatcher runtime del agente, superficie del Cerebro) ahora se
// sirven y se despachan en el kernel, y read_skill lee TODAS las
// raíces que list_skills anuncia. Cada prueba ejecuta la herramienta
// real vía tools.execute y comprueba datos o efectos, no promesas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const tools = require("../runtime/tools/tools");
const { READ_ONLY_TOOLS, WRITE_TOOLS } = require("../runtime/tools/classify");

const PORTADAS_1A = [
  "project_discovery", "codebase_map", "symbol_search", "dependency_search",
  "probe_endpoint", "clone_web_page", "images_to_code", "generate_image",
  "generate_video", "add_erp_module", "fullstack_deploy", "run_e2e_pipeline",
  "brain_search", "brain_skill", "brain_tools", "inspect_preview", "create_project",
];
const PORTADAS_ESCRITURA = ["clone_web_page", "images_to_code", "generate_image", "generate_video", "add_erp_module", "fullstack_deploy", "run_e2e_pipeline"];

function proyectoTemporal() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f2-portadas-"));
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "tmp-f2", version: "1.0.0", scripts: { dev: "node index.js" } }));
  fs.writeFileSync(path.join(tmp, "index.js"), "const { helper } = require(\"./helper\");\nfunction saludar() { return helper(); }\nmodule.exports = { saludar };\n");
  fs.writeFileSync(path.join(tmp, "helper.js"), "function helper() { return 42; }\nmodule.exports = { helper };\n");
  return tmp;
}

function userDataConSkillGlobal() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), "f2-userdata-"));
  const dir = path.join(ud, "skills", "carpeta-rara");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: skill-global-prueba\ndescription: Skill global de prueba F2\n---\n# Cuerpo global F2\nInstrucciones de la skill global.\n");
  return ud;
}

test("las 17 portadas del Grupo 1A están clasificadas y servidas", () => {
  const clasificadas = new Set([...READ_ONLY_TOOLS, ...WRITE_TOOLS]);
  const servidas = new Set(tools.getToolDefinitions({ allowWrite: true, isFullAccess: true }).map((d) => d.function.name));
  for (const nombre of PORTADAS_1A) {
    assert.ok(clasificadas.has(nombre), `${nombre} clasificada`);
    assert.ok(servidas.has(nombre), `${nombre} servida`);
  }
  assert.equal(servidas.size, 77, "el set servido completo son 77 herramientas");
  assert.equal(clasificadas.size, 77, "la clasificación promete exactamente 77");
});

test("las lecturas portadas responden con datos del proyecto real", async () => {
  const tmp = proyectoTemporal();
  const discovery = await tools.execute("project_discovery", {}, tmp, false, {});
  assert.equal(discovery.projectName, "tmp-f2");
  const simbolos = await tools.execute("symbol_search", { query: "saludar" }, tmp, false, {});
  assert.ok(JSON.stringify(simbolos).includes("saludar"), "symbol_search encuentra el símbolo real");
  const mapa = await tools.execute("codebase_map", {}, tmp, false, {});
  assert.ok(JSON.stringify(mapa).length > 20, "codebase_map devuelve el mapa");
  const deps = await tools.execute("dependency_search", { query: "helper" }, tmp, false, {});
  assert.ok(JSON.stringify(deps).length > 2, "dependency_search responde");
});

test("probe_endpoint sondea un servidor HTTP real", async () => {
  const srv = http.createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("{\"ok\":true}"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const tmp = proyectoTemporal();
    const out = await tools.execute("probe_endpoint", { url: `http://127.0.0.1:${srv.address().port}/` }, tmp, false, {});
    assert.ok(JSON.stringify(out).includes("200"), "el sondeo reporta el 200 real");
  } finally {
    srv.close();
  }
});

test("las escrituras portadas se niegan sin escritura y no caen en «desconocida» con ella", async () => {
  const tmp = proyectoTemporal();
  for (const nombre of PORTADAS_ESCRITURA) {
    const sin = await tools.execute(nombre, { prompt: "x", url: "https://example.com" }, tmp, false, {});
    assert.equal(sin.ok, false, `${nombre} sin escritura se niega`);
    assert.match(String(sin.error), /requiere modo escritura/, `${nombre} lo corta su guarda`);
  }
  const imagen = await tools.execute("generate_image", { prompt: "un gato" }, tmp, true, {});
  assert.equal(imagen.ok, false);
  assert.match(JSON.stringify(imagen), /no configurada|configura/i, "sin proveedor de imagen, el error es de configuración, no «desconocida»");
  const deploy = await tools.execute("fullstack_deploy", {}, tmp, true, {});
  assert.equal(deploy.ok, false, "sin conexiones el deploy no finge éxito");
  assert.ok(!String(deploy.error || "").includes("desconocida"));
});

test("brain_search usa la costura del Cerebro cuando viene y el índice local si no", async () => {
  const tmp = proyectoTemporal();
  let llamada = null;
  const helpers = { brainSearch: async (root, q, opts) => { llamada = { root, q, opts }; return { memory: [{ title: "M", content: "recuerdo" }], knowledge: [] }; } };
  const via = await tools.execute("brain_search", { query: "algo", scope: "memory", limit: 3 }, tmp, false, helpers);
  assert.equal(via.ok, true);
  assert.equal(llamada.q, "algo");
  assert.equal(llamada.opts.scope, "memory");
  assert.equal(via.memory.length, 1);
  const local = await tools.execute("brain_search", { query: "helper" }, tmp, false, {});
  assert.equal(local.ok, true, "sin costura responde el índice local");
});

test("brain_tools inventaría lo servido y las skills instaladas de verdad", async () => {
  const tmp = proyectoTemporal();
  const ud = userDataConSkillGlobal();
  const inv = await tools.execute("brain_tools", {}, tmp, false, { userDataPath: ud });
  assert.equal(inv.ok, true);
  assert.equal(inv.agentToolsTotal, 77);
  assert.ok(inv.skills.total >= 1);
  assert.ok(inv.skills.names.includes("skill-global-prueba"), "la skill global aparece en el inventario");
});

test("inspect_preview: sin costuras lo dice; con costuras compone arranque y captura", async () => {
  const tmp = proyectoTemporal();
  const sin = await tools.execute("inspect_preview", {}, tmp, true, {});
  assert.equal(sin.ok, false);
  assert.match(String(sin.error), /no conectó las costuras/);
  const helpers = {
    startPreview: async () => ({ url: "http://127.0.0.1:4321/" }),
    capturePreview: async ({ url, viewport }) => ({ ok: true, url, viewport, pngPath: "captura.png" }),
  };
  const con = await tools.execute("inspect_preview", { viewport: "mobile" }, tmp, true, helpers);
  assert.equal(con.ok, true);
  assert.equal(con.previewUrl, "http://127.0.0.1:4321/");
  assert.equal(con.capture.viewport, "mobile");
});

test("create_project crea el proyecto nuevo con el servicio de scaffold real", async () => {
  const tmp = proyectoTemporal();
  const sin = await tools.execute("create_project", { name: "mini", template: "blank" }, tmp, false, {});
  assert.equal(sin.ok, false);
  const creado = await tools.execute("create_project", { name: "mini-web", template: "blank" }, tmp, true, {});
  assert.equal(creado.ok, true);
  assert.equal(creado.path, "mini-web");
  assert.ok(fs.existsSync(path.join(tmp, "mini-web")), "la carpeta del proyecto nuevo existe");
  assert.ok(fs.readdirSync(path.join(tmp, "mini-web")).length > 0, "y no está vacía");
});

test("S-5/C-3: read_skill lee las skills globales/aprendidas por nombre y por carpeta", async () => {
  const tmp = proyectoTemporal();
  const ud = userDataConSkillGlobal();
  const helpers = { userDataPath: ud };
  const lista = await tools.execute("list_skills", {}, tmp, false, helpers);
  assert.ok((lista.global || []).includes("skill-global-prueba"), "list_skills la anuncia como global");
  const porNombre = await tools.execute("read_skill", { name: "skill-global-prueba" }, tmp, false, helpers);
  assert.equal(porNombre.ok, true);
  assert.ok(String(porNombre.content).includes("Cuerpo global F2"));
  const porCarpeta = await tools.execute("read_skill", { name: "carpeta-rara" }, tmp, false, helpers);
  assert.equal(porCarpeta.ok, true, "el alias de carpeta (doble identidad) también resuelve");
  const viaBrain = await tools.execute("brain_skill", { name: "skill-global-prueba" }, tmp, false, helpers);
  assert.equal(viaBrain.ok, true);
  assert.ok(String(viaBrain.content).includes("Cuerpo global F2"));
});

test("las skills del catálogo semilla siguen legibles (sin regresión de la cadena)", async () => {
  const tmp = proyectoTemporal();
  const semilla = path.join(__dirname, "..", "brain-seed", "skills");
  const primera = fs.readdirSync(semilla, { withFileTypes: true }).find((e) => e.isDirectory());
  assert.ok(primera, "hay skills semilla en el repo");
  const leida = await tools.execute("read_skill", { name: primera.name }, tmp, false, {});
  assert.equal(leida.ok, true, `la skill semilla ${primera.name} se sigue leyendo`);
  assert.ok(String(leida.content).length > 50);
});
