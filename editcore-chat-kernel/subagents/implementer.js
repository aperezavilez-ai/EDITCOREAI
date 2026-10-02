"use strict";

const tools = require("../tools");
const { snapshotBeforeWrite } = require("../snapshot");

/**
 * Implementer quirúrgico: snapshot previo + replace_in_file preferente.
 */
async function runImplementer({ projectRoot, path: rel, content, oldText, newText, onProgress }) {
  if (!rel) return { role: "implementer", ok: false, error: "Falta path" };
  onProgress?.({ phase: "subagent", name: "implementer", text: `Editando ${rel}...` });

  // Checkpoint explícito antes de mutar (tools.write/replace también crean snapshot)
  const pre = snapshotBeforeWrite(projectRoot, rel, "implementer");
  onProgress?.({
    phase: "tool",
    name: "snapshot",
    ok: pre.ok !== false,
    input: { path: rel, snapshotId: pre.id || null },
  });

  if (oldText != null && newText != null) {
    const result = tools.replaceInFile(projectRoot, rel, String(oldText), String(newText));
    onProgress?.({ phase: "tool", stage: "done", name: "replace_in_file", ok: result.ok, input: { path: rel } });
    return {
      role: "implementer",
      ok: result.ok,
      result: { ...result, snapshotId: result.snapshotId || pre.id || null },
      mode: "replace",
      snapshotId: result.snapshotId || pre.id || null,
    };
  }

  const existing = tools.readFile(projectRoot, rel, 50);
  if (existing.ok && content != null) {
    const result = tools.writeFile(projectRoot, rel, content);
    onProgress?.({ phase: "tool", stage: "done", name: "write_file", ok: result.ok, input: { path: rel } });
    return {
      role: "implementer",
      ok: result.ok,
      result: { ...result, snapshotId: result.snapshotId || pre.id || null },
      mode: "overwrite",
      snapshotId: result.snapshotId || pre.id || null,
    };
  }

  const result = tools.writeFile(projectRoot, rel, content ?? "");
  onProgress?.({ phase: "tool", stage: "done", name: "write_file", ok: result.ok, input: { path: rel } });
  return {
    role: "implementer",
    ok: result.ok,
    result: { ...result, snapshotId: result.snapshotId || pre.id || null },
    mode: "create",
    snapshotId: result.snapshotId || pre.id || null,
  };
}

module.exports = { runImplementer };
