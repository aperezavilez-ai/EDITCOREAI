"use strict";

/**
 * SURFACE CONTRACT — Contrato unificado IDE ↔ Web (EditCoreAI Fase 5)
 *
 * Objetivo:
 *  - Una sola forma de invocar operaciones de agente, archivos, sesión y estado
 *    tanto desde Electron (IDE) como desde el web-portal.
 *  - Mismos nombres, mismos shapes de request/response, mismos códigos de error.
 *  - Capacidades declaradas por superficie (lo que la web no puede hacer se marca
 *    `available: false` en lugar de romper).
 *
 * Uso:
 *   const { createSurface, SURFACE_OPS, normalizeResult } = require("./surface-contract");
 *   const surface = createSurface({ kind: "ide", projectRoot, adapters: { ... } });
 *   const r = await surface.invoke("files.write", { path: "a.js", content: "..." });
 */

const SURFACE_VERSION = "5.0";

/** Operaciones canónicas compartidas */
const SURFACE_OPS = Object.freeze({
  // Sesión / cuenta
  "session.get": { minSurface: "both", description: "Estado de sesión y cuenta" },
  "session.balance": { minSurface: "both", description: "Saldo / créditos" },

  // Proyecto
  "project.open": { minSurface: "both", description: "Abrir / seleccionar proyecto" },
  "project.status": { minSurface: "both", description: "Estado del proyecto activo" },
  "project.list": { minSurface: "both", description: "Listar proyectos" },

  // Archivos (contrato unificado)
  "files.read": { minSurface: "both", description: "Leer archivo" },
  "files.write": { minSurface: "both", description: "Escribir archivo atómico" },
  "files.replace": { minSurface: "both", description: "Replace seguro" },
  "files.delete": { minSurface: "both", description: "Borrar archivo" },
  "files.list": { minSurface: "both", description: "Listar directorio" },
  "files.tree": { minSurface: "both", description: "Árbol de directorios" },
  "files.search": { minSurface: "both", description: "Buscar en archivos" },
  "files.diff": { minSurface: "ide", description: "Diff unificado" },

  // Comandos / calidad
  "cmd.run": { minSurface: "ide", description: "Ejecutar comando local" },
  "cmd.lint": { minSurface: "ide", description: "Linter" },
  "cmd.test": { minSurface: "ide", description: "Tests" },

  // Agente
  "agent.start": { minSurface: "both", description: "Iniciar tarea de agente" },
  "agent.status": { minSurface: "both", description: "Estado A2A / checkpoints / memoria" },
  "agent.prompt": { minSurface: "both", description: "Construir prompt optimizado" },
  "agent.complete": { minSurface: "both", description: "Cerrar tarea" },
  "agent.abort": { minSurface: "both", description: "Abortar tarea" },

  // Memoria
  "memory.search": { minSurface: "both", description: "Búsqueda en memoria V2" },
  "memory.save": { minSurface: "both", description: "Persistir memoria" },
});

const ERROR_CODES = Object.freeze({
  OK: "ok",
  UNAVAILABLE: "unavailable",           // no soportado en esta superficie
  INVALID_ARGS: "invalid_args",
  NOT_FOUND: "not_found",
  PERMISSION: "permission",
  INCOMPLETE_CONTENT: "incomplete_content",
  TIMEOUT: "timeout",
  INTERNAL: "internal",
});

/**
 * Normaliza cualquier resultado al shape canónico.
 * { ok, code, data?, error?, available?, surface, op, ts }
 */
function normalizeResult(op, surfaceKind, raw, err = null) {
  const ts = new Date().toISOString();
  if (err) {
    const msg = err && err.message ? err.message : String(err);
    let code = ERROR_CODES.INTERNAL;
    if (/incompleto|truncad|TODO/i.test(msg)) code = ERROR_CODES.INCOMPLETE_CONTENT;
    else if (/no existe|not found|ENOENT/i.test(msg)) code = ERROR_CODES.NOT_FOUND;
    else if (/fuera del proyecto|permission|EACCES/i.test(msg)) code = ERROR_CODES.PERMISSION;
    else if (/timeout/i.test(msg)) code = ERROR_CODES.TIMEOUT;
    else if (/requiere|inválid|invalid|vacío/i.test(msg)) code = ERROR_CODES.INVALID_ARGS;
    return {
      ok: false,
      code,
      error: msg,
      available: true,
      surface: surfaceKind,
      op,
      ts,
    };
  }

  if (raw && raw.webUnavailable === true) {
    return {
      ok: false,
      code: ERROR_CODES.UNAVAILABLE,
      error: raw.error || "No disponible en esta superficie",
      available: false,
      surface: surfaceKind,
      op,
      ts,
      data: null,
    };
  }

  if (raw && raw.ok === false) {
    return {
      ok: false,
      code: raw.code || ERROR_CODES.INTERNAL,
      error: raw.error || "Error",
      available: raw.available !== false,
      surface: surfaceKind,
      op,
      ts,
      data: raw.data != null ? raw.data : raw,
    };
  }

  return {
    ok: true,
    code: ERROR_CODES.OK,
    available: true,
    surface: surfaceKind,
    op,
    ts,
    data: raw && raw.data !== undefined ? raw.data : raw,
  };
}

