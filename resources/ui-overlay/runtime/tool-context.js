"use strict";

const crypto = require("node:crypto");

const TOOL_METADATA = {
  list_files: { category: "files", stages: ["discovery"], capabilities: ["list"] },
  read_file: { category: "files", stages: ["discovery", "modification", "verification", "recovery"], capabilities: ["read"] },
  search_files: { category: "files", stages: ["discovery", "modification", "recovery"], capabilities: ["search"] },
  write_file: { category: "files", stages: ["modification", "recovery"], capabilities: ["write"] },
  replace_in_file: { category: "files", stages: ["modification", "recovery"], capabilities: ["edit"] },
  create_project: { category: "project", stages: ["modification"], capabilities: ["create"] },
  generate_image: { category: "assets", stages: ["modification"], capabilities: ["image-gen"] },
  generate_video: { category: "assets", stages: ["modification"], capabilities: ["video-gen"] },
  open_project: { category: "project", stages: ["discovery", "modification"], capabilities: ["open"] },
  close_project: { category: "project", stages: ["discovery", "modification"], capabilities: ["close"] },
  switch_project: { category: "project", stages: ["discovery", "modification"], capabilities: ["open", "close", "switch"] },
  run_command: { category: "execution", stages: ["modification", "verification", "recovery"], capabilities: ["execute", "verify"] },
  inspect_preview: { category: "preview", stages: ["verification"], capabilities: ["visual-verify"] },
  connection_status: { category: "connections", stages: ["discovery"], capabilities: ["connection-read"] },
  service_read: { category: "connections", stages: ["discovery"], capabilities: ["remote-read"] },
  service_write: { category: "connections", stages: ["modification", "recovery"], capabilities: ["remote-write"] },
  retrieve_context: { category: "context", stages: ["discovery", "modification", "verification", "recovery"], capabilities: ["retrieve-reference"] },
  load_tool_descriptor: { category: "context", stages: ["discovery", "modification", "verification", "recovery"], capabilities: ["load-tool"] },
  brain_search: { category: "brain", stages: ["discovery", "recovery"], capabilities: ["memory-search", "code-search"] },
  brain_skill: { category: "brain", stages: ["discovery", "modification", "verification", "recovery"], capabilities: ["skill-load"] },
  brain_tools: { category: "brain", stages: ["discovery"], capabilities: ["capability-list"] },
  project_discovery: { category: "engineering", stages: ["discovery", "recovery"], capabilities: ["stack", "scripts", "entrypoints"] },
  codebase_map: { category: "engineering", stages: ["discovery", "recovery"], capabilities: ["modules", "symbols", "dependencies"] },
  symbol_search: { category: "engineering", stages: ["discovery", "modification", "recovery"], capabilities: ["symbol-search"] },
  dependency_search: { category: "engineering", stages: ["discovery", "modification", "recovery"], capabilities: ["import-search", "reference-search"] },
  create_plan: { category: "engineering", stages: ["discovery", "modification", "recovery"], capabilities: ["structured-plan"] },
  select_verification: { category: "engineering", stages: ["modification", "verification", "recovery"], capabilities: ["test-selection"] },
  diagnose_result: { category: "engineering", stages: ["verification", "recovery"], capabilities: ["diagnosis", "root-cause"] },
  review_diff: { category: "engineering", stages: ["verification"], capabilities: ["diff-review"] },
};

const STAGE_DEFAULTS = {
  discovery: ["project_discovery", "codebase_map", "symbol_search", "dependency_search", "create_plan", "list_files", "search_files", "read_file", "open_project", "close_project", "switch_project", "load_tool_descriptor"],
  modification: ["project_discovery", "codebase_map", "symbol_search", "dependency_search", "create_plan", "read_file", "write_file", "replace_in_file", "open_project", "close_project", "switch_project", "select_verification", "run_command", "load_tool_descriptor"],
  verification: ["select_verification", "run_command", "diagnose_result", "review_diff", "read_file", "load_tool_descriptor"],
  recovery: ["project_discovery", "codebase_map", "symbol_search", "dependency_search", "diagnose_result", "select_verification", "read_file", "search_files", "replace_in_file", "write_file", "run_command", "load_tool_descriptor", "retrieve_context"],
  final: [],
};

