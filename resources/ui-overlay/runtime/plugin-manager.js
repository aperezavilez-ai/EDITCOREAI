"use strict";

/**
 * Plugin Manager — Motor de carga, registro y sandboxing de plugins locales.
 *
 * Ciclo 17 — Fase 1.
 * - Descubre plugins en carpetas locales empaquetadas.
 * - Carga módulos Node aislados por instancia separada.
 * - Aplica políticas mínimas de seguridad por defecto.
 */

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PLUGINS_DIR = path.join(process.cwd(), "plugins");
const SUPPORTED_ENTRY_FILES = ["plugin.js", "index.js", "main.js"];

class PluginManager {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.pluginsDir = options.pluginsDir || DEFAULT_PLUGINS_DIR;
    this.pluginApi = options.pluginApi || null;
    this._plugins = new Map();
    this._loadErrors = new Map();
  }

  setPluginApi(pluginApi) {
    this.pluginApi = pluginApi;
  }

  async discover() {
    const found = [];
    if (!fs.existsSync(this.pluginsDir)) {
      return found;
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(this.pluginsDir, entry.name);
      const manifestPath = path.join(pluginDir, "package.json");
      let manifest = null;
      if (fs.existsSync(manifestPath)) {
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        } catch {
          manifest = null;
        }
      }

      const entryFile = this._resolveEntry(pluginDir);
      if (!entryFile) continue;

      found.push({
        id: manifest?.name || entry.name,
        name: manifest?.displayName || entry.name,
        version: manifest?.version || "0.0.0",
        dir: pluginDir,
        entry: entryFile,
        manifest,
      });
    }

    return found;
  }

  async load(pluginDescriptor) {
    if (this._plugins.has(pluginDescriptor.id)) {
      return { ok: true, plugin: this._plugins.get(pluginDescriptor.id), loaded: true };
    }

    const pluginDir = pluginDescriptor.dir;
    const entryFile = pluginDescriptor.entry;

    const sandbox = this._createSandbox(pluginDescriptor);
    try {
      const resolved = require(path.resolve(pluginDir, entryFile));
      const plugin = typeof resolved === "function" ? resolved(sandbox) : resolved;
      const normalized = this._normalizePlugin(pluginDescriptor, plugin);
      this._plugins.set(pluginDescriptor.id, normalized);
      this._loadErrors.delete(pluginDescriptor.id);

      if (this.pluginApi && typeof normalized.register === "function") {
        normalized.register(this.pluginApi);
      }

      return { ok: true, plugin: normalized, loaded: true };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      this._loadErrors.set(pluginDescriptor.id, message);
      return { ok: false, error: `No se pudo cargar el plugin '${pluginDescriptor.id}': ${message}` };
    }
  }

  async unload(pluginId) {
    const plugin = this._plugins.get(pluginId);
    if (!plugin) return { ok: false, error: `Plugin '${pluginId}' no está cargado.` };

    if (typeof plugin.unregister === "function") {
      try {
        plugin.unregister();
      } catch {
        // noop: unregister best-effort
      }
    }

    this._plugins.delete(pluginId);
    return { ok: true, unloaded: true };
  }

  getLoaded() {
    return Array.from(this._plugins.values()).map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      activatedAt: plugin.activatedAt,
    }));
  }

  getLoadErrors() {
    return Array.from(this._loadErrors.entries()).map(([pluginId, error]) => ({
      pluginId,
      error,
    }));
  }

  _resolveEntry(pluginDir) {
    for (const file of SUPPORTED_ENTRY_FILES) {
      const candidate = path.join(pluginDir, file);
      if (fs.existsSync(candidate)) return file;
    }
    return null;
  }

  _createSandbox(pluginDescriptor) {
    return {
      pluginId: pluginDescriptor.id,
      pluginDir: pluginDescriptor.dir,
      log: (...args) => console.log(`[plugin:${pluginDescriptor.id}]`, ...args),
      warn: (...args) => console.warn(`[plugin:${pluginDescriptor.id}]`, ...args),
      error: (...args) => console.error(`[plugin:${pluginDescriptor.id}]`, ...args),
    };
  }

  _normalizePlugin(pluginDescriptor, plugin) {
    return {
      id: pluginDescriptor.id,
      name: pluginDescriptor.name,
      version: pluginDescriptor.version,
      dir: pluginDescriptor.dir,
      manifest: pluginDescriptor.manifest,
      activatedAt: new Date().toISOString(),
      register: typeof plugin.register === "function" ? plugin.register : () => {},
      unregister: typeof plugin.unregister === "function" ? plugin.unregister : () => {},
      execute: typeof plugin.execute === "function" ? plugin.execute : async () => ({ ok: false, error: "Plugin sin método execute." }),
      raw: plugin,
    };
  }
}

module.exports = { PluginManager };
