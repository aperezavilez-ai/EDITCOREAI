const { test, describe } = require("node:test");
const assert = require("node:assert");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");
const { esConsultaDeIdentidad, RESPUESTA_ADN_NEXUS_V5 } = require("../runtime/tools/nuevo/textos");

describe("EditCore Nexus v5 - ADN Fast-Path & 32B/14B Identity", () => {
  test("esConsultaDeIdentidad detecta variantes de preguntas de identidad y capacidades", () => {
    assert.strictEqual(esConsultaDeIdentidad("¿Qué modelo eres y cuáles son tus habilidades?"), true);
    assert.strictEqual(esConsultaDeIdentidad("¿Qué modelo eres?"), true);
    assert.strictEqual(esConsultaDeIdentidad("¿Cuáles son tus habilidades?"), true);
    assert.strictEqual(esConsultaDeIdentidad("¿Quién eres?"), true);
    assert.strictEqual(esConsultaDeIdentidad("¿Qué versión eres?"), true);
    assert.strictEqual(esConsultaDeIdentidad("¿Cuáles son tus capacidades?"), true);
    assert.strictEqual(esConsultaDeIdentidad("¿Qué puedes hacer?"), true);
    assert.strictEqual(esConsultaDeIdentidad("Crea un servidor en Express"), false);
    assert.strictEqual(esConsultaDeIdentidad("Corrige el error de compilación"), false);
  });

  test("manejarChatNuevo responde instantáneamente (< 20ms) desde el ADN de Nexus v5", async () => {
    const t0 = Date.now();
    const res = await manejarChatNuevo({
      providerKey: "nexus",
      model: "editcore-nexus-v5",
      message: "¿Qué modelo eres y cuáles son tus habilidades?",
      messages: [{ role: "user", content: "¿Qué modelo eres y cuáles son tus habilidades?" }]
    }, {
      callChat: async () => { throw new Error("No debe llamar al LLM externo para preguntas de ADN"); }
    });
    const elapsed = Date.now() - t0;

    assert.strictEqual(res.ok, true);
    assert.strictEqual(typeof res.text, "string");
    assert.ok(elapsed < 50, `Debe responder en < 50ms (tardó ${elapsed}ms)`);
    assert.ok(res.text.includes("EditCore Nexus v5"));
    assert.ok(res.text.includes("32B / 14B"));
    assert.ok(res.text.includes("Zero-OOM"));
    assert.ok(res.text.includes("Nexus Media Studio"));
    assert.ok(res.text.includes("Orquestación Multiagente Paralela"));
  });
});
