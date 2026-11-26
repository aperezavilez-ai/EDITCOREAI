"use strict";
// ============================================================
// GROQ EN AUTO (orden de Luis, 2026-11-26)
// Tras agregar Groq como motor aparte, Luis pidio que sus
// modelos TAMBIEN trabajen en Auto, segun la tarea, como lo
// hace ME AI. Hoy el motor Auto (auto-model-selection.js)
// conoce un solo upstream ("meai"): los modelos de Groq no
// tienen bucket, ni carril, ni tier — nunca son elegidos por
// la ruta normal, y el scope "groq" ni siquiera existe.
// Contrato que esta bateria exige:
//  1. "groq" es el segundo upstream del Auto: bucket propio
//     por proveedor, scope valido ("Auto · EditCore Nube"),
//     uso contabilizado por bucket y modelos seguros.
//  2. En Auto (scope "all") con ME AI cargado de uso, el
//     bucket de Groq gana y la tarea de implementar cae en su
//     carril: llama-3.3-70b-versatile.
//  3. Con scope "groq", Auto solo elige Groq y segun la
//     tarea: una consulta de chat cae en llama-3.1-8b-instant.
//  4. Los modelos de Groq que NO son de chat (voz, guardias,
//     moderacion) jamas son elegidos por Auto en ningun rol,
//     y Nexus (local, sin bucket) tampoco entra al Auto.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const AutoModel = require("../auto-model-selection");

const entrada = (providerKey, model) => ({
  providerKey,
  modelProviderGroup: providerKey,
  profileId: `${providerKey}:${model}`,
  model,
  enabled: true,
});

const MEAI = [
  entrada("meai", "claude-sonnet-4.6"),
  entrada("meai", "claude-opus-4.8"),
  entrada("meai", "claude-haiku-4.5"),
  entrada("meai", "deepseek-v4-pro"),
  entrada("meai", "qwen3.6-plus"),
  entrada("meai", "glm-5.2"),
];
const GROQ = [
  entrada("groq", "llama-3.3-70b-versatile"),
  entrada("groq", "openai/gpt-oss-120b"),
  entrada("groq", "llama-3.1-8b-instant"),
];
const GROQ_NO_CHAT = [
  entrada("groq", "canopylabs/orpheus-v1-english"),
  entrada("groq", "meta-llama/llama-prompt-guard-2-86m"),
  entrada("groq", "openai/gpt-oss-safeguard-20b"),
  entrada("groq", "whisper-large-v3-turbo"),
];
const NEXUS = [entrada("nexus", "editcore-nexus-v5")];

const CTX_IMPLEMENT = {
  prompt: "implementa la funcion de login del proyecto",
  isAgent: true, usesProjectTools: true, planAuthorizedExecution: true,
};
const CTX_CHAT = { prompt: "hola, que es una API?", usesProjectTools: false };

test("A-1: groq es el segundo upstream del Auto (bucket, scope, uso, seguros)", () => {
  assert.deepEqual(AutoModel.UPSTREAM_ORDER, ["meai", "groq"]);
  assert.equal(AutoModel.normalizeAutoProviderScope("groq"), "groq");
  assert.equal(AutoModel.isScopedAutoProvider("groq"), true);
  assert.equal(AutoModel.formatAutoLabel("groq"), "Auto · EditCore Nube");
  for (const e of GROQ) assert.equal(AutoModel.entryUpstreamBucket(e), "groq", `bucket de ${e.model}`);
  for (const e of MEAI) assert.equal(AutoModel.entryUpstreamBucket(e), "meai", `bucket de ${e.model}`);
  assert.equal(AutoModel.isSafeDefaultModel("llama-3.3-70b-versatile"), true);
  assert.equal(AutoModel.isSafeDefaultModel("openai/gpt-oss-120b"), true);
  assert.equal(AutoModel.isSafeDefaultModel("canopylabs/orpheus-v1-english"), false);
  const uso = AutoModel.bumpUpstreamUsage({ meai: 0, groq: 0 }, "llama-3.3-70b-versatile");
  assert.equal(uso.groq, 1, "el uso del bucket groq se contabiliza");
  assert.equal(uso.meai, 0);
  assert.match(AutoModel.describeModelDuty("llama-3.3-70b-versatile").duty, /implement/);
});

test("A-2: en Auto con ME AI cargado, implementar cae en el carril de Groq", () => {
  const usoModelos = {};
  for (const e of MEAI) usoModelos[e.model] = 5;
  const elegido = AutoModel.resolveAutoModelEntry([...MEAI, ...GROQ], {
    ...CTX_IMPLEMENT,
    autoProviderScope: "all",
    autoUpstreamUsage: { meai: 10, groq: 0 },
    autoModelUsage: usoModelos,
  });
  assert.ok(elegido, "Auto debe resolver un modelo");
  assert.equal(elegido.providerKey, "groq");
  assert.equal(elegido.model, "llama-3.3-70b-versatile");
});

test("A-3: con scope groq, Auto solo elige Groq y segun la tarea", () => {
  const elegido = AutoModel.resolveAutoModelEntry([...MEAI, ...GROQ], {
    ...CTX_CHAT,
    autoProviderScope: "groq",
  });
  assert.ok(elegido, "Auto debe resolver un modelo");
  assert.equal(elegido.providerKey, "groq");
  assert.equal(elegido.model, "llama-3.1-8b-instant", "el chat cae en el modelo rapido de Groq");
});

test("A-4: los modelos que no son de chat y Nexus jamas salen en Auto", () => {
  const opciones = [...MEAI, ...GROQ, ...GROQ_NO_CHAT, ...NEXUS];
  const contextos = [
    { prompt: "crea una app de ventas para mi negocio", isAgent: true, usesProjectTools: true, greenfieldCreate: true, planAuthorizedExecution: true },
    CTX_IMPLEMENT,
    { prompt: "analiza y revisa la arquitectura del proyecto", isAgent: true, usesProjectTools: true, needsAnalysisFirst: true },
    CTX_CHAT,
    { prompt: "auditoria de seguridad del proyecto antes de produccion", isAgent: true, usesProjectTools: true, needsAnalysisFirst: true },
  ];
  for (const ctx of contextos) {
    const elegido = AutoModel.resolveAutoModelEntry(opciones, { ...ctx, autoProviderScope: "all" });
    assert.ok(elegido, "Auto debe resolver un modelo");
    assert.notEqual(elegido.providerKey, "nexus", "Nexus no entra al Auto");
    assert.ok(!/orpheus|prompt-guard|safeguard|whisper/i.test(elegido.model), `modelo no-chat elegido: ${elegido.model}`);
  }
});
