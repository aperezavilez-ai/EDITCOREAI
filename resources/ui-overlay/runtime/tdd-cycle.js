"use strict";

/**
 * Ciclo TDD con maquina de estados: red → implement → green → refactor.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PHASES = ["red", "implement", "green", "refactor", "done"];

function statePath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "tdd-state.json");
}

function loadState(projectRoot) {
  const file = statePath(projectRoot);
  if (!fs.existsSync(file)) {
    return { phase: "red", cycles: 0, history: [], testPath: "", updatedAt: "" };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      phase: String(raw.phase || "red"),
      cycles: Number(raw.cycles) || 0,
      history: Array.isArray(raw.history) ? raw.history : [],
      testPath: String(raw.testPath || ""),
      updatedAt: String(raw.updatedAt || ""),
      lastPassed: raw.lastPassed === true,
    };
  } catch {
    return { phase: "red", cycles: 0, history: [] };
  }
}

function saveState(projectRoot, state) {
  const file = statePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function detectTestCommand(projectRoot) {
  const pkgPath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return "node --test";
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    if (scripts.test) return "npm test --silent";
    if (scripts["test:unit"]) return "npm run test:unit --silent";
  } catch { /* ignore */ }
  return "node --test";
}

function writeTestFile(projectRoot, relPath, content) {
  const rel = String(relPath || "").replace(/\\/g, "/");
  if (!rel || rel.includes("..")) throw new Error("path de test invalido");
  const abs = path.join(projectRoot, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(content ?? ""), "utf8");
  return { ok: true, path: rel };
}

function executeCommand(projectRoot, command, runCommand) {
  if (typeof runCommand === "function") return runCommand(command);
  const spawned = spawnSync(command, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 2_000_000,
  });
  return {
    ok: spawned.status === 0,
    code: spawned.status,
    stdout: String(spawned.stdout || "").slice(0, 12_000),
    stderr: String(spawned.stderr || "").slice(0, 8_000),
    command,
  };
}

function generateFixtureStub({ name = "sample", fields = ["id", "name"] } = {}) {
  const obj = {};
  for (const field of fields) {
    obj[field] = field === "id" ? 1 : `${name}-${field}`;
  }
  return `${JSON.stringify(obj, null, 2)}\n`;
}

/**
 * FSM:
 * - red: escribe test y DEBE fallar
 * - implement: usuario/agente corrige codigo (este paso solo re-corre tests)
 * - green: tests deben pasar
 * - refactor: opcional, re-verificar verde
 */
function runTddCycle(projectRoot, input = {}, { runCommand } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  let state = loadState(root);
  const requestedPhase = String(input.phase || state.phase || "red").toLowerCase();
  const phase = PHASES.includes(requestedPhase) ? requestedPhase : "red";
  const actions = [];

  if (input.reset === true) {
    state = saveState(root, { phase: "red", cycles: 0, history: [], testPath: "" });
  }

  if (input.testPath && input.testContent != null && (phase === "red" || input.forceWriteTest === true)) {
    actions.push(writeTestFile(root, input.testPath, input.testContent));
    state.testPath = String(input.testPath);
  }
  if (input.fixturePath && input.fixtureContent != null) {
    actions.push({ ...writeTestFile(root, input.fixturePath, input.fixtureContent), kind: "fixture" });
  }

  const command = String(input.command || detectTestCommand(root));
  const result = executeCommand(root, command, runCommand);
  const passed = result?.ok === true || Number(result?.code) === 0;

  let nextPhase = phase;
  let ok = true;
  let next = "";

  if (phase === "red") {
    if (passed) {
      ok = false;
      nextPhase = "red";
      next = "RED fallido: el test paso en verde. Escribe un test que falle primero (prueba el comportamiento ausente).";
    } else {
      nextPhase = "implement";
      next = "RED OK (test en rojo). Implementa el codigo minimo para pasar el test. Luego phase=green.";
    }
  } else if (phase === "implement" || phase === "green") {
    if (!passed) {
      ok = false;
      nextPhase = "implement";
      next = "GREEN fallido: tests en rojo. Corrige codigo de produccion (no borres el test) y reintenta phase=green.";
    } else {
      nextPhase = "refactor";
      next = "GREEN OK. Opcional: refactor con phase=refactor y vuelve a verificar.";
    }
  } else if (phase === "refactor") {
    if (!passed) {
      ok = false;
      nextPhase = "implement";
      next = "Refactor rompio tests. Restaura verde.";
    } else {
      nextPhase = "done";
      next = "TDD ciclo completo (rojo→verde→refactor).";
    }
  } else {
    nextPhase = passed ? "done" : "implement";
    next = passed ? "Done." : "Quedan fallos; vuelve a implement.";
  }

  state = saveState(root, {
    ...state,
    phase: nextPhase,
    cycles: Number(state.cycles || 0) + 1,
    lastPassed: passed,
    history: [...(state.history || []), { at: new Date().toISOString(), phase, passed, command }].slice(-20),
  });

  return {
    ok,
    passed,
    phase,
    nextPhase,
    command,
    actions,
    stdout: String(result?.stdout || "").slice(0, 12_000),
    stderr: String(result?.stderr || "").slice(0, 8_000),
    state,
    next,
  };
}

module.exports = {
  PHASES,
  detectTestCommand,
  writeTestFile,
  runTddCycle,
  generateFixtureStub,
  loadState,
  saveState,
};
