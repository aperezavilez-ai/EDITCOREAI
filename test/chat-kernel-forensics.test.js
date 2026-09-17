const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { dispatchSpecialist, SPECIALISTS } = require("../editcore-chat-kernel/subagents/dispatcher");
const tools = require("../editcore-chat-kernel/tools");
const { normalizeUsage } = require("../editcore-chat-kernel/provider");
const { buildSafeConnectionsSnapshot, formatOperatorConnectionsMemory } = require("../runtime/operator-connections-context");
const { RunReadCache } = require("../runtime/agent-token-harness");

test("Subagents Dispatcher - identifies specialists accurately", () => {
  const uiSpec = dispatchSpecialist("Necesito rediseñar la interfaz UI con componentes Tailwind y diseño responsive");
  assert.ok(uiSpec);
  assert.equal(uiSpec.name, SPECIALISTS.UI_UX.name);

  const dbSpec = dispatchSpecialist("Ejecuta una migración SQL en postgres / supabase para añadir la tabla de perfiles");
  assert.ok(dbSpec);
  assert.equal(dbSpec.name, SPECIALISTS.DATABASE.name);

  const secSpec = dispatchSpecialist("Auditar vulnerabilidades jwt y autenticación oauth");
  assert.ok(secSpec);
  assert.equal(secSpec.name, SPECIALISTS.SECURITY.name);

  const devopsSpec = dispatchSpecialist("Configurar pipeline CI/CD en GitHub Actions y deploy en Vercel");
  assert.ok(devopsSpec);
  assert.equal(devopsSpec.name, SPECIALISTS.DEVOPS.name);

  const noneSpec = dispatchSpecialist("Hola, cuéntame un resumen general");
  assert.equal(noneSpec, null);
});

test("Tools - Read and Write functions execute and handle safe paths", async () => {
  const testDir = path.resolve(__dirname, "../tmp_test_kernel");
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  // 1. Write file
  const writeRes = await tools.writeFile(testDir, "test-file.txt", "Initial content 123");
  assert.equal(writeRes.ok, true);

  // 2. Read file
  const readRes = await tools.readFile(testDir, "test-file.txt");
  assert.equal(readRes.ok, true);
  assert.ok(readRes.content.includes("Initial content 123"));

  // 3. Replace in file
  const replaceRes = await tools.replaceInFile(testDir, "test-file.txt", "Initial content 123", "Updated content 456");
  assert.equal(replaceRes.ok, true);

  // 4. Read after replacement
  const readRes2 = await tools.readFile(testDir, "test-file.txt");
  assert.equal(readRes2.ok, true);
  assert.ok(readRes2.content.includes("Updated content 456"));

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
});

test("RunReadCache - manages hit, miss and cache stats correctly", () => {
  const cache = new RunReadCache();
  assert.equal(cache.get("file1.txt"), null);
  assert.equal(cache.stats().misses, 1);

  cache.set("file1.txt", { content: "hello world" });
  const hit = cache.get("file1.txt");
  assert.ok(hit);
  assert.equal(hit.content, "hello world");
  assert.equal(cache.stats().hits, 1);
  assert.equal(cache.stats().size, 1);
});

test("Provider - normalizeUsage extracts cache read & write tokens", () => {
  const anthropicRaw = {
    input_tokens: 1200,
    output_tokens: 350,
    cache_read_input_tokens: 800,
    cache_creation_input_tokens: 400,
  };
  const normalizedAnthropic = normalizeUsage(anthropicRaw);
  assert.equal(normalizedAnthropic.input_tokens, 1200);
  assert.equal(normalizedAnthropic.output_tokens, 350);
  assert.equal(normalizedAnthropic.cache_read_input_tokens, 800);
  assert.equal(normalizedAnthropic.cache_creation_input_tokens, 400);

  const openAiRaw = {
    prompt_tokens: 1500,
    completion_tokens: 400,
    prompt_tokens_details: {
      cached_tokens: 1100,
    },
  };
  const normalizedOpenAi = normalizeUsage(openAiRaw);
  assert.equal(normalizedOpenAi.input_tokens, 1500);
  assert.equal(normalizedOpenAi.output_tokens, 400);
  assert.equal(normalizedOpenAi.cache_read_input_tokens, 1100);
  assert.equal(normalizedOpenAi.cache_creation_input_tokens, 0);
});

test("Operator Connections Context - builds safe connection memory snapshots", () => {
  const snapshot = buildSafeConnectionsSnapshot(process.cwd());
  assert.ok(snapshot);
  assert.ok(typeof snapshot === "object");
  assert.ok(snapshot.github);
  assert.ok(snapshot.vercel);

  const formatted = formatOperatorConnectionsMemory(snapshot);
  assert.ok(typeof formatted === "string");
  assert.ok(formatted.includes("MEMORIA DE CONEXIONES"));
});
