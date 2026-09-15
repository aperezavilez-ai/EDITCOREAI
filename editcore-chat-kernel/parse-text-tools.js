"use strict";

/**
 * Fallback: algunos modelos emiten tools como XML/texto en vez de tool_calls.
 * También limpia ese markup para que NUNCA se vea en el chat.
 */

const ALIAS = {
  list_directory: "list_files",
  list_dir: "list_files",
  listdir: "list_files",
  glob: "search_files",
  grep: "search_files",
  execute_command: "run_command",
  run_shell: "run_command",
  shell: "run_command",
  bash: "run_command",
  terminal: "run_command",
  str_replace: "replace_in_file",
  search_replace: "replace_in_file",
  apply_patch: "replace_in_file",
  edit_file: "replace_in_file",
  create_file: "write_file",
  write: "write_file",
  read: "read_file",
  view: "read_file",
  open_file: "read_file",
};

const NATIVE = [
  "list_files", "read_file", "write_file", "replace_in_file", "search_files",
  "run_command", "audit_env", "supabase_migrate", "scaffold_project", "capture_preview",
  "capture_preview_screenshot",
  "web_scrape", "ingest_to_brain", "list_brain", "clone_repo",
  "rollback_last_change", "list_snapshots",
];

const TOOL_TAG_NAMES = [...new Set([...NATIVE, ...Object.keys(ALIAS)])];

/** Marca el inicio de protocolo tool/XML/JSON que no debe verse en el chat. */
const TOOL_MARKUP_START_RE = /<(?:tool_call|tool_use|tool_invocation|function_calls?|function\s*=|parameter\s*=|invoke\b)\b|<\/?(?:tool_call|tool_use|function|parameter)\b|```(?:json|xml)?\s*\n\s*\{[\s\S]*?"(?:name|tool|function)"\s*:/i;

function normalizeToolName(name) {
  const raw = String(name || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ALIAS[raw] || raw;
}

function toolsKnown(name) {
  return NATIVE.includes(name);
}

function assignArg(args, key, val) {
  if (/^(path|file|filepath|file_path)$/i.test(key)) args.path = val;
  else if (/^(command|cmd)$/i.test(key)) args.command = val;
  else if (/^(content|contents|text)$/i.test(key)) args.content = val;
  else if (/^(old|old_str|oldText|old_text)$/i.test(key)) args.oldText = val;
  else if (/^(new|new_str|newText|new_text)$/i.test(key)) args.newText = val;
  else if (/^(query|pattern|search)$/i.test(key)) args.query = val;
  else if (/^url$/i.test(key)) args.url = val;
  else args[key] = val;
}

function parseInnerArgs(body) {
  const args = {};
  const src = String(body || "");
  let matched = false;

  // Primero parámetros cerrados
  const closedRe = /<parameter\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)\s*<\/parameter>/gi;
  let m;
  while ((m = closedRe.exec(src))) {
    matched = true;
    assignArg(args, String(m[1] || "").trim(), String(m[2] || "").trim());
  }

  // Luego un parámetro abierto al final (stream cortado)
  const remainder = src.replace(/<parameter\s*=\s*[a-zA-Z_][\w-]*\s*>\s*[\s\S]*?\s*<\/parameter>/gi, "");
  const open = /<parameter\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*)$/i.exec(remainder);
  if (open) {
    matched = true;
    assignArg(args, String(open[1] || "").trim(), String(open[2] || "").trim());
  }

  const tagRe = /<([a-zA-Z_][\w-]*)>\s*([\s\S]*?)\s*<\/\1>/g;
  while ((m = tagRe.exec(src))) {
    matched = true;
    const key = String(m[1] || "").trim();
    if (!key || /^(parameter|function|tool_call)$/i.test(key)) continue;
    assignArg(args, key, String(m[2] || "").trim());
  }

  if (!matched) {
    const trimmed = src.trim();
    if (trimmed.startsWith("{")) {
      try {
        const json = JSON.parse(trimmed);
        if (json && typeof json === "object") Object.assign(args, json);
      } catch { /* ignore */ }
    }
  }
  return args;
}

function toRelativePath(projectRoot, filePath) {
  const raw = String(filePath || "").trim();
  if (!raw || !projectRoot) return raw.replace(/\\/g, "/");
  const path = require("path");
  try {
    const root = path.resolve(String(projectRoot));
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
    const rootLower = root.toLowerCase();
    const absLower = abs.toLowerCase();
    if (absLower === rootLower) return ".";
    const sep = path.sep.toLowerCase();
    if (absLower.startsWith(rootLower + sep) || absLower.startsWith(`${rootLower}/`) || absLower.startsWith(`${rootLower}\\`)) {
      return path.relative(root, abs).replace(/\\/g, "/") || ".";
    }
  } catch { /* ignore */ }
  const escaped = String(projectRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}[\\\\/]?`, "i");
  if (re.test(raw)) return raw.replace(re, "").replace(/\\/g, "/") || ".";
  return raw.replace(/\\/g, "/");
}

