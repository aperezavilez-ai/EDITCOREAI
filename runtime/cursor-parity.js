"use strict";

(function exposeCursorParity(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreCursorParity = api;
})(typeof window !== "undefined" ? window : globalThis, function createCursorParity() {
  const CURSOR_PARITY_EXTRA_TOOLS = [
    "connection_status",
    "service_read",
    "service_write",
  ];

  const CURSOR_PARITY_CORE_TOOLS = [
    "write_file", "replace_in_file", "create_project",
    "list_files", "read_file", "search_files", "run_command",
    "project_discovery", "codebase_map", "symbol_search", "dependency_search",
    "search", "semantic_search", "run_diagnostics",
    "mcp_list_tools", "mcp_invoke",
    "inspect_preview", "inspect_browser", "browser_interact",
    "run_parallel_explore", "run_subagent",
    "fetch_url", "github_repo_info", "github_list_files", "github_read_file", "github_search_repos",
    "brain_search", "brain_skill", "brain_tools", "brain_install_repo",
    "generate_image", "generate_video", "add_erp_module", "propose_diff", "apply_diff", "deploy_one_click",
    "publish_project", "connect_project", "assess_project_connections",
    "provision_project", "onboard_project", "project_health",
    "sync_vercel_env", "supabase_manage", "ssh_deploy", "create_supabase_project",
    "git_status", "git_create_branch", "git_commit", "git_pull", "git_push",
    "create_pdf", "create_word", "create_excel", "create_csv",
  ];

  const CURSOR_PARITY_ALLOWLIST = [...new Set([...CURSOR_PARITY_CORE_TOOLS, ...CURSOR_PARITY_EXTRA_TOOLS])];

  const OPERATOR_PUBLISH_TOOLS = [
    "publish_project",
    "deploy_one_click",
    "onboard_project",
    "connect_project",
    "provision_project",
    "ssh_deploy",
    "create_supabase_project",
    "sync_vercel_env",
  ];

  function isOperatorPublishRequest(prompt = "") {
    return /\b(publica(?:r|ci[oó]n)?|deploy|despleg[aeo]|onboard|conecta(?:r)?(?:\s+\w+){0,4}\s+(?:github|vercel|supabase|gafcore|servicios)|aprovision(?:ar)?)\b/i.test(String(prompt || ""));
  }

  function isAppMutationStep(step = {}) {
    const name = String(step.name || "");
    if (step.ok === false) return false;
    if (!["write_file", "replace_in_file", "create_project", "apply_diff"].includes(name)) return false;
    const filePath = String(step.input?.path || step.result?.path || "").replace(/\\/g, "/");
    return !/(^|\/)ROADMAP\.md$/i.test(filePath);
  }

  function isClosingVerificationStep(step = {}) {
    if (step.ok === false) return false;
    // N2: lint/test/build con exit != 0 es evidencia de fallo, NO cierre OK.
    try {
      const { isFailedDiagnosticResult } = require("../agent-runtime");
      if (isFailedDiagnosticResult(step.result)) return false;
    } catch { /* ignore */ }
    if (step.result && typeof step.result === "object" && step.result.diagnostic === true && step.result.passed === false) {
      return false;
    }
    const name = String(step.name || "");
    if (["inspect_preview", "inspect_browser", "run_diagnostics"].includes(name)) {
      if (step.result && typeof step.result === "object" && step.result.passed === false) return false;
      return true;
    }
    if (name !== "run_command") return false;
    const command = String(step.input?.command || "").toLowerCase();
    return /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|test|check|lint|typecheck)\b/.test(command)
      || /\b(?:npm|pnpm|yarn)\s+test\b/.test(command)
      || /\bvitest\b/.test(command)
      || /\btsc\b/.test(command);
  }

  function shouldCloseAfterVerifiedWork({
    prompt = "",
    allowWrite = false,
    analysisMode = false,
    steps = [],
    uiOneShot = false,
  } = {}) {
    if (!allowWrite || analysisMode === true || uiOneShot === true) return false;
    if (isOperatorPublishRequest(prompt)) return false;
    const list = Array.isArray(steps) ? steps : [];
    return list.some(isAppMutationStep) && list.some(isClosingVerificationStep);
  }

  /** Limites ampliados (paridad Cursor) para exploracion de repo */
  const CURSOR_PARITY_LIMITS = {
    walkFiles: 2500,
    searchFiles: 2500,
    semanticIndexFiles: 1200,
    bootstrapRootEntries: 120,
    bootstrapSrcEntries: 80,
    conversationTurns: 16,
    conversationMaxChars: 160_000,
    maxIterations: 120,
    tokenBudget: 800_000,
    historyMessages: 16,
  };

  function isDeepAgentTaskRequest(prompt = "") {
    const text = String(prompt || "").trim();
    if (!text) return false;
    if (/\b(solo\s+explica|no\s+implementes|sin\s+cambiar|solo\s+teor[ií]c)\b/i.test(text)) return false;
    // NO tratar procede/continua/adelante como "tarea profunda": son reanudacion.
    if (/^\s*(?:contin[uú]a|procede|adelante|autorizo|hazlo)\b/i.test(text)
      && !/\b(corrige|repara|arregla|fix|implementa|crea|escribe|modifica)\b/i.test(text)) {
      return false;
    }
    return /\b(investiga|audita|auditar|diagnostica|diagnosticar|analiza\s+a fondo|revisa\s+todo|escanea|examina|depura|debug|root\s*cause|causa\s+ra[ií]z)\b/i.test(text)
      || /\b(encuentra|localiza|identifica)\b[\s\S]{0,40}\b(bug|error|fallo|problema|regresi[oó]n)\b/i.test(text)
      || /\b(soluciona|corrige|repara|arregla|fix|remedia|resuelve)\b/i.test(text)
      || /\b(implementa|crea\s+(?:el|la|un|una)\s+|escribe\s+(?:el|la|un|una)\s+)\b/i.test(text)
      || /\b(como\s+cursor|como\s+tu|igual\s+que\s+t[uú]|paridad\s+cursor)\b/i.test(text);
  }

  function isCursorParityActive({
    isAgent = false,
    permissionFull = false,
    permissionReadonly = false,
    prompt = "",
    cursorParityEnabled = true,
  } = {}) {
    if (!cursorParityEnabled) return false;
    if (!isAgent || permissionReadonly || !permissionFull) return false;
    return true;
  }

  function buildCursorParityOrchestrationBlock() {
    return [
      "ORQUESTACION EDITCORE (AGENTE · ACCESO COMPLETO):",
      "- Objetivo: investigar y resolver. No te quedes en chat ni solo narrar.",
      "- ROADMAP (ciclo obligatorio, ahorra tokens):",
      "  1) Si NO hay ROADMAP.md: analiza el proyecto en disco (list_files, package.json, index/html/js clave) y CREA ROADMAP.md con el mapa real. PROHIBIDO pedirlo al usuario.",
      "  2) Si YA existe: leelo y parte de ahi. No reanalices el repo entero.",
      "  3) Al terminar cambios: ACTUALIZA ROADMAP.md (estado, archivos tocados, siguiente).",
      "- Flujo: (0) analizar o leer ROADMAP, (1) evidencia puntual de huecos, (2) write_file/replace_in_file, (3) verificar, (4) actualizar ROADMAP, (5) cerrar.",
      "- Publicar/deploy SOLO si el usuario lo pidio. Si no lo pidio, cierra tras verificar; no te quedes en 'Siguiente paso con el modelo' ni en onboard/publish.",
      "- Si el usuario pide auditar/corregir/publicar/conectar: usa herramientas operador (onboard_project, publish_project, connect_project, provision_project) en lugar de describir pasos manuales.",
      "- run_command libre para npm test, lint, build, git, supabase CLI. Un comando por llamada.",
      "- Puedes usar run_parallel_explore y semantic_search para acelerar investigacion.",
      "- PROHIBIDO inventar archivos, rutas o resultados de comandos. Cita evidencia real.",
      "- Ignora avisos internos de Electron (CSP / Security Warning). No son errores de la app del usuario.",
      "- Cierra con resumen: que encontraste, que cambiaste, como lo verificaste, y que actualizaste en el ROADMAP.",
    ].join("\n");
  }

  function buildCursorParitySystemGuide() {
    return `

AGENTE EDITCORE (ACCESO COMPLETO):
1. Si no hay ROADMAP.md, analiza el proyecto y crealo. Si ya hay, leelo y no reexplores todo. Actualizalo al terminar.
2. Nunca pidas al usuario que pegue el ROADMAP.
3. Correcciones puntuales; no refactors masivos no pedidos.
4. Verifica tests/build/preview tras cambios relevantes.
5. Operador GitHub/Vercel/Supabase/Gateway solo cuando el usuario lo pida.
6. Espanol claro; sin XML/JSON de herramientas en la respuesta visible.`;
  }

  return {
    CURSOR_PARITY_ALLOWLIST,
    CURSOR_PARITY_CORE_TOOLS,
    CURSOR_PARITY_LIMITS,
    OPERATOR_PUBLISH_TOOLS,
    isDeepAgentTaskRequest,
    isCursorParityActive,
    isOperatorPublishRequest,
    shouldCloseAfterVerifiedWork,
    isAppMutationStep,
    isClosingVerificationStep,
    buildCursorParityOrchestrationBlock,
    buildCursorParitySystemGuide,
  };
});
