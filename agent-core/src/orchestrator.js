"use strict";

const { planTask } = require("./planner");
const { runPlan } = require("./worker");
const { verifyAndReport } = require("./verifier");
const { isFullAccess } = require("./classify");
const nodeFs = require("node:fs");
const nodePath = require("node:path");

// ============================================================
// HERRAMIENTAS EXTENDIDAS (v0.4.0)
// internet + git + skills + shell + acceso externo
// ============================================================
let extendedTools = null;
try {
  extendedTools = require("./tools-extended");
} catch (e) {
  // Si el archivo no existe, seguimos con las tools nativas.
  extendedTools = null;
}

const CORE_VERSION = "0.4.0";

// Lista de nombres de herramientas extendidas para chequeo rápido
const EXTENDED_TOOL_NAMES = new Set([
  "web_search",
  "web_fetch",
  "git_clone",
  "git_log",
  "git_status",
  "git_diff",
  "read_external_file",
  "write_external_file",
  "list_external_directory",
  "install_skill",
  "list_skills",
  "run_shell",
]);

// ============================================================
// TOOLS EXTENDIDAS (internet, git, skills, shell, archivos externos)
// ============================================================
async function executeExtended(name, args = {}) {
  if (!extendedTools || typeof extendedTools[name] !== "function") {
    return {
      ok: false,
      error: `Tool "${name}" no disponible. Verifica que agent-core/src/tools-extended.js exista y que axios/simple-git esten instalados.`,
    };
  }
  try {
    return await extendedTools[name](args);
  } catch (error) {
    return { ok: false, error: `Error en ${name}: ${error?.message || error}` };
  }
}

// ============================================================
// TOOLS NATIVAS DEL PROYECTO (disco, relativas a projectRoot)
// ============================================================
function buildNativeTools(projectRoot) {
  const resolveProjectPath = (p) => {
    if (!p) return projectRoot;
    if (nodePath.isAbsolute(p)) return p;
    return nodePath.join(projectRoot, p);
  };

  // Sin prototipo: un nombre como "toString" o "constructor" no debe resolverse a un método heredado.
  const tools = Object.create(null);

  tools.list_files = async (args) => {
    const root = resolveProjectPath(args.path || ".");
    try {
      const entries = nodeFs.readdirSync(root, { withFileTypes: true });
      return entries.map((f) => ({
        name: f.name,
        path: nodePath.join(root, f.name),
        isDirectory: f.isDirectory(),
        isFile: f.isFile(),
      }));
    } catch (error) {
      return { ok: false, error: `list_files fallo: ${error.message}`, path: root };
    }
  };

  tools.read_file = async (args) => {
    const p = resolveProjectPath(args.path);
    try {
      const stats = nodeFs.statSync(p);
      const maxBytes = 5 * 1024 * 1024;
      if (stats.size > maxBytes) {
        return { ok: false, error: `Archivo demasiado grande (${(stats.size / 1024 / 1024).toFixed(2)} MB)`, path: p };
      }
      let content = nodeFs.readFileSync(p, "utf8");
      let truncated = false;
      if (args.startLine || args.endLine) {
        const lines = content.split("\n");
        const start = Math.max(0, (args.startLine || 1) - 1);
        const end = args.endLine ? Math.min(lines.length, args.endLine) : lines.length;
        content = lines.slice(start, end).join("\n");
        truncated = true;
      }
      return { ok: true, path: p, content, truncated, totalLines: content.split("\n").length };
    } catch (error) {
      return { ok: false, error: `read_file fallo: ${error.message}`, path: p };
    }
  };

  tools.write_file = async (args) => {
    const p = resolveProjectPath(args.path);
    try {
      nodeFs.mkdirSync(nodePath.dirname(p), { recursive: true });
      nodeFs.writeFileSync(p, args.content || "", "utf8");
      return { ok: true, path: p, bytes: (args.content || "").length };
    } catch (error) {
      return { ok: false, error: `write_file fallo: ${error.message}`, path: p };
    }
  };

  tools.replace_in_file = async (args) => {
    const p = resolveProjectPath(args.path);
    try {
      const original = nodeFs.readFileSync(p, "utf8");
      if (!original.includes(args.oldText)) {
        return { ok: false, error: "oldText no encontrado en el archivo", path: p };
      }
      const updated = original.replace(args.oldText, args.newText);
      nodeFs.writeFileSync(p, updated, "utf8");
      return { ok: true, path: p, diffChars: updated.length - original.length };
    } catch (error) {
      return { ok: false, error: `replace_in_file fallo: ${error.message}`, path: p };
    }
  };

  tools.delete_file = async (args) => {
    const p = resolveProjectPath(args.path);
    try {
      nodeFs.unlinkSync(p);
      return { ok: true, path: p };
    } catch (error) {
      return { ok: false, error: `delete_file fallo: ${error.message}`, path: p };
    }
  };

  tools.search_files = async (args) => {
    const root = resolveProjectPath(args.path || ".");
    const query = String(args.query || "");
    if (!query) return { ok: false, error: "query es requerido" };
    const matches = [];
    const walk = (dir, depth = 0) => {
      if (depth > 6 || matches.length > 200) return;
      let entries;
      try { entries = nodeFs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (matches.length > 200) break;
        if (e.name === "node_modules" || e.name === ".git") continue;
        const full = nodePath.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full, depth + 1);
        } else if (e.isFile()) {
          try {
            const content = nodeFs.readFileSync(full, "utf8");
            if (content.includes(query)) {
              const line = content.split("\n").findIndex((l) => l.includes(query)) + 1;
              matches.push({ path: full, line, preview: content.split("\n")[line - 1]?.slice(0, 200) });
            }
          } catch {}
        }
      }
    };
    walk(root);
    return { ok: true, query, count: matches.length, matches };
  };

  // Alias nativo de run_shell: mismo comando, con el proyecto como cwd por defecto.
  tools.run_command = async (args) => {
    if (extendedTools && typeof extendedTools.run_shell === "function") {
      return await extendedTools.run_shell({ command: args.command, cwd: args.cwd || projectRoot });
    }
    return { ok: false, error: "run_shell no disponible (tools-extended no cargado)" };
  };

  return tools;
}

