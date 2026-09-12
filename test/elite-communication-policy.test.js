"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  POLICY_MARKER,
  ELITE_COMMUNICATION_POLICY,
  withEliteCommunicationPolicy,
  stripEliteFiller,
  normalizeSpanishProse,
  defaultChatSystemPrompt,
  hasElitePolicy,
} = require("../runtime/elite-communication-policy");

test("politica elite contiene ortografia y las 4 directrices", () => {
  assert.match(ELITE_COMMUNICATION_POLICY, /ORTOGRAF/);
  assert.match(ELITE_COMMUNICATION_POLICY, /tildes/);
  assert.match(ELITE_COMMUNICATION_POLICY, /APERTURA DIRECTA/);
  assert.match(ELITE_COMMUNICATION_POLICY, /RAZONAMIENTO ANTES DE ACCI/);
  assert.match(ELITE_COMMUNICATION_POLICY, /ESTILO Y FORMATO/);
  assert.match(ELITE_COMMUNICATION_POLICY, /POSTURA PROPOSITIVA/);
  assert.match(ELITE_COMMUNICATION_POLICY, /C[OÓ]DIGO Y DIFFS/);
  assert.match(ELITE_COMMUNICATION_POLICY, /PROHIBIDO empezar con saludos/);
  assert.match(ELITE_COMMUNICATION_POLICY, /placeholders/i);
  assert.match(ELITE_COMMUNICATION_POLICY, /está|también|código/);
});

test("withEliteCommunicationPolicy es idempotente y antepone el marcador", () => {
  const once = withEliteCommunicationPolicy("Eres EDITCOREAI. Haz X.");
  assert.ok(once.includes(POLICY_MARKER));
  assert.match(once, /Haz X/);
  const twice = withEliteCommunicationPolicy(once);
  assert.equal(twice, once);
  assert.equal(hasElitePolicy(once), true);
});

test("normalizeSpanishProse separa puntuacion y une cortes con guion", () => {
  assert.equal(
    normalizeSpanishProse("El archivo.está listo enel proyecto."),
    "El archivo. está listo enel proyecto.",
  );
  assert.equal(
    normalizeSpanishProse("proye-\ncto corregido"),
    "proyecto corregido",
  );
  assert.equal(
    normalizeSpanishProse("usa `main.js` y luego.Continua"),
    "usa `main.js` y luego. Continua",
  );
  assert.equal(
    normalizeSpanishProse("El bug está en main.js línea 12."),
    "El bug está en main.js línea 12.",
  );
  assert.equal(
    normalizeSpanishProse("```js\nfoo.bar()\n```\nListo."),
    "```js\nfoo.bar()\n```\nListo.",
  );
});

test("stripEliteFiller tambien normaliza prosa pegada", () => {
  const out = stripEliteFiller("Claro. Revisé el código.Está en renderer.js");
  assert.equal(out, "Revisé el código. Está en renderer.js");
});

test("defaultChatSystemPrompt ya no es conversacional de colega", () => {
  const p = defaultChatSystemPrompt();
  assert.match(p, /POLITICA_COMUNICACION_ELITE/);
  assert.doesNotMatch(p, /como un colega humano/i);
});

test("stripEliteFiller quita aperturas y cierres vacios", () => {
  assert.equal(
    stripEliteFiller("¡Claro! El bug está en main.js línea 12."),
    "El bug está en main.js línea 12.",
  );
  assert.equal(
    stripEliteFiller("Por supuesto. Usa list_files en api/."),
    "Usa list_files en api/.",
  );
  const withClose = stripEliteFiller("Listo el fix en renderer.js.\n\nEspero que esto te sirva.");
  assert.match(withClose, /Listo el fix/);
  assert.doesNotMatch(withClose, /Espero que esto te sirva/i);
});

test("inyeccion: main.js chat usa withEliteCommunicationPolicy", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(src, /withEliteCommunicationPolicy/);
  assert.match(src, /stripEliteFiller/);
  assert.match(src, /defaultChatSystemPrompt/);
});

test("inyeccion: adapter agente envuelve system prompt", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
  assert.match(src, /withEliteCommunicationPolicy\(`/);
  assert.match(src, /stripEliteFiller/);
});

test("inyeccion: intent-orchestrator hints elite + index.html carga el modulo", () => {
  const orch = fs.readFileSync(path.join(__dirname, "..", "runtime", "intent-orchestrator.js"), "utf8");
  assert.match(orch, /elite-communication-policy/);
  assert.match(orch, /withElite\(/);
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /elite-communication-policy\.js/);
});

test("inyeccion: context-engine y agent-core llm-loop", () => {
  const ctx = fs.readFileSync(path.join(__dirname, "..", "runtime", "context-engine.js"), "utf8");
  assert.match(ctx, /withEliteCommunicationPolicy\(\[/);
  const loop = fs.readFileSync(path.join(__dirname, "..", "agent-core", "src", "llm-loop.js"), "utf8");
  assert.match(loop, /elite-communication-policy/);
});

test("chatConversationHint de orquestador incluye marcador elite", () => {
  const ProjectAnalysis = require("../project-analysis");
  const orch = require("../runtime/intent-orchestrator");
  const plan = orch.resolveUnifiedAgentPlan({
    prompt: "quiero pensar el producto antes de escribir codigo",
    projectRoot: "D:\\\\PROGRAMAS IA\\\\EDITCOREAI",
    ProjectAnalysis,
  });
  if (plan.chatConversationHint) {
    assert.match(plan.chatConversationHint, /POLITICA_COMUNICACION_ELITE/);
  }
});
