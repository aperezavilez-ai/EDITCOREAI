const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
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

test("InlineEditProvider: buildModifiedFull reemplaza correctamente las líneas seleccionadas", () => {
  const provider = new InlineEditProvider();
  const original = "line 1\nline 2\nline 3\nline 4";
  const selection = { startLine: 2, endLine: 3, selectedText: "line 2\nline 3" };
  const proposal = "replaced 2 and 3";

  const full = provider.buildModifiedFull(original, selection, proposal);
  assert.strictEqual(full, "line 1\nreplaced 2 and 3\nline 4");
});

test("InlineEditProvider: validateProposalSyntax detecta errores sintácticos", () => {
  const provider = new InlineEditProvider();
  const valid = provider.validateProposalSyntax("src/test.ts", "const a: number = 10;");
  assert.strictEqual(valid.valid, true);

  const broken = provider.validateProposalSyntax("src/test.ts", "function broken( {");
  assert.strictEqual(broken.valid, false);
  assert.ok(broken.error);
});

test("InlineEditProvider: enrichInlineEditPrompt enriquece con AST y at-mentions", async () => {
  const provider = new InlineEditProvider();
  const promptEnriched = await provider.enrichInlineEditPrompt({
    filePath: "runtime/code-graph.js",
    projectRoot: path.resolve(__dirname, ".."),
    instruction: "revisa con @file:package.json",
  });

  assert.ok(promptEnriched.includes("GRAFO DE CÓDIGO AST") || promptEnriched.includes("CONTEXTO EXPLÍCITO"));
});
