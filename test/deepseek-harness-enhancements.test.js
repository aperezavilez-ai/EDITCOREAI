"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { validateSyntax, compactCommandOutput } = require("../runtime/syntax-validator");
const { writeFile, replaceInFile } = require("../editcore-chat-kernel/tools");

test("syntax-validator: detecta JS syntax errors con linea y mensaje", () => {
  const badJs = "function test() { const a = ; return a; }";
  const res = validateSyntax("app.js", badJs);
  assert.equal(res.ok, false);
  assert.equal(res.valid, false);
  assert.match(res.message, /Unexpected/i);
  assert.ok(res.hint.includes("replace_in_file"));

  const goodJs = "function test() { const a = 123; return a; }";
  const okRes = validateSyntax("app.js", goodJs);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.valid, true);
});

test("syntax-validator: valida JSON parse", () => {
  const badJson = '{\n  "name": "editcore",\n}';
  const res = validateSyntax("config.json", badJson);
  assert.equal(res.ok, false);
  assert.equal(res.valid, false);

  const goodJson = '{\n  "name": "editcore"\n}';
  const okRes = validateSyntax("config.json", goodJson);
  assert.equal(okRes.ok, true);
  assert.equal(okRes.valid, true);
});

test("syntax-validator: compacta salida larga preservando errores", () => {
  let longOutput = "Iniciando compilacion...\n";
  for (let i = 0; i < 100; i++) {
    longOutput += `[build info] procesando chunk ${i}...\n`;
  }
  longOutput += "Error: Cannot find module '@types/node'\n";
  for (let i = 0; i < 50; i++) {
    longOutput += `[build info] post-chunk ${i}...\n`;
  }
  longOutput += "Build fallido con codigo 1.\n";

  const compacted = compactCommandOutput(longOutput, 2000);
  assert.ok(compacted.length < longOutput.length);
  assert.ok(compacted.includes("Cannot find module '@types/node'"));
  assert.ok(compacted.includes("Harness:"));
  assert.ok(compacted.includes("Build fallido con codigo 1."));
});

test("kernel tools: writeFile y replaceInFile reportan advertencias de sintaxis para auto-heal", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-harness-test-"));
  try {
    // Escribir archivo con error de sintaxis JS
    const writeRes = writeFile(tmpDir, "bad.js", "const x = ;");
    assert.equal(writeRes.ok, true);
    assert.ok(writeRes.syntaxWarning);
    assert.ok(writeRes.selfHealHint);

    // Reemplazar corrigiendo el error
    const fixRes = replaceInFile(tmpDir, "bad.js", "const x = ;", "const x = 42;");
    assert.equal(fixRes.ok, true);
    assert.equal(fixRes.syntaxWarning, undefined);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
