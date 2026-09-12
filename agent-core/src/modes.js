"use strict";

/** @typedef {"list"|"explain"|"diagnose"|"execute"|"chat"} AgentMode */

const { classify: classifyFromModule, isFullAccess } = require("./classify");

/**
 * Clasifica el pedido del usuario en un modo del core.
 * @param {string} prompt
 * @param {{ allowWrite?: boolean, planAuthorized?: boolean, analysisMode?: boolean, permissionMode?: string, permissionFull?: boolean, fullAccess?: boolean }} [opts]
 * @returns {AgentMode}
 */
function classifyMode(prompt = "", opts = {}) {
  return classifyFromModule(prompt, opts);
}

/**
 * Extrae paths relativos de carpetas y archivos del prompt.
 */
function extractPathsFromPrompt(prompt = "") {
  const text = String(prompt || "");
  const dirs = [];
  const fullFiles = [];
  const bareFiles = [];

  // @path / @folder mentions (Cursor-like)
  for (const m of text.matchAll(/@((?:[\w.-]+\/)*[\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|txt|css|html))/gi)) {
    fullFiles.push(String(m[1] || "").replace(/\\/g, "/"));
  }
  for (const m of text.matchAll(/@((?:resources|runtime|src|app|lib|components|pages)(?:\/[\w.-]+)+)(?!\.\w)/gi)) {
    const p = String(m[1] || "").replace(/\\/g, "/").replace(/\/$/, "");
    if (!/\.\w+$/.test(p)) dirs.push(p);
  }

  for (const m of text.matchAll(/\b((?:resources|runtime|src|app|lib|components|pages)(?:\/[\w.-]+)+)\b/gi)) {
    const p = String(m[1] || "").replace(/\\/g, "/").replace(/\/$/, "");
    if (/analisis_errores|\.claude\//i.test(p)) continue;
    if (/\.(js|ts|tsx|jsx|mjs|cjs|json|md|txt|css|html|htm)$/i.test(p)) fullFiles.push(p);
    else dirs.push(p);
  }
  for (const m of text.matchAll(/\b([\w.-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|txt|css|html|htm))\b/gi)) {
    const base = String(m[1] || "");
    if (/analisis_errores/i.test(base)) continue;
    bareFiles.push(base);
  }
  if (/\bruntime\b/i.test(text) && !dirs.some((d) => /runtime/i.test(d))) {
    dirs.push("resources/app/runtime");
  }

  const covered = new Set(fullFiles.map((f) => f.split("/").pop().toLowerCase()));
  const files = [
    ...fullFiles,
    ...bareFiles.filter((b) => !covered.has(String(b).toLowerCase())),
  ];

  return {
    dirs: [...new Set(dirs)],
    files: [...new Set(files)],
  };
}

/**
 * Detecta creacion explicita de archivo con contenido exacto (smoke / pedidos concretos).
 * @returns {{ path: string, content: string } | null}
 */
function extractCreateFileSpec(prompt = "") {
  const text = String(prompt || "");

  // 1) Smoke explicito (prioridad maxima).
  const smokePath = text.match(/\b((?:resources\/app\/agent-core\/)?SMOKE_AGENT_CORE\.txt)\b/i);
  const smokePayload = text.match(/\b(agent-core-ok-[\w.-]+)\b/i);
  if (smokePath && smokePayload) {
    const raw = String(smokePath[1] || "").replace(/\\/g, "/");
    return {
      path: raw.includes("/") ? raw : `resources/app/agent-core/${raw}`,
      content: String(smokePayload[1] || "").trim(),
    };
  }

  // 2) Solo si el usuario dice CREA/ESCRIBE/GENERA el archivo <path>.
  // NUNCA tomar un path suelto del historial (ej. editcore-claude-adapter.js).
  const createLine = text.match(
    /(?:crea(?:r)?|escribe|genera)\s+(?:solo\s+)?(?:el\s+)?archivo\s+([^\s\n]+)/i,
  );
  if (!createLine) return null;

  let filePath = String(createLine[1] || "").replace(/\\/g, "/").replace(/[.,;:]+$/, "");
  if (!filePath) return null;

  // Bloquear "crear" archivos runtime existentes via write_file completo.
  if (/editcore-claude-adapter|intent-orchestrator|evidence-grounding|action-registry/i.test(filePath)) {
    return null;
  }

  let content = "";
  const exactLine = text.match(/contenido\s+de\s+una\s+l[ií]nea\s*:\s*\n?\s*([^\n]+)/i)
    || text.match(/exactamente\s+este\s+contenido[^:\n]*:\s*\n?\s*([^\n]+)/i)
    || text.match(/con\s+exactamente\s+este\s+contenido[^:\n]*:\s*\n?\s*([^\n]+)/i)
    || text.match(/\b(agent-core-ok-[\w.-]+)\b/i);
  if (exactLine) content = String(exactLine[1] || "").trim();

  if (!content) {
    const block = text.match(/contenido[^\n]*:\s*\n([^\n]+)/i);
    if (block) content = String(block[1] || "").trim();
  }

  if (!content) return null;
  if (/^(no\s+toques|al\s+terminar|crea|procede)/i.test(content)) return null;

  // write_file solo para archivos nuevos tipicos (.txt) o paths bajo agent-core/.
  if (!/\.txt$/i.test(filePath) && !/agent-core\//i.test(filePath)) {
    return null;
  }

  return { path: filePath, content };
}

/**
 * Detecta uno o mas replace_in_file explicitos (oldText/newText) en el prompt.
 * @returns {{ path: string, oldText: string, newText: string }[]}
 */
function extractReplaceSpecs(prompt = "") {
  const text = String(prompt || "");
  if (!/\breplace_in_file\b|\boldText\s*:/i.test(text)) return [];

  const pathRe = /\b((?:resources|runtime|src|app)(?:\/[\w.-]+)+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|txt))\b/i;
  const specs = [];
  let lastPath = "";
  const globalPath = text.match(pathRe);
  if (globalPath) lastPath = String(globalPath[1] || "").replace(/\\/g, "/");

  const blockRe = /(?:\breplace_in_file\b[^\n]*|\ben\s+[^\n]+)?[\s\S]*?oldText\s*:\s*\n?([\s\S]*?)\n\s*newText\s*:\s*\n?([\s\S]*?)(?=\n\s*(?:oldText\s*:|replace_in_file\b|No toques|Al terminar|$))/gi;
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    const chunk = text.slice(Math.max(0, m.index - 200), m.index + 80);
    const localPath = chunk.match(pathRe)
      || chunk.match(/en\s+([^\s\n]+?\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|txt))/i);
    if (localPath) lastPath = String(localPath[1] || "").replace(/\\/g, "/");
    if (!lastPath) continue;

    const oldText = String(m[1] || "").replace(/^\r?\n+|\r?\n+$/g, "");
    const newText = String(m[2] || "").replace(/^\r?\n+|\r?\n+$/g, "");
    if (!oldText || !newText || oldText === newText) continue;
    specs.push({ path: lastPath, oldText, newText });
  }

  return specs;
}

