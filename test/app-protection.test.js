"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const mainSrc = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
const preloadSrc = fs.readFileSync(path.join(ROOT, "preload.js"), "utf8");
const rendererSrc = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");

test("Protección de núcleo: main.js contiene función isAppProtectedPath", () => {
  assert.match(mainSrc, /function isAppProtectedPath\(targetPath\)/);
  assert.match(mainSrc, /ipcMain\.handle\("project:is-protected"/);
  assert.match(mainSrc, /if \(isAppProtectedPath\(chosen\)\)/);
  assert.match(mainSrc, /if \(isAppProtectedPath\(root\)\)/);
});

test("Protección de núcleo: preload.js expone isProtectedAppPath", () => {
  assert.match(preloadSrc, /isProtectedAppPath:\s*\(targetPath\)\s*=>\s*ipcRenderer\.invoke\("project:is-protected",\s*targetPath\)/);
});

test("Protección de núcleo: renderer.js valida isProtectedAppPath al elegir o abrir proyecto", () => {
  assert.match(rendererSrc, /window\.editcoreProject\?\.isProtectedAppPath\?\.\(picked\)/);
  assert.match(rendererSrc, /selected\?\.projectRoot\s*&&\s*await\s+window\.editcoreProject\?\.isProtectedAppPath\?\.\(selected\.projectRoot\)/);
});
