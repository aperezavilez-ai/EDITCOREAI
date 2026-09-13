"use strict";

const crypto = require("node:crypto");

function id(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value || crypto.randomUUID())).digest("hex").slice(0, 24)}`;
}

function unique(values = []) { return [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))]; }

class PlanEngine {
  constructor({ manager = null } = {}) { this.manager = manager; }

  create(input = {}) {
    const taskId = String(input.taskId || "");
    const objective = String(input.objective || input.goal || "").trim();
    if (!objective) throw new Error("El plan requiere un objetivo.");
    const requested = Array.isArray(input.steps) ? input.steps : [];
    const steps = requested.map((step, index) => {
      const source = typeof step === "string" ? { goal: step } : step || {};
      const planStepId = String(source.planStepId || id("planstep", `${taskId}:${index + 1}:${source.goal || source.title}`));
      return {
        planStepId,
        sequence: index + 1,
        title: String(source.title || source.goal || `Paso ${index + 1}`).slice(0, 200),
        goal: String(source.goal || source.title || "").slice(0, 800),
        stage: String(source.stage || (index === 0 ? "discovery" : "implementation")),
        files: unique(source.files || source.targetFiles || []),
        symbols: unique(source.symbols || []),
        dependencies: unique(source.dependencies || []),
        requiredTools: unique(source.requiredTools || []),
        successCriteria: unique(source.successCriteria || []),
        verification: unique(source.verification || []),
        risk: String(source.risk || "low"),
        status: "PENDING",
        evidenceReference: "",
      };
    });
    if (!steps.length) throw new Error("El plan requiere al menos un paso estructurado.");
    const plan = {
      planId: String(input.planId || id("plan", `${taskId}:${objective}:${JSON.stringify(steps)}`)),
      taskId,
      objective,
      strategy: String(input.strategy || "minimum-sufficient-context"),
      risks: unique(input.risks || []),
      successCriteria: unique(input.successCriteria || []),
      verification: unique(input.verification || []),
      steps,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    if (this.manager && taskId) {
      const reference = this.manager.reference(plan, { kind: "engineering-plan", taskId, planId: plan.planId });
      this.manager.updateTask(taskId, {
        currentStage: "planning",
        planReference: reference,
        nextAction: { type: "PLAN_STEP", description: steps[0].goal, targetFiles: steps[0].files, requiredTools: steps[0].requiredTools, dependsOn: steps[0].dependencies, status: "PENDING" },
      });
      this.manager.recordRuntimeEvent(taskId, "PLAN_CREATED", { payloadReference: reference, metadata: { planId: plan.planId, stepCount: steps.length } });
      return { ...plan, reference };
    }
    return plan;
  }

  completeStep(plan, planStepId, evidenceReference) {
    const step = plan?.steps?.find((item) => item.planStepId === planStepId);
    if (!step) throw new Error(`Paso de plan inexistente: ${planStepId}`);
    if (!evidenceReference) throw new Error("Un paso no puede completarse sin evidencia.");
    step.status = "COMPLETED";
    step.evidenceReference = String(evidenceReference);
    if (plan.steps.every((item) => item.status === "COMPLETED")) plan.status = "COMPLETED";
    return plan;
  }

  recordEvidence(plan, input = {}) {
    if (!plan?.steps?.length || !input.evidenceReference) return plan;
    const tool = String(input.tool || "");
    const stage = String(input.stage || "");
    const file = String(input.file || "");
    const step = plan.steps.find((item) => item.status === "PENDING" && (
      item.requiredTools.includes(tool)
      || (file && item.files.includes(file))
      || (!item.requiredTools.length && item.stage === stage)
    )) || plan.steps.find((item) => item.status === "PENDING" && item.dependencies.every((dependency) => plan.steps.some((candidate) => candidate.planStepId === dependency && candidate.status === "COMPLETED")));
    return step ? this.completeStep(plan, step.planStepId, input.evidenceReference) : plan;
  }
}

module.exports = { PlanEngine };
