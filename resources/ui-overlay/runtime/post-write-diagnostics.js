"use strict";

const path = require("node:path");
const { VerificationEngine } = require("./verification-engine");

const engine = new VerificationEngine();
const queues = new Map();

function packageScripts(projectRoot) {
  try {
    const pkg = JSON.parse(require("node:fs").readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    return pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  } catch {
    return {};
  }
}

function packageManager(projectRoot) {
  const fs = require("node:fs");
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(projectRoot, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(projectRoot, "bun.lockb"))) return "bun";
  return "npm";
}

/**
 * Selecciona comandos ligeros (typecheck/lint) tras una escritura.
 * Nunca lanza: si no hay scripts, returns { skipped: true }.
 */
function planDiagnostics(projectRoot, changedFiles = []) {
  const scripts = packageScripts(projectRoot);
  const discovery = { scripts, packageManager: packageManager(projectRoot) };
  const plan = engine.select(discovery, changedFiles, { force: false });
  const light = (plan.commands || []).filter((item) =>
    /type-?check|^check$|^lint/i.test(item.script)
  ).slice(0, 2);
  const tests = (plan.commands || []).filter((item) =>
    /^test$|test:unit|test:ci/i.test(item.script)
  ).slice(0, 1);
  // Preferir lint/typecheck; si no hay, o si el usuario pidio tests, incluir test.
  const commands = [...light];
  if (!commands.length && tests.length) commands.push(...tests);
  else if (tests.length && /forceTest|includeTests/i.test(String(changedFiles.join("|")))) {
    commands.push(...tests);
  }
  // Tras writes, si existe script test y hay pocos archivos, anexar test ligero.
  if (!commands.some((c) => /test/i.test(c.script)) && scripts.test && changedFiles.length && changedFiles.length <= 8) {
    const pm = packageManager(projectRoot);
    commands.push({
      script: "test",
      command: pm === "npm" ? "npm test --silent" : `${pm} test`,
    });
  }
  if (!commands.length && !light.length) {
    return { skipped: true, reason: "Sin scripts typecheck/lint/test en package.json", changedFiles };
  }
  if (!commands.length) {
    return { skipped: true, reason: "Sin scripts typecheck/lint en package.json", changedFiles };
  }
  return {
    skipped: false,
    changedFiles: [...new Set(changedFiles.map(String))],
    commands: commands.slice(0, 3),
  };
}

async function runDiagnostics(projectRoot, changedFiles = [], { runCommand } = {}) {
  const plan = planDiagnostics(projectRoot, changedFiles);
  if (plan.skipped) return plan;
  if (typeof runCommand !== "function") {
    return { ...plan, available: false, message: "runCommand no disponible" };
  }
  const results = [];
  for (const item of plan.commands) {
    try {
      const output = await runCommand(item.command);
      const text = typeof output === "string"
        ? output
        : String(output?.output || output?.summary || JSON.stringify(output || {})).slice(0, 12000);
      const diagnosticFailed = (output && typeof output === "object" && output.diagnostic === true && output.passed === false)
        || /verificacion finalizado con exit\s+([1-9]\d*)/i.test(text);
      results.push({
        command: item.command,
        script: item.script,
        ok: !diagnosticFailed,
        exitCode: typeof output === "object" && Number.isFinite(Number(output.exitCode)) ? Number(output.exitCode) : (diagnosticFailed ? 1 : 0),
        output: text.slice(-3000),
      });
    } catch (error) {
      results.push({
        command: item.command,
        script: item.script,
        ok: false,
        exitCode: error?.code,
        stdout: String(error?.stdout || "").slice(-2000),
        stderr: String(error?.stderr || error?.message || "").slice(-3000),
      });
    }
  }
  const evaluation = engine.evaluate(results, { required: true });
  return {
    skipped: false,
    changedFiles: plan.changedFiles,
    ...evaluation,
    results,
  };
}

function queuePostWriteDiagnostics(projectRoot, changedPath, { runCommand, onResult } = {}) {
  const root = String(projectRoot || "");
  if (!root || !changedPath) return false;
  const key = root.toLowerCase();
  const pending = queues.get(key) || { files: new Set(), timer: null };
  pending.files.add(String(changedPath).replace(/\\/g, "/"));
  if (pending.timer) clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    queues.delete(key);
    const files = [...pending.files];
    runDiagnostics(root, files, { runCommand })
      .then((result) => {
        try { onResult?.(result); } catch {}
      })
      .catch(() => undefined);
  }, 900);
  queues.set(key, pending);
  return true;
}

module.exports = {
  planDiagnostics,
  runDiagnostics,
  queuePostWriteDiagnostics,
};