// ============================================================
// EXECUTOR POR DEFECTO (fallback completo)
// Se usa cuando el caller NO provee input.tools.execute.
// Las extendidas tienen prioridad; los nombres de ambos grupos no deben repetirse.
// ============================================================
function buildDefaultExecutor(input = {}) {
  const projectRoot = input.projectRoot || process.cwd();
  const nativeTools = buildNativeTools(projectRoot);

  return {
    execute: async (name, args = {}) => {
      if (EXTENDED_TOOL_NAMES.has(name)) return executeExtended(name, args);
      const native = nativeTools[name];
      if (typeof native === "function") return native(args);
      return { ok: false, error: `Herramienta desconocida: ${name}` };
    },
  };
}

/**
 * Orquestador unico del Agent Core.
 * Acceso completo → sin pending/CONFIRM: planAuthorized + allowWrite forzados.
 * v0.4.0 — integra internet, git, skills, shell y acceso externo.
 * @param {object} input — ver CONTRACT.md (+ providerApi opcional)
 * @returns {Promise<object>} AgentRunResult
 */
async function runAgent(input = {}, maybeOptions = {}) {
  const started = Date.now();
  if (typeof input === "string") {
    input = { prompt: input, ...(maybeOptions || {}) };
  }

  // Fallback: si el caller no provee un executor, montamos el completo.
  if (!input.tools?.execute) {
    input.tools = buildDefaultExecutor(input);
    if (!extendedTools) input.unavailableTools = [...EXTENDED_TOOL_NAMES];
  }
  const warnings = Array.isArray(input.unavailableTools) && input.unavailableTools.length
    ? [{
      code: "EXTENDED_TOOLS_UNAVAILABLE",
      tools: [...input.unavailableTools],
      message: "No se cargó agent-core/src/tools-extended.js (o faltan axios/simple-git): sin internet, git avanzado, skills, shell ni archivos externos en esta corrida.",
    }]
    : [];

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
    text: `Agent Core v${CORE_VERSION} · plan ${plan.mode} (${(plan.steps || []).length} pasos)${fullAccess ? " · Acceso completo" : ""}${extendedTools ? " · tools extendidas OK" : " · SIN tools extendidas"}`,
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
    warnings,
    usage: {
      stepsExecuted: steps.length,
      provider_calls: Number(ran.providerCalls || 0),
      elapsedMs: Date.now() - started,
      coreVersion: CORE_VERSION,
      fullAccess: fullAccess || undefined,
      extendedTools: !!extendedTools,
    },
    report: {
      completed: verified.completed === true,
      outcome: verified.completed ? "completed" : "incomplete",
      stopReason: verified.stopReason,
      toolCount: steps.length,
      failedSteps: steps.filter((s) => !s.ok).length,
      mutated: steps.some((s) => ["write_file", "replace_in_file", "delete_file", "write_external_file"].includes(s.name) && s.ok),
      mutatedPaths: [...new Set(
        steps
          .filter((s) => ["write_file", "replace_in_file", "delete_file", "write_external_file"].includes(s.name) && s.ok)
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
  buildDefaultExecutor,
};