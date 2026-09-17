const test = require("node:test");
const assert = require("node:assert/strict");

const {
  InlineCompletionCache,
  buildFimPrompt,
  cleanPredictedCompletion,
  registerCursorTabProvider,
} = require("../runtime/monaco-inline-tab");

test("Ghost Text Tab - InlineCompletionCache sets and gets cached predictions", () => {
  const cache = new InlineCompletionCache(10, 1000);
  assert.equal(cache.get("app.ts", "const x = ", ";"), null);

  cache.set("app.ts", "const x = ", ";", "42");
  assert.equal(cache.get("app.ts", "const x = ", ";"), "42");
});

test("Ghost Text Tab - buildFimPrompt constructs accurate FIM messages", () => {
  const messages = buildFimPrompt({
    filePath: "src/utils.js",
    language: "javascript",
    prefix: "function calculateTotal(items) {\n  return items.",
    suffix: "\n}",
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.includes("Cursor Tab"));
  assert.ok(messages[1].content.includes("<<PREFIJO>>"));
  assert.ok(messages[1].content.includes("<<SUFIJO>>"));
});

test("Ghost Text Tab - cleanPredictedCompletion removes markdown wrappers and echoed lines", () => {
  const rawWithMarkdown = "```typescript\nreduce((a, b) => a + b, 0);\n```";
  const cleaned = cleanPredictedCompletion(rawWithMarkdown, "  return items.");
  assert.equal(cleaned.includes("```"), false);
  assert.ok(cleaned.includes("reduce((a, b) => a + b, 0);"));

  const rawEcho = "  return items.map(i => i.price);";
  const cleanedEcho = cleanPredictedCompletion(rawEcho, "  return items.");
  assert.equal(cleanedEcho, "map(i => i.price);");
});

test("Ghost Text Tab - registerCursorTabProvider binds cleanly to Monaco API", () => {
  let registeredLanguage = null;
  let registeredProvider = null;

  const mockMonaco = {
    languages: {
      registerInlineCompletionsProvider: (lang, provider) => {
        registeredLanguage = lang;
        registeredProvider = provider;
        return { dispose: () => {} };
      },
    },
  };

  const registration = registerCursorTabProvider(mockMonaco, {
    fetchCompletion: async () => "nextCode();",
  });

  assert.ok(registration);
  assert.equal(registeredLanguage, "*");
  assert.ok(typeof registeredProvider.provideInlineCompletions === "function");
});
