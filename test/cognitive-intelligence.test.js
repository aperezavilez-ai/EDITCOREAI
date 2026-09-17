"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");

const { SemanticIntentGuard, INTENT_TYPES } = require("../runtime/semantic-intent-guard");
const { AgentLearningMemory } = require("../runtime/agent-learning-memory");
const { LiveWebResearcher } = require("../runtime/live-web-researcher");
const { AutoRulesEvolver } = require("../runtime/auto-rules-evolver");

test("SemanticIntentGuard correctly distinguishes questions, negations and mutations", () => {
  const guard = new SemanticIntentGuard();

  // 1. Pregunta estratégica / de diseño (NO debe mutar ni clonar)
  const q1 = "tu como experto creador de paginas web de este tipo de paginas, que podemos implementar que sea muy profesional y veneficie a la pagina?";
  const r1 = guard.analyze(q1);
  assert.equal(r1.intent, INTENT_TYPES.STRATEGIC_CONSULTATION);
  assert.equal(r1.allowWrite, false);
  assert.ok(r1.prohibitedTools.includes("clone_web_page"));
  assert.ok(r1.prohibitedTools.includes("write_file"));

  // 2. Negación ("no te pedí clonar") -> NO debe clonar
  const q2 = "no te pedi clonar te pedi esto...?";
  const r2 = guard.analyze(q2);
  assert.notEqual(r2.intent, INTENT_TYPES.WEB_CLONING);
  assert.ok(r2.prohibitedTools.includes("clone_web_page"));

  // 3. Orden directa de mutación de código
  const q3 = "agrega un botón de WhatsApp flotante en la esquina inferior derecha";
  const r3 = guard.analyze(q3);
  assert.equal(r3.intent, INTENT_TYPES.CODE_MUTATION);
  assert.equal(r3.allowWrite, true);
  assert.equal(r3.requiresExecution, true);

  // 4. Confirmación
  const q4 = "procede";
  const r4 = guard.analyze(q4);
  assert.equal(r4.intent, INTENT_TYPES.CONFIRMATION);
  assert.equal(r4.allowWrite, true);
});

test("AgentLearningMemory records lessons, absorbs user corrections and injects memory blocks", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mem-test-"));
  const memory = new AgentLearningMemory({ projectRoot: tmpDir });

  // 1. Registrar lección explícita
  const l1 = memory.recordLesson({
    topic: "ui_style",
    correctBehavior: "Centrar siempre las tarjetas de producto en el carrusel de inicio",
  });
  assert.ok(l1.id.startsWith("lsn_"));
  assert.equal(memory.lessons.length, 1);

  // 2. Absorber corrección automáticamente desde el chat
  const absorbed = memory.detectAndAbsorbCorrection(
    "no lo hagas con flex-start, siempre usa justify-center en los contenedores",
    "Alineé los elementos a la izquierda"
  );
  assert.ok(absorbed);
  assert.equal(memory.lessons.length, 2);

  // 3. Formatear bloque para system prompt
  const block = memory.formatMemoryPromptBlock();
  assert.ok(block.includes("BANCO DE MEMORIA Y LECCIONES APRENDIDAS"));
  assert.ok(block.includes("Centrar siempre las tarjetas de producto"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("LiveWebResearcher caches and formats live web documentation", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-docs-test-"));
  const researcher = new LiveWebResearcher({ projectRoot: tmpDir });

  const docRes = await researcher.searchAndSynthesizeDocs("Supabase Row Level Security Policies");
  assert.equal(docRes.ok, true);
  assert.ok(docRes.keyFindings.length > 0);

  const promptBlock = researcher.formatResearchPromptBlock(docRes);
  assert.ok(promptBlock.includes("DOCUMENTACIÓN DE LA RED"));
  assert.ok(promptBlock.includes("SUPABASE ROW LEVEL SECURITY POLICIES"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("AutoRulesEvolver updates .editcorerules from learned lessons", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rules-evolver-test-"));
  const evolver = new AutoRulesEvolver({ projectRoot: tmpDir });

  const lessons = [
    { correctBehavior: "Usar Lucide Icons para todos los botones de acción" },
    { correctBehavior: "Validar contraseñas con mínimo 8 caracteres y botón de visibilidad" },
  ];

  const res = evolver.evolveRulesFromLessons(lessons);
  assert.equal(res.ok, true);
  assert.equal(res.evolvedCount, 2);

  const rulesContent = fs.readFileSync(path.join(tmpDir, ".editcorerules"), "utf8");
  assert.ok(rulesContent.includes("Usar Lucide Icons"));
  assert.ok(rulesContent.includes("Validar contraseñas"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
