"use strict";

/**
 * Persist external web/RAG knowledge into BrainMemoryStore (global by default).
 */

const EXTERNAL_TOOLS = new Set([
  "fetch_url",
  "github_repo_info",
  "github_list_files",
  "github_read_file",
  "github_search_repos",
  "mcp_invoke",
  "brain_install_repo",
  "brain_search",
  "search",
  "semantic_search",
  "clone_web_page",
  "images_to_code",
]);

function summarizeToolResult(name, result) {
  if (result == null) return "";
  if (typeof result === "string") return result.slice(0, 6000);
  try {
    return JSON.stringify(result, null, 2).slice(0, 6000);
  } catch {
    return String(result).slice(0, 6000);
  }
}

function shouldPersistTool(name, result) {
  if (!EXTERNAL_TOOLS.has(String(name || ""))) return false;
  const text = summarizeToolResult(name, result);
  return text.length >= 80;
}

function createExternalKnowledgeHook({ brain = null, projectRoot = "" } = {}) {
  return {
    async afterToolSuccess(name, input = {}, result = {}) {
      if (!brain || !shouldPersistTool(name, result)) return null;
      const content = summarizeToolResult(name, result);
      const topic = String(input.query || input.url || input.path || input.tool || name).slice(0, 160);
      try {
        const saved = await brain.remember("", {
          scope: "global",
          type: "web_rag",
          title: `web/rag · ${name} · ${topic || "external"}`,
          content: `Fuente herramienta: ${name}\nInput: ${JSON.stringify(input).slice(0, 500)}\n\n${content}`,
          importance: 0.72,
          source: "web/rag",
        });
        // Best-effort RAG chunk for active project
        if (projectRoot && typeof brain.ingestExternalSnippet === "function") {
          await brain.ingestExternalSnippet(projectRoot, {
            path: `external/${name}/${Date.now()}.md`,
            text: content,
            title: topic,
          }).catch(() => null);
        }
        return saved;
      } catch {
        return null;
      }
    },
  };
}

function wrapDispatcherWithKnowledgePersist(dispatcher, hook) {
  if (!dispatcher || typeof dispatcher.dispatch !== "function" || !hook?.afterToolSuccess) return dispatcher;
  const original = dispatcher.dispatch.bind(dispatcher);
  dispatcher.dispatch = async (name, input = {}, context = {}) => {
    const record = await original(name, input, context);
    if (record?.ok) {
      try {
        await hook.afterToolSuccess(record.name || name, input, record.result);
      } catch {
        /* never break tools */
      }
    }
    return record;
  };
  return dispatcher;
}

module.exports = {
  EXTERNAL_TOOLS,
  createExternalKnowledgeHook,
  wrapDispatcherWithKnowledgePersist,
  shouldPersistTool,
  summarizeToolResult,
};
