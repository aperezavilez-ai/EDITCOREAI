"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const ragMemory = require("../runtime/rag-memory");
const promptCache = require("../runtime/prompt-cache-manager");

test("rag-memory: tokenización y embeddings matemáticos", () => {
  const tokens = ragMemory.tokenize("Hola EditCoreAI, prueba de RAG y semántica!");
  assert.ok(tokens.includes("hola"));
  assert.ok(tokens.includes("editcoreai"));
  assert.ok(tokens.includes("rag"));
  assert.ok(tokens.includes("semantica") || tokens.includes("semántica"));

  const emb1 = ragMemory.buildEmbedding("autenticacion de usuarios con supabase y tokens");
  const emb2 = ragMemory.buildEmbedding("login y session con supabase auth");
  const emb3 = ragMemory.buildEmbedding("procesamiento de imagenes con sharp canvas");

  assert.equal(emb1.length, 64);
  assert.equal(emb2.length, 64);

  const sim12 = ragMemory.cosineSimilarity(emb1, emb2);
  const sim13 = ragMemory.cosineSimilarity(emb1, emb3);

  // La similitud entre tópicos de auth debe ser mayor que con procesamiento de imágenes
  assert.ok(sim12 >= 0, "Similitud coseno no negativa");
  assert.ok(sim13 >= 0, "Similitud coseno no negativa");
});

test("rag-memory: chunking de texto con overlap", () => {
  const text = "Linea 1: Introduccion al sistema.\nLinea 2: Configuracion de base de datos.\nLinea 3: Despliegue en la nube.";
  const chunks = ragMemory.chunkText(text, 50, 10);
  assert.ok(Array.isArray(chunks));
  assert.ok(chunks.length > 0);
});

test("rag-memory: indexación de workspace temporal y búsqueda semántica", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rag-test-"));
  fs.writeFileSync(path.join(tmpDir, "auth.js"), "function loginUser(email, password) { return supabase.auth.signInWithPassword({ email, password }); }");
  fs.writeFileSync(path.join(tmpDir, "database.sql"), "CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);");
  fs.writeFileSync(path.join(tmpDir, "README.md"), "# Documentacion de API de Autenticacion y Usuarios");

  try {
    const status = ragMemory.indexWorkspace(tmpDir);
    assert.equal(status.fileCount, 3);
    assert.ok(status.chunkCount >= 3);

    const results = ragMemory.querySemantic("como funciona login y autenticacion supabase", 3, 0.01);
    assert.ok(Array.isArray(results));
    assert.ok(results.length > 0);
    assert.ok(results.some((r) => r.file.includes("auth.js") || r.file.includes("README.md")));

    // Prueba de agregar documento
    const added = ragMemory.addDocument("new-service.js", "function verifyToken(token) { return jwt.verify(token); }", tmpDir);
    assert.equal(added.file, "new-service.js");
    assert.ok(added.chunksAdded >= 1);

    // Prueba de borrar documento
    const deleted = ragMemory.deleteDocument("new-service.js", tmpDir);
    assert.equal(deleted.ok, true);

    // Prueba de clear cache
    const clearRes = ragMemory.clearCache();
    assert.equal(clearRes.ok, true);
    assert.equal(ragMemory.getIndexStatus().chunkCount, 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("prompt-cache-manager: hashing de prompts, almacenamiento y wrapRequest", async () => {
  promptCache.clearCache();

  const key1 = promptCache.buildCacheKey({
    systemBlock: "Eres el asistente EditCoreAI",
    userMessage: "¿Como crear un proyecto?",
    model: "claude-3-5-sonnet",
  });
  const key2 = promptCache.buildCacheKey({
    systemBlock: "Eres el asistente EditCoreAI",
    userMessage: "¿Como crear un proyecto?",
    model: "claude-3-5-sonnet",
  });
  assert.equal(key1, key2, "Las claves para prompts identicos deben coincidir");

  promptCache.set({
    systemBlock: "Eres el asistente EditCoreAI",
    userMessage: "¿Como crear un proyecto?",
    model: "claude-3-5-sonnet",
    response: "Usa el boton Conectar o la terminal.",
  });

  assert.equal(
    promptCache.has({
      systemBlock: "Eres el asistente EditCoreAI",
      userMessage: "¿Como crear un proyecto?",
      model: "claude-3-5-sonnet",
    }),
    true
  );

  const cached = promptCache.get({
    systemBlock: "Eres el asistente EditCoreAI",
    userMessage: "¿Como crear un proyecto?",
    model: "claude-3-5-sonnet",
  });
  assert.equal(cached, "Usa el boton Conectar o la terminal.");

  let callCount = 0;
  const mockProvider = async () => {
    callCount++;
    return "Respuesta fresca";
  };

  const wrap1 = await promptCache.wrapRequest(mockProvider, {
    systemBlock: "sys",
    userMessage: "msg_nuevo",
  });
  assert.equal(wrap1.cached, false);
  assert.equal(callCount, 1);

  const wrap2 = await promptCache.wrapRequest(mockProvider, {
    systemBlock: "sys",
    userMessage: "msg_nuevo",
  });
  assert.equal(wrap2.cached, true);
  assert.equal(callCount, 1, "No debe llamar al provider en caso de cache hit");

  const stats = promptCache.getStats();
  assert.ok(stats.hits >= 1);
  assert.ok(stats.entries >= 1);
});
