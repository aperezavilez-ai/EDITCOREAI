"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Planner: escribe/actualiza .editcore/plan.json antes de implementar.
 */

function planPath(projectRoot) {
  return path.join(projectRoot, ".editcore", "plan.json");
}

function loadPlan(projectRoot) {
  const p = planPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function savePlan(projectRoot, plan) {
  const dir = path.join(projectRoot, ".editcore");
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    goal: String(plan.goal || ""),
    tasks: Array.isArray(plan.tasks) ? plan.tasks : [],
    architecture: plan.architecture || "",
    status: plan.status || "planned",
  };
  fs.writeFileSync(planPath(projectRoot), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

async function runPlanner({ projectRoot, goal, tasks, architecture, onProgress }) {
  onProgress?.({ phase: "subagent", name: "planner", text: "Diseñando plan de arquitectura..." });
  const normalizedTasks = (Array.isArray(tasks) && tasks.length
    ? tasks
    : [
      { id: "explore", title: "Mapear estructura y configs", status: "pending" },
      { id: "implement", title: "Aplicar cambios quirúrgicos", status: "pending" },
      { id: "verify", title: "Validar typecheck/build", status: "pending" },
    ]).map((t, i) => ({
    id: String(t.id || `t${i + 1}`),
    title: String(t.title || t),
    status: t.status || "pending",
  }));

  const plan = savePlan(projectRoot, {
    goal: goal || "Implementación solicitada",
    tasks: normalizedTasks,
    architecture: architecture || "Incremental, UI-first, sin reescrituras innecesarias.",
    status: "planned",
  });

  onProgress?.({ phase: "subagent", name: "planner", text: `Plan listo (${plan.tasks.length} tareas) → .editcore/plan.json` });
  return { role: "planner", ok: true, plan };
}

module.exports = { runPlanner, loadPlan, savePlan, planPath };
