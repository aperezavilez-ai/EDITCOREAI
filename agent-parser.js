"use strict";

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlValue(value) {
  const decoded = decodeXml(value).trim();
  if (/^(true|false)$/i.test(decoded)) return decoded.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(decoded)) return Number(decoded);
  try { return JSON.parse(decoded); } catch { return decoded; }
}

function normalizeAgentToolInput(name, value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const nested = raw.input && typeof raw.input === "object" && !Array.isArray(raw.input) ? raw.input : {};
  const input = { ...nested, ...raw };
  delete input.input;
  const first = (...keys) => keys.map((key) => input[key]).find((item) => item !== undefined && item !== null && item !== "");
  if (["list_files", "read_file", "write_file", "replace_in_file"].includes(name)) {
    input.path = first("path", "filePath", "file_path", "relativePath", "relative_path", "filename", "file") ?? "";
  }
  if (name === "write_file") input.content = first("content", "fileContent", "file_content", "code", "text") ?? "";
  if (name === "replace_in_file") {
    input.oldText = first("oldText", "old_text", "search", "before") ?? "";
    input.newText = first("newText", "new_text", "replacement", "after") ?? "";
    const rawReplaceAll = first("replaceAll", "replace_all");
    input.replaceAll = rawReplaceAll === true || rawReplaceAll === "true";
  }
  if (name === "search_files") {
    input.query = first("query", "search", "term", "pattern") ?? "";
    input.path = first("path", "directory", "folder") ?? input.path ?? "";
  }
  if (name === "run_command") {
    input.command = first("command", "cmd", "shell_command", "shellCommand") ?? "";
    input.cwd = first("cwd", "workingDirectory", "working_directory", "directory") ?? input.cwd ?? "";
  }
  if (name === "create_project") input.name = first("name", "projectName", "project_name") ?? "";
  return input;
}

function normalizeAgentToolAction(name, value) {
  let requestedName = String(name || "").trim().toLowerCase();
  requestedName = requestedName.replace(/[\s.-]+/g, "_");
  if (["execute_command", "exec_command", "run_cmd", "command", "runcommand", "run_command", "terminal_command", "run_terminal", "run_terminal_command", "shell_command"].includes(requestedName)) {
    requestedName = "run_command";
  } else if (["read_project_file", "readfile", "read"].includes(requestedName)) {
    requestedName = "read_file";
  } else if (["write_project_file", "writefile", "write"].includes(requestedName)) {
    requestedName = "write_file";
  } else if (["replace_project_file", "replacefile", "replace_text", "edit_file"].includes(requestedName)) {
    requestedName = "replace_in_file";
  } else if (["list_project_files", "listfiles", "list", "list_dir", "list_directory"].includes(requestedName)) {
    requestedName = "list_files";
  } else if (["search_project_files", "searchfiles", "search", "search_files", "file_search", "search_file", "find_files", "find_in_files", "grep"].includes(requestedName)) {
    requestedName = "search_files";
  }
  const input = normalizeAgentToolInput(requestedName, value);
  const effectiveName = requestedName === "read_file" && !String(input.path || "").trim()
    ? "list_files"
    : requestedName;
  return { type: "tool", name: effectiveName, input };
}

function containsAgentProtocol(value) {
  return /<(?:tool_call|tool_use|function_calls?|invoke)\b|<function(?:\s|=)|<parameter(?:\s|=)|\btool_calls?\b|["']type["']\s*:\s*["']tool["']|\b(?:list_files|list_dir|read_file|write_file|replace_in_file|search_files|run_command|create_project|open_project|close_project|project_discovery|codebase_map|symbol_search|dependency_search|inspect_preview|brain_search|brain_skill|brain_tools|fetch_url)\s*\(/i.test(String(value || ""));
}

function providerToolCallAction(call) {
  if (!call || typeof call !== "object") return null;
  const fn = call.function && typeof call.function === "object" ? call.function : call;
  const name = String(fn.name || call.name || "").trim();
  if (!name) return null;
  let input = fn.arguments ?? fn.input ?? call.arguments ?? call.input ?? {};
  if (typeof input === "string") {
    input = safeParseToolArguments(input);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) input = {};
  return normalizeAgentToolAction(name, input);
}

/** Garantiza que arguments de tool_call sea JSON object-string valido (nunca lanza). */
function safeParseToolArguments(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {}
  // Recorte al primer objeto balanceado si el modelo mando basura alrededor.
  const start = text.indexOf("{");
  if (start < 0) return {};
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
          return {};
        }
      }
    }
  }
  return {};
}

