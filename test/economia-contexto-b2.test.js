"use strict";

// [EDITCORE-INTEGRAL-B2] ECONOMÍA DE CONTEXTO (Bloque 2 de la corrección
// integral v4.9.0): la auditoría midió ~85.243 caracteres de cuerpos
// COMPLETOS de SKILL.md re-pagados en CADA llamada del bucle (~85% del
// costo fijo por llamada), la selección de skills ejecutada DOS veces
// por turno, turnContext sin tope agregado y el umbral de tokens del
// compactador (maxTotalTokens=120.000) nunca leído por compactMessages.
// Patrón de publicacion-verificada / verdad-turno-b1: comportamiento con
// callChat guionado y fakes inyectados, sin red ni CLI reales; nada de
// aserciones sobre el texto fuente.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b2-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

const { ChatOrchestrator, applyTurnContextBudget, TURN_CONTEXT_MAX_CHARS, TURN_CONTEXT_TRUNCATION_MARKER, CTX_TIER_ESSENTIAL, CTX_TIER_ACCESSORY } = require("../editcore-chat-kernel/orchestrator");
const tools = require("../editcore-chat-kernel/tools");
const catalog = require("../editcore-chat-kernel/skills-catalog");
const skillsEngine = require("../runtime/skills-engine");
const { ContextCompactor, estimateMessagesTokens } = require("../editcore-chat-kernel/context-compactor");

// Skill FALSA de >20.000 caracteres: su id lleva varias palabras del
// mensaje de prueba para que el ranking la seleccione, y su cuerpo
// termina con un marcador que jamás debe viajar en el prompt.
const FAKE_SKILL_ID = "fake-long-skill-build-error-debug";
const BODY_TAIL_MARKER = "MARCADOR-FINAL-DEL-CUERPO-B2";
const FAKE_BODY = [
  "---",
  `name: ${FAKE_SKILL_ID}`,
  'description: "Use when the user mentions fake long skill build error debug work."',
  "---",
  "",
  `# ${FAKE_SKILL_ID}`,
  "",
  "Guía de la skill falsa: pasos para el trabajo fake long skill build error debug.",
  "",
  "RELLENO-DE-LA-SKILL-FALSA ".repeat(760),
  "",
  BODY_TAIL_MARKER,
  "",
].join("\n");

function tmpProjectWithFakeSkill() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b2-proj-"));
  const skillDir = path.join(root, ".editcore", "skills", FAKE_SKILL_ID);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), FAKE_BODY);
  return root;
}

function assertPairsIntact(msgs) {
  const callIds = new Set();
  const resultIds = new Set();
  for (const m of msgs) {
    if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls) callIds.add(c.id);
    }
    if (m.role === "tool" && m.tool_call_id) resultIds.add(m.tool_call_id);
  }
  for (const id of resultIds) assert.ok(callIds.has(id), `resultado tool huérfano de su llamada: ${id}`);
  for (const id of callIds) assert.ok(resultIds.has(id), `llamada tool sin su resultado: ${id}`);
}

test("B2-1 turno guionado: el payload al proveedor lleva el ÍNDICE de la skill larga, no su cuerpo", async () => {
  assert.ok(FAKE_BODY.length > 20_000, "la skill falsa supera los 20.000 caracteres");
  const root = tmpProjectWithFakeSkill();
  const captured = [];
  const events = [];
  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "fake long skill build error debug: aplica la guía en este proyecto",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: {
      callChat: async (args) => {
        captured.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
        return { text: "Listo, apliqué la guía pedida para este proyecto.", toolCalls: [], usage: {} };
      },
    },
    history: [], onProgress: (ev) => events.push(ev),
  });

  assert.ok(captured.length >= 1, "el modelo fue llamado");
  const payload = captured[0];
  assert.ok(payload.includes(`SKILL ${FAKE_SKILL_ID} (`), "el índice nombra a la skill seleccionada");
  assert.ok(payload.includes("ÍNDICE"), "la entrada se presenta como índice, no como cuerpo");
  assert.ok(payload.includes(`read_skill(name: "${FAKE_SKILL_ID}")`), "el índice dice cómo cargar el cuerpo completo");
  assert.ok(payload.includes(FAKE_BODY.slice(300, 420)), "el extracto acotado de las primeras líneas SÍ viaja");
  assert.ok(!payload.includes(BODY_TAIL_MARKER), "la cola del cuerpo completo NO viaja en el prompt");
  assert.ok(!payload.includes(FAKE_BODY.slice(3000, 3600)), "el relleno del cuerpo completo NO viaja en el prompt");

  // La narrativa de skills (v4.8.0) se conserva y nombra la misma selección.
  const skillLines = events.filter((e) => e.phase === "narration" && /^Skills aplicadas este turno:/.test(String(e.text || "")));
  assert.equal(skillLines.length, 1, "la línea «Skills aplicadas este turno: …» se emite una sola vez");
  assert.ok(String(skillLines[0].text).includes(FAKE_SKILL_ID), "la narrativa nombra la skill del índice");
});

