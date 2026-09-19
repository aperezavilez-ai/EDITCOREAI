/**
 * runtime/editor-hooks.js
 * EditCoreAI - Ganchos de Ciclo de Vida del Editor (Ciclo 30)
 */

const { EventEmitter } = require("events");

const HOOK_EVENTS = {
  PRE_EDIT: "onPreEdit",
  POST_EDIT: "onPostEdit",
  PRE_COMMIT: "onPreCommit",
};

class EditorHooks extends EventEmitter {
  constructor() {
    super();
    this.hooks = {
      [HOOK_EVENTS.PRE_EDIT]: [],
      [HOOK_EVENTS.POST_EDIT]: [],
      [HOOK_EVENTS.PRE_COMMIT]: [],
    };
  }

  /**
   * Registra un nuevo gancho interceptor
   * @param {string} eventName - 'onPreEdit' | 'onPostEdit' | 'onPreCommit'
   * @param {Function} handler - Función asíncrona o sincrónica
   * @param {Object} options - { name, priority }
   */
  registerHook(eventName, handler, options = {}) {
    if (!this.hooks[eventName]) {
      throw new Error(`Evento de gancho no válido: ${eventName}. Permitidos: ${Object.values(HOOK_EVENTS).join(", ")}`);
    }
    if (typeof handler !== "function") {
      throw new Error("El manejador de gancho debe ser una función");
    }

    const hookRecord = {
      name: options.name || `hook_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      priority: Number.isInteger(options.priority) ? options.priority : 10,
      handler,
    };

    this.hooks[eventName].push(hookRecord);
    // Ordenar por prioridad descendente (mayor número se ejecuta primero)
    this.hooks[eventName].sort((a, b) => b.priority - a.priority);

    return hookRecord.name;
  }

  /**
   * Elimina un gancho por nombre o referencia
   */
  unregisterHook(eventName, handlerOrName) {
    if (!this.hooks[eventName]) return false;

    const initialLen = this.hooks[eventName].length;
    this.hooks[eventName] = this.hooks[eventName].filter((h) => {
      if (typeof handlerOrName === "string") {
        return h.name !== handlerOrName;
      }
      return h.handler !== handlerOrName;
    });

    return this.hooks[eventName].length < initialLen;
  }

  /**
   * Dispara los ganchos onPreEdit con capacidad de veto o transformación
   * @param {Object} editContext - { filePath, content, diff, options }
   * @returns {Promise<Object>} { allowed: boolean, reason: string, context: Object }
   */
  async triggerPreEdit(editContext = {}) {
    let currentContext = { ...editContext };
    this.emit("pre-edit:triggered", currentContext);

    for (const hook of this.hooks[HOOK_EVENTS.PRE_EDIT]) {
      try {
        const res = await hook.handler(currentContext);
        if (res === false || (res && res.allowed === false)) {
          const reason = (res && res.reason) || `Edición vetada por el gancho ${hook.name}`;
          this.emit("pre-edit:vetoed", { hookName: hook.name, reason, context: currentContext });
          return {
            allowed: false,
            reason,
            hookName: hook.name,
          };
        }
        if (res && typeof res === "object") {
          if (res.transformedContext) {
            currentContext = { ...currentContext, ...res.transformedContext };
          }
        }
      } catch (err) {
        this.emit("pre-edit:error", { hookName: hook.name, error: err.message });
      }
    }

    return {
      allowed: true,
      context: currentContext,
    };
  }

  /**
   * Dispara los ganchos onPostEdit tras aplicar una edición exitosa
   * @param {Object} editContext - { filePath, success, changes }
   */
  async triggerPostEdit(editContext = {}) {
    this.emit("post-edit:triggered", editContext);

    for (const hook of this.hooks[HOOK_EVENTS.POST_EDIT]) {
      try {
        await hook.handler(editContext);
      } catch (err) {
        this.emit("post-edit:error", { hookName: hook.name, error: err.message });
      }
    }
  }

  /**
   * Dispara los ganchos onPreCommit antes de confirmar o escribir cambios en disco
   * @param {Object} commitContext - { files, branch, author, message }
   * @returns {Promise<Object>} { allowed: boolean, reason: string, context: Object }
   */
  async triggerPreCommit(commitContext = {}) {
    let currentContext = { ...commitContext };
    this.emit("pre-commit:triggered", currentContext);

    for (const hook of this.hooks[HOOK_EVENTS.PRE_COMMIT]) {
      try {
        const res = await hook.handler(currentContext);
        if (res === false || (res && res.allowed === false)) {
          const reason = (res && res.reason) || `Commit vetado por el gancho ${hook.name}`;
          this.emit("pre-commit:vetoed", { hookName: hook.name, reason, context: currentContext });
          return {
            allowed: false,
            reason,
            hookName: hook.name,
          };
        }
        if (res && typeof res === "object") {
          if (res.transformedContext) {
            currentContext = { ...currentContext, ...res.transformedContext };
          }
        }
      } catch (err) {
        this.emit("pre-commit:error", { hookName: hook.name, error: err.message });
      }
    }

    return {
      allowed: true,
      context: currentContext,
    };
  }

  /**
   * Devuelve un resumen de los ganchos registrados
   */
  getRegisteredHooks() {
    const summary = {};
    for (const [evt, list] of Object.entries(this.hooks)) {
      summary[evt] = list.map((h) => ({
        name: h.name,
        priority: h.priority,
      }));
    }
    return summary;
  }
}

const editorHooksInstance = new EditorHooks();

module.exports = {
  EditorHooks,
  editorHooks: editorHooksInstance,
  HOOK_EVENTS,
};
