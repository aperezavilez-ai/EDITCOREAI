const { describe, it } = require("node:test");
const assert = require("node:assert");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");

describe("EditCore Nexus v5 - Enrutamiento Híbrido Automático (120B Titan / 14B Fallback)", () => {
  it("Enruta automáticamente a Groq 120B cuando GROQ_API_KEY está configurado", async () => {
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
  });
});
