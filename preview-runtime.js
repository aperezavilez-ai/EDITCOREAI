"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FRAMEWORKS = [
  { name: "vite", pattern: /^vite(?:\s+(?:dev|serve))?(?:\s|$)/i, binary: ["vite", "bin", "vite.js"], args: (port) => ["--host", "127.0.0.1", "--port", String(port), "--strictPort"] },
  { name: "next", pattern: /^next\s+(?:dev|start)(?:\s|$)/i, binary: ["next", "dist", "bin", "next"], args: (port, script) => [script === "start" ? "start" : "dev", "--hostname", "127.0.0.1", "--port", String(port)] },
  { name: "astro", pattern: /^astro(?:\s+dev)?(?:\s|$)/i, binary: ["astro", "astro.js"], args: (port) => ["dev", "--host", "127.0.0.1", "--port", String(port)] },
  { name: "angular", pattern: /^(?:ng|angular)\s+serve(?:\s|$)/i, binary: ["@angular", "cli", "bin", "ng.js"], args: (port) => ["serve", "--host", "127.0.0.1", "--port", String(port)] },
];

const PUBLIC_ENV_PREFIXES = ["VITE_", "NEXT_PUBLIC_", "REACT_APP_", "PUBLIC_", "NG_APP_", "NUXT_PUBLIC_", "VUE_APP_", "EXPO_PUBLIC_"];
const PREVIEW_RESTART_FILES = new Set([
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb",
  ".env", ".env.local", ".env.development", ".env.development.local",
  "angular.json", "astro.config.js", "astro.config.mjs", "astro.config.ts",
  "next.config.js", "next.config.mjs", "next.config.ts",
  "vite.config.js", "vite.config.mjs", "vite.config.ts",
]);

function readPackage(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch { return null; }
}

function hasPreviewScript(pkg) {
  return Boolean(pkg?.scripts?.dev || pkg?.scripts?.start);
}

