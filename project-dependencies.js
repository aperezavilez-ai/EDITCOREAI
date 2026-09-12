"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function declaredDependencies(pkg = {}) {
  return [...new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ])].sort();
}

function dependencyPath(root, name) {
  return path.join(root, "node_modules", ...String(name).split("/"));
}

function missingDependencies(root, pkg = {}) {
  return declaredDependencies(pkg).filter((name) => !fs.existsSync(dependencyPath(root, name)));
}

function dependencyInstallCommand(manager, options = {}) {
  const legacy = options.legacyPeerDeps === true;
  if (manager === "pnpm") return { command: "npx", args: ["--yes", "pnpm@10.15.0", "install", "--no-frozen-lockfile"] };
  if (manager === "bun") return { command: "bun", args: ["install"] };
  const npmArgs = ["install", "--no-audit", "--no-fund"];
  if (legacy) npmArgs.push("--legacy-peer-deps");
  return { command: "npm", args: npmArgs };
}

async function ensureProjectDependencies(runtimeRoot, pkg, manager, options = {}) {
  const missingBefore = missingDependencies(runtimeRoot, pkg);
  if (!missingBefore.length) return { checked: true, installed: false, missingBefore: [], missingAfter: [] };
  const exec = options.execFileAsync || execFileAsync;
  let lastError = null;
  for (const legacyPeerDeps of [false, true]) {
    const install = dependencyInstallCommand(manager, { legacyPeerDeps });
    const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : install.command;
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", `${install.command}.cmd ${install.args.join(" ")}`]
      : install.args;
    try {
      await exec(executable, args, {
        cwd: runtimeRoot,
        timeout: Number(options.timeoutMs) || 10 * 60_000,
        maxBuffer: 2_000_000,
        windowsHide: true,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const detail = String(error?.stderr || error?.stdout || error?.message || error);
      if (!legacyPeerDeps && /ERESOLVE|peer dep|Could not resolve/i.test(detail)) continue;
      const compact = detail.replace(/\s+/g, " ").slice(-1200);
      throw new Error(`Faltan dependencias (${missingBefore.join(", ")}) y ${manager} no pudo instalarlas: ${compact}`);
    }
  }
  if (lastError) {
    const detail = String(lastError?.stderr || lastError?.stdout || lastError?.message || lastError).replace(/\s+/g, " ").slice(-1200);
    throw new Error(`Faltan dependencias (${missingBefore.join(", ")}) y ${manager} no pudo instalarlas: ${detail}`);
  }
  const missingAfter = missingDependencies(runtimeRoot, pkg);
  if (missingAfter.length) throw new Error(`La instalacion termino, pero siguen faltando dependencias: ${missingAfter.join(", ")}`);
  return { checked: true, installed: true, manager, missingBefore, missingAfter: [] };
}

module.exports = { declaredDependencies, dependencyInstallCommand, ensureProjectDependencies, missingDependencies };
