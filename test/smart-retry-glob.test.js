"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCommonStrategies } = require("../runtime/smart-retry");

function globStrategy(dir) {
  const s = createCommonStrategies("list_files", { path: dir.replace(/\\/g, "/") }).find((x) => x.name === "glob pattern");
  assert.ok(s, "falta la estrategia glob pattern");
  return s;
}

test("smart-retry glob pattern: lista archivos anidados sin node_modules/.git (fs.glob nativo)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-glob-"));
  for (const rel of ["a.js", "src/b.js", "src/deep/c.txt", "node_modules/x/index.js", ".git/HEAD", "dist/out.js"]) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "x");
  }
  const files = await globStrategy(dir).execute();
  const names = files.map((f) => path.relative(dir, f.path).replace(/\\/g, "/")).sort();
  assert.deepEqual(names, ["a.js", "src/b.js", "src/deep/c.txt"]);
  assert.ok(files.every((f) => f.kind === "file" && f.name === path.basename(f.path)));
});

test("smart-retry glob pattern: carpeta vacía rechaza para pasar a la siguiente estrategia", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-glob-empty-"));
  await assert.rejects(globStrategy(dir).execute(), /No se encontraron archivos/);
});

test("smart-retry ya no depende del paquete glob (no declarado y sin API de callback en v9+)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "runtime", "smart-retry.js"), "utf8");
  assert.doesNotMatch(src, /require\(\s*["']glob["']\s*\)/);
});
