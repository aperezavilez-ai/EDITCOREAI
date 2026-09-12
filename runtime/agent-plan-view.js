"use strict";

(function exposeAgentPlanView(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreAgentPlanView = api;
})(typeof window !== "undefined" ? window : globalThis, function createAgentPlanView() {
  function extractPlanTodos(planText = "") {
    const text = String(planText || "");
    const todos = [];
    const lineRe = /^\s*(?:[-*]|\d+[.)])\s+(.+)$/gm;
    let match;
    while ((match = lineRe.exec(text)) && todos.length < 24) {
      const label = String(match[1] || "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!label) continue;
      todos.push({ id: `plan-${todos.length + 1}`, label, status: "pending", source: "plan" });
    }
    return todos;
  }

  function stepPath(step = {}) {
    return String(step.input?.path || step.result?.path || "").replace(/\\/g, "/");
  }

  function isRoadmapPath(filePath = "") {
    return /(^|\/)ROADMAP\.md$|(^|\/)\.editcore\/context\.md$/i.test(String(filePath || "").replace(/\\/g, "/"));
  }

  function isRoadmapReadStep(step = {}) {
    return String(step.name || "") === "read_file" && isRoadmapPath(stepPath(step));
  }

  function isRoadmapStep(step = {}) {
    const name = String(step.name || "");
    if (isRoadmapReadStep(step)) return true;
    if (!["write_file", "replace_in_file", "apply_diff"].includes(name)) return false;
    return isRoadmapPath(stepPath(step));
  }

  function buildLiveTodosFromSteps(steps = [], planText = "") {
    const todos = extractPlanTodos(planText);
    const okSteps = (Array.isArray(steps) ? steps : []).filter(Boolean);
    const byName = new Map();
    for (const step of okSteps) {
      const name = String(step.name || "step");
      const list = byName.get(name) || [];
      list.push(step);
      byName.set(name, list);
    }
    const toTodo = (item, hits) => {
      const failed = hits.some((step) => step.ok === false);
      const done = hits.some((step) => step.ok !== false);
      return {
        id: item.id,
        label: item.label,
        status: failed ? "error" : done ? "done" : "pending",
        source: "runtime",
        count: hits.length,
      };
    };
    const live = [
      { id: "discover", label: "Explorar / leer contexto", match: ["list_files", "read_file", "search_files", "semantic_search", "run_parallel_explore", "codebase_map", "project_discovery"] },
      { id: "roadmap", label: "Roadmap: leer/crear al inicio y actualizar al cerrar", match: [] },
      { id: "mutate", label: "Escribir cambios", match: ["write_file", "replace_in_file", "create_project", "apply_diff"] },
      { id: "verify", label: "Verificar (preview/diagnosticos)", match: ["run_command", "run_diagnostics", "inspect_preview", "inspect_browser", "browser_interact"] },
    ].map((item) => {
      const hits = item.id === "roadmap"
        ? okSteps.filter(isRoadmapStep)
        : item.match.flatMap((name) => byName.get(name) || []);
      return toTodo(item, hits);
    });
    const deployHits = ["deploy_one_click", "publish_project"].flatMap((name) => byName.get(name) || []);
    if (deployHits.length) live.push(toTodo({ id: "deploy", label: "Publicar / deploy" }, deployHits));
    return [...todos.slice(0, 12), ...live];
  }

  function formatCheckpoints(checkpoints = []) {
    return (Array.isArray(checkpoints) ? checkpoints : []).slice(-8).map((row, index) => ({
      id: `cp-${index}`,
      label: String(row.name || row.description || row.type || `checkpoint ${index + 1}`).slice(0, 120),
      ok: row.ok !== false,
      at: row.updatedAt || row.at || "",
    }));
  }

  return {
    extractPlanTodos,
    buildLiveTodosFromSteps,
    formatCheckpoints,
    isRoadmapStep,
    isRoadmapReadStep,
  };
});