function sanitizeToolCallArguments(raw) {
  if (raw == null) return "{}";
  if (typeof raw === "object") {
    try { return JSON.stringify(raw); } catch { return "{}"; }
  }
  const text = String(raw).trim();
  if (!text) return "{}";
  try {
    JSON.parse(text);
    return text;
  } catch {
    return JSON.stringify(safeParseToolArguments(text));
  }
}

function sanitizeMessagesToolArguments(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    if (!Array.isArray(msg.tool_calls) || !msg.tool_calls.length) return msg;
    return {
      ...msg,
      tool_calls: msg.tool_calls.map((call) => {
        const fn = call?.function || {};
        return {
          ...call,
          type: call.type || "function",
          function: {
            ...fn,
            name: String(fn.name || ""),
            arguments: sanitizeToolCallArguments(fn.arguments ?? fn.input ?? "{}"),
          },
        };
      }),
    };
  });
}

function isAgentActionComplete(action) {
  if (!action || typeof action !== "object") return false;
  if (action.type === "final") return Boolean(String(action.text || "").trim());
  if (action.type !== "tool" || !action.name) return false;
  const input = action.input && typeof action.input === "object" ? action.input : {};
  const nonEmpty = (key) => Boolean(String(input[key] ?? "").trim());
  if (action.name === "read_file") return nonEmpty("path");
  if (action.name === "search_files") return nonEmpty("query");
  if (action.name === "write_file") return nonEmpty("path") && input.content !== undefined;
  if (action.name === "replace_in_file") return nonEmpty("path") && nonEmpty("oldText") && input.newText !== undefined;
  if (action.name === "create_project") return nonEmpty("name");
  if (action.name === "run_command") return nonEmpty("command");
  return true;
}

function selectAgentResponse(toolCall, content) {
  const nativeAction = providerToolCallAction(toolCall);
  const contentAction = parseAgentPayload(content);
  if (isAgentActionComplete(nativeAction)) return nativeAction;
  if (isAgentActionComplete(contentAction)) return contentAction;
  return nativeAction || contentAction || null;
}