/** @returns {{ path: string, oldText: string, newText: string } | null} */
function extractReplaceSpec(prompt = "") {
  return extractReplaceSpecs(prompt)[0] || null;
}

/**
 * Detecta borrado explicito de un archivo.
 * @returns {{ path: string } | null}
 */
function extractDeleteSpec(prompt = "") {
  const text = String(prompt || "");
  if (!/\b(?:borra|borrar|elimina(?:r)?|delete(?:_file)?)\b/i.test(text)) return null;

  const pathMatch = text.match(
    /\b(?:borra|borrar|elimina(?:r)?|delete(?:_file)?)\s+(?:solo\s+)?(?:el\s+)?(?:archivo\s+)?([^\s\n]+?\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|txt))\b/i,
  ) || text.match(/\b((?:resources|runtime|src|app)(?:\/[\w.-]+)+\.(?:txt|md))\b/i);
  if (!pathMatch) return null;

  let filePath = String(pathMatch[1] || "").replace(/\\/g, "/").replace(/[.,;:]+$/, "");
  if (!filePath) return null;
  // Candados: no borrar nucleo del IDE ni secretos.
  if (/(^|\/)(main\.js|package\.json|\.env(?:\.|$)|app\.asar)/i.test(filePath)) return null;
  if (/editcore-claude-adapter|intent-orchestrator|evidence-grounding|action-registry|agent-core-bridge/i.test(filePath)
    && !/\.txt$/i.test(filePath)) {
    return null;
  }
  return { path: filePath };
}

