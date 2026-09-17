"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("boot: fast path marca interactive antes del background", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const interactiveAt = src.indexOf('performance.mark?.("editcore-interactive")');
  const backgroundAt = src.indexOf("bootBackground(");
  const hydrateAllLoop = /for \(const project of state\.projects\) \{\s*if \(!project\?\.projectRoot\) continue;\s*await hydrateProjectChatsFromDisk/;
  assert.ok(interactiveAt > 0);
  assert.ok(backgroundAt > 0);
  assert.ok(interactiveAt < backgroundAt, "interactive debe marcarse antes de lanzar bootBackground");
  assert.doesNotMatch(src, hydrateAllLoop);
  assert.match(src, /requestIdleCallback[\s\S]{0,250}bootBackground/);
});

test("selectProject: en Chat no arranca preview", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(src, /wantPreview/);
  assert.match(src, /dataset\.appMode !== ["']chat["']/);
  assert.match(src, /options\.preview !== false/);
});

test("bridges Settings / Chat Home expuestos", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(src, /window\.EditCoreTheme\s*=/);
  assert.match(src, /window\.EditCorePermissions\s*=/);
  assert.match(src, /window\.openConnections\s*=/);
  assert.match(src, /window\.EditCoreModels\s*=/);
});

test("main: createWindow antes de migracion/cerebro en arranque normal", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const createAt = src.indexOf('createWindow({ windowId: "main" })');
  const brainAt = src.indexOf("startup:brain-initializing");
  assert.ok(createAt > 0 && brainAt > createAt);
  assert.match(src, /UI primero: migraciones\/tareas\/Cerebro/);
  assert.match(src, /spellcheck:\s*false/);
});

test("focus ya no refresca catalogo siempre", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.doesNotMatch(src, /window\.addEventListener\("focus", refreshVisibleProjectCatalog\)/);
  assert.match(src, /if \(!\$\("projectsDialog"\)\?\.open\) return/);
});

test("main: UI carga index.html canónico de la app", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(src, /loadUiIntoWindow/);
  assert.match(src, /createWindow/);
});

test("dictation prioriza Windows STT y escribe en prompt IDE/Chat", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(src, /window\.EditCoreDictation\s*=/);
  assert.match(src, /writeDictationToPrompts/);
  assert.match(src, /startWindowsDictationFallback/);
  assert.match(src, /startMediaRecorderDictation/);
  assert.match(src, /Preferir Windows STT|windowsSttStart/);
});