function parseXmlToolCall(raw) {
  const str = String(raw || "");
  const invokeMatch = str.match(/<invoke\s+name=["']?([\w.-]+)["']?\s*>([\s\S]*?)<\/invoke>/i);
  let name = "";
  let parameters = "";

  if (invokeMatch) {
    name = invokeMatch[1].trim();
    parameters = invokeMatch[2] || "";
  } else {
    const blockMatch = str.match(/<(tool_call|tool_use|tool_invocation|function_calls?)\b[^>]*>([\s\S]*?)<\/\1>/i);
    const block = blockMatch?.[2] || str;
    const functionBlock = block.match(/<function\s*=\s*["']?([\w.-]+)["']?\s*>([\s\S]*?)<\/function>/i);
    name = decodeXml(
      block.match(/<(?:tool_name|name)>[\s\S]*?<\/(?:tool_name|name)>/i)?.[0]
        ?.replace(/^<[^>]+>|<\/[^>]+>$/g, "")
        || functionBlock?.[1]
    ).trim();
    parameters = block.match(/<(?:parameters|arguments|input)>([\s\S]*?)<\/(?:parameters|arguments|input)>/i)?.[1] || functionBlock?.[2] || block;
  }

  if (!name) return null;

  let input = {};
  const decodedParameters = decodeXml(parameters).trim();
  try {
    const parsed = JSON.parse(decodedParameters);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed;
  } catch {}

  const fieldPattern = /<parameter\s+name=["']?([a-zA-Z_][\w.-]*)["']?\s*>([\s\S]*?)<\/parameter>|<([a-zA-Z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\3>/gi;
  let match;
  const aliases = { filePath: "path", relativePath: "path" };
  while ((match = fieldPattern.exec(parameters))) {
    const key = match[1] || match[3];
    const val = match[2] !== undefined ? match[2] : match[4];
    if (!key || ["invoke", "function_calls", "function_call", "tool_call", "parameters", "arguments", "input"].includes(key.toLowerCase())) continue;
    const finalKey = aliases[key] || key;
    if (finalKey === "name" && input.name) continue;
    input[finalKey] = xmlValue(val);
  }

  return normalizeAgentToolAction(name, input);
}

const PLAIN_TOOL_NAMES = new Set([
  "list_files", "list_dir", "read_file", "write_file", "replace_in_file",
  "search_files", "run_command", "create_project", "open_project", "close_project", "project_discovery",
  "codebase_map", "symbol_search", "dependency_search", "inspect_preview",
  "brain_search", "brain_skill", "brain_tools", "fetch_url",
]);

function splitPlainArguments(value) {
  const parts = [];
  let start = 0;
  let quote = "";
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (["{", "[", "("].includes(char)) depth += 1;
    else if (["}", "]", ")"].includes(char)) depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function plainValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw); } catch {}
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/\\'/g, "'").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  if (/^(true|false)$/i.test(raw)) return raw.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  try { return JSON.parse(raw); } catch { return raw; }
}

function parsePlainToolArguments(value) {
  const input = {};
  for (const part of splitPlainArguments(value)) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    if (!/^[A-Za-z_][\w.-]*$/.test(key)) continue;
    input[key] = plainValue(part.slice(separator + 1));
  }
  return input;
}

function extractPlainToolCalls(text) {
  const raw = String(text || "");
  const actions = [];
  const pattern = /\b([A-Za-z_][\w.-]*)\s*\(/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const name = String(match[1] || "").toLowerCase().replace(/[\s.-]+/g, "_");
    if (!PLAIN_TOOL_NAMES.has(name)) continue;
    let quote = "";
    let escaped = false;
    let depth = 1;
    let end = match.index + match[0].length;
    for (; end < raw.length; end += 1) {
      const char = raw[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    const args = raw.slice(match.index + match[0].length, end);
    const action = normalizeAgentToolAction(name, parsePlainToolArguments(args));
    if (isAgentActionComplete(action)) actions.push(action);
    pattern.lastIndex = end + 1;
  }
  return actions;
}

function narrationWithoutToolCalls(text) {
  const raw = String(text || "");
  const first = raw.search(/\b(?:list_files|list_dir|read_file|write_file|replace_in_file|search_files|run_command|create_project|open_project|close_project|project_discovery|codebase_map|symbol_search|dependency_search|inspect_preview|brain_search|brain_skill|brain_tools|fetch_url)\s*\(/i);
  let cleaned = (first >= 0 ? raw.slice(0, first) : raw)
    .replace(/```(?:json|bash|shell)?\s*$/i, "")
    .trim();

  if (!cleaned || /^\s*\{[\s\S]*\}\s*$/.test(cleaned)) {
    const thoughtMatch = raw.match(/"(?:thought|reasoning|analysis|thinking)"\s*:\s*"((?:[^"\\]|\\.)*)"/i)
      || raw.match(/<(?:thinking|thought|reasoning)>([\s\S]*?)(?:<\/(?:thinking|thought|reasoning)>|$)/i);
    if (thoughtMatch && thoughtMatch[1]) {
      cleaned = thoughtMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
    }
  }
  return cleaned;
}

function parseAgentPayload(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  if (/<(?:tool_call|tool_use|tool_invocation)\b/i.test(raw)) {
    const xmlAction = parseXmlToolCall(raw);
    if (xmlAction) return xmlAction;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed?.type === "tool" ? normalizeAgentToolAction(parsed.name, parsed.input) : parsed;
  } catch {}
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") { if (depth === 0) start = i; depth += 1; }
    else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        try {
          const parsed = JSON.parse(raw.slice(start, i + 1));
          return parsed?.type === "tool" ? normalizeAgentToolAction(parsed.name, parsed.input) : parsed;
        } catch {}
        start = -1;
      }
    }
  }
  return parseXmlToolCall(raw);
}

module.exports = {
  containsAgentProtocol,
  extractPlainToolCalls,
  isAgentActionComplete,
  narrationWithoutToolCalls,
  normalizeAgentToolAction,
  normalizeAgentToolInput,
  parseAgentPayload,
  parsePlainToolArguments,
  parseXmlToolCall,
  providerToolCallAction,
  safeParseToolArguments,
  sanitizeToolCallArguments,
  sanitizeMessagesToolArguments,
  selectAgentResponse,
};