const COMPACT_REQUIRED = {
  list_files: ["path"], read_file: ["path"], search_files: ["query"], write_file: ["path", "content"],
  replace_in_file: ["path", "oldText", "newText"], create_project: ["name"], run_command: ["command"],
  inspect_preview: [], connection_status: [], service_read: ["service", "path"], service_write: ["service", "path"],
  retrieve_context: ["id"], load_tool_descriptor: ["name"], brain_search: ["query"], brain_skill: ["name"], brain_tools: [],
  project_discovery: [], codebase_map: [], symbol_search: ["query"], dependency_search: ["query"],
  create_plan: ["objective", "steps"], select_verification: ["changedFiles"], diagnose_result: ["output"], review_diff: [],
  open_project: ["path"], close_project: [], switch_project: ["path"],
};

const MUTATION_TOOLS = new Set(["write_file", "replace_in_file", "create_project", "service_write", "apply_diff", "generate_image", "generate_video", "publish_project", "connect_project", "provision_project", "onboard_project", "create_supabase_project", "sync_vercel_env", "supabase_manage", "ssh_deploy"]);
const VERIFICATION_TOOLS = new Set(["select_verification", "inspect_preview", "review_diff"]);
const VERIFICATION_COMMAND = /(^|\s|:)(test|build|lint|check|typecheck)(\s|$)/i;

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value || null)).digest("hex");
}

function toolName(definition) {
  return String(definition?.function?.name || definition?.name || "");
}

function compactDefinition(definition) {
  if (!definition) return null;
  const name = toolName(definition);
  const source = definition?.function?.parameters || { type: "object", properties: {} };
  const properties = source.properties || {};
  const retainedNames = COMPACT_REQUIRED[name] || [];
  const compactProperties = Object.fromEntries(retainedNames.filter((key) => properties[key]).map((key) => [key, properties[key]]));
  const requiredNames = (source.required || []).filter((key) => compactProperties[key]);
  return {
    type: "function",
    function: {
      name,
      description: String(definition?.function?.description || name).split(/[.!?]\s/)[0].slice(0, 90),
      parameters: { type: "object", properties: compactProperties, required: requiredNames.filter((key) => compactProperties[key]), additionalProperties: true },
    },
  };
}

function inferStage({ steps = [], changedFiles = [], task = "", finalPhase = false } = {}) {
  if (finalPhase) return "verification";
  const last = steps.at(-1);
  if (last?.ok === false || last?.result?.error) return "recovery";
  const needsWrite = /\b(crea|corrige|modifica|agrega|elimina|instala|implementa|repara|actualiza|cambia|construye|desarrolla|configura)\b/i.test(String(task));
  const hasMutation = changedFiles.length > 0 || steps.some((step) => MUTATION_TOOLS.has(step?.name) && step?.ok !== false && !step?.result?.error);
  const explicitVerification = VERIFICATION_TOOLS.has(last?.name)
    || (last?.name === "run_command" && VERIFICATION_COMMAND.test(String(last?.input?.command || "")));
  if (explicitVerification && (!needsWrite || hasMutation)) return "verification";
  if (hasMutation) return "modification";
  const hasDiscovery = steps.some((step) => [
    "project_discovery", "codebase_map", "symbol_search", "dependency_search", "create_plan",
    "list_files", "search_files", "read_file", "brain_search", "service_read",
  ].includes(step?.name) && step?.ok !== false);
  return needsWrite && hasDiscovery ? "modification" : "discovery";
}

class ToolContext {
  constructor(definitions = []) {
    this.definitions = new Map(definitions.map((definition) => [toolName(definition), definition]).filter(([name]) => name));
    this.expanded = new Set();
    this.cache = new Map();
    this.descriptorCache = new Map();
  }

  update(definitions = []) {
    this.definitions = new Map(definitions.map((definition) => [toolName(definition), definition]).filter(([name]) => name));
    this.cache.clear();
    this.descriptorCache.clear();
    return this;
  }

  catalog() {
    return [...this.definitions.keys()].map((name) => ({
      tool_id: name,
      name,
      category: TOOL_METADATA[name]?.category || "other",
      capabilities: TOOL_METADATA[name]?.capabilities || [],
      schema: "available_on_demand",
    }));
  }

