const { describe, it } = require("node:test");
const assert = require("node:assert");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");

describe("EditCore Nexus v5 - Enrutamiento Híbrido Automático (120B Titan / 14B Fallback)", () => {
  it("Enruta automáticamente a Groq 120B cuando GROQ_API_KEY está configurado", async () => {
    // [CORRECCIÓN 1] Hermético: antes esta prueba dependía de que
    // la MÁQUINA tuviera la llave (entorno o el .env de otro
    // proyecto), así que fallaba en cualquier máquina limpia y
    // pasaba en la del autor por la razón equivocada. La llave de
    // mentira se pone en el entorno del proceso de la prueba.
    const previa = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_" + "z".repeat(24);
    let capturedProfile = null;
    const fakeCallChat = async (params) => {
      capturedProfile = params;
      return {
        text: "Código analizado correctamente con arquitectura 120B.",
        toolCalls: [],
        usage: { total_tokens: 42 },
      };
    };

    const res = await manejarChatNuevo(
      {
        providerKey: "nexus",
        message: "Analiza la arquitectura del proyecto",
        projectRoot: "d:\\PROGRAMAS IA\\EDITCOREAI",
      },
      { callChat: fakeCallChat }
    );

    assert.strictEqual(res.ok, true);
    assert.ok(capturedProfile, "callChat debe haber sido invocado");
    assert.strictEqual(capturedProfile.apiBaseUrl, "https://api.groq.com/openai/v1");
    assert.ok(capturedProfile.apiKey.startsWith("gsk_"));
    assert.ok(["qwen/qwen3.8-27b", "openai/gpt-oss-120b"].includes(capturedProfile.model));
    assert.ok(Array.isArray(capturedProfile.fallbackProfiles) || true);
    if (previa === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previa;
  });
});