/** Parse `npm --prefix "dir with spaces"` / `'dir'` / unquoted token. */
function matchNpmPrefixTarget(script) {
  const match = String(script || "").match(/--prefix\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  return match ? String(match[1] || match[2] || match[3] || "").trim() : "";
}

/** Root scripts that only re-run into a nested package are not the app runtime. */
function isPrefixOnlyDevScript(script) {
  const text = String(script || "").trim();
  if (!text || !/--prefix\b/i.test(text)) return false;
  return /^(?:npm(?:\.cmd)?|pnpm|yarn|bun)\b/i.test(text);
}

function prefixedWorkspaceRoots(root, pkg) {
  const candidates = [];
  for (const script of Object.values(pkg?.scripts || {})) {
    const target = matchNpmPrefixTarget(script);
    if (!target) continue;
    const candidate = path.resolve(root, target);
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function delegatedRuntimeRoot(root, pkg) {
  const activeScript = String(pkg?.scripts?.dev || pkg?.scripts?.start || "");
  const target = matchNpmPrefixTarget(activeScript);
  if (!target) return "";
  const candidate = path.resolve(root, target);
  return hasPreviewScript(readPackage(candidate)) ? candidate : "";
}

function declaredWorkspaceRoots(root, pkg) {
  const configured = Array.isArray(pkg?.workspaces)
    ? pkg.workspaces
    : Array.isArray(pkg?.workspaces?.packages) ? pkg.workspaces.packages : [];
  const candidates = [];
  for (const workspace of configured) {
    const value = String(workspace || "").trim();
    if (!value) continue;
    if (value.endsWith("/*") || value.endsWith("/**")) {
      const baseDir = path.resolve(root, value.replace(/\/\*+$/, ""));
      if (fs.existsSync(baseDir) && fs.statSync(baseDir).isDirectory()) {
        try {
          for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
              const fullPath = path.join(baseDir, entry.name);
              if (!candidates.includes(fullPath)) candidates.push(fullPath);
            }
          }
        } catch {}
      }
      continue;
    }
    if (/[*?{}[\]]/.test(value)) continue;
    const candidate = path.resolve(root, value);
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function findRunnableProjectRoot(root) {
  const safeRoot = path.resolve(root);
  const rootPackage = readPackage(safeRoot);
  const delegated = delegatedRuntimeRoot(safeRoot, rootPackage);
  if (delegated) return delegated;
  const activeScript = String(rootPackage?.scripts?.dev || rootPackage?.scripts?.start || "");
  // Do not treat a pure `--prefix` wrapper as the runnable app: that stalls preview
  // on the wrong cwd (e.g. `"FUXION SERVICE"` cut to `FUXION`) for minutes.
  if (hasPreviewScript(rootPackage) && !isPrefixOnlyDevScript(activeScript)) return safeRoot;
  for (const candidate of [...prefixedWorkspaceRoots(safeRoot, rootPackage), ...declaredWorkspaceRoots(safeRoot, rootPackage)]) {
    if (hasPreviewScript(readPackage(candidate))) return candidate;
  }
  return "";
}

function readProjectPreviewEnv(projectRoot, runtimeRoot) {
  const values = {};
  const candidates = [
    path.join(projectRoot, ".env"),
    path.join(projectRoot, ".env.local"),
    path.join(projectRoot, ".env.development"),
    path.join(projectRoot, ".env.development.local"),
    path.join(runtimeRoot, ".env"),
    path.join(runtimeRoot, ".env.local"),
    path.join(runtimeRoot, ".env.development"),
    path.join(runtimeRoot, ".env.development.local"),
  ];
  for (const filePath of [...new Set(candidates)]) {
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || !PUBLIC_ENV_PREFIXES.some((prefix) => match[1].startsWith(prefix))) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      values[match[1]] = value;
    }
  }
  return values;
}

function previewRuntimeFingerprint(projectRoot, runtimeRoot) {
  const roots = [...new Set([path.resolve(projectRoot), path.resolve(runtimeRoot)])];
  const hash = crypto.createHash("sha256");
  for (const root of roots) {
    for (const name of [...PREVIEW_RESTART_FILES].sort()) {
      const filePath = path.join(root, name);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) continue;
      hash.update(path.relative(projectRoot, filePath).replace(/\\/g, "/"));
      hash.update("\0");
      hash.update(fs.readFileSync(filePath));
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

// Keep preview ports stable per project so another project's server cannot be
// mistaken for the active project when a common port is already occupied.
function stablePreviewPort(root, base = 4100, span = 1800) {
  const normalized = path.resolve(String(root || "")).replace(/[\\/]+$/, "").toLowerCase();
  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest();
  return Number(base) + (digest.readUInt16BE(0) % Math.max(1, Number(span)));
}

function directPreviewLaunch(pkg, script, runtimeRoot, port) {
  const originalText = String(pkg?.scripts?.[script] || "").trim();
  if (!originalText || /(?:&&|\|\||concurrently|npm-run-all|run-p|run-s)/i.test(originalText)) return null;
  const env = {};
  const scriptText = originalText.replace(/^(?:([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s]+)\s+)+/, (block) => {
    for (const match of block.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s]+)\s*/g)) {
      const rawValue = String(match[2]);
      env[match[1]] = (["\"", "'"].includes(rawValue[0]) && rawValue.at(-1) === rawValue[0]) ? rawValue.slice(1, -1) : rawValue;
    }
    return "";
  }).trim();
  const framework = FRAMEWORKS.find((item) => item.pattern.test(scriptText));
  if (!framework) return null;
  const binary = path.join(runtimeRoot, "node_modules", ...framework.binary);
  if (!fs.existsSync(binary)) return null;
  return {
    executable: "node",
    args: [binary, ...framework.args(port, script)],
    label: `${framework.name} ${script} en 127.0.0.1:${port}`,
    direct: true,
    env,
  };
}

function builtNextPreviewLaunch(pkg, runtimeRoot, port) {
  const dependencies = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const isVinextProject = Boolean(dependencies.vinext && dependencies.next);
  const buildId = path.join(runtimeRoot, ".next", "BUILD_ID");
  const binary = path.join(runtimeRoot, "node_modules", "next", "dist", "bin", "next");
  if (!isVinextProject || !fs.existsSync(buildId) || !fs.existsSync(binary)) return null;
  return {
    executable: "node",
    args: [binary, "start", "--hostname", "127.0.0.1", "--port", String(port)],
    label: `next build en 127.0.0.1:${port}`,
    direct: true,
    env: {},
  };
}

