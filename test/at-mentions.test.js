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
  const prompt = "Revisa el archivo @file:src/auth.js y la función @symbol:loginUser junto a @folder:src/api/ y @git. Además chequea @package.json y @src/components/";
  const mentions = extractMentions(prompt);

  assert.ok(mentions.length >= 5);
  assert.ok(mentions.some((m) => m.type === "file" && m.query === "src/auth.js"));
  assert.ok(mentions.some((m) => m.type === "symbol" && m.query === "loginUser"));
  assert.ok(mentions.some((m) => m.type === "folder" && m.query.includes("src/api")));
  assert.ok(mentions.some((m) => m.type === "folder" && m.query.includes("src/components")));
  assert.ok(mentions.some((m) => m.type === "git"));
  assert.ok(mentions.some((m) => m.type === "file" && m.query === "package.json"));
});

test("At-Mentions Resolver - queryMentionCandidates filters categories, files, folders and symbols", () => {
  const candidates = queryMentionCandidates(__dirname, "prob");
  assert.ok(candidates.some((c) => c.type === "problems"));

  const fileCandidates = queryMentionCandidates(__dirname, "mentions");
  assert.ok(fileCandidates.length > 0);
  assert.ok(fileCandidates.some((c) => c.label.includes("mentions")));

  const symbolCategory = queryMentionCandidates(__dirname, "sym");
  assert.ok(symbolCategory.some((c) => c.type === "symbol"));

  const folderCategory = queryMentionCandidates(__dirname, "folder");
  assert.ok(folderCategory.some((c) => c.type === "folder"));
});

test("At-Mentions Resolver - resolveMentionsContext formats file, problems, folder and AST symbol context", async () => {
  const testDir = path.resolve(__dirname, "../tmp_test_mentions");
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const subDir = path.join(testDir, "sub");
  if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

  const testFile = path.join(testDir, "service.js");
  fs.writeFileSync(testFile, "export function fetchUsers() { return ['alice']; }", "utf8");

  const callerFile = path.join(testDir, "caller.js");
  fs.writeFileSync(callerFile, "import { fetchUsers } from './service';\nconst u = fetchUsers();", "utf8");

  const subFile = path.join(subDir, "helper.js");
  fs.writeFileSync(subFile, "export const helperValue = 42;", "utf8");

  const mentions = [
    { type: "file", query: "service.js" },
    { type: "folder", query: "sub" },
    { type: "symbol", query: "fetchUsers" },
    { type: "problems", query: "" },
    { type: "selection", query: "" },
  ];

  const context = await resolveMentionsContext(mentions, testDir, {
    activeSelection: "const a = 1;",
    markers: [{ severity: "Error", resource: "service.js", startLineNumber: 1, message: "Missing semicolon" }],
  });

  assert.ok(context.includes("CONTEXTO EXPLÍCITO FIJADO POR EL USUARIO"));
  assert.ok(context.includes("fetchUsers"));
  assert.ok(context.includes("Grafo de Código AST"));
  assert.ok(context.includes("caller.js")); // Cross-reference / importedBy
  assert.ok(context.includes("@folder: sub"));
  assert.ok(context.includes("helper.js"));
  assert.ok(context.includes("Missing semicolon"));
  assert.ok(context.includes("const a = 1;"));

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
});
