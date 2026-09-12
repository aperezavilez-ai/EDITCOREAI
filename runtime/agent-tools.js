"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { ToolDispatcher } = require("./tool-dispatcher");
const { registerBrainTools } = require("./brain-tools");
const { resolveInside } = require("../project-path-policy");

const READ_METHODS = new Set(["GET", "HEAD"]);

const TOOL_SCHEMAS = {
  list_files:     { type: "object", properties: { path: { type: "string" } }, additionalProperties: true },
  read_file:      { type: "object", properties: { path: { type: "string", minLength: 1 }, startLine: { type: "integer" }, endLine: { type: "integer" } }, required: ["path"], additionalProperties: true },
  search_files:   { type: "object", properties: { query: { type: "string", minLength: 1 }, path: { type: "string" } }, required: ["query"], additionalProperties: true },
  write_file:     { type: "object", properties: { path: { type: "string", minLength: 1 }, content: { type: "string" } }, required: ["path", "content"], additionalProperties: true },
  replace_in_file:{ type: "object", properties: { path: { type: "string", minLength: 1 }, oldText: { type: "string", minLength: 1 }, newText: { type: "string" }, replaceAll: { type: "boolean" } }, required: ["path", "oldText", "newText"], additionalProperties: true },
  create_project: { type: "object", properties: { name: { type: "string", minLength: 1 }, template: { type: "string" }, path: { type: "string" } }, required: ["name"], additionalProperties: true },
  open_project: { type: "object", properties: { path: { type: "string" }, name: { type: "string" } }, additionalProperties: true },
  close_project: { type: "object", properties: {}, additionalProperties: true },
  run_command:    { type: "object", properties: { command: { type: "string", minLength: 1 } }, required: ["command"], additionalProperties: true },
  inspect_preview:{ type: "object", properties: { viewport: { type: "string", enum: ["desktop", "mobile"] } }, additionalProperties: true },
  connection_status: { type: "object", properties: { service: { type: "string" } }, additionalProperties: true },
  service_read:   { type: "object", properties: { service: { type: "string" }, method: { type: "string" }, path: { type: "string" } }, additionalProperties: true },
  service_write:  { type: "object", properties: { service: { type: "string" }, method: { type: "string" }, path: { type: "string" }, body: {} }, additionalProperties: true },
  write_file_batch: { type: "object", properties: { files: { type: "array" } }, required: ["files"], additionalProperties: true },
  scaffold_project: { type: "object", properties: { template: { type: "string" }, name: { type: "string" }, prompt: { type: "string" } }, additionalProperties: true },
  manage_process: { type: "object", properties: { action: { type: "string" }, command: { type: "string" }, port: { type: "integer" } }, additionalProperties: true },
  manage_dependencies: { type: "object", properties: { manager: { type: "string" }, action: { type: "string" }, packages: { type: "array" } }, additionalProperties: true },
  verify_project_health: { type: "object", properties: {}, additionalProperties: true },
  orchestrate_project_build: { type: "object", properties: { spec: { type: "string" }, template: { type: "string" } }, additionalProperties: true },
};

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", ".cache", "vendor", "target", ".svelte-kit", "out", ".output", ".vercel", ".turbo"]);

function lockFile(workspace, relPath, fileLocks) {
  if (!fileLocks) return;
  const abs = resolveInside(workspace.root, relPath).toLowerCase();
  const owner = fileLocks.map.get(abs);
  if (owner && owner !== fileLocks.key) throw new Error(`Archivo ocupado por otra tarea paralela: ${relPath}.`);
  fileLocks.map.set(abs, fileLocks.key);
  fileLocks.locked.add(abs);
}

