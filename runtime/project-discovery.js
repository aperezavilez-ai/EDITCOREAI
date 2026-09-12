"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SKIP_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".output", ".svelte-kit", ".turbo", ".vercel",
  "build", "coverage", "dist", "node_modules", "out", "target", "vendor",
]);

const CONFIG_FILES = new Set([
  "package.json", "tsconfig.json", "jsconfig.json", "vite.config.js", "vite.config.ts",
  "next.config.js", "next.config.mjs", "next.config.ts", "electron-builder.yml",
  "electron-builder.json", "pyproject.toml", "requirements.txt", "cargo.toml",
  "pom.xml", "build.gradle", "build.gradle.kts", "go.mod", "composer.json",
]);

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value || null)).digest("hex");
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function packageManager(root, pkg = {}) {
  const declared = String(pkg.packageManager || "").split("@")[0];
  if (declared) return declared;
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(root, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(root, "bun.lockb")) || fs.existsSync(path.join(root, "bun.lock"))) return "bun";
  if (fs.existsSync(path.join(root, "package-lock.json"))) return "npm";
  return pkg.name ? "npm" : "";
}

function collectRoot(root) {
  const entries = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      entries.push({ name: entry.name, kind: entry.isDirectory() ? "directory" : "file" });
    }
  } catch {}
  return entries;
}

function dependencyNames(pkg = {}) {
  return Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) });
}

function detectFrameworks(pkg = {}, rootEntries = []) {
  const deps = new Set(dependencyNames(pkg));
  const files = new Set(rootEntries.filter((item) => item.kind === "file").map((item) => item.name.toLowerCase()));
  return unique([
    deps.has("electron") || files.has("electron-builder.yml") || files.has("electron-builder.json") ? "Electron" : "",
    deps.has("next") || [...files].some((name) => name.startsWith("next.config.")) ? "Next.js" : "",
    deps.has("vite") || [...files].some((name) => name.startsWith("vite.config.")) ? "Vite" : "",
    deps.has("react") ? "React" : "",
    deps.has("vue") ? "Vue" : "",
    deps.has("svelte") ? "Svelte" : "",
    deps.has("express") ? "Express" : "",
    deps.has("fastify") ? "Fastify" : "",
    files.has("pyproject.toml") || files.has("requirements.txt") ? "Python" : "",
    files.has("cargo.toml") ? "Rust" : "",
    files.has("pom.xml") || files.has("build.gradle") || files.has("build.gradle.kts") ? "Java" : "",
    files.has("go.mod") ? "Go" : "",
  ]);
}

function detectLanguages(pkg = {}, rootEntries = []) {
  const deps = new Set(dependencyNames(pkg));
  const files = new Set(rootEntries.map((item) => item.name.toLowerCase()));
  return unique([
    deps.has("typescript") || files.has("tsconfig.json") ? "TypeScript" : "",
    pkg.name || [...files].some((name) => /\.(?:js|jsx|mjs|cjs)$/.test(name)) ? "JavaScript" : "",
    files.has("pyproject.toml") || files.has("requirements.txt") ? "Python" : "",
    files.has("cargo.toml") ? "Rust" : "",
    files.has("pom.xml") || files.has("build.gradle") || files.has("build.gradle.kts") ? "Java" : "",
    files.has("go.mod") ? "Go" : "",
  ]);
}

function entryPoints(root, pkg = {}) {
  const candidates = unique([
    pkg.main, pkg.module, pkg.browser,
    "src/main.ts", "src/main.tsx", "src/main.js", "src/index.ts", "src/index.tsx", "src/index.js",
    "main.js", "index.js", "app.js", "server.js", "manage.py", "main.py", "src/main.rs", "src/main/java",
  ]);
  return candidates.filter((candidate) => {
    try { return fs.existsSync(path.resolve(root, candidate)); } catch { return false; }
  });
}

function scriptCapabilities(scripts = {}) {
  const names = Object.keys(scripts);
  const find = (patterns) => names.filter((name) => patterns.some((pattern) => pattern.test(name)));
  return {
    test: find([/^test(?::|$)/i]),
    build: find([/^build(?::|$)/i]),
    lint: find([/^lint(?::|$)/i]),
    typecheck: find([/^type-?check(?::|$)/i, /^check(?::|$)/i]),
    start: find([/^start(?::|$)/i, /^dev(?::|$)/i, /^preview(?::|$)/i]),
  };
}

class ProjectDiscovery {
  constructor() { this.cache = new Map(); }

  discover(projectRoot, { refresh = false } = {}) {
    const root = path.resolve(String(projectRoot || ""));
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("El proyecto no existe o no es un directorio.");
    const rootEntries = collectRoot(root);
    const signature = digest(rootEntries.map((entry) => {
      const target = path.join(root, entry.name);
      let mtimeMs = 0; let size = 0;
      try { ({ mtimeMs, size } = fs.statSync(target)); } catch {}
      return [entry.name, entry.kind, mtimeMs, size];
    }));
    const cached = this.cache.get(root);
    if (!refresh && cached?.signature === signature) return { ...cached.value, cacheHit: true };
    const pkg = readJson(path.join(root, "package.json")) || {};
    const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
    const configs = rootEntries.filter((item) => item.kind === "file" && (CONFIG_FILES.has(item.name.toLowerCase()) || /\.config\.(?:js|cjs|mjs|ts|json)$/i.test(item.name))).map((item) => item.name);
    const value = {
      projectRoot: root,
      projectName: String(pkg.name || path.basename(root)),
      languages: detectLanguages(pkg, rootEntries),
      frameworks: detectFrameworks(pkg, rootEntries),
      packageManager: packageManager(root, pkg),
      scripts,
      capabilities: scriptCapabilities(scripts),
      entryPoints: entryPoints(root, pkg),
      configurationFiles: configs,
      rootEntries: rootEntries.slice(0, 80),
      dependencyCount: dependencyNames(pkg).length,
      hasTests: Object.keys(scripts).some((name) => /^test(?::|$)/i.test(name)) || rootEntries.some((item) => /^(test|tests|__tests__|spec)$/.test(item.name.toLowerCase())),
      discoveredAt: new Date().toISOString(),
      signature,
      cacheHit: false,
    };
    this.cache.set(root, { signature, value });
    return value;
  }

  invalidate(projectRoot) { return this.cache.delete(path.resolve(String(projectRoot || ""))); }
}

module.exports = { CONFIG_FILES, ProjectDiscovery, SKIP_DIRECTORIES, digest, scriptCapabilities };
