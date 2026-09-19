"use strict";

/**
 * Bucle autónomo Test-Driven Repair.
 * Ejecuta tests → parsea fallos → aplica parches vía patch-engine → reintenta.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { applyPatch } = require("../patch-engine");

function detectTestCommand(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return "node --test";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    if (scripts.test) return "npm test --silent";
    if (scripts["test:unit"]) return "npm run test:unit --silent";
  } catch {
    /* ignore */
  }
  return "node --test";
}

function runTests(projectRoot, testCommand, runCommand) {
  if (typeof runCommand === "function") {
    const result = runCommand(testCommand);
    return {
      ok: result?.ok === true || Number(result?.code) === 0,
      code: Number(result?.code ?? (result?.ok ? 0 : 1)),
      stdout: String(result?.stdout || "").slice(0, 20_000),
      stderr: String(result?.stderr || "").slice(0, 12_000),
    };
  }
  const spawned = spawnSync(testCommand, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 4_000_000,
  });
  return {
    ok: spawned.status === 0,
    code: spawned.status,
    stdout: String(spawned.stdout || "").slice(0, 20_000),
    stderr: String(spawned.stderr || "").slice(0, 12_000),
  };
}

function extractFailureHints(output = "") {
  const text = String(output || "");
  const files = new Set();
  const patterns = [
    /(?:Error|FAIL|✖|×).*?[\\/]([^\s:'"]+\.(?:js|ts|tsx|jsx|mjs|cjs))/gi,
    /(?:at\s+).?[\\/]?((?:src|test|runtime|lib|app)[\\/][^\s:)]+\.(?:js|ts|tsx|jsx))/gi,
    /(?:Cannot find module ['"])([^'"]+)/gi,
    /(?:AssertionError[^\n]*\n[^\n]*?)([\\/][^\s:]+\.(?:js|ts|tsx|jsx))/gi,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) {
      const candidate = String(match[1] || "").replace(/^\.\//, "").replace(/\\/g, "/");
      if (candidate && !candidate.includes("node_modules")) files.add(candidate);
    }
  }
  return { files: [...files].slice(0, 12), excerpt: text.slice(0, 4000) };
}

function normalizePatchSpec(patch = {}) {
  const filePath = String(patch.path || patch.filePath || patch.file || "").trim();
  if (!filePath) return null;
  return {
    path: filePath,
    oldText: Object.prototype.hasOwnProperty.call(patch, "oldText") ? patch.oldText : patch.old_text,
    newText: Object.prototype.hasOwnProperty.call(patch, "newText")
      ? patch.newText
      : (patch.new_text ?? patch.content ?? ""),
  };
}

/**
 * @param {string} projectRoot
 * @param {{
 *   testCommand?: string,
 *   maxAttempts?: number,
 *   patches?: Array<object>,
 *   patchProvider?: (ctx: object) => Array<object>|Promise<Array<object>>,
 *   runCommand?: Function,
 * }} [options]
 */
async function runTddRepair(projectRoot, options = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: "projectRoot invalido", attempts: 0, logs: [], patchesApplied: [] };
  }

  const testCommand = String(options.testCommand || detectTestCommand(root)).trim();
  const maxAttempts = Math.max(1, Math.min(8, Number(options.maxAttempts) || 3));
  const logs = [];
  const patchesApplied = [];
  let attempt = 0;
  let lastTest = null;
  let hints = { files: [], excerpt: "" };

  while (attempt < maxAttempts) {
    attempt += 1;
    logs.push(`--- Intento ${attempt}/${maxAttempts}: ${testCommand} ---`);
    lastTest = runTests(root, testCommand, options.runCommand);
    if (lastTest.ok) {
      logs.push("Pruebas en verde.");
      return {
        ok: true,
        attempts: attempt,
        logs,
        patchesApplied,
        testCommand,
        lastTest,
        hints,
      };
    }

    const blob = `${lastTest.stdout}\n${lastTest.stderr}`;
    hints = extractFailureHints(blob);
    logs.push(`Fallo detectado. Hints: ${hints.files.join(", ") || "(sin path)"}`);

    let patches = Array.isArray(options.patches) ? options.patches.map(normalizePatchSpec).filter(Boolean) : [];
    if (!patches.length && typeof options.patchProvider === "function") {
      const provided = await options.patchProvider({
        attempt,
        projectRoot: root,
        testCommand,
        lastTest,
        hints,
      });
      patches = (Array.isArray(provided) ? provided : []).map(normalizePatchSpec).filter(Boolean);
    }

    if (!patches.length) {
      logs.push("Sin parches aplicables en este intento (se requiere patchProvider o patches).");
      continue;
    }

    for (const patch of patches) {
      const result = applyPatch(root, patch.path, patch.oldText, patch.newText, {
        runId: `tdd-repair-${Date.now()}-${attempt}`,
        createBackup: true,
      });
      patchesApplied.push({ ...result, path: patch.path, attempt });
      logs.push(result.ok
        ? `Parche aplicado: ${patch.path}`
        : `Parche fallido (${patch.path}): ${result.error || "error"}`);
    }
  }

  return {
    ok: false,
    attempts: attempt,
    logs,
    patchesApplied,
    testCommand,
    lastTest,
    hints,
    error: "No se alcanzo verde tras los intentos de reparacion",
  };
}

class TestRepairLoop {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  runRepairCycle(testCommand = "npm test", maxAttempts = 3) {
    return runTddRepair(this.projectRoot, { testCommand, maxAttempts });
  }
}

module.exports = {
  TestRepairLoop,
  runTddRepair,
  detectTestCommand,
  extractFailureHints,
};
