"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60_000; // 5 min por intento (antes: 10).
const TRANSIENT_RETRY_DELAY_MS = 2_000;
const MAX_OUTPUT_KEEP = 200_000;

function declaredDependencies(pkg = {}) {
  return [...new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ])].sort();
}

function dependencyPath(root, name) {
  return path.join(root, "node_modules", ...String(name).split("/"));
}

/**
 * FIX #1: verificación robusta.
 * Antes: solo miraba si existía `node_modules/<pkg>` (una carpeta a medio
 * instalar pasaba como OK).
 * Ahora: lee `node_modules/.package-lock.json` (que npm genera al terminar
 * una instalación exitosa) y confirma que cada dependencia declarada esté
 * resuelta en el lockfile interno.
 *
 * Fallback: si no hay lockfile interno, mira existencia de carpeta (compat).
 */
function missingDependencies(root, pkg = {}) {
  const declared = declaredDependencies(pkg);
  if (!declared.length) return [];

  const nodeModules = path.join(root, "node_modules");
  const internalLock = path.join(nodeModules, ".package-lock.json");

  // Ruta rápida: sin node_modules → todo falta.
  if (!fs.existsSync(nodeModules) || !fs.statSync(nodeModules).isDirectory()) {
    return declared.slice();
  }

  // Ruta robusta: hay lockfile interno → usarlo como fuente de verdad.
  if (fs.existsSync(internalLock)) {
    try {
      const lock = JSON.parse(fs.readFileSync(internalLock, "utf8"));
      const packages = lock && typeof lock === "object" ? (lock.packages || {}) : {};
      const missing = [];
      for (const name of declared) {
        const key = `node_modules/${name}`;
        if (!packages[key]) missing.push(name);
      }
      return missing;
    } catch {
      // Lockfile corrupto → tratar como instalación inválida.
      return declared.slice();
    }
  }

  // Fallback (sin lockfile interno): existencia de carpeta individual.
  return declared.filter((name) => !fs.existsSync(dependencyPath(root, name)));
}

function dependencyInstallCommand(manager, options = {}) {
  const legacy = options.legacyPeerDeps === true;
  if (manager === "pnpm") return { command: "npx", args: ["--yes", "pnpm@10.15.0", "install", "--no-frozen-lockfile"] };
  if (manager === "bun") return { command: "bun", args: ["install"] };
  const npmArgs = ["install", "--no-audit", "--no-fund", "--prefer-offline"];
  if (legacy) npmArgs.push("--legacy-peer-deps");
  return { command: "npm", args: npmArgs };
}

/**
 * FIX #2: chequeo previo de que npm (o el manager) exista.
 * Si no existe, falla con mensaje claro en vez de ENOENT críptico.
 */
function assertManagerAvailable(manager) {
  const probe = manager === "pnpm" ? "npx" : manager === "bun" ? "bun" : "npm";
  const { spawnSync } = require("node:child_process");
  const isWin = process.platform === "win32";
  try {
    const result = spawnSync(isWin ? "cmd.exe" : probe, isWin ? ["/d", "/s", "/c", `${probe} --version`] : ["--version"], {
      windowsHide: true,
      timeout: 10_000,
      encoding: "utf8",
    });
    if (result.status !== 0 || !String(result.stdout || "").trim()) {
      throw new Error(`${probe} no responde al pedir --version`);
    }
    return true;
  } catch (err) {
    throw new Error(
      `No encuentro ${probe} en el PATH. Instalá Node.js (https://nodejs.org) y reiniciá EditCore. ` +
      `Detalle: ${String(err?.message || err).slice(0, 200)}`,
    );
  }
}

/**
 * FIX #3: reemplazo execFile por spawn para emitir chunks en vivo
 * y cancelar limpio en timeout.
 */
function runInstallProcess(command, args, { cwd, timeoutMs, env, onProgress }) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const exec = isWin ? (process.env.ComSpec || "cmd.exe") : command;
    const execArgs = isWin
      ? ["/d", "/s", "/c", `${command}.cmd ${args.join(" ")}`]
      : args;

    let child;
    try {
      child = spawn(exec, execArgs, {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: env || process.env,
      });
    } catch (err) {
      reject(Object.assign(new Error(`No se pudo lanzar ${command}: ${err?.message || err}`), { stderr: "", stdout: "" }));
      return;
    }

    let stdout = "";
    let stderr = "";
    let finished = false;

    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      finish(reject, Object.assign(
        new Error(`npm install excedió ${Math.round(timeoutMs / 1000)}s sin terminar.`),
        { stdout, stderr, code: "TIMEOUT" },
      ));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout = (stdout + text).slice(-MAX_OUTPUT_KEEP);
      if (onProgress) {
        for (const line of text.split(/\r?\n/).filter(Boolean).slice(-3)) {
          onProgress({ stream: "stdout", line: line.slice(0, 300) });
        }
      }
    });

    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr = (stderr + text).slice(-MAX_OUTPUT_KEEP);
      if (onProgress) {
        for (const line of text.split(/\r?\n/).filter(Boolean).slice(-3)) {
          onProgress({ stream: "stderr", line: line.slice(0, 300) });
        }
      }
    });

    child.on("error", (err) => {
      finish(reject, Object.assign(err, { stdout, stderr }));
    });

    child.on("close", (code) => {
      if (code === 0) finish(resolve, { stdout, stderr });
      else finish(reject, Object.assign(
        new Error(`Exit ${code}`),
        { stdout, stderr, code },
      ));
    });
  });
}