test("B2-1b selección ÚNICA: el índice inyectado es exactamente la selección devuelta (buildSkillsTurn)", () => {
  const root = tmpProjectWithFakeSkill();
  const turn = catalog.buildSkillsTurn(root, "EXECUTE", "créame una landing para mi taller mecánico");
  const injectedIds = [...turn.prompt.matchAll(/^SKILL ([a-z0-9-]+) \(/gim)].map((m) => m[1]);
  assert.deepEqual(injectedIds, turn.pickedIds, "una sola selección alimenta índice y narrativa");
  assert.ok(turn.prompt.length < 20_000, `el índice completo (${turn.prompt.length}) queda muy por debajo de los ~85.000 de cuerpos de antes`);
});

test("B2-1c la otra vía (runtime/skills-engine, ruta agent:run) también inyecta índice acotado", () => {
  const block = skillsEngine.assembleSkillsSystemPrompt([
    { name: "skill-larga-falsa", description: "Skill falsa para la prueba del Bloque 2.", body: `${"z".repeat(20_000)}\n${BODY_TAIL_MARKER}` },
  ]);
  assert.ok(block.includes("skill-larga-falsa"), "el índice nombra la skill");
  assert.ok(block.includes("read_skill"), "el índice indica la vía del cuerpo completo");
  assert.ok(!block.includes(BODY_TAIL_MARKER), "el cuerpo completo no viaja por esta vía tampoco");
  assert.ok(!block.includes("z".repeat(1_000)), "el extracto está acotado (no hay 1.000 caracteres seguidos del cuerpo)");
  assert.ok(block.length < 2_500, `el bloque por skill queda acotado (${block.length})`);
});

test("B2-2 read_skill sigue devolviendo el cuerpo COMPLETO bajo demanda", async () => {
  const root = tmpProjectWithFakeSkill();
  const res = await tools.execute("read_skill", { name: FAKE_SKILL_ID }, root, false, {});
  assert.equal(res.ok, true, "read_skill encuentra la skill falsa en el catálogo");
  assert.ok(String(res.content || "").length > 20_000, "el cuerpo devuelto es el completo (>20.000)");
  assert.ok(String(res.content || "").includes(BODY_TAIL_MARKER), "hasta la cola del cuerpo llega vía read_skill");
});

test("B2-3 un «hola» (ruta corta) no carga cuerpos de skills", async () => {
  const root = tmpProjectWithFakeSkill();
  const captured = [];
  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "hola",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: false, fullAccess: false,
    helpers: {
      callChat: async (args) => {
        captured.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
        return { text: "Hola. ¿En qué te ayudo?", toolCalls: [], usage: {} };
      },
    },
    history: [],
  });
  assert.ok(captured.length >= 1, "el modelo fue llamado en el turno trivial");
  const payload = captured[0];
  assert.ok(!payload.includes(BODY_TAIL_MARKER), "ningún cuerpo de skill viaja en un «hola»");
  // Las skills que la selección de un CHAT elija van como índice: de cada
  // una, un tramo profundo de su cuerpo real debe estar AUSENTE.
  const picked = catalog.selectSkillsForTurn(root, "CHAT", "hola");
  assert.ok(picked.length >= 1, "la ruta CHAT sigue seleccionando (para el índice)");
  for (const p of picked) {
    const body = catalog.loadSkillBody(root, p.id).body;
    if (body.length > 3_000) {
      assert.ok(!payload.includes(body.slice(2500, 3100)), `el cuerpo de ${p.id} no viaja en el «hola»`);
    }
  }
  const promptHola = catalog.skillsPrompt(root, "CHAT", "hola");
  assert.ok(promptHola.length < 7_000, `el bloque de skills de un «hola» es el índice acotado (${promptHola.length}), no los ~7.660 de cuerpos de antes`);
});

