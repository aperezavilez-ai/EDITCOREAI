"use strict";

/**
 * EDITCORE STACK — Bootstrap único Fases 1–5
 *
 * Uso:
 *   const { getStack } = require("./editcore-stack");
 *   const stack = await getStack(projectRoot);
 *   // stack.a2a | stack.harness | stack.disk | stack.surface
 *   await stack.surface.invoke("files.write", { path, content });
 *   await stack.surface.invoke("agent.start", { task });
 *
 * Cableado mínimo en agent-runtime / orchestrator:
 *   ver docs/WIRE-STACK.md
 */

const path = require("path");

const stacks = new Map();

async function getStack(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  if (stacks.has(root) && !options.forceNew) {
    return stacks.get(root);
  }

  const { getA2ABridge } = require("./a2a-bridge");
  const { attachHarness } = require("./harness-a2a-integration");
  const { attachDiskTools } = require("./disk-tools-integration");
  const { attachSurface } = require("./surface-integration");

  const a2a = getA2ABridge(root, options.a2a || {});
  await a2a.init();

  const harness = attachHarness(a2a, {
    maxTokens: options.maxTokens || 120_000,
    ...(options.harness || {}),
  });

  const disk = attachDiskTools(a2a, { harness });
  const surface = attachSurface(a2a, { disk, harness });

  const stack = {
    projectRoot: root,
    a2a,
    harness,
    disk,
    surface,
    ROLES: require("./a2a-protocol").ROLES,

    /** Atajos */
    async invoke(op, args) {
      return surface.invoke(op, args);
    },
    startTask(task, opts) {
      return a2a.startTask(task, opts);
    },
    getPrompt(role, userMessage, extra = {}) {
      return harness.buildPrompt({
        systemCore: extra.systemCore || "",
        toolsSchema: extra.toolsSchema || "",
        history: extra.history || [],
        userMessage: userMessage || "",
        role: role || "supervisor",
      });
    },
    clipTool(result) {
      return harness.clipToolResult(result);
    },
    async writeFile(rel, content, opts) {
      return surface.invoke("files.write", { path: rel, content, ...opts });
    },
    async readFile(rel, opts) {
      return surface.invoke("files.read", { path: rel, ...opts });
    },
    status() {
      return {
        a2a: a2a.status(),
        harness: harness.snapshot(),
        disk: disk.snapshot(),
        surfaceOps: surface.listOps().length,
      };
    },
    async save() {
      await a2a.save();
    },
    complete(summary) {
      a2a.complete(summary || "");
    },
    getEliteUiPrompt() {
      try {
        return require("./elite-ui-policy").eliteUiSystemPrompt();
      } catch {
        return "";
      }
    },
    getProductPipelinePrompt(userText) {
      try {
        return require("./product-pipeline").buildPipelinePrompt(userText);
      } catch {
        return { active: false, prompt: "" };
      }
    },
  };

  stacks.set(root, stack);
  return stack;
}

/**
 * Helper para tool handlers del kernel: envuelve write_file / replace con validación.
 */
function wrapWriteTools(stack, tools) {
  if (!tools || typeof tools !== "object") return tools;
  const origWrite = tools.write_file || tools.writeFile;
  const origReplace = tools.replace_in_file || tools.replaceInFile;

  if (typeof origWrite === "function") {
    tools.write_file = async (args, ctx) => {
      const content = args?.content ?? args?.text ?? "";
      try {
        stack.a2a.assertComplete(content, args?.path || "file");
      } catch (err) {
        return { ok: false, error: err.message };
      }
      return origWrite(args, ctx);
    };
  }

  if (typeof origReplace === "function") {
    tools.replace_in_file = async (args, ctx) => {
      const replacement = args?.replacement ?? args?.new_string ?? "";
      // Solo validar si el replacement parece un bloque grande de código
      if (String(replacement).length > 400) {
        try {
          stack.a2a.assertComplete(replacement, args?.path || "replace");
        } catch (err) {
          return { ok: false, error: err.message };
        }
      }
      return origReplace(args, ctx);
    };
  }

  return tools;
}

module.exports = {
  getStack,
  wrapWriteTools,
};