function isTransientNetworkError(error) {
  const text = `${error?.message || ""} ${error?.stderr || ""} ${error?.stdout || ""}`;
  return /ETIMEDOUT|ENOTFOUND|ECONNRESET|ECONNREFUSED|EAI_AGAIN|network|socket hang up|fetch failed|request to .* failed/i.test(text);
}

/**
 * FIX #4: emite progreso visible + reintentos en errores transitorios
 * + verificación post-install robusta.
 */
async function ensureProjectDependencies(runtimeRoot, pkg, manager, options = {}) {
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_INSTALL_TIMEOUT_MS;

  const missingBefore = missingDependencies(runtimeRoot, pkg);
  if (!missingBefore.length) {
    onProgress?.({ phase: "deps-ok", line: "Dependencias ya instaladas y verificadas." });
    return { checked: true, installed: false, missingBefore: [], missingAfter: [] };
  }

  onProgress?.({ phase: "deps-missing", line: `Faltan ${missingBefore.length} dependencias: ${missingBefore.slice(0, 5).join(", ")}${missingBefore.length > 5 ? ", …" : ""}` });

  // FIX: verificar manager antes de intentar.
  try {
    assertManagerAvailable(manager);
  } catch (err) {
    throw new Error(`No se puede instalar dependencias: ${err.message}`);
  }

  let lastError = null;
  const attempts = [
    { legacyPeerDeps: false, retry: false },
    { legacyPeerDeps: false, retry: true },  // retry en error de red
    { legacyPeerDeps: true, retry: false },  // fallback con legacy-peer-deps
  ];

  for (const attempt of attempts) {
    const install = dependencyInstallCommand(manager, { legacyPeerDeps: attempt.legacyPeerDeps });
    onProgress?.({ phase: "deps-install", line: `Ejecutando ${install.command} ${install.args.join(" ")}${attempt.legacyPeerDeps ? " (legacy-peer-deps)" : ""}` });

    try {
      await runInstallProcess(install.command, install.args, {
        cwd: runtimeRoot,
        timeoutMs,
        env: { ...process.env, CI: "1", FORCE_COLOR: "0", npm_config_loglevel: "warn" },
        onProgress,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      const detail = String(error?.stderr || error?.stdout || error?.message || error).replace(/\s+/g, " ").slice(-1200);

      // ERESOLVE: reintentar sin legacy sólo si no fue el primer intento.
      if (!attempt.legacyPeerDeps && /ERESOLVE|peer dep|Could not resolve/i.test(detail)) {
        onProgress?.({ phase: "deps-retry", line: "Conflicto de peer deps. Reintentando con --legacy-peer-deps…" });
        continue;
      }

      // Error transitorio de red: reintentar 1 vez con delay.
      if (!attempt.retry && isTransientNetworkError(error)) {
        onProgress?.({ phase: "deps-retry", line: `Error de red (${String(error?.message || "").slice(0, 80)}). Reintentando en ${TRANSIENT_RETRY_DELAY_MS / 1000}s…` });
        await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
        continue;
      }

      // Si es el último intento, propagar.
      if (attempt === attempts[attempts.length - 1]) {
        throw new Error(`npm no pudo instalar dependencias (${missingBefore.length}): ${detail}`);
      }
    }
  }

  if (lastError && missingDependencies(runtimeRoot, pkg).length) {
    const detail = String(lastError?.stderr || lastError?.stdout || lastError?.message || lastError).replace(/\s+/g, " ").slice(-1200);
    throw new Error(`npm falló tras 3 intentos. Faltan: ${missingBefore.join(", ")}. Detalle: ${detail}`);
  }

  const missingAfter = missingDependencies(runtimeRoot, pkg);
  if (missingAfter.length) {
    throw new Error(
      `npm terminó OK pero siguen faltando: ${missingAfter.join(", ")}. ` +
      `Posible instalación parcial. Probá manualmente: cd "${runtimeRoot}" && npm install`,
    );
  }

  onProgress?.({ phase: "deps-done", line: `Dependencias instaladas (${missingBefore.length} paquetes).` });
  return { checked: true, installed: true, manager, missingBefore, missingAfter: [] };
}

module.exports = {
  declaredDependencies,
  dependencyInstallCommand,
  ensureProjectDependencies,
  missingDependencies,
};