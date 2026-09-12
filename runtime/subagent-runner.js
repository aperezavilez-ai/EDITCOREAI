"use strict";

const { unifiedSearch } = require("./unified-search");
const { semanticSearch } = require("./semantic-index");
const { runBoundedImplement } = require("./bounded-implementer");
const { rememberProjectEvent } = require("./project-memory");

/**
 * Sub-agentes acotados y seguros (sin deps de pago):
 * - explorer: solo lectura
 * - implementer: max 5 patches, rutas bloqueadas para secretos
 */
async function runParallelExplore(projectRoot, input = {}, { brain = null } = {}) {
  const query = String(input.query || input.goal || "").trim();
  if (!query) throw new Error("run_parallel_explore requiere query/goal.");
  const started = Date.now();
  const tasks = [
    unifiedSearch({ projectRoot, query, limit: 12, brain }).then((result) => ({
      agent: "searcher",
      ok: true,
      result,
    })).catch((error) => ({
      agent: "searcher",
      ok: false,
      error: String(error?.message || error),
    })),
    semanticSearch(projectRoot, query, { limit: 10 }).then((result) => ({
      agent: "semantic-explorer",
      ok: true,
      result,
    })).catch((error) => ({
      agent: "semantic-explorer",
      ok: false,
      error: String(error?.message || error),
    })),
  ];

  if (input.includeGithub === true && input.githubQuery) {
    tasks.push(Promise.resolve({
      agent: "github-scout",
      ok: true,
      result: {
        deferred: true,
        message: "Usa github_search_repos / github_read_file desde el agente principal con esta query.",
        query: String(input.githubQuery),
      },
    }));
  }

  const settled = await Promise.all(tasks);
  const files = [];
  const seen = new Set();
  for (const row of settled) {
    if (!row.ok) continue;
    const localFiles = row.result?.files || row.result?.local || [];
    for (const hit of localFiles) {
      const key = hit.path || hit.title || JSON.stringify(hit);
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ ...hit, via: row.agent });
    }
  }

  if (projectRoot && files.length) {
    try {
      const filePaths = files.map((f) => String(f.path || f.title || "").trim()).filter(Boolean);
      rememberProjectEvent(projectRoot, {
        task: `[Subagente Exploración] ${query}`.slice(0, 240),
        summary: `Subagentes exploraron ${files.length} archivos relevantes.`,
        files: filePaths,
      });
    } catch {}
  }

  return {
    mode: "parallel-explore",
    query,
    durationMs: Date.now() - started,
    agents: settled,
    mergedFiles: files.slice(0, 30),
    write: false,
    note: "Sub-agentes de solo lectura.",
  };
}

async function runSubagent(projectRoot, input = {}, ctx = {}) {
  const role = String(input.role || "explorer").toLowerCase();
  if (role === "implementer" || role === "writer") {
    const res = await runBoundedImplement(projectRoot, input, ctx);
    if (projectRoot && res && res.ok && Array.isArray(res.applied)) {
      try {
        const writtenFiles = res.applied.filter((p) => p.ok).map((p) => p.path);
        rememberProjectEvent(projectRoot, {
          task: `[Subagente Implementer] ${input.task || input.goal || "Parches"}`.slice(0, 240),
          summary: `Subagente aplicó parches en ${writtenFiles.length} archivo(s).`,
          files: writtenFiles,
          decision: "Parches aplicados por subagente implementer",
        });
      } catch {}
    }
    return res;
  }
  return runParallelExplore(projectRoot, {
    query: input.query || input.goal || input.task,
    includeGithub: input.includeGithub === true,
    githubQuery: input.githubQuery || "",
  }, ctx);
}

module.exports = { runParallelExplore, runSubagent, runBoundedImplement };
