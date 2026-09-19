"use strict";

/**
 * EditCore extension packs — install real .vsix (zip) packages.
 * Compatible packaging with VS Code .vsix; host is EditCore (themes CSS,
 * contributes.commands → catalog skills, contributes.configuration).
 * This is NOT a full VS Code Extension Host / VS Code API shim.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

function extensionsRoot(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "extensions");
}

function registryPath(projectRoot) {
  return path.join(extensionsRoot(projectRoot), "registry.json");
}

function loadRegistry(projectRoot) {
  const file = registryPath(projectRoot);
  try {
    if (!fs.existsSync(file)) return { version: 1, extensions: [] };
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: 1,
      extensions: Array.isArray(raw.extensions) ? raw.extensions : [],
    };
  } catch {
    return { version: 1, extensions: [] };
  }
}

function saveRegistry(projectRoot, registry) {
  const root = extensionsRoot(projectRoot);
  fs.mkdirSync(root, { recursive: true });
  const file = registryPath(projectRoot);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf8");
  fs.renameSync(tmp, file);
  return file;
}

function unzipVsix(vsixPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  // Prefer PowerShell Expand-Archive after copying to .zip (vsix is zip)
  const zipCopy = path.join(os.tmpdir(), `editcore-vsix-${process.pid}.zip`);
  fs.copyFileSync(vsixPath, zipCopy);
  try {
    // Try jszip if available
    let JSZip = null;
    try {
      JSZip = require("jszip");
    } catch {
      JSZip = null;
    }
    if (JSZip) {
      const buf = fs.readFileSync(zipCopy);
      return JSZip.loadAsync(buf).then(async (zip) => {
        const writes = [];
        zip.forEach((rel, entry) => {
          if (entry.dir) return;
          const target = path.join(destDir, rel.replace(/^extension\//, "extension/"));
          writes.push(
            entry.async("nodebuffer").then((data) => {
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.writeFileSync(target, data);
            })
          );
        });
        await Promise.all(writes);
        return destDir;
      });
    }
    const ps = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipCopy.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
      { encoding: "utf8", windowsHide: true }
    );
    if (ps.status !== 0) {
      throw new Error(ps.stderr || ps.stdout || "Expand-Archive failed");
    }
    return Promise.resolve(destDir);
  } finally {
    try {
      fs.unlinkSync(zipCopy);
    } catch {}
  }
}

function readPackageJson(extDir) {
  const candidates = [
    path.join(extDir, "extension", "package.json"),
    path.join(extDir, "package.json"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      return { file, pkg: JSON.parse(fs.readFileSync(file, "utf8")) };
    }
  }
  throw new Error("El .vsix no contiene package.json válido.");
}

async function installVsix(projectRoot, vsixPath, { activate = true } = {}) {
  const src = path.resolve(String(vsixPath || ""));
  if (!src || !fs.existsSync(src)) throw new Error("Ruta .vsix inexistente.");
  if (!/\.vsix$/i.test(src) && !/\.zip$/i.test(src)) {
    throw new Error("Se espera un archivo .vsix (o .zip compatible).");
  }
  const staging = path.join(
    extensionsRoot(projectRoot),
    `_staging_${Date.now().toString(36)}`
  );
  await unzipVsix(src, staging);
  const { pkg } = readPackageJson(staging);
  const id = String(pkg.publisher ? `${pkg.publisher}.${pkg.name}` : pkg.name || path.basename(src, ".vsix"));
  const version = String(pkg.version || "0.0.0");
  const target = path.join(extensionsRoot(projectRoot), id.replace(/[^\w.@-]+/g, "_"));
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.renameSync(staging, target);

  const contributes = pkg.contributes && typeof pkg.contributes === "object" ? pkg.contributes : {};
  const entry = {
    id,
    version,
    displayName: String(pkg.displayName || pkg.name || id),
    description: String(pkg.description || "").slice(0, 500),
    path: path.relative(String(projectRoot || ""), target).replace(/\\/g, "/"),
    activated: activate !== false,
    installedAt: new Date().toISOString(),
    contributes: {
      commands: Array.isArray(contributes.commands) ? contributes.commands.slice(0, 50) : [],
      themes: Array.isArray(contributes.themes) ? contributes.themes.slice(0, 20) : [],
      configuration: contributes.configuration || null,
    },
    host: "editcore-extension-pack",
    note: "Empaquetado compatible .vsix; host EditCore (no VS Code Extension Host completo).",
  };

  const registry = loadRegistry(projectRoot);
  registry.extensions = [
    entry,
    ...registry.extensions.filter((row) => row.id !== id),
  ];
  saveRegistry(projectRoot, registry);

  // Materialize theme CSS if present
  let themeCss = "";
  if (entry.contributes.themes?.length) {
    const themeRel = entry.contributes.themes[0]?.path;
    if (themeRel) {
      const themeFile = path.join(target, "extension", themeRel);
      const alt = path.join(target, themeRel);
      const themePath = fs.existsSync(themeFile) ? themeFile : alt;
      if (fs.existsSync(themePath)) {
        try {
          const themeJson = JSON.parse(fs.readFileSync(themePath, "utf8"));
          const colors = themeJson.colors || {};
          themeCss = Object.entries(colors)
            .slice(0, 40)
            .map(([k, v]) => `  --vscode-${k.replace(/\./g, "-")}: ${v};`)
            .join("\n");
          if (themeCss) {
            const cssFile = path.join(target, "editcore-theme.css");
            fs.writeFileSync(cssFile, `:root {\n${themeCss}\n}\n`, "utf8");
            entry.themeCss = path.relative(String(projectRoot || ""), cssFile).replace(/\\/g, "/");
          }
        } catch {
          /* ignore invalid theme */
        }
      }
    }
  }
  saveRegistry(projectRoot, registry);
  return { ok: true, extension: entry };
}

function listExtensions(projectRoot) {
  return loadRegistry(projectRoot);
}

function uninstallExtension(projectRoot, extensionId) {
  const id = String(extensionId || "").trim();
  const registry = loadRegistry(projectRoot);
  const row = registry.extensions.find((e) => e.id === id);
  if (!row) throw new Error(`Extensión no encontrada: ${id}`);
  const full = path.join(String(projectRoot || ""), row.path);
  if (fs.existsSync(full)) fs.rmSync(full, { recursive: true, force: true });
  registry.extensions = registry.extensions.filter((e) => e.id !== id);
  saveRegistry(projectRoot, registry);
  return { ok: true, removed: id };
}

function getActiveThemes(projectRoot) {
  return loadRegistry(projectRoot).extensions
    .filter((e) => e.activated && e.themeCss)
    .map((e) => ({ id: e.id, themeCss: e.themeCss, displayName: e.displayName }));
}

module.exports = {
  extensionsRoot,
  installVsix,
  listExtensions,
  uninstallExtension,
  getActiveThemes,
  loadRegistry,
};
