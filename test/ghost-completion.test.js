"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GhostCompletionEngine } = require("../runtime/ghost-completion");

test("GhostCompletionEngine: Cache stores and retrieves completions with TTL", () => {
  const engine = new GhostCompletionEngine({ maxCacheEntries: 5, defaultTtlMs: 500 });
  engine.cacheCompletion("const [count, setCount] = use", "State(0);");

  const hit = engine.getCached("const [count, setCount] = use");
  assert.equal(hit, "State(0);");

  // Missing key returns null
  assert.equal(engine.getCached("nonexistent"), null);

  // Eviction when exceeding max entries
  for (let i = 0; i < 10; i++) {
    engine.cacheCompletion(`prefix_${i}`, `completion_${i}`);
  }
  assert.equal(engine.cache.size <= 5, true);
});

test("GhostCompletionEngine: Heuristic predictions for common developer patterns", () => {
  const engine = new GhostCompletionEngine();

  // 1. Arrow functions
  const arrow = engine.predictHeuristicCompletion("const handleSave = () =>");
  assert.ok(arrow);
  assert.match(arrow, /return|{/);

  // 2. Try-catch
  const tryCatch = engine.predictHeuristicCompletion("try {");
  assert.ok(tryCatch);
  assert.match(tryCatch, /catch \(error\)/);

  // 3. React useState
  const hook = engine.predictHeuristicCompletion("const [data, setData] = use");
  assert.ok(hook);
  assert.match(hook, /State/);

  // 4. React useEffect
  const effect = engine.predictHeuristicCompletion("useEffect(() =>");
  assert.ok(effect);
  assert.match(effect, /\[\]/);

  // 5. Test runner it / test
  const testBlock = engine.predictHeuristicCompletion('it("renders properly');
  assert.ok(testBlock);
  assert.match(testBlock, /=>/);

  // 6. Console log
  const clg = engine.predictHeuristicCompletion("console.log(");
  assert.ok(clg);

  // 7. Import statement
  const imp = engine.predictHeuristicCompletion("import {");
  assert.ok(imp);
  assert.match(imp, /from/);
});

test("GhostCompletionEngine: provideInlineCompletion resolves with correct source and updates stats", async () => {
  const engine = new GhostCompletionEngine();

  const res = await engine.provideInlineCompletion("const [flag, setFlag] = use", { lineNumber: 1, column: 29 });
  assert.ok(res);
  assert.equal(res.source, "heuristic");
  assert.equal(res.insertText, "State(null);");

  // Second call should hit cache
  const cachedRes = await engine.provideInlineCompletion("const [flag, setFlag] = use", { lineNumber: 1, column: 29 });
  assert.ok(cachedRes);
  assert.equal(cachedRes.source, "cache");

  const stats = engine.getStats();
  assert.equal(stats.requests, 2);
  assert.equal(stats.heuristics >= 1, true);
  assert.equal(stats.hits >= 1, true);
});

test("GhostCompletionEngine: Fallback to LLM provider when heuristic returns null", async () => {
  const mockLlm = async (ctx, pos) => "customLlmCompletion();";
  const engine = new GhostCompletionEngine({ llmProvider: mockLlm });

  const res = await engine.provideInlineCompletion("myUnknownFunctionCall(", { lineNumber: 1, column: 23 }, { useLlm: true });
  assert.ok(res);
  assert.equal(res.source, "llm");
  assert.equal(res.insertText, "customLlmCompletion();");
});

test("GhostCompletion: Monaco Inline Completions Provider contracts", async () => {
  const { ghostCompletion } = require("../runtime/ghost-completion");
  
  // Mock model and range
  const mockModel = {
    getLineContent: (line) => "const [todos, setTodos] = use",
    getValueInRange: () => "const [todos, setTodos] = use",
    getLanguageId: () => "typescript",
  };
  const position = { lineNumber: 5, column: 31 };

  // 1. Simular llamada exitosa
  const suggestion = await ghostCompletion.provideInlineCompletion(
    mockModel.getValueInRange(),
    position,
    { language: mockModel.getLanguageId() }
  );

  assert.ok(suggestion);
  assert.equal(suggestion.insertText, "State(null);");

  // Estructura requerida por Monaco Editor
  const monacoItems = [
    {
      insertText: suggestion.insertText,
      range: {
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      },
    },
  ];

  assert.equal(monacoItems.length, 1);
  assert.equal(monacoItems[0].insertText, "State(null);");
  assert.equal(monacoItems[0].range.startLineNumber, 5);
  assert.equal(monacoItems[0].range.startColumn, 31);
});

