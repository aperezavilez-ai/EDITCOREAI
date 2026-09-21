"use strict";

/**
 * Contrato de pase entre agentes. Evita que el editor reescriba el mundo
 * a partir de prosa del researcher.
 */

function emptyHandOff(goal = "") {
  return {
    version: 1,
    goal: String(goal || ""),
    constraints: [],
    facts: [],
    open_questions: [],
    artifacts: [],
    next_role: "editor",
    forbidden: ["inventar cifras", "inventar rutas", "afirmar tools no ejecutadas"],
    actions_taken: [],
  };
}

function fact(claim, source) {
  return {
    claim: String(claim || "").trim(),
    source: source ? String(source) : undefined,
  };
}

function fromSteps(goal, steps = []) {
  const handoff = emptyHandOff(goal);
  for (const step of steps) {
    const name = step?.name || "";
    const ok = step?.ok !== false && step?.result?.ok !== false;
    const path = step?.input?.path || step?.result?.path;
    handoff.actions_taken.push({
      tool: name,
      ok: !!ok,
      path: path || undefined,
      error: ok ? undefined : String(step?.error || step?.result?.error || ""),
    });
    if (!ok) continue;
    if (name === "read_file" && path) {
      handoff.facts.push(fact(`Leido ${path}`, `read_file:${path}`));
      handoff.artifacts.push({ id: path, type: "file_read", path });
    }
    if ((name === "write_file" || name === "replace_in_file") && path) {
      handoff.facts.push(fact(`Mutado ${path} via ${name}`, `${name}:${path}`));
      handoff.artifacts.push({ id: path, type: "file_write", path });
    }
    if (name === "list_files") {
      const files = step?.result?.files;
      if (Array.isArray(files)) {
        handoff.facts.push(fact(`list_files=${files.slice(0, 40).join(", ")}`, "list_files"));
      }
    }
  }
  return handoff;
}

function promptBlock(handoff) {
  const data = handoff && typeof handoff === "object" ? handoff : emptyHandOff();
  return [
    "HANDOFF_JSON (unica fuente de facts entre agentes):",
    "```json",
    JSON.stringify(data, null, 2),
    "```",
    "No reinvestigues facts ya citados. No agregues facts sin tool nueva.",
  ].join("\n");
}

function merge(a = {}, b = {}) {
  const out = emptyHandOff(b.goal || a.goal);
  out.constraints = [...new Set([...(a.constraints || []), ...(b.constraints || [])])];
  out.facts = [...(a.facts || []), ...(b.facts || [])];
  out.open_questions = [...new Set([...(a.open_questions || []), ...(b.open_questions || [])])];
  out.artifacts = [...(a.artifacts || []), ...(b.artifacts || [])];
  out.actions_taken = [...(a.actions_taken || []), ...(b.actions_taken || [])];
  out.next_role = b.next_role || a.next_role || "editor";
  out.forbidden = [...new Set([...(a.forbidden || []), ...(b.forbidden || [])])];
  return out;
}

module.exports = {
  emptyHandOff,
  fact,
  fromSteps,
  promptBlock,
  merge,
};
