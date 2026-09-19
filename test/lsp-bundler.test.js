/**
 * Unit tests for LspBundler (runtime/lsp-bundler.js)
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { LspBundler, SUPPORTED_LANGUAGES } = require("../runtime/lsp-bundler");

test("LspBundler: detects supported languages correctly", () => {
  const bundler = new LspBundler();

  assert.strictEqual(bundler.detectLanguage("src/app.ts"), "typescript");
  assert.strictEqual(bundler.detectLanguage("main.py"), "python");
  assert.strictEqual(bundler.detectLanguage("package.json"), "json");
  assert.strictEqual(bundler.detectLanguage("README.md"), "markdown");
  assert.strictEqual(bundler.detectLanguage("image.png"), null);
});

test("LspBundler: analyzes JSON syntax errors and TS brace imbalance", async () => {
  const bundler = new LspBundler();

  // Valid JSON
  const validJsonDiags = await bundler.analyzeDocument("config.json", '{"name": "test"}');
  assert.strictEqual(validJsonDiags.length, 0);

  // Invalid JSON
  const invalidJsonDiags = await bundler.analyzeDocument("config.json", '{"name": "test",}');
  assert.strictEqual(invalidJsonDiags.length, 1);
  assert.strictEqual(invalidJsonDiags[0].severity, "error");

  // TS with unbalanced braces
  const tsDiags = await bundler.analyzeDocument("main.ts", "function foo() { if (true) { return 1; }");
  assert.strictEqual(tsDiags.length, 1);
  assert.strictEqual(tsDiags[0].severity, "warning");
});

test("LspBundler: provides completions and hover information", async () => {
  const bundler = new LspBundler();

  const tsCompletions = await bundler.getCompletions("main.ts", 1, 1, "con");
  assert.ok(tsCompletions.some((c) => c.label === "const"));

  const pyCompletions = await bundler.getCompletions("script.py", 1, 1, "de");
  assert.ok(pyCompletions.some((c) => c.label === "def"));

  const hover = await bundler.getHover("main.ts", "calculateTotal");
  assert.ok(hover);
  assert.strictEqual(hover.symbol, "calculateTotal");
  assert.ok(hover.contents.includes("Zero-Config LSP"));
});
