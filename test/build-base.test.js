"use strict";

// Base profesional con movimiento (v4.7.0). La landing de Taller Luis
// salió como un index.html suelto y plano porque el proyecto estaba
// vacío y el agente improvisó: la base profesional del IDE (React +
// Vite + Tailwind + Framer Motion) solo se sentaba al CREAR el proyecto
// y la herramienta scaffold_project estaba clasificada en classify.js
// pero no existía en tools.js. Aquí: la herramienta nace, una compuerta
// bloquea una vez el HTML suelto sobre un lienzo en turnos de
// construcción, y las fotos pueden ir a public/assets (proyectos Vite).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const guard = require("../editcore-chat-kernel/build-base-guard");
const tools = require("../editcore-chat-kernel/tools");
const stock = require("../editcore-chat-kernel/stock-photos");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-base-"));
}

test("base: projectLooksEmpty reconoce el lienzo y respeta una app existente", () => {
  const empty = tmpDir();
  assert.equal(guard.projectLooksEmpty(empty), true);
  fs.writeFileSync(path.join(empty, "README.md"), "# hola");
  assert.equal(guard.projectLooksEmpty(empty), true, "un blank con README sigue siendo lienzo");
  fs.writeFileSync(path.join(empty, "package.json"), "{}");
  assert.equal(guard.projectLooksEmpty(empty), false, "con package.json ya es una app");
  const withSrc = tmpDir();
  fs.mkdirSync(path.join(withSrc, "src"));
  fs.writeFileSync(path.join(withSrc, "README.md"), "# x");
  assert.equal(guard.projectLooksEmpty(withSrc), false);
  assert.equal(guard.projectLooksEmpty(path.join(empty, "no-existe")), false);
});

test("base: la compuerta bloquea una vez el HTML suelto y luego deja pasar", () => {
  const ctx = { name: "write_file", args: { path: "index.html" }, buildTask: true, projectEmpty: true, scaffolded: false, blocksSoFar: 0 };
  const block = guard.maybeBlockLooseHtmlWrite(ctx);
  assert.ok(block && block.blocked === true);
  assert.match(block.guidance, /scaffold_project/);
  assert.equal(guard.maybeBlockLooseHtmlWrite({ ...ctx, blocksSoFar: 1 }), null, "fail-open tras un bloqueo");
  assert.equal(guard.maybeBlockLooseHtmlWrite({ ...ctx, scaffolded: true }), null);
  assert.equal(guard.maybeBlockLooseHtmlWrite({ ...ctx, buildTask: false }), null);
  assert.equal(guard.maybeBlockLooseHtmlWrite({ ...ctx, projectEmpty: false }), null);
  assert.equal(guard.maybeBlockLooseHtmlWrite({ ...ctx, args: { path: "src/index.html" } }), null, "un HTML dentro de src/ no es la página suelta");
  assert.equal(guard.maybeBlockLooseHtmlWrite({ ...ctx, name: "replace_in_file" }), null);
});

test("base: el protocolo del turno ordena sentar la base antes de escribir", () => {
  const prompt = guard.buildBaseProtocolPrompt();
  assert.match(prompt, /scaffold_project/);
  assert.match(prompt, /npm install/);
  assert.match(prompt, /capture_preview_screenshot/);
});

test("base: scaffold_project existe y sienta la base animada en un proyecto vacío", async () => {
  const defs = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true, isAnalysis: false });
  assert.ok(defs.some((t) => (t.function?.name || t.name) === "scaffold_project"), "la definición debe existir");
  const tmp = tmpDir();
  fs.writeFileSync(path.join(tmp, "README.md"), "# Taller Luis");
  const res = await tools.execute("scaffold_project", { name: "Taller Luis", prompt: "landing de un taller mecánico" }, tmp, true);
  assert.equal(res.ok, true);
  assert.equal(res.template, "animated-pwa");
  assert.ok(fs.existsSync(path.join(tmp, "package.json")));
  assert.ok(fs.existsSync(path.join(tmp, "src", "App.tsx")));
  assert.ok(fs.existsSync(path.join(tmp, "src", "components", "sections", "Hero.tsx")));
  const pkg = JSON.parse(fs.readFileSync(path.join(tmp, "package.json"), "utf8"));
  const deps = JSON.stringify(pkg.dependencies || {});
  assert.match(deps, /framer-motion|"motion"/, "la base trae librería de movimiento");
  // Y no pisa lo que acaba de crear:
  const again = await tools.execute("scaffold_project", { name: "Otro" }, tmp, true);
  assert.equal(again.ok, false, "sobre un proyecto con contenido se niega sin force");
});

test("base: las fotos pueden guardarse en public/assets para proyectos Vite", async () => {
  const tmp = tmpDir();
  const jpeg = Buffer.alloc(20480, 3);
  const fetcher = async (url) => {
    if (String(url).includes("openverse")) {
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ results: [{ url: "https://img.example/t.jpg", title: "t", creator: "A", license: "cc0", foreign_landing_url: "" }] }) };
    }
    return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) };
  };
  const res = await stock.fetchStockPhoto({ query: "mechanic", name: "hero", folder: "public/assets", projectRoot: tmp, fetcher });
  assert.equal(res.ok, true);
  assert.equal(res.path, "public/assets/hero.jpg");
  assert.ok(fs.existsSync(path.join(tmp, "public", "assets", "hero.jpg")));
  const evil = await stock.fetchStockPhoto({ query: "mechanic", name: "hero", folder: "../../fuera", projectRoot: tmp, fetcher });
  assert.equal(evil.ok, true);
  assert.ok(!evil.path.includes(".."), "la carpeta jamás sale del proyecto");
});
