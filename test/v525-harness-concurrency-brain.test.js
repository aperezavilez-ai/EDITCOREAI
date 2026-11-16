"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const { hasMutationIntent } = require("../editcore-chat-kernel/orchestrator");
const { isPureKernelQuery } = require("../editcore-chat-kernel/index");
const { getEmbedding, cosineSimilarity, localEmbedding } = require("../runtime/embeddings");
const { VectorMemory } = require("../runtime/vector-memory");
const { ContextCompactor } = require("../editcore-chat-kernel/context-compactor");

test("[FASE 1] ContextCompactor tiene límites de seguridad reducidos para prevenir explosión de tokens", () => {
  const compactor = new ContextCompactor();
  assert.ok(compactor.maxTotalTokens <= 32_000, `maxTotalTokens debe ser <= 32000, actual: ${compactor.maxTotalTokens}`);
  assert.ok(compactor.maxToolResultChars <= 6_000, `maxToolResultChars debe ser <= 6000, actual: ${compactor.maxToolResultChars}`);
});

test("[FASE 2] hasMutationIntent no confunde consultas o preguntas con órdenes de mutación", () => {
  // Consultas que antes bloqueaban el motor o caían en la cola serial:
  const inquiries = [
    "ahora que pendientes quedan por corregir en editcoreai?",
    "explicame el fallo que aparece en el chat no escribas codigo solo explicame ya",
    "quiere decir que si aplico cambios con otra ia, no podre hacer el commit push y deploy con editcoreai,,, con solo darle la orden directa? respondeme no escribas codigo",
    "que mas queda pendiente de corregir ? puntos a evaluar",
    "¿qué archivos se modificaron?",
    "cuál es el estado del proyecto?",
    "dime si hay errores en el build",
  ];

  for (const q of inquiries) {
    assert.strictEqual(
      hasMutationIntent(q),
      false,
      `hasMutationIntent("${q}") debería ser false (consulta/inquiry, no mutación)`
    );
  }

  // Órdenes reales de mutación deben seguir dando true:
  const mutations = [
    "haz commit push y deploy",
    "corrige el error en app.py",
    "crea un nuevo archivo test.js",
    "elimina el archivo tmp.txt",
    "actualiza package.json e instala axios",
  ];

  for (const m of mutations) {
    assert.strictEqual(
      hasMutationIntent(m),
      true,
      `hasMutationIntent("${m}") debería ser true (orden de mutación directa)`
    );
  }
});

test("[FASE 2] isPureKernelQuery detecta consultas para desvío concurrente a subagente", () => {
  assert.strictEqual(isPureKernelQuery({ message: "ahora que pendientes quedan por corregir en editcoreai?" }), true);
  assert.strictEqual(isPureKernelQuery({ message: "explicame el fallo que aparece en el chat no escribas codigo solo explicame ya" }), true);
  assert.strictEqual(isPureKernelQuery({ message: "haz commit push y deploy" }), false);
});

test("[FASE 3] Embeddings neuronales y similitud coseno generan vectores densos", async () => {
  const v1 = await getEmbedding("inicio de sesión y autenticación de usuarios");
  const v2 = await getEmbedding("login y credenciales con google");
  const v3 = await getEmbedding("receta para cocinar pasta italiana con queso");

  assert.ok(Array.isArray(v1) && v1.length === 384, "v1 debe tener dimensión 384");
  assert.ok(Array.isArray(v2) && v2.length === 384, "v2 debe tener dimensión 384");
  assert.ok(Array.isArray(v3) && v3.length === 384, "v3 debe tener dimensión 384");

  const simAuth = cosineSimilarity(v1, v2);
  const simPasta = cosineSimilarity(v1, v3);

  assert.ok(simAuth > simPasta, `Vectores semánticos afines (auth/login: ${simAuth.toFixed(3)}) deben tener mayor similitud que conceptos disjuntos (pasta: ${simPasta.toFixed(3)})`);
});

test("[FASE 3] VectorMemory indexa y recupera memorias semánticamente en espacio vectorial", async () => {
  const tmpDir = path.join(__dirname, "tmp-vector-mem-" + Date.now());
  try {
    const vm = new VectorMemory(tmpDir);
    await vm.add("Configuración de base de datos y credenciales de autenticación en Supabase Cloud", { id: "mem-1", title: "Supabase Auth" }, "test-ns");
    await vm.add("Pipeline de despliegue en Vercel con alias personalizado y smoke test", { id: "mem-2", title: "Vercel Deploy" }, "test-ns");

    const resultsAuth = await vm.search("conexión a la base de datos supabase", { ns: "test-ns", topK: 1 });
    assert.ok(resultsAuth.length > 0, "Debe encontrar memoria semántica");
    assert.strictEqual(resultsAuth[0].id, "mem-1", "Debe priorizar la memoria de Supabase/Auth por afinidad vectorial");

    const resultsDeploy = await vm.search("publicar y hacer release a producción", { ns: "test-ns", topK: 1 });
    assert.ok(resultsDeploy.length > 0, "Debe encontrar memoria semántica");
    assert.strictEqual(resultsDeploy[0].id, "mem-2", "Debe priorizar la memoria de Vercel/Deploy por afinidad vectorial");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});
