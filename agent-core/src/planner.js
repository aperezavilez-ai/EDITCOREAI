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

// ============================================================
// v0.4.0 — Deteccion de intents de herramientas extendidas
// ============================================================

const EXT_READ_ONLY = new Set([
  "web_search", "web_fetch", "git_log", "git_status", "git_diff",
  "read_external_file", "list_external_directory", "list_skills",
]);

const EXT_MUTATION = new Set([
  "git_clone", "write_external_file", "install_skill", "run_shell",
]);

function isExtendedReadOnly(tool) { return EXT_READ_ONLY.has(tool); }
function isExtendedMutation(tool) { return EXT_MUTATION.has(tool); }

/**
 * Analiza el prompt y detecta intents de herramientas extendidas.
 * @returns {{tool: string, input: object}[]}
 */
function detectExtendedIntent(prompt = "") {
  const p = String(prompt || "");
  const intents = [];

  // ---- web_search ----
  const searchRe = /\b(?:busca(?:r|me)?(?:\s+en\s+(?:internet|la\s+web|google))?|investiga(?:r)?|averigua(?:r)?|googlea(?:r)?|consulta(?:r)?(?:\s+en\s+(?:internet|la\s+web))|b[uú]scame|buscar\s+en\s+(?:internet|la\s+web))\s+(?:sobre\s+|acerca\s+de\s+|por\s+|la\s+|el\s+|los\s+|las\s+|cu[aá]l\s+es\s+(?:la\s+)?|qu[eé]\s+es\s+)?["“']?([^"\n'.”]{3,200})["”']?/i;
  const searchMatch = p.match(searchRe);
  if (searchMatch) {
    let query = searchMatch[1].trim();
    query = query.replace(/\s+(?:y\s+luego.*|y\s+dime.*|y\s+despu[eé]s.*|y\s+lista.*|y\s+muestra.*)$/i, "").trim();
    if (query && !/^(?:archivos?|carpetas?|archivo|carpeta)\b/i.test(query)) {
      intents.push({ tool: "web_search", input: { query, maxResults: 5 } });
    }
  }

  // ---- web_fetch ----
  const urlInPrompt = p.match(/\bhttps?:\/\/[^\s<>"'”]+/);
  if (urlInPrompt && /\b(?:lee|abre|fetchea|descarga|revisa|analiza|consulta)\b/i.test(p)) {
    intents.push({ tool: "web_fetch", input: { url: urlInPrompt[0] } });
  }

  // ---- git_clone ----
  const cloneRe = /\b(?:clona(?:r|me)?|git\s+clone|descarga(?:r)?\s+el\s+repo(?:sitorio)?|trae(?:me)?\s+el\s+repo(?:sitorio)?)\s+(?:el\s+repo(?:sitorio)?\s+|de\s+|desde\s+)?["“']?(https?:\/\/[^\s<>"'”]+|git@[^\s"'”]+)["”']?(?:\s+(?:en|a|hacia|dentro\s+de)\s+["“']?([^"\n'”]+?)["”']?)?/i;
  const cloneMatch = p.match(cloneRe);
  if (cloneMatch) {
    intents.push({
      tool: "git_clone",
      input: {
        url: cloneMatch[1],
        targetDir: cloneMatch[2] ? cloneMatch[2].trim() : "",
        depth: 1,
      },
    });
  }

  // ---- list_external_directory ----
  const listDirRe = /\b(?:lista(?:r|me)?|muestra(?:me)?|enlista(?:r|me)?|dame|qu[eé]\s+hay\s+en)\s+(?:los\s+|las\s+|el\s+|la\s+)?(?:archivos?|carpetas?|contenido)?\s*(?:de|en|dentro\s+de)?\s+["“']?([A-Za-z]:\\[^"\n'”]+|\/[^"\n'”\s]+)["”']?/i;
  const listDirMatch = p.match(listDirRe);
  if (listDirMatch) {
    const path = listDirMatch[1].trim().replace(/[.,;]+$/, "");
    if (path.length > 2) {
      intents.push({ tool: "list_external_directory", input: { path } });
    }
  }

  // ---- read_external_file ----
  const readFileRe = /\b(?:lee|abre|muestra\s+el\s+contenido\s+de|revisa)\s+(?:el\s+archivo\s+)?["“']?([A-Za-z]:\\[^"\n'”]+\.\w{1,6}|\/[^"\n'”]+\.\w{1,6})["”']?/i;
  const readFileMatch = p.match(readFileRe);
  if (readFileMatch) {
    intents.push({ tool: "read_external_file", input: { path: readFileMatch[1].trim() } });
  }

  // ---- git_log / git_status / git_diff ----
  const gitRepoRe = /(?:repo(?:sitorio)?\s+(?:en|de)\s+["“']?([A-Za-z]:\\[^"\n'”]+)["”']?|["“']?([A-Za-z]:\\[^"\n'”]+)["”']?\s+(?:es\s+un\s+)?repo(?:sitorio)?)/i;
  const gitRepoMatch = p.match(gitRepoRe);
  if (gitRepoMatch) {
    const repoPath = (gitRepoMatch[1] || gitRepoMatch[2] || "").trim();
    if (repoPath) {
      if (/\b(?:commit|historial|log|últimos\s+cambios)\b/i.test(p)) {
        intents.push({ tool: "git_log", input: { repoPath, maxCount: 10 } });
      } else if (/\b(?:diff|cambios\s+sin\s+confirmar)\b/i.test(p)) {
        intents.push({ tool: "git_diff", input: { repoPath, staged: false } });
      } else if (/\b(?:status|estado|estatus)\b/i.test(p)) {
        intents.push({ tool: "git_status", input: { repoPath } });
      }
    }
  }

  // ---- run_shell ----
  const shellRe = /\b(?:ejecuta(?:r|me)?|corre(?:r|me)?|lanza(?:r|me)?)\s+(?:el\s+comando\s+|la\s+terminal\s+con\s+|en\s+shell\s+|en\s+powershell\s+)?(?:["'`])?([^\n"'`]{3,300})(?:["'`])?/i;
  const shellMatch = p.match(shellRe);
  if (shellMatch) {
    let cmd = shellMatch[1].trim();
    if (/^(?:npm|yarn|pnpm|node|python|python3|pip|pip3|git|dir|ls|cd|mkdir|rmdir|rm|del|copy|move|type|where|find|findstr|echo|cat|curl|wget|Invoke-WebRequest|Get-ChildItem|Set-Location)\b/i.test(cmd)
        || /[;&|]/.test(cmd)
        || /--?\w+/.test(cmd)) {
      intents.push({ tool: "run_shell", input: { command: cmd } });
    }
  }

  // ---- list_skills ----
  if (/\b(?:qu[eé]\s+skills(?:\s+tienes|\s+hay|\s+est[aá]n\s+instaladas)?|skills\s+instaladas|lista(?:r|me)?\s+(?:las\s+)?skills|mis\s+skills)\b/i.test(p)) {
    intents.push({ tool: "list_skills", input: {} });
  }

  // ---- install_skill ----
  const installRe = /\b(?:instala(?:r|me)?|a[ñn]ade|agrega(?:r)?)\s+(?:la\s+)?skill\s+["“']?([^\s"'”\n]{2,80})["”']?(?:\s+(?:desde|de|con)\s+["“']?(https?:\/\/[^\s"'”<>]+)["”']?)?/i;
  const installMatch = p.match(installRe);
  if (installMatch) {
    intents.push({
      tool: "install_skill",
      input: {
        repoUrl: installMatch[2] || "",
        skillName: installMatch[1],
      },
    });
  }

  return intents;
}

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

  // ============ v0.4.0: Intents extendidos PRIORITARIOS ============
  const extendedIntents = detectExtendedIntent(prompt);
  const hasExtReadOnly = extendedIntents.some(i => isExtendedReadOnly(i.tool));
  const hasExtMutation = extendedIntents.some(i => isExtendedMutation(i.tool));

  // Si hay intents extendidos y NO hay specs de archivos locales → camino extendido
  if (extendedIntents.length > 0 && !createSpec && !replaceSpecs.length && !deleteSpec) {
    const extSteps = extendedIntents.map(intent => ({
      type: "tool",
      tool: intent.tool,
      input: intent.input,
      note: `Intent extendido (${intent.tool})`,
    }));
    // Si es solo lectura, además añadir un report
    extSteps.push({ type: "report", note: "Armar respuesta final en markdown con evidencia de tools extendidas." });

    const resolvedMode = hasExtMutation ? "execute" : "research";

    return {
      mode: resolvedMode,
      steps: extSteps,
      allowMutation: hasExtMutation && (fullAccess || input.planAuthorized === true || input.allowWrite !== false),
      paths,
      verifyCommand: verifyCommand || null,
      extendedIntents,
      needsConcreteChange: false,
    };
  }

  // Si hay intents extendidos Y también specs de archivos → prepend ext steps
  const prependExtSteps = extendedIntents.map(intent => ({
    type: "tool",
    tool: intent.tool,
    input: intent.input,
    note: `Intent extendido (${intent.tool})`,
  }));

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
        ...prependExtSteps,
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
        ...prependExtSteps,
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
    const steps = [...prependExtSteps];
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
        steps: prependExtSteps,
        allowMutation: false,
        note: "Sin autorizacion: solo diagnostico. Espera PROCEDE para mutar.",
      };
    }

    const hasExplicitMutationIntent = /\b(crea(?:r)?|corrige|arregla|repara|implementa|modifica|refactoriza|actualiza|audita|replace|borra|elimina|delete|a[ñn]ade|agrega|renombra|fix\b|cambia(?:r)?\s+|escribe\s+el\s+archivo|clona(?:r)?|instala(?:r)?|ejecuta(?:r)?)\b/i.test(prompt)
      || /SMOKE_AGENT_CORE|SMOKE_MUTATION|replace_in_file|oldText\s*:|delete_file/i.test(prompt)
      || Boolean(swapSpec)
      || hasExtMutation
      || (paths.files.length > 0 && /\b(bug|error|falla|roto|rompe|defect)\b/i.test(prompt));
    if (!createSpec && !replaceSpecs.length && !deleteSpec && !hasExplicitMutationIntent) {
      return {
        mode: "execute",
        steps: prependExtSteps,
        allowMutation: false,
        createSpec: null,
        needsConcreteChange: true,
        note: "PROCEDE sin pedido concreto de mutacion.",
      };
    }
  }

  /** @type {{ type: string, tool?: string, input?: object, note?: string }[]} */
  const steps = [...prependExtSteps];

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
  detectExtendedIntent,
  isExtendedReadOnly,
  isExtendedMutation,
};