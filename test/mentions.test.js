const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { MentionParser, mentionParser, BUILTIN_MENTIONS } = require("../runtime/mention-parser");

test("MentionParser: extrae menciones simples y simbólicas", () => {
  const parser = new MentionParser();
  const text = "Revisa @src/index.js y también consulta @files y @docs para el refactor.";

  const mentions = parser.extractMentions(text);
  assert.strictEqual(mentions.length, 3);
  assert.strictEqual(mentions[0].raw, "@src/index.js");
  assert.strictEqual(mentions[0].type, "file");
  assert.strictEqual(mentions[1].raw, "@files");
  assert.strictEqual(mentions[1].type, "symbolic");
  assert.strictEqual(mentions[2].raw, "@docs");
  assert.strictEqual(mentions[2].type, "symbolic");
});

test("MentionParser: sugiere autocompletados según el query y archivos", () => {
  const parser = new MentionParser();
  const files = ["src/app.js", "src/utils.js", "docs/api.md"];

  const suggestions = parser.suggestCompletions("app", files);
  assert.ok(suggestions.some((s) => s.label === "@src/app.js"));

  const builtins = parser.suggestCompletions("doc", files);
  assert.ok(builtins.some((s) => s.label === "@docs"));
});

test("MentionParser: resuelve contenido de archivos y carpetas locales", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mentions-"));
  const sampleFile = path.join(tempDir, "sample.txt");
  fs.writeFileSync(sampleFile, "CONTENIDO_DE_PRUEBA_123", "utf-8");

  const parser = new MentionParser();
  const prompt = "Analiza @sample.txt y @docs";
  const resolved = parser.resolveMentions(prompt, tempDir);

  assert.strictEqual(resolved.length, 2);
  const fileRes = resolved.find((r) => r.type === "file");
  assert.ok(fileRes);
  assert.ok(fileRes.content.includes("CONTENIDO_DE_PRUEBA_123"));

  const fullPrompt = parser.buildPromptWithMentions(prompt, tempDir);
  assert.ok(fullPrompt.includes("## 📎 Contexto Adjunto vía @ Mentions:"));
  assert.ok(fullPrompt.includes("CONTENIDO_DE_PRUEBA_123"));

  fs.rmSync(tempDir, { recursive: true, force: true });
});
