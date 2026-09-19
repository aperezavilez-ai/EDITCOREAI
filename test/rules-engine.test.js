/**
 * test/rules-engine.test.js
 * Unit tests for RulesEngine (Ciclo 30)
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { RulesEngine } = require("../runtime/rules-engine.js");

describe("Cycle 30: Project Rules Engine (.mdc)", () => {
  let tmpDir;
  let engine;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rules-test-"));
    engine = new RulesEngine();
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignorar
    }
  });

  test("parses MDC frontmatter and markdown body correctly", () => {
    const rawMdc = `---
description: "Reglas para componentes React"
globs: ["src/components/**/*.tsx", "*.jsx"]
alwaysApply: false
---

# Directiva React
- Usa siempre functional components con hooks.
- No uses any en TypeScript.
`;

    const parsed = engine.parseRuleContent(rawMdc, "/path/react-rules.mdc");

    assert.strictEqual(parsed.name, "react-rules");
    assert.strictEqual(parsed.description, "Reglas para componentes React");
    assert.deepStrictEqual(parsed.globs, ["src/components/**/*.tsx", "*.jsx"]);
    assert.strictEqual(parsed.alwaysApply, false);
    assert.ok(parsed.content.includes("Usa siempre functional components"));
  });

  test("saves, loads and filters rules by active file glob match", () => {
    // Save rule 1: TypeScript rule
    engine.saveRule(tmpDir, "ts-conventions", {
      description: "TypeScript Best Practices",
      globs: ["*.ts", "**/*.ts"],
      alwaysApply: false,
      content: "Usa tipos estrictos y define interfaces explícitas.",
    });

    // Save rule 2: Global rule
    engine.saveRule(tmpDir, "security-rules", {
      description: "Global Security Policy",
      globs: [],
      alwaysApply: true,
      content: "Nunca expongas claves o secretos en el código.",
    });

    // Save rule 3: Python rule
    engine.saveRule(tmpDir, "python-style", {
      description: "PEP8 Standards",
      globs: ["*.py"],
      alwaysApply: false,
      content: "Usa snake_case para funciones y variables.",
    });

    // Test rules for TypeScript file
    const tsRules = engine.getRulesForFile(tmpDir, "src/index.ts");
    assert.strictEqual(tsRules.length, 2, "Should match ts-conventions and security-rules");
    const tsNames = tsRules.map((r) => r.name);
    assert.ok(tsNames.includes("ts-conventions"));
    assert.ok(tsNames.includes("security-rules"));

    // Test rules for Python file
    const pyRules = engine.getRulesForFile(tmpDir, "scripts/worker.py");
    assert.strictEqual(pyRules.length, 2, "Should match python-style and security-rules");

    // Test rules for Markdown file (only global rule applies)
    const mdRules = engine.getRulesForFile(tmpDir, "README.md");
    assert.strictEqual(mdRules.length, 1);
    assert.strictEqual(mdRules[0].name, "security-rules");
  });

  test("formats active rules cleanly for LLM system prompt injection", () => {
    const rules = [
      {
        name: "security-rules",
        description: "Global Security Policy",
        content: "No hardcodees tokens de API.",
      },
      {
        name: "clean-code",
        description: "Regla de nombres claros",
        content: "Nombres de funciones deben ser verbos descriptivos.",
      },
    ];

    const promptText = engine.formatRulesForPrompt(rules);

    assert.ok(promptText.includes("[PROJECT_RULES_START]"));
    assert.ok(promptText.includes("Directivas y Reglas Obligatorias"));
    assert.ok(promptText.includes("security-rules"));
    assert.ok(promptText.includes("No hardcodees tokens de API"));
    assert.ok(promptText.includes("[PROJECT_RULES_END]"));
  });
});
