"use strict";

const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const EventEmitter = require("events");

const COMMON_DEV_PORTS = [5173, 3000, 8080, 4173, 8000, 3001, 5000, 8081];

/**
 * Script ligero inyectado en el Live Preview para Click-to-Edit
 */
const INSPECTOR_INJECTION_SCRIPT = `
(function() {
  if (window.__EDITCORE_INSPECTOR_ACTIVE__) return;
  window.__EDITCORE_INSPECTOR_ACTIVE__ = true;

  let overlay = document.createElement('div');
  overlay.id = '__editcore_inspect_overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:999999;border:2px solid #3b82f6;background:rgba(59,130,246,0.15);transition:all 0.05s ease;display:none;';
  document.body.appendChild(overlay);

  let isInspectMode = false;

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'EDITCORE_SET_INSPECT_MODE') {
      isInspectMode = !!e.data.enabled;
      if (!isInspectMode) overlay.style.display = 'none';
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!isInspectMode) return;
    const target = e.target;
    if (!target || target === overlay) return;
    const rect = target.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  }, true);

  document.addEventListener('click', function(e) {
    if (!isInspectMode) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    const info = {
      tagName: target.tagName ? target.tagName.toLowerCase() : '',
      id: target.id || '',
      className: target.className || '',
      innerText: (target.innerText || '').slice(0, 100),
      outerHTMLSnippet: target.outerHTML ? target.outerHTML.slice(0, 300) : '',
      attributes: Array.from(target.attributes || []).reduce((acc, a) => {
        acc[a.name] = a.value;
        return acc;
      }, {}),
    };

    // Broadcast al editor principal EditCoreAI
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'EDITCORE_ELEMENT_SELECTED', element: info }, '*');
    }
  }, true);
})();
`;

class LivePreviewManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.activePort = null;
    this.activeUrl = null;
    this.inspectMode = false;
  }

  /**
   * Chequea si un puerto local está abierto y escuchando
   */
  async checkPortOpen(port, host = "127.0.0.1", timeoutMs = 400) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let status = false;

      socket.setTimeout(timeoutMs);
      socket.on("connect", () => {
        status = true;
        socket.destroy();
        resolve(true);
      });

      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * Escanea puertos comunes para detectar el servidor de desarrollo activo
   */
  async detectActiveDevServer(ports = COMMON_DEV_PORTS) {
    for (const port of ports) {
      const isOpen = await this.checkPortOpen(port);
      if (isOpen) {
        this.activePort = port;
        this.activeUrl = `http://localhost:${port}`;
        this.emit("server-detected", { port, url: this.activeUrl });
        return { active: true, port, url: this.activeUrl };
      }
    }
    return { active: false, port: null, url: null };
  }

  /**
   * Retorna el script de inyección para el inspector Click-to-Edit
   */
  getInspectorScript() {
    return INSPECTOR_INJECTION_SCRIPT;
  }

  /**
   * Procesa el evento de selección de elemento y sugiere el prompt de IA adecuado
   */
  handleElementSelected(elementInfo = {}) {
    const tag = elementInfo.tagName || "elemento";
    const text = elementInfo.innerText ? `con texto "${elementInfo.innerText.trim()}"` : "";
    const idOrClass = elementInfo.id ? `#${elementInfo.id}` : (elementInfo.className ? `.${elementInfo.className.split(" ")[0]}` : "");

    const promptSuggestion = `Modifica el componente visual correspondiente a <${tag}${idOrClass ? " " + idOrClass : ""}> ${text}.`;

    const result = {
      timestamp: Date.now(),
      element: elementInfo,
      promptSuggestion,
    };

    this.emit("element-inspected", result);
    return result;
  }

  setInspectMode(enabled) {
    this.inspectMode = !!enabled;
    this.emit("inspect-mode-toggled", { enabled: this.inspectMode });
    return this.inspectMode;
  }
}

module.exports = {
  LivePreviewManager,
  INSPECTOR_INJECTION_SCRIPT,
  COMMON_DEV_PORTS,
};
