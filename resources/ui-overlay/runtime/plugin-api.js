"use strict";

/**
 * Plugin API — Puntos de extensión y hooks para plugins de terceros.
 *
 * Ciclo 17 — Fase 2.
 * - Registro de comandos de paleta.
 * - Registro de elementos de barra lateral.
 * - Hooks de lifecycle y eventos del editor.
 */

class PluginApi {
  constructor() {
    this._commands = new Map();
    this._sidebarItems = new Map();
    this._hooks = new Map();
    this._editorExtensions = new Map();
  }

  registerCommand(command) {
    if (!command || !command.id || typeof command.handler !== "function") {
      return { ok: false, error: "Comando inválido: se requiere 'id' y 'handler'." };
    }

    this._commands.set(command.id, {
      id: command.id,
      title: command.title || command.id,
      category: command.category || "plugins",
      handler: command.handler,
      when: typeof command.when === "function" ? command.when : () => true,
    });

    return { ok: true, registered: command.id };
  }

  registerSidebarItem(item) {
    if (!item || !item.id || typeof item.render !== "function") {
      return { ok: false, error: "Elemento de sidebar inválido: se requiere 'id' y 'render'." };
    }

    this._sidebarItems.set(item.id, {
      id: item.id,
      title: item.title || item.id,
      icon: item.icon || null,
      render: item.render,
      priority: Number.isFinite(item.priority) ? item.priority : 100,
    });

    return { ok: true, registered: item.id };
  }

  registerHook(hook) {
    if (!hook || !hook.name || typeof hook.listener !== "function") {
      return { ok: false, error: "Hook inválido: se requiere 'name' y 'listener'." };
    }

    const listeners = this._hooks.get(hook.name) || [];
    listeners.push({
      pluginId: hook.pluginId || "unknown",
      listener: hook.listener,
      once: Boolean(hook.once),
    });
    this._hooks.set(hook.name, listeners);

    return { ok: true, registered: hook.name };
  }

  registerEditorExtension(extension) {
    if (!extension || !extension.id) {
      return { ok: false, error: "Extensión de editor inválida: se requiere 'id'." };
    }

    this._editorExtensions.set(extension.id, {
      id: extension.id,
      contributes: extension.contributes || {},
      activate: typeof extension.activate === "function" ? extension.activate : () => ({}),
      deactivate: typeof extension.deactivate === "function" ? extension.deactivate : () => {},
    });

    return { ok: true, registered: extension.id };
  }

  getCommands() {
    return Array.from(this._commands.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  getSidebarItems() {
    return Array.from(this._sidebarItems.values()).sort((a, b) => a.priority - b.priority);
  }

  getHooks() {
    const result = {};
    for (const [name, listeners] of this._hooks.entries()) {
      result[name] = listeners.map((item) => ({ pluginId: item.pluginId, once: item.once }));
    }
    return result;
  }

  getEditorExtensions() {
    return Array.from(this._editorExtensions.values());
  }

  async emit(eventName, payload = {}) {
    const listeners = this._hooks.get(eventName) || [];
    const remaining = [];
    for (const item of listeners) {
      try {
        const result = await Promise.resolve(item.listener(payload));
        if (!item.once) remaining.push(item);
      } catch (error) {
        console.warn(`[plugin-api] hook '${eventName}' failed:`, error && error.message ? error.message : error);
        if (!item.once) remaining.push(item);
      }
    }
    this._hooks.set(eventName, remaining);
    return { ok: true, event: eventName, listeners: remaining.length };
  }
}

module.exports = { PluginApi };
