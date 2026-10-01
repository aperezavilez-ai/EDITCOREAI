"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { RulesEngine } = require("../runtime/rules-engine");

test("RulesEngine reads .editcorerules, .cursorrules and formats system prompt directives", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rules-test-"));
  
  const rulesEngine = new RulesEngine({ projectRoot: tmpDir });
  
  // Guardar reglas por defecto
  const saveRes = rulesEngine.saveDefaultRules();
  assert.equal(saveRes.ok, true);
  assert.equal(fs.existsSync(path.join(tmpDir, ".editcorerules")), true);

  // Cargar directivas
  const prompt = rulesEngine.getSystemPromptDirectives();
  assert.ok(prompt.includes("REGLAS Y ESTÁNDARES DEL PROYECTO"));
  assert.ok(prompt.includes("Mantener código limpio, modular y completamente tipado"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
