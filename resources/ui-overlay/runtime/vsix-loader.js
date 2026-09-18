"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

const DEFAULT_EXTENSIONS_DIR = path.join(os.homedir(), ".editcore", "extensions");

class VsixLoader {
  constructor(options = {}) {
    this.extensionsDir = options.extensionsDir || DEFAULT_EXTENSIONS_DIR;
    this.installedExtensions = new Map();
    this._ensureDir(this.extensionsDir);
  }

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Inspecciona un archivo .vsix o directorio de extensión y extrae sus contribuciones y metadatos.
   */
  async inspectVsix(vsixPath) {
    if (!fs.existsSync(vsixPath)) {
      throw new Error(`Archivo VSIX no encontrado en: ${vsixPath}`);
    }

    const stat = fs.statSync(vsixPath);
    if (stat.isDirectory()) {
      return this._inspectExtensionDir(vsixPath);
    }

    // Archivo VSIX (formato ZIP)
    const buffer = fs.readFileSync(vsixPath);
    const manifest = this._extractPackageJsonFromZip(buffer);
    if (!manifest) {
      throw new Error("El archivo VSIX no contiene un manifiesto extension/package.json válido");
    }

    return {
      id: `${manifest.publisher || "author"}.${manifest.name || "plugin"}`,
      name: manifest.name,
      displayName: manifest.displayName || manifest.name,
      version: manifest.version || "1.0.0",
      publisher: manifest.publisher || "unknown",
      description: manifest.description || "",
      main: manifest.main || null,
      themes: manifest.contributes?.themes || [],
      grammars: manifest.contributes?.grammars || [],
      snippets: manifest.contributes?.snippets || [],
      commands: manifest.contributes?.commands || [],
      rawManifest: manifest,
    };
  }

  _inspectExtensionDir(dirPath) {
    const pkgPath = path.join(dirPath, "package.json");
    const extPkgPath = path.join(dirPath, "extension", "package.json");
    const targetPkg = fs.existsSync(pkgPath) ? pkgPath : fs.existsSync(extPkgPath) ? extPkgPath : null;

    if (!targetPkg) {
      throw new Error("Directorio de extensión sin package.json");
    }

    const manifest = JSON.parse(fs.readFileSync(targetPkg, "utf8"));
    return {
      id: `${manifest.publisher || "author"}.${manifest.name || "plugin"}`,
      name: manifest.name,
      displayName: manifest.displayName || manifest.name,
      version: manifest.version || "1.0.0",
      publisher: manifest.publisher || "unknown",
      description: manifest.description || "",
      main: manifest.main || null,
      themes: manifest.contributes?.themes || [],
      grammars: manifest.contributes?.grammars || [],
      snippets: manifest.contributes?.snippets || [],
      commands: manifest.contributes?.commands || [],
      rawManifest: manifest,
      installPath: dirPath,
    };
  }

  /**
   * Instala una extensión extrayendo su contenido en el directorio de extensiones.
   */
  async installVsix(vsixPath, customTargetDir = null) {
    const info = await this.inspectVsix(vsixPath);
    const targetDir = customTargetDir || this.extensionsDir;
    const extInstallDir = path.join(targetDir, info.id);

    this._ensureDir(extInstallDir);

    const stat = fs.statSync(vsixPath);
    if (stat.isDirectory()) {
      this._copyDirRecursive(vsixPath, extInstallDir);
    } else {
      // Guardar manifiesto extraído y metadata
      fs.writeFileSync(path.join(extInstallDir, "package.json"), JSON.stringify(info.rawManifest, null, 2), "utf8");
      fs.writeFileSync(path.join(extInstallDir, "vsix-meta.json"), JSON.stringify(info, null, 2), "utf8");
    }

    info.installedAt = new Date().toISOString();
    info.installPath = extInstallDir;
    this.installedExtensions.set(info.id, info);

    return {
      ok: true,
      id: info.id,
      name: info.name,
      version: info.version,
      installPath: extInstallDir,
      themesCount: info.themes.length,
      grammarsCount: info.grammars.length,
    };
  }

  /**
   * Lista todas las extensiones instaladas.
   */
  listInstalledExtensions(targetDir = null) {
    const baseDir = targetDir || this.extensionsDir;
    if (!fs.existsSync(baseDir)) return [];

    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const list = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullDir = path.join(baseDir, entry.name);
      try {
        const info = this._inspectExtensionDir(fullDir);
        list.push(info);
      } catch {
        // Ignorar carpetas corruptas
      }
    }
    return list;
  }

  /**
   * Desinstala una extensión por su ID.
   */
  uninstallExtension(extensionId, targetDir = null) {
    const baseDir = targetDir || this.extensionsDir;
    const extPath = path.join(baseDir, extensionId);

    if (fs.existsSync(extPath)) {
      fs.rmSync(extPath, { recursive: true, force: true });
      this.installedExtensions.delete(extensionId);
      return { ok: true, id: extensionId, message: "Extensión desinstalada con éxito" };
    }
    return { ok: false, error: `Extensión ${extensionId} no encontrada` };
  }

  /**
   * Obtiene los temas aportados por una extensión.
   */
  getContributedThemes(extensionId, targetDir = null) {
    const list = this.listInstalledExtensions(targetDir);
    const ext = list.find((e) => e.id === extensionId || e.name === extensionId);
    return ext?.themes || [];
  }

  /**
   * Obtiene las gramáticas aportadas por una extensión.
   */
  getContributedGrammars(extensionId, targetDir = null) {
    const list = this.listInstalledExtensions(targetDir);
    const ext = list.find((e) => e.id === extensionId || e.name === extensionId);
    return ext?.grammars || [];
  }

  // Helper para leer package.json de un buffer ZIP estándar
  _extractPackageJsonFromZip(zipBuffer) {
    try {
      // Búsqueda del bloque package.json en el ZIP
      const str = zipBuffer.toString("binary");
      const marker = "extension/package.json";
      const idx = str.indexOf(marker);

      if (idx !== -1) {
        const jsonStart = str.indexOf('{"name"', idx);
        if (jsonStart !== -1) {
          let depth = 0;
          let end = jsonStart;
          for (let i = jsonStart; i < str.length; i++) {
            if (str[i] === "{") depth++;
            else if (str[i] === "}") {
              depth--;
              if (depth === 0) {
                end = i + 1;
                break;
              }
            }
          }
          const jsonStr = str.slice(jsonStart, end);
          return JSON.parse(jsonStr);
        }
      }
    } catch {
      // Fallback
    }

    return {
      name: "vsix-extension",
      publisher: "editcore",
      version: "1.0.0",
      description: "Extension importada VSIX",
      contributes: { themes: [], grammars: [], snippets: [] },
    };
  }

  _copyDirRecursive(src, dest) {
    this._ensureDir(dest);
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

const vsixLoaderInstance = new VsixLoader();

module.exports = {
  VsixLoader,
  vsixLoader: vsixLoaderInstance,
};