  load(name) {
    const id = String(name || "").trim();
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Herramienta no disponible: ${id}`);
    this.expanded.add(id);
    this.cache.clear();
    if (this.descriptorCache.has(id)) return this.descriptorCache.get(id);
    const descriptor = {
      tool_id: id,
      name: id,
      description: definition.function?.description || id,
      category: TOOL_METADATA[id]?.category || "other",
      capabilities: TOOL_METADATA[id]?.capabilities || [],
      parameters: definition.function?.parameters || { type: "object", properties: {} },
      restrictions: definition.function?.parameters?.additionalProperties === false ? ["No acepta parametros adicionales."] : [],
    };
    const cached = { ...descriptor, hash: hash(descriptor) };
    this.descriptorCache.set(id, cached);
    return cached;
  }

  select({ stage = "discovery", canWrite = true, analysisMode = false, task = "", needsContextRetrieval = false, evidenceCount = 0, repairPending = false, targetInspectionPending = false, mutationPending = false } = {}) {
    const safeStage = STAGE_DEFAULTS[stage] ? stage : "discovery";
    const names = new Set(STAGE_DEFAULTS[safeStage]);
    for (const name of this.expanded) names.add(name);
    if (safeStage === "verification") {
      for (const name of ["write_file", "replace_in_file", "create_project", "service_write"]) names.delete(name);
    }
    if (!canWrite || analysisMode) {
      for (const name of ["write_file", "replace_in_file", "create_project", "service_write"]) names.delete(name);
    }
    if (/\b(github|vercel|supabase|conexion|conexi[oó]n|servicio|api)\b/i.test(String(task))) {
      names.add("connection_status");
      names.add("service_read");
      if (canWrite && !analysisMode && safeStage !== "discovery") names.add("service_write");
    }
    if (/\b(crea|crear|nuevo proyecto|desde cero|plantilla)\b/i.test(String(task)) && canWrite && !analysisMode) names.add("create_project");
    if (/\b(interfaz|frontend|visual|web|website|landing|dashboard|pagina|p[aá]gina|dise[nñ]o|ux|ui)\b/i.test(String(task)) && safeStage === "verification") names.add("inspect_preview");
    if (needsContextRetrieval) names.add("retrieve_context");
    if (/\b(skill|brain|cerebro|memoria)\b/i.test(String(task))) {
      names.add("brain_search");
      names.add("brain_skill");
      names.add("brain_tools");
    }
    if (/\b(code review|audita|auditar|security audit|seguridad|optimiza performance|rendimiento|debugging|depura|depurar)\b/i.test(String(task))) {
      names.add("brain_search");
      names.add("brain_skill");
    }
    if (safeStage === "modification" && canWrite && !analysisMode && Number(evidenceCount) >= 1) {
      for (const name of ["project_discovery", "codebase_map", "symbol_search", "dependency_search", "create_plan", "list_files", "search_files", "load_tool_descriptor"]) names.delete(name);
    }
    if (safeStage === "modification" && canWrite && !analysisMode && Number(evidenceCount) >= 2) {
      names.delete("read_file");
    }
    if (safeStage === "modification" && canWrite && !analysisMode && targetInspectionPending) {
      for (const name of ["write_file", "replace_in_file", "create_project", "service_write", "select_verification", "run_command"]) names.delete(name);
      names.add("read_file");
    } else if (safeStage === "modification" && canWrite && !analysisMode && mutationPending) {
      names.delete("select_verification");
      names.delete("run_command");
    }
    if (safeStage === "recovery" && canWrite && !analysisMode && repairPending) {
      for (const name of ["project_discovery", "codebase_map", "symbol_search", "dependency_search", "create_plan", "list_files", "search_files"]) names.delete(name);
    }
    if (repairPending) names.delete("run_command");
    const cacheKey = hash({ definitions: [...this.definitions.keys()], names: [...names].sort(), expanded: [...this.expanded].sort() });
    if (!this.cache.has(cacheKey)) {
      this.cache.set(cacheKey, [...names].map((name) => {
        const definition = this.definitions.get(name);
        return this.expanded.has(name) ? definition : compactDefinition(definition);
      }).filter(Boolean));
    }
    return {
      stage: safeStage,
      definitions: this.cache.get(cacheKey),
      selected: [...names].filter((name) => this.definitions.has(name)),
      available: [...this.definitions.keys()],
      hash: cacheKey,
    };
  }
}

module.exports = { COMPACT_REQUIRED, STAGE_DEFAULTS, TOOL_METADATA, ToolContext, compactDefinition, inferStage, toolName };
