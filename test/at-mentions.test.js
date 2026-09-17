const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  extractMentions,
  queryMentionCandidates,
  resolveMentionsContext,
  MENTION_TYPES,
} = require("../runtime/at-mentions-resolver");

test("At-Mentions Resolver - extractMentions identifies structured and direct mentions", () => {
  const prompt = "Revisa el archivo @file:src/auth.js y la función @symbol:loginUser junto a @problems y @git. Además chequea @package.json";
  const mentions = extractMentions(prompt);

  assert.ok(mentions.length >= 4);
  assert.ok(mentions.some((m) => m.type === "file" && m.query === "src/auth.js"));
  assert.ok(mentions.some((m) => m.type === "symbol" && m.query === "loginUser"));
  assert.ok(mentions.some((m) => m.type === "problems"));
  assert.ok(mentions.some((m) => m.type === "git"));
  assert.ok(mentions.some((m) => m.type === "file" && m.query === "package.json"));
});

test("At-Mentions Resolver - queryMentionCandidates filters categories and files", () => {
  const candidates = queryMentionCandidates(__dirname, "prob");
  assert.ok(candidates.some((c) => c.type === "problems"));

  const fileCandidates = queryMentionCandidates(__dirname, "mentions");
  assert.ok(fileCandidates.length > 0);
  assert.ok(fileCandidates.some((c) => c.label.includes("mentions")));
});

test("At-Mentions Resolver - resolveMentionsContext formats file, problems and selection context", async () => {
  const testDir = path.resolve(__dirname, "../tmp_test_mentions");
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const testFile = path.join(testDir, "service.js");
  fs.writeFileSync(testFile, "export function fetchUsers() { return []; }", "utf8");

  const mentions = [
    { type: "file", query: "service.js" },
    { type: "problems", query: "" },
    { type: "selection", query: "" },
  ];

  const context = await resolveMentionsContext(mentions, testDir, {
    activeSelection: "const a = 1;",
    markers: [{ severity: "Error", resource: "service.js", startLineNumber: 1, message: "Missing semicolon" }],
  });

  assert.ok(context.includes("CONTEXTO EXPLÍCITO FIJADO POR EL USUARIO"));
  assert.ok(context.includes("fetchUsers"));
  assert.ok(context.includes("Missing semicolon"));
  assert.ok(context.includes("const a = 1;"));

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
});
