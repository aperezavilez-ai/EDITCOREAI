"use strict";

/**
 * Fallback: algunos modelos emiten tools como XML/texto en vez de tool_calls.
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

function normalizeToolName(name) {
  const raw = String(name || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ALIAS[raw] || raw;
}

function toolsKnown(name) {
  return NATIVE.includes(name);
}

function parseInnerArgs(body) {
  const args = {};
  // Formato Claude-like: <parameter=file_path>value</parameter>
  const paramRe = /<parameter\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)\s*<\/parameter>/gi;
  let m;
  let matched = false;
  while ((m = paramRe.exec(body))) {
    matched = true;
    const key = String(m[1] || "").trim();
    const val = String(m[2] || "").trim();
    if (/^(path|file|filepath|file_path)$/i.test(key)) args.path = val;
    else if (/^(command|cmd)$/i.test(key)) args.command = val;
    else if (/^(content|contents|text)$/i.test(key)) args.content = val;
    else if (/^(old|old_str|oldText|old_text)$/i.test(key)) args.oldText = val;
    else if (/^(new|new_str|newText|new_text)$/i.test(key)) args.newText = val;
    else if (/^(query|pattern|search)$/i.test(key)) args.query = val;
    else if (/^url$/i.test(key)) args.url = val;
    else args[key] = val;
  }

  const tagRe = /<([a-zA-Z_][\w-]*)>\s*([\s\S]*?)\s*<\/\1>/g;
  while ((m = tagRe.exec(body))) {
    matched = true;
    const key = String(m[1] || "").trim();
    const val = String(m[2] || "").trim();
    if (!key || /^(parameter|function|tool_call)$/i.test(key)) continue;
    if (/^(path|file|filepath|file_path)$/i.test(key)) args.path = val;
    else if (/^(command|cmd)$/i.test(key)) args.command = val;
    else if (/^(content|contents|text)$/i.test(key)) args.content = val;
    else if (/^(old|old_str|oldText|old_text)$/i.test(key)) args.oldText = val;
    else if (/^(new|new_str|newText|new_text)$/i.test(key)) args.newText = val;
    else if (/^(query|pattern|search)$/i.test(key)) args.query = val;
    else if (/^url$/i.test(key)) args.url = val;
    else if (!args[key]) args[key] = val;
  }
  if (!matched) {
    const trimmed = String(body || "").trim();
    if (trimmed) {
      if (/^[A-Za-z]:\\|^\/|\.\//.test(trimmed) || /\.[a-z]{1,5}$/i.test(trimmed)) args.path = trimmed;
      else args.command = trimmed;
    }
  }
  return args;
}

function toRelativePath(projectRoot, maybePath) {
  const raw = String(maybePath || "").trim();
  if (!raw || !projectRoot) return raw;
  try {
    const path = require("path");
    const root = path.resolve(projectRoot);
    const abs = path.resolve(raw);
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

function parseTextToolCalls(text, { projectRoot } = {}) {
  const src = String(text || "");
  if (!src.trim()) return [];
  const calls = [];

  // Formato: <tool_call><function=name>...</function></tool_call>
  const fnBlockRe = /<tool_call>\s*<function\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)\s*<\/function>\s*<\/tool_call>/gi;
  let m;
  while ((m = fnBlockRe.exec(src))) {
    const name = normalizeToolName(m[1]);
    if (!toolsKnown(name)) continue;
    const args = parseInnerArgs(m[2] || "");
    if (args.path) args.path = toRelativePath(projectRoot, args.path);
    calls.push({
      id: `text_tool_${calls.length + 1}_${Date.now()}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
      _fromText: true,
    });
  }

  // Formato clásico: <read_file>...</read_file>
  const names = TOOL_TAG_NAMES.join("|");
  const blockRe = new RegExp(`<(${names})>\\s*([\\s\\S]*?)\\s*<\\/\\1>`, "gi");
  while ((m = blockRe.exec(src))) {
    const name = normalizeToolName(m[1]);
    if (!toolsKnown(name)) continue;
    const args = parseInnerArgs(m[2] || "");
    if (args.path) args.path = toRelativePath(projectRoot, args.path);
    if (name === "run_command" && args.command && projectRoot) {
      const esc = String(projectRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      args.command = String(args.command)
        .replace(new RegExp(`^cd\\s+"?${esc}"?\\s*(?:&&|;)\\s*`, "i"), "")
        .trim();
    }
    calls.push({
      id: `text_tool_${calls.length + 1}_${Date.now()}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
      _fromText: true,
    });
  }
  return calls;
}

function stripTextToolMarkup(text) {
  let out = String(text || "");
  out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  out = out.replace(/<function\s*=\s*[a-zA-Z_][\w-]*\s*>[\s\S]*?<\/function>/gi, "");
  const names = TOOL_TAG_NAMES.join("|");
  const re = new RegExp(`<(${names})>\\s*[\\s\\S]*?\\s*<\\/\\1>`, "gi");
  out = out.replace(re, "");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = {
  parseTextToolCalls,
  stripTextToolMarkup,
  normalizeToolName,
  toRelativePath,
  ALIAS,
};
