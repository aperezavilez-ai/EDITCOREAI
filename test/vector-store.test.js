const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { VectorStore, vectorStore } = require("../runtime/vector-store");

test("VectorStore: genera embeddings normalizados (generateEmbedding)", () => {
  const store = new VectorStore();
  const vec = store.generateEmbedding("hello world hello editcore");

  assert.ok(vec.hello);
  assert.ok(vec.world);
  assert.ok(vec.editcore);
  assert.ok(vec.hello > vec.world); // mayor frecuencia
});

test("VectorStore: calcula cosineSimilarity entre vectores dispersos", () => {
  const store = new VectorStore();
  const vec1 = store.generateEmbedding("javascript function async await");
  const vec2 = store.generateEmbedding("javascript async function promise");
  const vec3 = store.generateEmbedding("python pandas dataframe numpy");

  const simHigh = store.cosineSimilarity(vec1, vec2);
  const simLow = store.cosineSimilarity(vec1, vec3);

  assert.ok(simHigh > 0.4);
  assert.strictEqual(simLow, 0);
});

test("VectorStore: fragmenta documentos en chunks semánticos (chunkDocument)", () => {
  const store = new VectorStore({ chunkSize: 50, overlap: 10 });
  const content = "Línea 1: función de inicialización.\nLínea 2: configuración de base de datos.\nLínea 3: conexión al socket.\nLínea 4: ejecución de tareas.";

  const chunks = store.chunkDocument("test.js", content);
  assert.ok(chunks.length >= 2);
  assert.strictEqual(chunks[0].filePath, "test.js");
  assert.ok(chunks[0].embedding);
});

test("VectorStore: indexa y busca similitud en un proyecto real (indexProject & searchSimilar)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-vector-"));
  const f1 = path.join(tempDir, "auth.js");
  const f2 = path.join(tempDir, "payment.js");

  fs.writeFileSync(f1, "function loginUser(username, password) {\n  return authenticate(username);\n}\n", "utf-8");
  fs.writeFileSync(f2, "function processPayment(amount, card) {\n  return chargeCreditCard(amount);\n}\n", "utf-8");

  const store = new VectorStore();
  const indexRes = store.indexProject(tempDir, ["auth.js", "payment.js"]);

  assert.strictEqual(indexRes.fileCount, 2);
  assert.ok(indexRes.totalChunks >= 2);

  const results = store.searchSimilar(tempDir, "login username authenticate", { topK: 3 });
  assert.ok(results.length > 0);
  assert.strictEqual(results[0].filePath, "auth.js");

  const stats = store.getStats(tempDir);
  assert.strictEqual(stats.indexed, true);
  assert.strictEqual(stats.fileCount, 2);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
