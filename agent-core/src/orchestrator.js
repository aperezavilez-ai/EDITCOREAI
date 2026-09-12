"use strict";

const { planTask } = require("./planner");
const { runPlan } = require("./worker");
const { verifyAndReport } = require("./verifier");

const CORE_VERSION = "0.2.14";

/**
 * Orquestador unico del Agent Core.
 * @param {object} input — ver CONTRACT.md (+ providerApi opcional en v0.2)
 * @returns {Promise<object>} AgentRunResult
 */
async function runAgent(input = {}) {
  const started = Date.now();
  if (!input.tools?.execute) {
    throw new Error("runAgent: falta tools.execute (EDITCOREAI debe inyectar el ToolDispatcher).");
  }

  const plan = planTask(input);
  input.onProgress?.({
    phase: "startup",
    text: `Agent Core v${CORE_VERSION} · plan ${plan.mode} (${(plan.steps || []).length} pasos)`,
  });

  const ran = await runPlan(plan, input);
  const steps = ran.steps || [];
  const verified = verifyAndReport({
    plan,
    steps,
    input,
    finalText: ran.finalText || "",
  });

  return {
    text: verified.text,
    completed: verified.completed === true,
    mode: plan.mode,
    steps,
    stopReason: verified.stopReason || "",
    usage: {
      stepsExecuted: steps.length,
      provider_calls: Number(ran.providerCalls || 0),
      elapsedMs: Date.now() - started,
      coreVersion: CORE_VERSION,
    },
    report: {
      completed: verified.completed === true,
      outcome: verified.completed ? "completed" : "incomplete",
      stopReason: verified.stopReason,
      toolCount: steps.length,
      failedSteps: steps.filter((s) => !s.ok).length,
      mutated: steps.some((s) => ["write_file", "replace_in_file", "delete_file"].includes(s.name) && s.ok),
      mutatedPaths: [...new Set(
        steps
          .filter((s) => ["write_file", "replace_in_file", "delete_file"].includes(s.name) && s.ok)
          .map((s) => String(s.input?.path || s.result?.path || "").replace(/\\/g, "/"))
          .filter(Boolean),
      )],
      evidenceToolsOk: steps.filter((s) => s.ok).length,
      evidenceToolsFailed: steps.filter((s) => !s.ok).length,
    },
  };
}

module.exports = {
  runAgent,
  planTask,
  CORE_VERSION,
};
