const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const {
  chunkCodeFile,
  tokenize,
  buildCodebaseIndex,
  querySemanticCodebase,
  updateFileInIndex,
} = require("../runtime/codebase-indexer");

test("Codebase Indexer - chunkCodeFile and tokenize extract semantic tokens", () => {
  const code = [
    "export function authenticateUser(email, passwordHash) {",
    "  const token = jwt.sign({ email }, SECRET);",
    "  return token;",
    "}",
    "",
    "export function logoutUser(sessionToken) {",
    "  sessionStore.delete(sessionToken);",
    "}",
  ].join("\n");

  const chunks = chunkCodeFile("auth.js", code, 10);
  assert.ok(chunks.length >= 1);
  assert.ok(chunks[0].tokens.includes("authenticate"));
  assert.ok(chunks[0].tokens.includes("jwt"));
});

test("Codebase Indexer - buildCodebaseIndex and querySemanticCodebase find relevant chunks", () => {
  const testDir = path.resolve(__dirname, "../tmp_test_rag");
  if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

  const authFile = path.join(testDir, "auth-service.js");
  const billingFile = path.join(testDir, "billing-service.js");

  fs.writeFileSync(authFile, "export function verifySessionToken(token) { return jwt.verify(token); }", "utf8");
  fs.writeFileSync(billingFile, "export function processStripeInvoice(customer, amount) { return stripe.charges.create(); }", "utf8");

  const index = buildCodebaseIndex(testDir);
  assert.ok(index.totalFiles >= 2);
  assert.ok(fs.existsSync(path.join(testDir, ".editcore", "codebase-index.json")));

  const resultsAuth = querySemanticCodebase(testDir, "verify jwt session token", 3);
  assert.ok(resultsAuth.length > 0);
  assert.ok(resultsAuth[0].file.includes("auth-service.js"));

  const resultsBilling = querySemanticCodebase(testDir, "stripe invoice charge", 3);
  assert.ok(resultsBilling.length > 0);
  assert.ok(resultsBilling[0].file.includes("billing-service.js"));

  // Update file incrementally
  updateFileInIndex(testDir, "auth-service.js", "export function verifyOAuthToken(oauthKey) { return oauth.check(); }");
  const resultsOAuth = querySemanticCodebase(testDir, "oauth check token", 3);
  assert.ok(resultsOAuth.length > 0);

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
});
