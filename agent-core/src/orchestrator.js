"use strict";

const { planTask } = require("./planner");
const { runPlan } = require("./worker");
const { verifyAndReport } = require("./verifier");
const { isFullAccess } = require("./classify");

const CORE_VERSION = "0.2.15";

/**
 * Orquestador unico del Agent Core.
 * Acceso completo → sin pending/CONFIRM: planAuthorized + allowWrite forzados.
 * @param {object} input — ver CONTRACT.md (+ providerApi opcional en v0.2)
 * @returns {Promise<object>} AgentRunResult
 */
async function runAgent(input = {}, maybeOptions = {}) {
  const started = Date.now();
  if (typeof input === "string") {
    input = { prompt: input, ...(maybeOptions || {}) };
  }
  if (!input.tools?.execute) {
    const fs = require("node:fs");
    const path = require("node:path");
    input.tools = {
      execute: async (name, args = {}) => {
        if (name === "list_files") {
          const root = String(args.path || input.projectRoot || ".");
          try {
            return fs.readdirSync(root).map((f) => ({ name: f, path: path.join(root, f) }));
          } catch { return []; }
        }
        if (name === "read_file") {
          try {
            return { path: args.path, content: fs.readFileSync(args.path, "utf8") };
          } catch { return { path: args.path, content: "" }; }
        }
        return { ok: true, name, args };
      },
    };
  }

  const fullAccess = isFullAccess(input);
  if (fullAccess) {
    input.allowWrite = true;
    input.planAuthorized = true;
    input.planAuthorizedExecution = true;
    input.permissionFull = true;
    input.fullAccess = true;
    input.permissionMode = input.permissionMode || "full";
    input.pendingTask = null;
    input.skipConfirm = true;
  } else if (input.planAuthorized === true || input.planAuthorizedExecution === true) {
    input.allowWrite = true;
    input.skipConfirm = true;
  }

  const plan = planTask(input);
  if (fullAccess && plan.mode === "execute") {
    plan.allowMutation = true;
    plan.skipConfirm = true;
  }

  input.onProgress?.({
    type: "start",
    phase: "startup",
    text: `Agent Core v${CORE_VERSION} · plan ${plan.mode} (${(plan.steps || []).length} pasos)${fullAccess ? " · Acceso completo" : ""}`,
  });

  const ran = await runPlan(plan, input);
  const steps = ran.steps || [];
  const verified = verifyAndReport({
    plan,
    steps,
    input,
    finalText: ran.finalText || "",
  });

  const isBudgetStop = ran.reason === "wall_timeout" || ran.reason === "tool_budget" || ran.reason === "token_budget";
  const reason = isBudgetStop
    ? ran.reason
    : (verified.completed ? "done" : "tool_budget");

  input.onProgress?.({
    type: verified.completed ? "sufficient" : "done",
    phase: "complete",
    text: verified.text,
  });

  return {
    text: verified.text,
    completed: verified.completed === true,
    ok: verified.completed === true || isBudgetStop,
    mode: plan.mode,
    steps: steps.length,
    stepsList: steps,
    toolCalls: steps.length,
    reason,
    stopReason: verified.stopReason || reason,
    usage: {
      stepsExecuted: steps.length,
      provider_calls: Number(ran.providerCalls || 0),
      elapsedMs: Date.now() - started,
      coreVersion: CORE_VERSION,
      fullAccess: fullAccess || undefined,
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
  isFullAccess,
};
