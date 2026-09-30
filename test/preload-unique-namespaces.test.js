"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PRELOAD = path.join(ROOT, "preload.js");
const OVERLAY_PRELOAD = path.join(ROOT, "resources", "ui-overlay", "preload.js");

function exposedNames(source) {
  return [...source.matchAll(/exposeInMainWorld\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
}

test("preload.js expone cada namespace una sola vez (contextBridge lanza en duplicados)", () => {
  const names = exposedNames(fs.readFileSync(PRELOAD, "utf8"));
  const dups = names.filter((n, i) => names.indexOf(n) !== i);
  assert.ok(names.length > 50);
  assert.deepEqual(dups, []);
});

test("preload.js compila", () => {
  const source = fs.readFileSync(PRELOAD, "utf8");
  assert.doesNotThrow(() => new Function("require", "module", source));
});

test("resources/ui-overlay/preload.js es idéntico a preload.js", () => {
  if (!fs.existsSync(OVERLAY_PRELOAD)) return;
  const norm = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  assert.equal(norm(OVERLAY_PRELOAD), norm(PRELOAD));
});
