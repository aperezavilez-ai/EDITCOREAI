/**
 * EditCoreAI - Visual Extensions & VSIX Marketplace Manager (runtime/marketplace-manager.js)
 * Manages VSIX installation, TextMate/Monaco themes, language grammars, and visual extension catalog.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { VsixLoader } = require("./vsix-loader");

const EXTENSIONS_DIR = path.join(os.homedir(), ".editcore", "extensions");
const MANIFEST_FILE = path.join(EXTENSIONS_DIR, "installed-manifest.json");

const CURATED_CATALOG = [
  {
    id: "editcore.theme-one-dark-pro",
    name: "One Dark Pro Theme",
    publisher: "EditCoreAI",
    version: "1.4.0",
    description: "El icónico tema One Dark con soporte completo para Monaco y TextMate.",
    category: "themes",
    icon: "🎨",
    rating: 4.9,
    downloads: 12400,
  },
  {
    id: "editcore.theme-dracula-official",
    name: "Dracula Official",
    publisher: "Dracula Theme",
    version: "2.24.2",
    description: "Tema oscuro famoso para diseñadores y desarrolladores de software.",
    category: "themes",
    icon: "🧛",
    rating: 4.8,
    downloads: 9800,
  },
  {
    id: "editcore.lang-python-extended",
    name: "Python Intelligence & Grammars",
    publisher: "EditCoreAI",
    version: "2.1.0",
    description: "Gramáticas extendidas, snippets y resaltado de sintaxis enriquecido para Python.",
    category: "languages",
    icon: "🐍",
    rating: 4.9,
    downloads: 15600,
  },
  {
    id: "editcore.lang-rust-analyzer-syntax",
    name: "Rust Enhanced Syntax",
    publisher: "Rust Community",
    version: "1.8.0",
    description: "Coloreado semántico y gramáticas precisas para proyectos en Rust.",
    category: "languages",
    icon: "🦀",
    rating: 4.7,
    downloads: 6200,
  },
  {
    id: "editcore.snippets-fullstack-dev",
    name: "Full-Stack Productivity Snippets",
    publisher: "EditCoreAI",
    version: "1.0.5",
    description: "Colección de snippets rápidos para React, Node, Tailwind y Express.",
    category: "snippets",
    icon: "⚡",
    rating: 4.9,
    downloads: 8900,
  },
];

class MarketplaceManager {
  constructor(options = {}) {
    this.extensionsDir = options.extensionsDir || EXTENSIONS_DIR;
    this.vsixLoader = new VsixLoader({ extensionsDir: this.extensionsDir });
    this.installedManifestPath = options.manifestPath || MANIFEST_FILE;
    this._installed = new Map();
    this._loadManifest();
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _loadManifest() {
    try {
      this._ensureDir(this.extensionsDir);
      if (fs.existsSync(this.installedManifestPath)) {
        const raw = fs.readFileSync(this.installedManifestPath, "utf8");
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            this._installed.set(item.id, item);
          }
        }
      }
    } catch (err) {
      console.warn(`[MarketplaceManager] Error cargando manifiesto: ${err?.message}`);
    }
  }

  _saveManifest() {
    try {
      this._ensureDir(this.extensionsDir);
      const list = Array.from(this._installed.values());
      fs.writeFileSync(this.installedManifestPath, JSON.stringify(list, null, 2), "utf8");
      return true;
    } catch (err) {
      console.warn(`[MarketplaceManager] Error guardando manifiesto: ${err?.message}`);
      return false;
    }
  }

  /**
   * Obtiene el catálogo de extensiones disponibles en el marketplace
   */
  getCatalog(category = null) {
    if (!category || category === "all") {
      return CURATED_CATALOG.map((item) => ({
        ...item,
        isInstalled: this._installed.has(item.id),
        isEnabled: this._installed.get(item.id)?.enabled !== false,
      }));
    }
    return CURATED_CATALOG
      .filter((item) => item.category === category)
      .map((item) => ({
        ...item,
        isInstalled: this._installed.has(item.id),
        isEnabled: this._installed.get(item.id)?.enabled !== false,
      }));
  }

  /**
   * Lista las extensiones instaladas
   */
  listInstalled() {
    return Array.from(this._installed.values());
  }

  /**
   * Instala una extensión del catálogo o un paquete VSIX desde archivo local
   */
  async install(extensionIdOrPath) {
    // Si es una ruta a archivo VSIX o directorio
    if (fs.existsSync(extensionIdOrPath)) {
      const inspectRes = await this.vsixLoader.inspectVsix(extensionIdOrPath);
      const extInfo = {
        id: inspectRes.id,
        name: inspectRes.displayName || inspectRes.name,
        publisher: inspectRes.publisher,
        version: inspectRes.version,
        description: inspectRes.description,
        enabled: true,
        installedAt: Date.now(),
        source: "local-vsix",
        path: extensionIdOrPath,
        themes: inspectRes.themes || [],
        grammars: inspectRes.grammars || [],
        snippets: inspectRes.snippets || [],
      };
      this._installed.set(extInfo.id, extInfo);
      this._saveManifest();
      return { success: true, extension: extInfo };
    }

    // Buscar en catálogo
    const catalogItem = CURATED_CATALOG.find((item) => item.id === extensionIdOrPath);
    if (!catalogItem) {
      throw new Error(`Extensión no encontrada en el catálogo: ${extensionIdOrPath}`);
    }

    const extInfo = {
      ...catalogItem,
      enabled: true,
      installedAt: Date.now(),
      source: "marketplace",
    };

    this._installed.set(extInfo.id, extInfo);
    this._saveManifest();
    return { success: true, extension: extInfo };
  }

  /**
   * Desinstala una extensión
   */
  uninstall(extensionId) {
    if (!this._installed.has(extensionId)) {
      return { success: false, error: "Extensión no instalada" };
    }
    this._installed.delete(extensionId);
    this._saveManifest();
    return { success: true, uninstalledId: extensionId };
  }

  /**
   * Activa o desactiva una extensión
   */
  toggleExtension(extensionId, enabled = true) {
    const ext = this._installed.get(extensionId);
    if (!ext) return { success: false, error: "Extensión no encontrada" };
    ext.enabled = Boolean(enabled);
    this._saveManifest();
    return { success: true, extension: ext };
  }
}

const marketplaceManagerInstance = new MarketplaceManager();

module.exports = {
  MarketplaceManager,
  marketplaceManager: marketplaceManagerInstance,
  CURATED_CATALOG,
};