function staticPreviewLaunch(runtimeRoot, port, executable, serverScript, entry = "index.html") {
  if (!fs.existsSync(path.join(runtimeRoot, entry))) return null;
  return {
    executable,
    args: [serverScript, runtimeRoot, String(port), entry],
    label: `static preview en 127.0.0.1:${port}`,
    direct: true,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

const STATIC_UI_DIRS = ["", "web", "www", "public", "static", "src", "app", "renderer", "src/renderer", "frontend", "ui", "dist", "build", "out"];
const DESKTOP_DEV_SCRIPT = /\b(?:electron|electron-forge|nw)\b/i;
const BUNDLED_DEV_SCRIPT = /\b(?:vite|webpack|next|react-scripts|parcel|electron-vite|concurrently|wait-on|nuxt|astro|ng)\b/i;

function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** index.html de código fuente de un bundler (`<script src="/src/main.tsx">`) no se puede servir tal cual. */
function isServableHtml(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    const html = fs.readFileSync(file, "utf8").slice(0, 200_000);
    return !/<script[^>]+src=["'][^"']+\.(?:tsx?|jsx|vue|svelte)["']/i.test(html);
  } catch { return false; }
}

function findStaticUiRoot(base, preferred = []) {
  for (const rel of [...preferred, ...STATIC_UI_DIRS]) {
    const dir = path.resolve(base, rel);
    if (isInside(base, dir) && isServableHtml(path.join(dir, "index.html"))) return dir;
  }
  return "";
}

function readJsonFile(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); } catch { return null; }
}

function readTauriConfig(root) {
  for (const rel of ["src-tauri/tauri.conf.json", "tauri.conf.json"]) {
    const file = path.join(root, rel);
    const config = fs.existsSync(file) ? readJsonFile(file) : null;
    if (config) return { config, dir: path.dirname(file) };
  }
  return null;
}

/** HTML que carga la ventana principal de Electron (`loadFile("x.html")`, `path.join(__dirname, "a", "b.html")`, `file://${__dirname}/x.html`). */
function electronEntryHtml(root, pkg) {
  const mainFile = path.resolve(root, String(pkg?.main || "main.js"));
  if (/\.html?$/i.test(mainFile)) return isInside(root, mainFile) && isServableHtml(mainFile) ? mainFile : "";
  let source = "";
  try { source = fs.readFileSync(mainFile, "utf8"); } catch { return ""; }
  for (const line of source.split(/\r?\n/)) {
    if (!/\bload(?:File|URL)\s*\(/.test(line)) continue;
    const parts = [...line.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1].replace(/^file:\/\/(?:\$\{__dirname\})?\/?/i, ""));
    const htmlIndex = parts.findIndex((part) => /\.html?$/i.test(part));
    if (htmlIndex < 0) continue;
    const candidate = path.resolve(path.dirname(mainFile), ...parts.slice(0, htmlIndex + 1).filter((part) => !/[:${}]/.test(part)));
    if (isInside(root, candidate) && isServableHtml(candidate)) return candidate;
  }
  return "";
}

/**
 * Apps de escritorio (Tauri, Electron, NW.js) y proyectos HTML sin servidor: su script dev abre una ventana
 * nativa y nunca publica una URL. Devuelve cómo mostrar su interfaz en el panel Web, o null si el flujo normal sirve.
 */
