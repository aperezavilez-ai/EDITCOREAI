"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveUnifiedAgentPlan,
  wantsExplicitFilesystemWork,
  isListOnlyRequest,
} = require("../runtime/intent-orchestrator");

test("Acceso completo + Agente lista rutas con herramientas (no chat vacio)", () => {
  for (const prompt of [
    "enlistame todo D:\\PROGRAMAS IA",
    "listar D:\\PROGRAMAS IA",
    "analiza el proyecto",
    "D:\\PROGRAMAS IA",
  ]) {
    const plan = resolveUnifiedAgentPlan({
      prompt,
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
      permissionMode: "full",
      cursorParityEnabled: true,
    });
    assert.equal(plan.usesProjectTools, true, `${prompt} => ${plan.mode} ${plan.reason}`);
    assert.notEqual(plan.mode, "chat", prompt);
  }
  assert.equal(wantsExplicitFilesystemWork("enlistame todo D:\\PROGRAMAS IA"), true);
  assert.equal(wantsExplicitFilesystemWork("listar D:\\PROGRAMAS IA"), true);
});

test("enlistar/listar es list-only; analizar no", () => {
  assert.equal(isListOnlyRequest("enlistame D:\\PROGRAMAS IA"), true);
  assert.equal(isListOnlyRequest("enlistame todo D:\\PROGRAMAS IA"), true);
  assert.equal(isListOnlyRequest("listar D:\\PROGRAMAS IA"), true);
  assert.equal(isListOnlyRequest("analiza el proyecto"), false);
  assert.equal(isListOnlyRequest("enlistame y analiza cada proyecto"), false);

  const listPlan = resolveUnifiedAgentPlan({
    prompt: "enlistame D:\\PROGRAMAS IA",
    requestedAgent: true,
    projectOpen: false,
    allowWrite: true,
    permissionMode: "full",
    cursorParityEnabled: true,
  });
  assert.equal(listPlan.listOnly, true);
  assert.equal(listPlan.runProfile.listOnly, true);
  assert.deepEqual(listPlan.allowedTools, ["list_files"]);
  assert.match(listPlan.statusLabel, /Listando/i);

  const analyzePlan = resolveUnifiedAgentPlan({
    prompt: "analiza el proyecto",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
    cursorParityEnabled: true,
  });
  assert.equal(analyzePlan.listOnly, false);
});

