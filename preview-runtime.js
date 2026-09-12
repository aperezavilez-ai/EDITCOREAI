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

function prefixedWorkspaceRoots(root, pkg) {
  const candidates = [];
  for (const script of Object.values(pkg?.scripts || {})) {
    const match = String(script).match(/--prefix\s+["']?([^\s"']+)/i);
    if (!match) continue;
    const candidate = path.resolve(root, match[1]);
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function delegatedRuntimeRoot(root, pkg) {
  const activeScript = String(pkg?.scripts?.dev || pkg?.scripts?.start || "");
  const match = activeScript.match(/--prefix\s+["']?([^\s"']+)/i);
  if (!match) return "";
  const candidate = path.resolve(root, match[1]);
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
  if (hasPreviewScript(rootPackage)) return safeRoot;
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

function staticPreviewLaunch(runtimeRoot, port, executable, serverScript) {
  if (!fs.existsSync(path.join(runtimeRoot, "index.html"))) return null;
  return {
    executable,
    args: [serverScript, runtimeRoot, String(port)],
    label: `static preview en 127.0.0.1:${port}`,
    direct: true,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

function normalizePreviewUrl(value) {
  const parsed = new URL(String(value || ""));
  if (["localhost", "0.0.0.0", "[::1]", "::1"].includes(parsed.hostname)) parsed.hostname = "127.0.0.1";
  return parsed.href.replace(/\/$/, "");
}

function isPreviewDocumentContentType(value) {
  return /(?:^|;)\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(String(value || ""));
}

module.exports = { builtNextPreviewLaunch, directPreviewLaunch, findRunnableProjectRoot, isPreviewDocumentContentType, normalizePreviewUrl, previewRuntimeFingerprint, readProjectPreviewEnv, stablePreviewPort, staticPreviewLaunch };