function pushCall(calls, name, args, projectRoot) {
  const normalized = normalizeToolName(name);
  if (!toolsKnown(normalized)) return;
  const next = { ...args };
  if (next.path) next.path = toRelativePath(projectRoot, next.path);
  if (normalized === "run_command" && next.command && projectRoot) {
    const esc = String(projectRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next.command = String(next.command)
      .replace(new RegExp(`^cd\\s+"?${esc}"?\\s*(?:&&|;)\\s*`, "i"), "")
      .trim();
  }
  calls.push({
    id: `text_tool_${calls.length + 1}_${Date.now()}`,
    type: "function",
    function: { name: normalized, arguments: JSON.stringify(next) },
    _fromText: true,
  });
}

function parseTextToolCalls(text, { projectRoot } = {}) {
  const src = String(text || "");
  if (!src.trim()) return [];
  const calls = [];

  // Formato cerrado: <tool_call><function=name>...</function></tool_call>
  const fnBlockRe = /<tool_call>\s*<function\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)\s*<\/function>\s*<\/tool_call>/gi;
  let m;
  while ((m = fnBlockRe.exec(src))) {
    pushCall(calls, m[1], parseInnerArgs(m[2] || ""), projectRoot);
  }

  // Formato incompleto / sin cierre (stream cortado)
  if (!calls.length) {
    const open = /<tool_call>\s*<function\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*)$/i.exec(src);
    if (open) {
      const args = parseInnerArgs(open[2] || "");
      if (args.path || args.content || args.command || args.query || args.oldText) {
        pushCall(calls, open[1], args, projectRoot);
      }
    }
  }

  // <function=write_file> sin wrapper tool_call
  if (!calls.length) {
    const bareFn = /<function\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)(?:<\/function>|$)/gi;
    while ((m = bareFn.exec(src))) {
      const args = parseInnerArgs(m[2] || "");
      if (args.path || args.content || args.command || args.query || args.oldText) {
        pushCall(calls, m[1], args, projectRoot);
      }
    }
  }

  // Formato clásico: <read_file>...</read_file>
  const names = TOOL_TAG_NAMES.join("|");
  const blockRe = new RegExp(`<(${names})>\\s*([\\s\\S]*?)\\s*<\\/\\1>`, "gi");
  while ((m = blockRe.exec(src))) {
    pushCall(calls, m[1], parseInnerArgs(m[2] || ""), projectRoot);
  }
  return calls;
}

/**
 * Texto visible para el chat: corta en el primer markup de tool/protocolo.
 */
function visibleNarrationText(text) {
  const raw = String(text || "");
  if (!raw) return "";
  const idx = raw.search(TOOL_MARKUP_START_RE);
  if (idx >= 0) return raw.slice(0, idx).replace(/\s+$/g, "");
  return raw;
}

function stripTextToolMarkup(text) {
  let out = String(text || "");
  out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  out = out.replace(/<function\s*=\s*[a-zA-Z_][\w-]*\s*>[\s\S]*?<\/function>/gi, "");
  out = out.replace(/<parameter\s*=\s*[a-zA-Z_][\w-]*\s*>[\s\S]*?<\/parameter>/gi, "");
  const names = TOOL_TAG_NAMES.join("|");
  const re = new RegExp(`<(${names})>\\s*[\\s\\S]*?\\s*<\\/\\1>`, "gi");
  out = out.replace(re, "");
  // Incompletos / stream cortado
  out = visibleNarrationText(out);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function isToolProtocolText(text) {
  const t = String(text || "").trimStart();
  if (!t) return false;
  if (TOOL_MARKUP_START_RE.test(t)) return true;
  if (/^(?:\{|\[)/.test(t) && /"(?:type|name|tool|function)"\s*:/.test(t)) return true;
  return false;
}

module.exports = {
  parseTextToolCalls,
  stripTextToolMarkup,
  visibleNarrationText,
  isToolProtocolText,
  normalizeToolName,
  toRelativePath,
  ALIAS,
  TOOL_MARKUP_START_RE,
};
