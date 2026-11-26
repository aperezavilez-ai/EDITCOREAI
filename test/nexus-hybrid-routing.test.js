const { describe, it } = require("node:test");
const assert = require("node:assert");
const { manejarChatNuevo } = require("../runtime/tools/nuevo/adaptador");

describe("EditCore Nexus v5 - Enrutamiento independiente (modelo propio)", () => {
  it("Con GROQ_API_KEY configurado, el turno Nexus va al modelo propio local", async () => {
    // [CORRECCIÓN 3] El contrato «híbrido» murió por decisión de
    // Luis (2026-11-24): Nexus es independiente y Groq sale de su
    // ruta. La llave de mentira se pone en el entorno a propósito:
    // ni con ella presente el turno sale de casa.
    const previa = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "gsk_" + "z".repeat(24);
    let capturedProfile = null;
    const fakeCallChat = async (params) => {
      capturedProfile = params;
      return {
        text: "Código analizado correctamente con el modelo propio.",
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
    assert.strictEqual(capturedProfile.apiBaseUrl, "http://127.0.0.1:11435/v1");
    assert.strictEqual(capturedProfile.model, "editcore-nexus");
    assert.ok(!String(capturedProfile.apiKey || "").startsWith("gsk_"));
    for (const f of capturedProfile.fallbackProfiles || []) {
      assert.ok(!String(f?.apiBaseUrl || "").includes("api.groq.com"));
    }
    if (previa === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previa;
  });
});
