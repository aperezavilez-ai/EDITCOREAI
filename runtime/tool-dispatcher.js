"use strict";

const TOOL_ALIASES = Object.freeze({
  execute_command: "run_command",
  exec_command: "run_command",
  run_cmd: "run_command",
  runcommand: "run_command",
  "run command": "run_command",
  terminal_command: "run_command",
  run_terminal_command: "run_command",
  "run terminal command": "run_command",
  run_terminal: "run_command",
  shell_command: "run_command",
  "shell command": "run_command",
  command: "run_command",
  list_dir: "list_files",
  list_directory: "list_files",
  list_project_files: "list_files",
  read_text_file: "read_file",
  read_project_file: "read_file",
  readfile: "read_file",
  write_project_file: "write_file",
  writefile: "write_file",
  edit_file: "replace_in_file",
  replace_project_file: "replace_in_file",
  replace_text: "replace_in_file",
  search_code: "search_files",
  search_project_files: "search_files",
  file_search: "search_files",
  "file search": "search_files",
  search_file: "search_files",
  "search file": "search_files",
  find_files: "search_files",
  find_in_files: "search_files",
  grep: "search_files",
});

function normalizeToolInput(canonicalName, input) {
  const value = input && typeof input === "object" ? { ...input } : {};
  if (canonicalName === "run_command" && !value.command) value.command = value.cmd || value.script || "";
  if (canonicalName === "run_command" && value.cwd === undefined) value.cwd = value.workingDirectory || value.working_directory || value.directory || "";
  if (["list_files", "read_file"].includes(canonicalName) && value.path === undefined) value.path = value.directory || value.file || "";
  if (canonicalName === "search_files" && !value.query) value.query = value.pattern || value.text || value.search || value.term || value.needle || "";
  if (canonicalName === "search_files" && value.path === undefined) value.path = value.directory || value.folder || value.cwd || "";
  if (canonicalName === "write_file") {
    if (value.path === undefined) value.path = value.filePath || value.file_path || value.relativePath || value.relative_path || value.file || "";
    if (value.content === undefined) value.content = value.fileContent ?? value.file_content ?? value.code ?? value.text ?? "";
  }
  if (canonicalName === "replace_in_file") {
    if (value.path === undefined) value.path = value.filePath || value.file_path || value.relativePath || value.relative_path || value.file || "";
    if (value.oldText === undefined) value.oldText = value.old_text ?? value.search ?? value.before ?? "";
    if (value.newText === undefined) value.newText = value.new_text ?? value.replacement ?? value.after ?? "";
  }
  return value;
}

class ToolDispatcher {
  constructor({ audit = () => undefined, authorize = async () => false, defaultTimeoutMs = 120000 } = {}) {
    this.tools = new Map();
    this.audit = audit;
    this.authorize = authorize;
    this.defaultTimeoutMs = Math.max(10, Number(defaultTimeoutMs) || 120000);
  }

  register(definition) {
    if (!definition?.name || typeof definition.execute !== "function") throw new Error("Definicion de herramienta invalida.");
    this.tools.set(definition.name, { ...definition, schema: definition.schema || { type: "object", properties: {} } });
  }

  definitions() {
    return [...this.tools.values()].map(({ name, description, schema }) => ({ type: "function", function: { name, description: description || name, parameters: schema } }));
  }

  async dispatch(name, input = {}, context = {}) {
    const requestedName = String(name || "");
    const canonicalName = TOOL_ALIASES[requestedName] || requestedName;
    const normalizedInput = normalizeToolInput(canonicalName, input);
    const tool = this.tools.get(canonicalName);
    const startedAt = Date.now();
    if (!tool) return this.fail(requestedName, "Herramienta desconocida.", startedAt, context);
    try {
      if (tool.write && !(await this.authorize(tool, normalizedInput, context))) return this.fail(canonicalName, "Operacion no autorizada.", startedAt, context);
      const timeoutMs = Math.max(10, Number(tool.timeoutMs) || this.defaultTimeoutMs);
      const execution = Promise.resolve().then(() => tool.execute(normalizedInput, context));
      let timer = null;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`La herramienta ${tool.name} excedio ${timeoutMs} ms.`), { code: "TOOL_TIMEOUT" })), timeoutMs); });
      const result = await Promise.race([execution, timeout]).finally(() => clearTimeout(timer));
      const record = { ok: true, name: tool.name, result, durationMs: Date.now() - startedAt, actionId: String(context.actionId || ""), metadata: { timeoutMs, ...(context.metadata || {}) } };
      await this.audit({ ...record, input: normalizedInput, context: { ...context, requestedToolName: requestedName } });
      return record;
    } catch (error) {
      return this.fail(canonicalName, String(error?.message || error), startedAt, context, normalizedInput);
    }
  }

  async fail(name, error, startedAt, context, input = {}) {
    const record = { ok: false, name: String(name || ""), error, durationMs: Date.now() - startedAt, actionId: String(context.actionId || ""), metadata: { ...(context.metadata || {}) } };
    await this.audit({ ...record, input, context });
    return record;
  }
}

module.exports = { ToolDispatcher };