test("B2-4 turnContext sobre el presupuesto: sale recortado con la marca, bajo el tope y con lo esencial intacto", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b2-ctx-"));
  const captured = [];
  const orch = new ChatOrchestrator();
  orch._turnExtras = ["A".repeat(9_000), "B".repeat(9_000), "C".repeat(9_000)];
  orch._currentUserText = "crea una sección nueva para la landing de mi taller";
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "crea una sección nueva para la landing de mi taller",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 3, fullAccess: true, permissionMode: "full",
    helpers: {
      callChat: async (args) => {
        captured.push((args.messages || []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n"));
        return { text: "Listo: la sección quedó creada para la landing del taller.", toolCalls: [], usage: {} };
      },
    },
  });
  assert.ok(out && typeof out.text === "string");
  assert.ok(captured.length >= 1, "el modelo fue llamado");
  const payload = captured[0];
  const start = payload.indexOf("=== CONTEXTO DE EDITCOREAI PARA ESTE TURNO");
  const end = payload.indexOf("=== FIN CONTEXTO ===");
  assert.ok(start >= 0 && end > start, "el mensaje lleva el bloque de contexto del turno");
  const segment = payload.slice(start, end);
  assert.ok(segment.includes(TURN_CONTEXT_TRUNCATION_MARKER), "el recorte se declara con su marca en el propio bloque");
  assert.ok(segment.length <= TURN_CONTEXT_MAX_CHARS + 3_700, `el segmento (${segment.length}) queda bajo el presupuesto + el expediente acotado (≤3.500) y los encabezados`);
  assert.ok(!segment.includes("C".repeat(500)), "el bloque accesorio/normal del final es lo que se corta");
  assert.ok(segment.includes("IDIOMA DEL USUARIO: ESPAÑOL"), "lo esencial (directiva de idioma, empujada al final) NO se amputa: la prioridad manda sobre el orden de llegada");
});

test("B2-4b applyTurnContextBudget: sin exceso no toca nada; con exceso, lo esencial va primero y el tope es duro", () => {
  const small = applyTurnContextBudget([{ text: "uno", tier: CTX_TIER_ACCESSORY }, { text: "dos", tier: CTX_TIER_ESSENTIAL }], 500);
  assert.equal(small, "dos\n\nuno", "sin exceso solo reordena por prioridad (esencial primero)");
  const big = applyTurnContextBudget([
    { text: "X".repeat(900), tier: CTX_TIER_ACCESSORY },
    { text: "ESENCIAL-DEL-TURNO", tier: CTX_TIER_ESSENTIAL },
  ], 500);
  assert.ok(big.length <= 500, "el tope es duro incluso con un accesorio gigante");
  assert.ok(big.startsWith("ESENCIAL-DEL-TURNO"), "lo esencial abre el bloque");
  assert.ok(big.includes(TURN_CONTEXT_TRUNCATION_MARKER), "el corte se declara");
});

test("B2-5 el compactador compacta por TAMAÑO ESTIMADO aun con pocos mensajes, conservando los pares", () => {
  const pair = (id, fill, len) => ([
    { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "run_command", arguments: "{}" } }] },
    { role: "tool", tool_call_id: id, name: "run_command", content: fill.repeat(len) },
  ]);
  const messages = [
    { role: "system", content: "system de prueba" },
    { role: "user", content: "trabaja en el proyecto" },
    ...pair("call_a", "a", 8_000),
    ...pair("call_b", "b", 8_000),
    ...pair("call_c", "c", 8_000),
    { role: "assistant", content: "cierre parcial" },
  ];
  assert.ok(messages.length <= 40, "son pocos mensajes: la ventana por cantidad NO dispararía");
  const compactor = new ContextCompactor({ maxTotalTokens: 2_500 });
  const out = compactor.compactMessages(messages);
  assert.ok(estimateMessagesTokens(out) <= 2_500, `el estimado final (${estimateMessagesTokens(out)}) queda bajo el umbral`);
  assert.ok(out.length < messages.length, "hubo compactación real por tamaño");
  assertPairsIntact(out);
  const joined = JSON.stringify(out);
  assert.ok(!joined.includes("a".repeat(500)), "el resultado viejo y grande (a) se recortó");
  assert.ok(!joined.includes("b".repeat(500)), "el segundo resultado viejo (b) también");
  assert.ok(joined.includes("c".repeat(500)), "el resultado más reciente se conserva");
  assert.equal(out[0].role, "system", "el system se conserva");
});

test("B2-5b el compactador achica un único resultado gigante sin romper su par", () => {
  const messages = [
    { role: "system", content: "system de prueba" },
    { role: "user", content: "lee el archivo grande" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: "run_command", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_x", name: "run_command", content: "x".repeat(20_000) },
  ];
  const compactor = new ContextCompactor({ maxTotalTokens: 400 });
  const out = compactor.compactMessages(messages);
  assert.ok(estimateMessagesTokens(out) <= 460, `el estimado final (${estimateMessagesTokens(out)}) queda junto al umbral de 400`);
  assertPairsIntact(out);
  assert.ok(JSON.stringify(out).includes("caracteres truncados"), "el achique se declara con su marca de truncado");
});