/**
 * Declara qué puede hacer cada superficie.
 */
function defaultCapabilities(kind) {
  const both = [
    "session.get", "session.balance",
    "project.open", "project.status", "project.list",
    "files.read", "files.write", "files.replace", "files.delete",
    "files.list", "files.tree", "files.search",
    "agent.start", "agent.status", "agent.prompt", "agent.complete", "agent.abort",
    "memory.search", "memory.save",
  ];
  const ideOnly = ["files.diff", "cmd.run", "cmd.lint", "cmd.test"];
  if (kind === "ide") return [...both, ...ideOnly];
  if (kind === "web") return both; // sin terminal/git local/diff nativo
  return both;
}

class Surface {
  /**
   * @param {object} options
   * @param {"ide"|"web"} options.kind
   * @param {string} [options.projectRoot]
   * @param {object} [options.adapters] - map op -> async (args) => rawResult
   * @param {string[]} [options.capabilities]
   */
  constructor(options = {}) {
    this.kind = options.kind === "web" ? "web" : "ide";
    this.projectRoot = options.projectRoot || null;
    this.adapters = options.adapters || {};
    this.capabilities = new Set(options.capabilities || defaultCapabilities(this.kind));
    this.version = SURFACE_VERSION;
  }

  supports(op) {
    return this.capabilities.has(op);
  }

  listOps() {
    return [...this.capabilities].sort();
  }

  /**
   * Invocación única y tipada.
   * @param {string} op - clave de SURFACE_OPS
   * @param {object} [args]
   */
  async invoke(op, args = {}) {
    if (!SURFACE_OPS[op]) {
      return normalizeResult(op, this.kind, null, new Error(`Operación desconocida: ${op}`));
    }
    if (!this.supports(op)) {
      return normalizeResult(op, this.kind, {
        ok: false,
        webUnavailable: this.kind === "web",
        error: `Operación '${op}' no disponible en superficie '${this.kind}'`,
      });
    }
    const adapter = this.adapters[op];
    if (typeof adapter !== "function") {
      return normalizeResult(op, this.kind, {
        ok: false,
        error: `Adapter no registrado para '${op}'`,
      });
    }
    try {
      const raw = await adapter(args || {});
      return normalizeResult(op, this.kind, raw);
    } catch (err) {
      return normalizeResult(op, this.kind, null, err);
    }
  }

  /** Atajos ergonómicos */
  read(path, opts) { return this.invoke("files.read", { path, ...opts }); }
  write(path, content, opts) { return this.invoke("files.write", { path, content, ...opts }); }
  list(path, opts) { return this.invoke("files.list", { path, ...opts }); }
  tree(path, opts) { return this.invoke("files.tree", { path, ...opts }); }
  search(query, opts) { return this.invoke("files.search", { query, ...opts }); }
  run(command, opts) { return this.invoke("cmd.run", { command, ...opts }); }
  agentStart(task, opts) { return this.invoke("agent.start", { task, ...opts }); }
  agentStatus() { return this.invoke("agent.status", {}); }
}

/**
 * Construye adapters IDE a partir del stack Fases 1–4 (a2a + disk + harness).
 */
