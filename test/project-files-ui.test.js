"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveWrittenFileViewDir,
  resolveWrittenFileName,
  resolveHighlightNames,
  shouldAutoStartPreview,
  filesChangedPayload,
} = require("../runtime/project-files-ui");

const ROOT = "D:/PROGRAMAS IA/TICKETIA";

test("archivo en raiz vuelve al listado raiz del panel", () => {
  assert.equal(resolveWrittenFileViewDir(ROOT, "D:/PROGRAMAS IA/TICKETIA/README.md"), "");
  assert.equal(resolveWrittenFileViewDir(ROOT, "README.md"), "");
});

test("archivo en subcarpeta abre esa carpeta en el panel", () => {
  assert.equal(
    resolveWrittenFileViewDir(ROOT, "D:/PROGRAMAS IA/TICKETIA/src/app/page.tsx"),
    "src/app",
  );
  assert.deepEqual(
    resolveHighlightNames(ROOT, "D:/PROGRAMAS IA/TICKETIA/src/app/page.tsx"),
    ["src", "app", "page.tsx"],
  );
});

test("package.json dispara auto preview", () => {
  assert.equal(shouldAutoStartPreview("package.json"), true);
  assert.equal(shouldAutoStartPreview("README.md"), false);
});

test("css/tsx disparan hot-reload sin auto-start", () => {
  const { shouldHotReloadPreview } = require("../runtime/project-files-ui");
  assert.equal(shouldHotReloadPreview("App.tsx"), true);
  assert.equal(shouldHotReloadPreview("styles.css"), true);
  assert.equal(shouldHotReloadPreview("README.md"), false);
});

test("payload de cambio conserva directorio visible", () => {
  const payload = filesChangedPayload({
    name: "write_file",
    input: { path: "D:/PROGRAMAS IA/TICKETIA/package.json" },
  }, ROOT);
  assert.equal(payload.viewDir, "");
  assert.equal(payload.fileName, "package.json");
  assert.deepEqual(payload.highlightNames, ["package.json"]);
  assert.equal(payload.autoPreview, true);
  assert.equal(payload.hotReload, true);
});
