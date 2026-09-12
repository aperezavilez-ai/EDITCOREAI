"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const ProjectAnalysis = require("../project-analysis");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");

test("acceso completo ejecuta greenfield sin tarea previa en orquestador", () => {
  const prompt = "CREA EL PROYECTO AHORA una app web con README y package.json";
  assert.equal(ProjectAnalysis.isGreenfieldCreateRequest(prompt), true);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    resumableTask: false,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.greenfieldCreate, true);
  assert.equal(plan.runProfile.permissionFull, true);
  assert.ok(plan.allowedTools.includes("search_files"));
  assert.equal(plan.skipBrain, false);
});

test("acceso completo no ejecuta greenfield con pedido vago", () => {
  const prompt = "Crea una app web con README y package.json";
  assert.equal(ProjectAnalysis.isVagueGreenfieldRequest(prompt), true);
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    resumableTask: false,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.greenfieldCreate, false);
  assert.equal(plan.usesProjectTools, false);
});

test("renderer expone allowsImmediateAgentExecution para acceso completo", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(source, /function allowsImmediateAgentExecution\(/);
  assert.match(source, /isFullAccessMode\(job\)\) return true/);
  assert.match(source, /immediateExecution/);
  assert.doesNotMatch(source, /!hasResumableAgentTask\(project\)\) \{\s*elapsedSeconds = stopTimer\(\);\s*removeThinking/);
});

test("cancelacion rechaza aprobaciones pendientes y limpia cola", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(renderer, /pendingAgentApprovalCards\.clear\(\)/);
  assert.match(renderer, /respondApproval\(\{ requestId, approved: false \}\)/);
  assert.match(renderer, /promptQueue = \[\]/);
  assert.match(main, /function rejectPendingApprovalsForSender/);
  assert.match(main, /rejectPendingApprovalsForSender\(senderId, false\)/);
});

test("acceso completo no pide confirmacion para comandos compuestos", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.match(main, /shouldRequireCommandConfirmation\(commandRisk,\s*\{\s*fullAccess\s*\}\)/);
  assert.doesNotMatch(main, /fullAccess\s*\?\s*await confirmRiskyAgentAction/);
});