function resolveDesktopPreviewTarget(root, pkg) {
  const activeScript = String(pkg?.scripts?.dev || pkg?.scripts?.start || "");
  const tauri = readTauriConfig(root);
  if (tauri && (!activeScript || /\btauri\b/i.test(activeScript))) {
    const build = tauri.config.build || {};
    const devUrl = [build.devUrl, build.devPath].find((value) => /^https?:\/\//i.test(String(value || ""))) || "";
    const before = typeof build.beforeDevCommand === "object" ? build.beforeDevCommand : { script: build.beforeDevCommand };
    const appRoot = path.basename(tauri.dir) === "src-tauri" ? path.dirname(tauri.dir) : tauri.dir;
    if (devUrl && String(before?.script || "").trim()) {
      return {
        kind: "tauri",
        mode: "dev-server",
        url: devUrl,
        command: String(before.script).trim(),
        cwd: before.cwd ? path.resolve(appRoot, before.cwd) : appRoot,
      };
    }
    const distRel = [build.frontendDist, build.distDir, build.devPath].find((value) => value && !/^https?:\/\//i.test(String(value)));
    const distDir = distRel ? path.resolve(tauri.dir, String(distRel)) : "";
    const staticRoot = distDir && isServableHtml(path.join(distDir, "index.html")) ? distDir : findStaticUiRoot(appRoot);
    if (staticRoot) return { kind: "tauri", mode: "static", staticRoot, entry: "index.html", url: devUrl };
    return { kind: "tauri", mode: "none" };
  }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const isNw = /\.html?$/i.test(String(pkg?.main || "")) && (deps.nw || /\bnw\b/i.test(activeScript) || pkg?.window);
  const isElectron = (deps.electron || deps["@electron-forge/cli"]) && DESKTOP_DEV_SCRIPT.test(activeScript) && !BUNDLED_DEV_SCRIPT.test(activeScript);
  if (isNw || isElectron) {
    const html = electronEntryHtml(root, pkg);
    if (html) return { kind: isNw ? "nwjs" : "electron", mode: "static", staticRoot: root, entry: path.relative(root, html).replace(/\\/g, "/") };
    const staticRoot = findStaticUiRoot(root);
    if (staticRoot) return { kind: isNw ? "nwjs" : "electron", mode: "static", staticRoot, entry: "index.html" };
    return { kind: isNw ? "nwjs" : "electron", mode: "none" };
  }
  if (!activeScript) {
    const staticRoot = findStaticUiRoot(root);
    if (staticRoot) return { kind: "static", mode: "static", staticRoot, entry: "index.html" };
  }
  return null;
}

/**
 * 🔧 FIX: normalizePreviewUrl defensiva.
 *
 * Antes: new URL("") → TypeError: Invalid URL.
 * Ahora: si la entrada no es una URL válida, devuelve "" (string vacía)
 * para que el caller pueda decidir qué hacer sin reventar.
 *
 * Acepta:
 *  - string ("http://127.0.0.1:4100")
 *  - object con .url o .href ({ url: "http://..." })
 *  - number (puerto suelto → no aplica, devuelve "")
 */
function normalizePreviewUrl(value) {
  let raw = "";
  if (typeof value === "string") {
    raw = value.trim();
  } else if (value && typeof value === "object") {
    raw = String(value.url || value.href || "").trim();
    if (!raw && typeof value.toString === "function") {
      const str = String(value);
      if (str && str !== "[object Object]") raw = str.trim();
    }
  } else if (typeof value === "number" && Number.isFinite(value)) {
    // Un puerto suelto → construir URL base
    raw = `http://127.0.0.1:${Math.trunc(value)}`;
  }
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return "";
  }
  if (["localhost", "0.0.0.0", "[::1]", "::1"].includes(parsed.hostname)) parsed.hostname = "127.0.0.1";
  return parsed.href.replace(/\/$/, "");
}

/**
 * 🔧 FIX NUEVO: buildPreviewUrl(port, pathName)
 *
 * Helper seguro para construir URLs de preview a partir de un puerto.
 * Evita el bug "{}" al devolver siempre una string válida o "".
 */
function buildPreviewUrl(port, pathName = "") {
  const p = Number(port);
  if (!Number.isFinite(p) || p <= 0 || p > 65535) return "";
  const suffix = String(pathName || "").replace(/^\/+/, "");
  return `http://127.0.0.1:${Math.trunc(p)}${suffix ? "/" + suffix : ""}`;
}

function isPreviewDocumentContentType(value) {
  return /(?:^|;)\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(String(value || ""));
}

module.exports = {
  builtNextPreviewLaunch,
  directPreviewLaunch,
  findRunnableProjectRoot,
  findStaticUiRoot,
  resolveDesktopPreviewTarget,
  isPreviewDocumentContentType,
  normalizePreviewUrl,
  buildPreviewUrl,
  previewRuntimeFingerprint,
  readProjectPreviewEnv,
  stablePreviewPort,
  staticPreviewLaunch,
};