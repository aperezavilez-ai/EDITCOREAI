"use strict";

/**
 * Convierte agent:progress / complete en eventos granulares estilo Cursor
 * para que el chat muestre pensamiento, exploración y diffs en tiempo real.
 */

const EXPLORE_TOOLS = new Set([
  "list_files",
  "read_file",
  "search_files",
  "grep",
  "codebase_map",
  "project_discovery",
  "brain_search",
  "semantic_search",
  "index_search",
]);

const MUTATE_TOOLS = new Set([
  "write_file",
  "replace_in_file",
  "apply_diff",
  "delete_file",
  "create_project",
]);

function countDiffLines(unifiedDiff = "") {
  let additions = 0;
  let deletions = 0;
  for (const line of String(unifiedDiff || "").split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function extractTarget(progress = {}) {
  const input = progress.input && typeof progress.input === "object" ? progress.input : {};
  return String(
    input.path
    || input.filePath
    || input.query
    || input.pattern
    || input.command
    || progress.target
    || "",
  ).trim();
}

function buildSnippetDiff(progress = {}) {
  const name = String(progress.name || "");
  const input = progress.input && typeof progress.input === "object" ? progress.input : {};
  const filePath = extractTarget(progress);
  if (!filePath) return null;

  let unifiedDiff = String(progress.diff || progress.unifiedDiff || input.diff || "").trim();
  if (!unifiedDiff && name === "replace_in_file") {
    const oldText = String(input.oldText || "");
    const newText = String(input.newText || "");
    if (oldText || newText) {
      const rel = filePath.replace(/\\/g, "/");
      const lines = [`--- a/${rel}`, `+++ b/${rel}`, "@@"];
      for (const line of oldText.split("\n")) lines.push(`-${line}`);
      for (const line of newText.split("\n")) lines.push(`+${line}`);
      unifiedDiff = lines.join("\n");
    }
  } else if (!unifiedDiff && name === "write_file") {
    const content = String(input.content || "").slice(0, 12000);
    if (content) {
      const rel = filePath.replace(/\\/g, "/");
      const lines = [`--- a/${rel}`, `+++ b/${rel}`, "@@"];
      for (const line of content.split("\n").slice(0, 80)) lines.push(`+${line}`);
      unifiedDiff = lines.join("\n");
    }
  }

  if (!unifiedDiff) {
    return {
      filePath,
      additions: Number(progress.additions) || 0,
      deletions: Number(progress.deletions) || 0,
      unifiedDiff: "",
      summary: progress.summary || filePath,
    };
  }
  const counts = countDiffLines(unifiedDiff);
  return {
    filePath,
    additions: Number(progress.additions) || counts.additions,
    deletions: Number(progress.deletions) || counts.deletions,
    unifiedDiff: unifiedDiff.slice(0, 24000),
    summary: progress.summary || filePath,
  };
}

function createAgentTransparencyEmitter(sender, { runId = "", projectId = "", projectRoot = "" } = {}) {
  const explored = new Map();
  let exploreOpen = false;
  let lastThought = "";

  function safeSend(channel, payload) {
    try {
      if (!sender || sender.isDestroyed?.()) return;
      sender.send(channel, {
        runId,
        projectId,
        projectRoot,
        at: Date.now(),
        ...(payload && typeof payload === "object" ? payload : { value: payload }),
      });
    } catch {
      /* ignore */
    }
  }

  function emitThought(text, { delta = false } = {}) {
    const value = String(text || "");
    if (!value.trim()) return;
    if (!delta && value === lastThought) return;
    lastThought = value.slice(-4000);
    safeSend("agent:thought-stream", { text: value, delta: Boolean(delta) });
  }

  function emitFromProgress(progress = {}) {
    const phase = String(progress.phase || "");
    const name = String(progress.name || "");
    const stage = String(progress.stage || (progress.ok === undefined ? "running" : progress.ok ? "done" : "failed"));
    const target = extractTarget(progress);

    // narration / narration_delta ya los pinta el renderer vía agent:progress.
    // Re-emitir a thought-stream duplicaba cada token en _streamBuffer ("VoyVoy…").
    if (phase === "narration_delta" || phase === "narration" || phase === "final_report") {
      return;
    }
    if (phase === "specialist" || phase === "subagent" || phase === "direction") {
      if (progress.text) emitThought(String(progress.text), { delta: false });
    }

    const isTool = phase === "tool" || (!phase && name);
    if (!isTool || !name) return;

    if (EXPLORE_TOOLS.has(name)) {
      if (stage === "running" || progress.ok === undefined) {
        if (!exploreOpen) {
          exploreOpen = true;
          safeSend("agent:exploration-start", {
            tool: name,
            query: target,
            detail: target || name,
          });
        }
        const key = `${name}:${target || "*"}`;
        if (!explored.has(key)) {
          explored.set(key, {
            tool: name,
            path: target || "",
            query: name.includes("search") || name === "grep" ? target : "",
            label: target || name.replace(/_/g, " "),
          });
        }
      }
      if (stage === "done" || progress.ok === true || progress.ok === false) {
        if (target) {
          const key = `${name}:${target}`;
          explored.set(key, {
            tool: name,
            path: target,
            query: name.includes("search") || name === "grep" ? target : "",
            label: target,
            ok: progress.ok !== false,
          });
        }
        exploreOpen = false;
        safeSend("agent:exploration-end", {
          tool: name,
          summary: `Explored ${explored.size} file${explored.size === 1 ? "" : "s"}`,
          count: explored.size,
          items: [...explored.values()].slice(-40),
        });
      }
      return;
    }

    if (MUTATE_TOOLS.has(name)) {
      const diffPayload = buildSnippetDiff(progress);
      if (stage === "running" || progress.ok === undefined) {
        if (diffPayload) safeSend("agent:diff-proposed", diffPayload);
        return;
      }
      if (stage === "done" || progress.ok === true) {
        if (diffPayload?.unifiedDiff) safeSend("agent:diff-proposed", diffPayload);
        safeSend("agent:diff-applied", {
          filePath: diffPayload?.filePath || target,
          ok: true,
        });
      }
    }
  }

  function emitTaskComplete(ok = true, extra = {}) {
    safeSend("agent:task-complete", { ok: Boolean(ok), ...extra });
  }

  return {
    emitFromProgress,
    emitThought,
    emitTaskComplete,
    explored,
  };
}

function attachTransparencyToProgress(sender, basePayload, progress) {
  const runId = String(basePayload?.runId || progress?.runId || "");
  const projectId = String(basePayload?.projectId || progress?.projectId || "");
  const projectRoot = String(basePayload?.projectRoot || progress?.projectRoot || "");
  const key = `${sender?.id || 0}:${runId || "anon"}`;
  if (!attachTransparencyToProgress._cache) attachTransparencyToProgress._cache = new Map();
  let emitter = attachTransparencyToProgress._cache.get(key);
  if (!emitter) {
    emitter = createAgentTransparencyEmitter(sender, { runId, projectId, projectRoot });
    attachTransparencyToProgress._cache.set(key, emitter);
    if (attachTransparencyToProgress._cache.size > 40) {
      const first = attachTransparencyToProgress._cache.keys().next().value;
      attachTransparencyToProgress._cache.delete(first);
    }
  }
  emitter.emitFromProgress(progress);
  return emitter;
}

module.exports = {
  EXPLORE_TOOLS,
  MUTATE_TOOLS,
  countDiffLines,
  buildSnippetDiff,
  createAgentTransparencyEmitter,
  attachTransparencyToProgress,
};