function buildIdeAdapters({ a2a, disk, harness } = {}) {
  const adapters = {};

  adapters["session.get"] = async () => ({
    ok: true,
    surface: "ide",
    account: null,
    note: "Sesión IDE local; la cuenta cloud se resuelve vía auth-manager si está configurado",
  });

  adapters["session.balance"] = async () => ({ ok: true, balance: null, surface: "ide" });

  adapters["project.status"] = async () => ({
    ok: true,
    projectRoot: a2a?.projectRoot || disk?.projectRoot || null,
  });

  adapters["project.list"] = async () => ({ ok: true, projects: [] });
  adapters["project.open"] = async ({ path: p }) => ({ ok: true, projectRoot: p });

  if (disk) {
    adapters["files.read"] = async ({ path: p, ...opts }) => disk.readFile(p, opts);
    adapters["files.write"] = async ({ path: p, content, ...opts }) => disk.writeFile(p, content, opts);
    adapters["files.replace"] = async ({ path: p, search, replacement, ...opts }) =>
      disk.replaceInFile(p, search, replacement, opts);
    adapters["files.delete"] = async ({ path: p, ...opts }) => disk.deleteFile(p, opts);
    adapters["files.list"] = async ({ path: p, ...opts }) => disk.listDir(p || ".", opts);
    adapters["files.tree"] = async ({ path: p, ...opts }) => disk.tree(p || ".", opts);
    adapters["files.search"] = async ({ query, ...opts }) => disk.searchFiles(query, opts);
    adapters["files.diff"] = async ({ path: p, content }) => disk.diff(p, content);
    adapters["cmd.run"] = async ({ command, ...opts }) => disk.runCommand(command, opts);
    adapters["cmd.lint"] = async (opts) => disk.runLinter(opts);
    adapters["cmd.test"] = async (opts) => disk.runTests(opts);
  }

  if (a2a) {
    adapters["agent.start"] = async ({ task, ...opts }) => {
      const session = a2a.startTask(task, opts);
      return { ok: true, sessionId: session?.id, task };
    };
    adapters["agent.status"] = async () => a2a.status();
    adapters["agent.prompt"] = async ({ role, userMessage, systemCore, history, toolsSchema }) => {
      if (harness) {
        return harness.buildPrompt({ systemCore, toolsSchema, history, userMessage, role });
      }
      return { prompt: a2a.getFullPrompt(role, userMessage || "") };
    };
    adapters["agent.complete"] = async ({ summary }) => {
      a2a.complete(summary || "");
      await a2a.save?.();
      return { ok: true };
    };
    adapters["agent.abort"] = async ({ reason }) => {
      a2a.abort(reason || "aborted");
      return { ok: true };
    };
    adapters["memory.search"] = async ({ query, ...opts }) => a2a.memory?.search?.(query, opts) || { results: [] };
    adapters["memory.save"] = async () => {
      await a2a.save?.();
      return { ok: true };
    };
  }

  return adapters;
}

/**
 * Adapters Web mínimos: mismos nombres, backend vía callbacks que el portal inyecta
 * (IndexedDB, API de cuentas, etc.). Lo no implementado → unavailable.
 */
function buildWebAdapters(hooks = {}) {
  const adapters = {};
  const unavail = async () => ({ ok: false, webUnavailable: true, error: "Disponible solo en la app de escritorio de EditCoreAI." });

  adapters["session.get"] = hooks.getSession || (async () => ({ ok: true, account: hooks.account || null }));
  adapters["session.balance"] = hooks.getBalance || (async () => ({ ok: true, balance: hooks.balance ?? null }));

  adapters["project.list"] = hooks.listProjects || (async () => ({ ok: true, projects: [] }));
  adapters["project.open"] = hooks.openProject || (async ({ id }) => ({ ok: true, projectId: id }));
  adapters["project.status"] = hooks.projectStatus || (async () => ({ ok: true, projectId: hooks.projectId || null }));

  // Archivos en web suelen vivir en IndexedDB / virtual FS
  adapters["files.read"] = hooks.readFile || unavail;
  adapters["files.write"] = hooks.writeFile || unavail;
  adapters["files.replace"] = hooks.replaceInFile || unavail;
  adapters["files.delete"] = hooks.deleteFile || unavail;
  adapters["files.list"] = hooks.listDir || unavail;
  adapters["files.tree"] = hooks.tree || unavail;
  adapters["files.search"] = hooks.searchFiles || unavail;

  adapters["agent.start"] = hooks.agentStart || unavail;
  adapters["agent.status"] = hooks.agentStatus || unavail;
  adapters["agent.prompt"] = hooks.agentPrompt || unavail;
  adapters["agent.complete"] = hooks.agentComplete || unavail;
  adapters["agent.abort"] = hooks.agentAbort || unavail;
  adapters["memory.search"] = hooks.memorySearch || unavail;
  adapters["memory.save"] = hooks.memorySave || unavail;

  // IDE-only quedan sin registrar → surface.supports = false
  return adapters;
}

function createSurface(options) {
  return new Surface(options);
}

/**
 * Factory conveniente para IDE con stack Fases 1–4.
 */
function createIdeSurface({ projectRoot, a2a, disk, harness } = {}) {
  return createSurface({
    kind: "ide",
    projectRoot,
    adapters: buildIdeAdapters({ a2a, disk, harness }),
  });
}

/**
 * Factory para Web: el portal pasa hooks de su storage/API.
 */
function createWebSurface(hooks = {}) {
  return createSurface({
    kind: "web",
    adapters: buildWebAdapters(hooks),
    capabilities: defaultCapabilities("web"),
  });
}

module.exports = {
  SURFACE_VERSION,
  SURFACE_OPS,
  ERROR_CODES,
  Surface,
  createSurface,
  createIdeSurface,
  createWebSurface,
  buildIdeAdapters,
  buildWebAdapters,
  normalizeResult,
  defaultCapabilities,
};
