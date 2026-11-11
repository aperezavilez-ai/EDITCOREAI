"use strict";

// DIETA DE CONTEXTO (v4.8.0, línea 5): en vivo, turnos sueltos
// costaron 189k–250k tokens porque el historial guardado reenviaba
// los diffs completos y el bloque «🔍 Verificación post-escritura»
// de cada turno anterior. La dieta actúa en rememberExchange, el
// único punto donde el intercambio se guarda: SOLO lo almacenado se
// adelgaza (la respuesta en vivo no se toca) — los bloques de diff
// (```diff, o unificado crudo --- a/ +++ b/ con hunks) y el bloque de
// verificación se sustituyen por una línea resumen con los archivos.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const { slimStoredAssistantText } = require("../editcore-chat-kernel/thread-core");

test("dieta: el adelgazador sustituye diff crudo y bloque de verificación por la línea resumen", () => {
  const raw = [
    "Resumen del cambio aplicado.",
    "--- a/src/Hero.tsx",
    "+++ b/src/Hero.tsx",
    "@@ -1,2 +1,2 @@",
    "-titulo viejo LINEA_UNICA_CRUDO_7a1",
    "+titulo nuevo con la clase del taller",
    "",
    "## 🔍 Verificación post-escritura — la app se ejercitó de verdad",
    "- `src/Hero.tsx`: ✅ verificada (vista del chat: parece renderizar)",
    "Cierre del turno.",
  ].join("\n");
  const slim = slimStoredAssistantText(raw);
  assert.ok(!slim.includes("LINEA_UNICA_CRUDO_7a1"), "el cuerpo del diff no queda en lo guardado");
  assert.ok(!slim.includes("Verificación post-escritura"), "el bloque de verificación tampoco");
  assert.ok(slim.includes("[diff y verificación de"), "queda la línea resumen de la dieta");
  assert.ok(slim.includes("src/Hero.tsx"), "la línea resumen conserva el nombre del archivo");
  assert.ok(slim.includes("Resumen del cambio aplicado."), "la prosa del turno se conserva");
  assert.ok(slim.includes("Cierre del turno."), "el cierre se conserva");
});

test("dieta: el turno siguiente NO recibe el diff del anterior, aunque la respuesta en vivo sí lo mostró", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-dieta-"));
  const DIFF_LINE = "LINEA_UNICA_DEL_DIFF_9f3";
  const ANSWER_WITH_DIFF = [
    "Listo, creé el archivo. El cambio aplicado fue:",
    "",
    "```diff",
    "--- a/saludo.txt",
    "+++ b/saludo.txt",
    "@@ -0,0 +1 @@",
    `+hola ${DIFF_LINE}`,
    "```",
  ].join("\n");

  let calls = 0;
  const orch1 = new ChatOrchestrator();
  const out1 = await orch1.handle({
    message: "crea el archivo saludo.txt con un hola",
    threadId: "hilo-dieta",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: {
      callChat: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "saludo.txt", content: "hola" }) } }],
            usage: {},
          };
        }
        return { text: ANSWER_WITH_DIFF, toolCalls: [], usage: {} };
      },
    },
    history: [],
  });
  assert.ok(String(out1.text || "").includes(DIFF_LINE), "la respuesta EN VIVO conserva el diff completo (la dieta no la toca)");

  const captured = [];
  const orch2 = new ChatOrchestrator();
  await orch2.handle({
    message: "¿qué archivo creaste en el turno anterior?",
    threadId: "hilo-dieta",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: false, fullAccess: false,
    helpers: {
      callChat: async (args) => {
        captured.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
        return { text: "Creé saludo.txt en el turno anterior.", toolCalls: [], usage: {} };
      },
    },
    history: [],
  });

  assert.ok(captured.length >= 1, "el segundo turno llamó al modelo");
  const historySeen = captured[0];
  assert.ok(historySeen.includes("[diff y verificación de"), "el historial reenviado trae la línea resumen de la dieta");
  assert.ok(historySeen.includes("saludo.txt"), "la línea resumen conserva el nombre del archivo");
  assert.ok(!historySeen.includes(DIFF_LINE), "el cuerpo del diff NO viaja al turno siguiente");
});