/**
 * Detecta "cambia X por Y" / "reemplaza X por Y" / "cambia el h1 a Y".
 * @returns {{ path: string, oldText: string, newText: string, tagSwap?: { tag: string, newText: string } } | null}
 */
function extractSwapSpec(prompt = "") {
  const text = String(prompt || "");
  const pathMatch = text.match(/\b((?:resources|runtime|src|app)(?:\/[\w.-]+)+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|txt|css|html|htm))\b/i);
  if (!pathMatch) return null;
  const filePath = String(pathMatch[1] || "").replace(/\\/g, "/");

  // cambia el h1/h2/title a "Nuevo texto"
  const tagChange = text.match(/\bcambia(?:r)?\s+(?:el\s+)?(h1|h2|h3|title)\s+a\s+["“”']([^"“”'\n]+)["“”']/i)
    || text.match(/\bcambia(?:r)?\s+(?:el\s+)?(h1|h2|h3|title)\s+a\s+([^\n.]+?)(?=\s+con\s+replace|\s+con\s+replace_in_file|\s*$)/i);
  if (tagChange) {
    const tag = String(tagChange[1] || "").toLowerCase();
    const newInner = String(tagChange[2] || "").trim().replace(/^["'`]+|["'`]+$/g, "");
    if (!tag || !newInner || newInner.length > 240) return null;
    return {
      path: filePath,
      oldText: `__TAG_SWAP__${tag}__`,
      newText: newInner,
      tagSwap: { tag, newText: newInner },
    };
  }

  const swap = text.match(/\bcambia(?:r)?\s+([^\n]+?)\s+por\s+([^\n]+?)(?=\s+y\s+|\s+en\s+|\n|$)/i)
    || text.match(/\breemplaza(?:r)?\s+([^\n]+?)\s+(?:por|con)\s+([^\n]+?)(?=\s+y\s+|\s+en\s+|\n|$)/i);
  if (!swap) return null;

  const oldText = String(swap[1] || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  const newText = String(swap[2] || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  if (!oldText || !newText || oldText === newText) return null;
  if (oldText.length > 240 || newText.length > 240) return null;
  // Evitar capturar frases enteras de verificacion.
  if (/\bverifica|\bnpm\b|\bnode\b|\breplace_in_file\b|\bel\s+h1\b/i.test(oldText)) return null;
  if (/\bverifica|\bnpm\b|\bnode\b/i.test(newText)) return null;

  return {
    path: filePath,
    oldText,
    newText,
  };
}

/**
 * Detecta comando de verificacion pedido por el usuario (npm test, node --test, etc.).
 * Rechaza node -e/--eval (no son verificacion estable en step mode).
 * @returns {string | null}
 */
function extractVerifyCommand(prompt = "") {
  const text = String(prompt || "");
  const explicit = text.match(
    /\b(?:verifica(?:r)?(?:\s+con)?|ejecuta|corre|run)\s*[:=]?\s*((?:npm|pnpm|yarn|bun|npx|node)\b[^\n;]+)/i,
  );
  let cmd = explicit ? String(explicit[1] || "").trim().slice(0, 220) : "";
  if (!cmd) {
    const npmish = text.match(/\b((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|build|check)(?:\s+[^\n;]*)?)/i);
    if (npmish) cmd = String(npmish[1] || "").trim().slice(0, 220);
  }
  if (!cmd) {
    const nodeTest = text.match(/\b(node\s+--test(?:\s+[^\n;]*)?)/i);
    if (nodeTest) cmd = String(nodeTest[1] || "").trim().slice(0, 220);
  }
  if (!cmd) return null;
  // node -e / --eval no son verificacion fiable (y fallan sin Acceso completo).
  if (/\bnode\b[\s\S]*\s(-e|--eval|-p|--print)\b/i.test(cmd)) return null;
  return cmd;
}

module.exports = {
  classifyMode,
  isFullAccess,
  extractPathsFromPrompt,
  extractCreateFileSpec,
  extractReplaceSpec,
  extractReplaceSpecs,
  extractDeleteSpec,
  extractSwapSpec,
  extractVerifyCommand,
};
