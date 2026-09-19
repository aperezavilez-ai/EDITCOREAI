const test = require("node:test");
const assert = require("node:assert");
const { InlineEditProvider, inlineEditProvider } = require("../runtime/inline-edit-provider");

test("InlineEditProvider: crea solicitudes de edición y las almacena en memoria", () => {
  const provider = new InlineEditProvider();
  const req = provider.createInlineEditRequest({
    filePath: "src/index.js",
    selection: { startLine: 1, endLine: 5 },
    originalText: "function test() {\n  return 1;\n}",
    prompt: "Añadir log",
  });

  assert.ok(req.requestId.startsWith("inline_"));
  assert.strictEqual(req.filePath, "src/index.js");
  assert.strictEqual(req.status, "pending");
  assert.strictEqual(provider.activeRequests.get(req.requestId).prompt, "Añadir log");
});

test("InlineEditProvider: calcula diferencias línea por línea correctamente (computeInlineDiff)", () => {
  const provider = new InlineEditProvider();
  const orig = "function hello() {\n  return 'hi';\n}";
  const mod = "function hello() {\n  console.log('hi');\n  return 'hi';\n}";

  const diff = provider.computeInlineDiff(orig, mod);

  assert.strictEqual(diff.hasChanges, true);
  assert.ok(diff.addedCount >= 1);
  assert.ok(diff.lines.length >= 3);
  assert.ok(diff.lines.some((l) => l.type === "add" && l.text.includes("console.log")));
});

test("InlineEditProvider: detecta líneas eliminadas y reemplazadas", () => {
  const provider = new InlineEditProvider();
  const orig = "const a = 1;\nconst b = 2;\nconst c = 3;";
  const mod = "const a = 1;\nconst b = 99;";

  const diff = provider.computeInlineDiff(orig, mod);
  assert.strictEqual(diff.hasChanges, true);
  assert.ok(diff.removedCount > 0);
});

test("InlineEditProvider: aplica parches con diff estructurado o string directo (applyPatch)", () => {
  const provider = new InlineEditProvider();
  const orig = "let x = 10;";
  const modStr = "let x = 20;";

  const resultStr = provider.applyPatch(orig, modStr);
  assert.strictEqual(resultStr, "let x = 20;");

  const diffObj = provider.computeInlineDiff(orig, "let x = 30;");
  const resultDiff = provider.applyPatch(orig, diffObj);
  assert.strictEqual(resultDiff, "let x = 30;");
});

test("InlineEditProvider: genera propuestas mock heurísticas para fallback", () => {
  const provider = new InlineEditProvider();
  const orig = "function compute() {\n  return 42;\n}";
  
  const tryProposal = provider.generateMockProposal("Añadir try catch", orig);
  assert.ok(tryProposal.includes("try {"));
  assert.ok(tryProposal.includes("catch (error)"));

  const docProposal = provider.generateMockProposal("Generar jsdoc", orig);
  assert.ok(docProposal.includes("/**"));
});
