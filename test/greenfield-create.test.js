"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ProjectAnalysis = require("../project-analysis");
const { resolveAgentRunProfile, resolveUnifiedAgentPlan, PHASES, SUB_AGENTS, MODES } = require("../runtime/intent-orchestrator");

test("comentario vamos a crear es conversacion, no ejecucion", () => {
  const prompt = "VAMOS A CREAR UN PROYECTO NUEVO";
  assert.equal(ProjectAnalysis.isProjectIntentComment(prompt), true);
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), false);
  assert.equal(ProjectAnalysis.shouldAnalyzePromptFirst(prompt), false);
  assert.equal(ProjectAnalysis.classifyPromptIntent(prompt), "conversation");
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.equal(plan.conversationOnly, true);
});

test("quiero crear proyecto nuevo es comentario, no orden de escritura", () => {
  const prompt = "QUIERO CREAR UN PROYECTO NUEVO";
  assert.equal(ProjectAnalysis.isProjectIntentComment(prompt), true);
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), false);
});

test("crea el proyecto ahora si es ejecucion greenfield", () => {
  const prompt = "CREA EL PROYECTO AHORA con README y package.json";
  assert.equal(ProjectAnalysis.isProjectIntentComment(prompt), false);
  assert.equal(ProjectAnalysis.isVagueGreenfieldRequest(prompt), false);
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), true);
  const profile = resolveAgentRunProfile({ prompt, analysisMode: false, allowWrite: true });
  assert.equal(profile.phase, PHASES.EXECUTE);
  assert.equal(profile.greenfieldCreate, true);
  assert.equal(profile.promptOnlyMode, false);
});

test("spec larga sin implementar sigue en prompt-first", () => {
  const prompt = [
    "Quiero crear una app de tickets para eventos con registro, venta QR y panel admin.",
    "Stack React + Node. ANALIZA, DISEÑA, DOCUMENTA, NO IMPLEMENTES.",
  ].join(" ");
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), false);
  assert.equal(ProjectAnalysis.shouldAnalyzePromptFirst(prompt), true);
});

test("tickets corto no es comentario vacio", () => {
  const prompt = "QUIERO CREAR UN PROYECTO DE TICKETS PARA EVENTOS";
  assert.equal(ProjectAnalysis.isProjectIntentComment(prompt), false);
  assert.equal(ProjectAnalysis.shouldAnalyzePromptFirst(prompt), true);
});

test("solo crea el proyecto activa greenfield", () => {
  const prompt = "NO QUIERO CONECTAR AUN, SOLO CREA EL PROYECTO";
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), true);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.greenfieldCreate, true);
});

test("continua proyecto incompleto activa greenfield", () => {
  const prompt = "HAY QUE CONTINUAR CON EL PROYECTO TICKETIA";
  assert.equal(ProjectAnalysis.isGreenfieldContinuationRequest(prompt, { scaffoldIncomplete: true }), true);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    scaffoldIncomplete: true,
  });
  assert.equal(plan.greenfieldCreate, true);
});

test("app web con readme y package.json es vago y pregunta antes de escribir", () => {
  const prompt = "Crea una app web con README y package.json";
  assert.equal(ProjectAnalysis.isVagueGreenfieldRequest(prompt), true);
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), false);
  assert.equal(ProjectAnalysis.shouldAnalyzePromptFirst(prompt), true);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.greenfieldCreate, false);
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.match(plan.chatConversationHint, /NO escribas archivos/i);
});

test("ayudame a pensar sobre el proyecto es brainstorm con el modelo, no plantilla", () => {
  const prompt = "QUIERO QUE ME AYUDES A PENSAR SOBRE MI NUEVO PROYECTO PARA CREARLO DESDE CERO";
  assert.equal(ProjectAnalysis.isProjectBrainstormRequest(prompt), true);
  assert.equal(ProjectAnalysis.isVagueGreenfieldRequest(prompt), false);
  assert.equal(ProjectAnalysis.shouldAnalyzePromptFirst(prompt), true);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.usesProjectTools, false);
  assert.match(plan.chatConversationHint, /socio de producto|turno a turno/i);
});

test("renderer ya no responde greenfield vago con texto prestablecido local", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "renderer.js"), "utf8");
  assert.doesNotMatch(source, /Preguntas enviadas · 0 tokens de API/);
  assert.doesNotMatch(source, /aún no está claro \*\*qué producto\*\* construir/);
});

test("renderer restaura marcadores de tokens bajo cada respuesta", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(source, /function usageMetaText\(usage\)/);
  assert.match(source, /cache proveedor/);
  assert.match(source, /entrada neta aprox/);
  assert.doesNotMatch(source, /function usageMetaText\(usage\) \{\s*void usage;\s*return "";\s*\}/);
});

test("esqueleto minimo explicito si permite greenfield", () => {
  const prompt = "CREA AHORA un esqueleto minimo con README y package.json";
  assert.equal(ProjectAnalysis.isVagueGreenfieldRequest(prompt), false);
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), true);
});

test("findOriginalUserRequest ignora procede y recupera spec del chat", () => {
  const project = {
    messages: [
      { role: "user", content: "PROCEDE FASE 1" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "Quiero una app TicketIA con registro, venta QR y panel admin en React y Node." },
    ],
    agentWorkflow: { task: "PROCEDE FASE 1" },
  };
  const original = ProjectAnalysis.findOriginalUserRequest(project);
  assert.match(original, /TicketIA/i);
  assert.doesNotMatch(original, /PROCEDE/i);
});
