"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ProjectAnalysis = require("../project-analysis");
const {
  resolveAgentRunProfile,
  resolveUnifiedAgentPlan,
  SUB_AGENTS,
  PHASES,
  MODES,
} = require("../runtime/intent-orchestrator");

test("greenfield spec entra en chat sin filesystem", () => {
  const prompt = [
    "Quiero crear una app de tickets para eventos.",
    "Debe tener registro, venta, QR y panel admin.",
    "Stack: React + Node. Empieza entendiendo este requerimiento.",
  ].join(" ");
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.equal(plan.conversationOnly, false);
  assert.match(plan.chatConversationHint, /producto o idea nueva/i);
});

test("analiza texto pegado sin pedir proyecto usa chat de entendimiento", () => {
  const prompt = "Analiza lo siguiente:\n\nQuiero una app de tickets para eventos con registro, venta QR y panel admin en React y Node.";
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.match(plan.chatConversationHint, /producto o idea nueva/i);
});

test("analiza el proyecto explicito usa explorador", () => {
  const profile = resolveAgentRunProfile({
    prompt: "Analiza el proyecto completo y dame un reporte",
    analysisMode: true,
    allowWrite: false,
  });
  assert.equal(profile.phase, PHASES.DISCOVER);
  assert.equal(profile.subAgent, SUB_AGENTS.EXPLORER);
  assert.equal(profile.allowFilesystem, true);
});

test("comentario de intencion usa chat sin herramientas", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "VAMOS A CREAR UN PROYECTO NUEVO",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.equal(plan.conversationOnly, true);
  assert.deepEqual(plan.allowedTools, []);
});

test("crea el proyecto ahora usa implementador", () => {
  const profile = resolveAgentRunProfile({
    prompt: "CREA EL PROYECTO AHORA con README y package.json",
    analysisMode: false,
    allowWrite: true,
  });
  assert.equal(profile.phase, PHASES.EXECUTE);
  assert.equal(profile.subAgent, SUB_AGENTS.IMPLEMENTER);
  assert.equal(profile.promptOnlyMode, false);
  assert.equal(profile.greenfieldCreate, true);
});

test("tickets para eventos usa chat con modelo, no respuesta local", () => {
  const prompt = "QUIERO CREAR UN PROYECTO DE TICKETS PARA EVENTOS";
  assert.equal(ProjectAnalysis.shouldAnalyzePromptFirst(prompt), true);
  assert.equal(ProjectAnalysis.isProjectIntentComment(prompt), false);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.equal(plan.conversationOnly, false);
});

test("que haremos es seguimiento conversacional sin agente", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "QUE HAREMOS",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.match(plan.chatConversationHint, /qu[eé] sigue/i);
});

test("steering de correccion fuerza chat de entendimiento", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "Analiza el proyecto",
    steeringInstruction: "NO ANALIZASTE MI PROMPT, primero entiende lo que pegue",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.match(plan.chatConversationHint, /producto o idea nueva|historial/i);
});