function createAgentTools(workspace, options = {}) {
  const { canWrite = false, analysisMode = false, authorize = async () => true,
    fileLocks = null, brain = null, inspectPreview = null,
    runCommand = null, createProject = null, openProject = null, closeProject = null, getConnections = null,
    executeRemote = null, parseAnalysisCommand = null } = options;

  const dispatcher = new ToolDispatcher({ authorize: (tool, input) => authorize(tool, input) });
  const observedFiles = new Map();
  const observationKey = (target) => path.resolve(target).toLowerCase();
  const fileDigest = (target) => crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
  const observeFile = (target) => observedFiles.set(observationKey(target), fileDigest(target));
  const assertFreshObservation = (target, relPath) => {
    const observed = observedFiles.get(observationKey(target));
    if (!observed) throw new Error(`Lee ${relPath} antes de modificarlo para conservar su contenido actual.`);
    if (observed !== fileDigest(target)) throw new Error(`${relPath} cambio desde la ultima lectura. Vuelve a leerlo y aplica un parche actualizado.`);
  };

  // Sin permiso de escritura la herramienta no se registra, en lugar de registrarse
  // y rechazarse al despachar: si el modelo la ve en su catalogo la intenta, gasta un
  // paso y recibe "Operacion no autorizada". El doble control sigue vigente, porque
  // authorize se evalua igual para todo lo marcado write.
  const register = (tool) => {
    if (tool.write && !canWrite) return;
    dispatcher.register(tool);
  };

  dispatcher.register({ name: "list_files", description: "Lista archivos dentro del proyecto.", schema: TOOL_SCHEMAS.list_files,
    execute: (input) => workspace.listFiles(String(input.path || "")).filter((e) => e.kind !== "directory" || !SKIP_DIRS.has(e.name.toLowerCase())) });

  dispatcher.register({ name: "read_file", description: "Lee un archivo del proyecto. Devuelve cada linea con el prefijo 'N| '; cita esos numeros y quita el prefijo antes de reusar el texto en replace_in_file. startLine y endLine son base 1.", schema: TOOL_SCHEMAS.read_file,
    execute: (input) => {
      const relPath = String(input.path || "");
      const result = workspace.readFile(relPath, { startLine: input.startLine, endLine: input.endLine });
      const target = resolveInside(workspace.root, result.path || relPath);
      if (fs.existsSync(target) && fs.statSync(target).isFile()) observeFile(target);
      return result;
    } });

  dispatcher.register({ name: "search_files", description: "Busca texto en archivos del proyecto.", schema: TOOL_SCHEMAS.search_files,
    execute: (input) => workspace.searchFiles(String(input.query || ""), String(input.path || "")) });

  register({ name: "write_file", description: "Escribe un archivo del proyecto.", schema: TOOL_SCHEMAS.write_file, write: true,
    execute: (input) => {
      const relPath = String(input.path || "");
      lockFile(workspace, relPath, fileLocks);
      const target = resolveInside(workspace.root, relPath);
      if (fs.existsSync(target)) {
        if (/^\.env(?:\.|$)/i.test(path.basename(relPath))) throw new Error(`No se permite sobrescribir ${relPath} completo. Usa replace_in_file.`);
        assertFreshObservation(target, relPath);
      }
      const result = workspace.writeFile(relPath, String(input.content || ""));
      observeFile(target);
      return result;
    } });

  register({ name: "replace_in_file", description: "Reemplaza texto exacto dentro de un archivo existente.", schema: TOOL_SCHEMAS.replace_in_file, write: true,
    execute: (input) => {
      const relPath = String(input.path || "");
      const target = resolveInside(workspace.root, relPath);
      lockFile(workspace, relPath, fileLocks);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`Archivo no encontrado: ${relPath}`);
      assertFreshObservation(target, relPath);
      const oldText = String(input.oldText ?? "");
      const newText = String(input.newText ?? "");
      if (!oldText) throw new Error("replace_in_file requiere oldText no vacio.");
      const content = fs.readFileSync(target, "utf8");
      const occurrences = content.split(oldText).length - 1;
      if (!occurrences) throw new Error("El texto exacto de oldText no existe. Vuelve a leer el archivo y reintenta el parche; no sobrescribas el archivo completo.");
      if (occurrences > 1 && input.replaceAll !== true) throw new Error(`oldText aparece ${occurrences} veces. Usa un bloque mas especifico o replaceAll: true.`);
      const next = input.replaceAll === true ? content.split(oldText).join(newText) : content.replace(oldText, newText);
      const result = workspace.writeFile(relPath, next);
      observeFile(target);
      return { ...result, replacements: input.replaceAll === true ? occurrences : 1 };
    } });

  register({ name: "run_command", description: "Ejecuta un comando permitido.", schema: TOOL_SCHEMAS.run_command, write: !analysisMode,
    execute: (input) => {
      const command = String(input.command || "");
      const { isShellExploreCommand, extractShellExplorePathHint } = require("../command-policy");
      if (isShellExploreCommand(command)) {
        let listPath = String(extractShellExplorePathHint(command) || "");
        if (path.isAbsolute(listPath)) {
          try {
            listPath = path.relative(workspace.root, listPath);
            if (listPath.startsWith("..")) listPath = "";
          } catch {
            listPath = "";
          }
        }
        const entries = workspace.listFiles(listPath || "").filter((e) => e.kind !== "directory" || !SKIP_DIRS.has(e.name.toLowerCase()));
        return {
          redirectedFrom: "run_command",
          usedTool: "list_files",
          path: listPath || ".",
          entries,
          note: "Exploracion por shell convertida a list_files.",
        };
      }
      if (analysisMode && parseAnalysisCommand) parseAnalysisCommand(command);
      if (!runCommand) throw new Error("run_command no esta configurado.");
      return runCommand(command);
    } });

  if (createProject) {
    register({ name: "create_project", description: "Crea un proyecto dentro del workspace.", schema: TOOL_SCHEMAS.create_project, write: true,
      execute: (input) => createProject(input) });
  }

  if (typeof openProject === "function") {
    dispatcher.register({
      name: "open_project",
      description: "Abre una carpeta real en el panel de EDITCOREAI.",
      schema: TOOL_SCHEMAS.open_project,
      execute: (input) => openProject(input),
    });
  }

  if (typeof closeProject === "function") {
    dispatcher.register({
      name: "close_project",
      description: "Cierra el proyecto abierto en el panel de EDITCOREAI.",
      schema: TOOL_SCHEMAS.close_project,
      execute: (input) => closeProject(input),
    });
  }

  if (inspectPreview) {
    dispatcher.register({ name: "inspect_preview", description: "Inspecciona el proyecto en un navegador Electron real.", schema: TOOL_SCHEMAS.inspect_preview,
      execute: (input) => inspectPreview(input) });
  }

  if (getConnections) {
    dispatcher.register({ name: "connection_status", description: "Consulta conexiones configuradas.", schema: TOOL_SCHEMAS.connection_status,
      execute: (input) => { const summary = getConnections(); const svc = String(input.service || "").toLowerCase(); return svc ? { [svc]: summary[svc] || { configured: false } } : summary; } });
  }

  if (executeRemote) {
    dispatcher.register({ name: "service_read", description: "Lee datos de un servicio conectado.", schema: TOOL_SCHEMAS.service_read,
      execute: (input) => { const method = String(input.method || "GET").toUpperCase(); if (!READ_METHODS.has(method)) throw new Error("service_read solo permite GET o HEAD."); return executeRemote({ ...input, method }); } });
    register({ name: "service_write", description: "Modifica un servicio conectado.", schema: TOOL_SCHEMAS.service_write, write: true,
      execute: (input) => { const method = String(input.method || "POST").toUpperCase(); if (READ_METHODS.has(method)) throw new Error("service_write requiere POST, PATCH, PUT o DELETE."); return executeRemote({ ...input, method }); } });
  }

  if (brain) {
    registerBrainTools(dispatcher, {
      brain: {
        searchForAgent: (_root, query, opts) => brain.search(query, opts),
        readSkillForAgent: (_root, name) => brain.getSkill(name),
        agentInventory: brain.agentInventory,
      },
      rootPath: workspace.root,
      hostTools: () => dispatcher.definitions(),
    });
  }

  return dispatcher;
}

module.exports = { createAgentTools };
