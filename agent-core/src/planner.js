"use strict";

const {
  classifyMode,
  extractPathsFromPrompt,
  extractCreateFileSpec,
  extractReplaceSpec,
  extractReplaceSpecs,
  extractDeleteSpec,
  extractSwapSpec,
  extractVerifyCommand,
} = require("./modes");
const { isFullAccess } = require("./classify");

/**
 * Planner: decide modo y pasos concretos.
 */
function planTask(input = {}) {
  const prompt = String(input.prompt || "");
  const fullAccess = isFullAccess(input);
  const mode = classifyMode(prompt, {
    allowWrite: fullAccess ? true : input.allowWrite,
    planAuthorized: fullAccess ? true : input.planAuthorized,
    planAuthorizedExecution: fullAccess ? true : input.planAuthorizedExecution,
    analysisMode: input.analysisMode,
    permissionMode: input.permissionMode,
    permissionFull: fullAccess || input.permissionFull,
    fullAccess,
  });
  const paths = extractPathsFromPrompt(prompt);
  const createSpec = extractCreateFileSpec(prompt);
  let replaceSpecs = extractReplaceSpecs(prompt);
  const swapSpec = extractSwapSpec(prompt);
  if (!replaceSpecs.length && swapSpec) replaceSpecs = [swapSpec];
  const replaceSpec = replaceSpecs[0] || extractReplaceSpec(prompt);
  const deleteSpec = extractDeleteSpec(prompt);
  const verifyCommand = extractVerifyCommand(prompt);

  if (mode === "chat") {
    return {
      mode,
      steps: [{ type: "reply", note: "Responder en español sin tools." }],
      allowMutation: false,
    };
  }

  if (mode === "execute" && createSpec) {
    return {
      mode,
      steps: [
        {
          type: "tool",
          tool: "write_file",
          input: { path: createSpec.path, content: createSpec.content },
          note: "Creacion explicita pedida por el usuario",
        },
        {
          type: "tool",
          tool: "read_file",
          input: { path: createSpec.path, startLine: 1, endLine: 20 },
          note: "Verificar contenido escrito",
        },
        { type: "report", note: "Confirmar path y contenido." },
      ],
      allowMutation: true,
      paths,
      createSpec,
      verifyCommand,
      needsConcreteChange: false,
    };
  }

  if (mode === "execute" && deleteSpec && !replaceSpecs.length) {
    return {
      mode,
      steps: [
        {
          type: "tool",
          tool: "delete_file",
          input: { path: deleteSpec.path },
          note: "Borrado explicito pedido por el usuario",
        },
        { type: "report", note: "Confirmar borrado." },
      ],
      allowMutation: true,
      paths,
      deleteSpec,
      verifyCommand,
      needsConcreteChange: false,
    };
  }

  if (mode === "execute" && replaceSpecs.length) {
    const steps = [];
    const lockedPaths = [...new Set(replaceSpecs.map((s) => s.path))];
    for (const path of lockedPaths) {
      steps.push({
        type: "tool",
        tool: "read_file",
        input: { path, startLine: 1, endLine: 80 },
        note: "Leer antes de replace (si falta, se creara)",
        optional: true,
      });
    }
    for (const spec of replaceSpecs) {
      const isTagSwap = Boolean(spec.tagSwap && spec.tagSwap.tag);
      steps.push({
        type: "tool",
        tool: "replace_in_file",
        input: {
          path: spec.path,
          oldText: spec.oldText,
          newText: isTagSwap ? spec.tagSwap.newText : spec.newText,
          ...(isTagSwap ? { tagSwap: spec.tagSwap } : {}),
        },
        note: isTagSwap
          ? `Cambiar texto de <${spec.tagSwap.tag}>`
          : "Replace/swap pedido por el usuario",
        // tagSwap necesita el archivo real; no crear basura con solo el texto nuevo
        createIfMissing: !isTagSwap,
      });
    }
    for (const path of lockedPaths) {
      steps.push({
        type: "tool",
        tool: "read_file",
        input: { path, startLine: 1, endLine: 40 },
        note: "Verificar replace",
      });
    }
    if (verifyCommand) {
      steps.push({
        type: "tool",
        tool: "run_command",
        input: { command: verifyCommand },
        note: "Verificacion pedida por el usuario",
      });
    }
    steps.push({ type: "report", note: "Confirmar mutacion." });
    return {
      mode,
      steps,
      allowMutation: true,
      paths,
      replaceSpec,
      replaceSpecs,
      swapSpec: swapSpec || null,
      verifyCommand,
      needsConcreteChange: false,
    };
  }

  if (mode === "execute") {
    const authorized = input.planAuthorized === true
      || input.planAuthorizedExecution === true
      || fullAccess
      || /^\s*(?:procede|adelante|autorizo|contin[uú]a)\b/i.test(prompt);
    if (!authorized) {
      return {
        mode: "diagnose",
        steps: [],
        allowMutation: false,
        note: "Sin autorizacion: solo diagnostico. Espera PROCEDE para mutar.",
      };
    }

    const hasExplicitMutationIntent = /\b(crea(?:r)?|corrige|arregla|repara|implementa|modifica|refactoriza|actualiza|audita|replace|borra|elimina|delete|a[ñn]ade|agrega|renombra|fix\b|cambia(?:r)?\s+|escribe\s+el\s+archivo)\b/i.test(prompt)
      || /SMOKE_AGENT_CORE|SMOKE_MUTATION|replace_in_file|oldText\s*:|delete_file/i.test(prompt)
      || Boolean(swapSpec)
      || (paths.files.length > 0 && /\b(bug|error|falla|roto|rompe|defect)\b/i.test(prompt));
    if (!createSpec && !replaceSpecs.length && !deleteSpec && !hasExplicitMutationIntent) {
      return {
        mode: "execute",
        steps: [],
        allowMutation: false,
        createSpec: null,
        needsConcreteChange: true,
        note: "PROCEDE sin pedido concreto de mutacion.",
      };
    }
  }

  /** @type {{ type: string, tool?: string, input?: object, note?: string }[]} */
  const steps = [];

  if (mode === "list" || mode === "explain") {
    const dir = paths.dirs[0] || "resources/app/runtime";
    steps.push({ type: "tool", tool: "list_files", input: { path: dir } });
  }

  if (mode === "explain" || mode === "diagnose" || mode === "execute") {
    const files = paths.files.length
      ? paths.files
      : (mode === "diagnose"
        ? [
          "resources/app/runtime/editcore-claude-adapter.js",
          "resources/app/runtime/intent-orchestrator.js",
          "resources/app/runtime/evidence-grounding.js",
          "resources/app/runtime/action-registry.js",
        ]
        : []);
    for (const file of files.slice(0, 8)) {
      const candidates = file.includes("/")
        ? [file]
        : [`resources/app/runtime/${file}`, `resources/app/${file}`, file];
      steps.push({
        type: "tool",
        tool: "read_file",
        input: { path: candidates[0], startLine: 1, endLine: mode === "execute" ? 800 : 500 },
        fallbackPaths: candidates.slice(1),
      });
      if (/main\.js$/i.test(candidates[0]) || /main\.js$/i.test(file)) {
        steps.push({
          type: "tool",
          tool: "read_file",
          input: { path: candidates[0], startLine: 5280, endLine: 5380 },
          fallbackPaths: candidates.slice(1),
          note: "Ventana Agent Core en main.js",
        });
      }
    }
  }

  if (mode === "execute") {
    steps.push({
      type: "mutate",
      note: "Lee evidencia, construye oldText exacto tu mismo y aplica replace_in_file/write_file. Luego verifica con run_command si aplica.",
    });
    if (verifyCommand) {
      steps.push({
        type: "verify",
        tool: "run_command",
        input: { command: verifyCommand },
        note: "Verificacion + posible reintento de reparacion",
      });
    }
  }

  steps.push({ type: "report", note: "Armar respuesta final en español con evidencia." });

  const freeFormFix = mode === "execute"
    && !createSpec
    && !replaceSpecs.length
    && !deleteSpec;

  return {
    mode,
    steps,
    allowMutation: mode === "execute" && input.allowWrite !== false,
    paths,
    createSpec: createSpec || null,
    replaceSpec: replaceSpec || null,
    replaceSpecs: replaceSpecs.length ? replaceSpecs : null,
    deleteSpec: deleteSpec || null,
    verifyCommand: verifyCommand || null,
    freeFormFix,
    needsConcreteChange: false,
  };
}

module.exports = {
  planTask,
};
