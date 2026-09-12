"use strict";

const { runDiagnostics } = require("./post-write-diagnostics");

const DEFAULT_MAX_CYCLES = 3;

function summarizeDiagnostics(diag = {}) {
  if (!diag || diag.skipped) return null;
  if (diag.passed === true) return null;
  const failures = (diag.results || []).filter((item) => item && item.ok === false);
  if (!failures.length && diag.ok === false) {
    return {
      failed: true,
      commands: [],
      stderr: String(diag.message || diag.reason || "Diagnostico fallido").slice(0, 2000),
    };
  }
  if (!failures.length) return null;
  return {
    failed: true,
    commands: failures.map((item) => item.command || item.script).filter(Boolean),
    stderr: failures.map((item) => String(item.stderr || item.stdout || "").slice(-1800)).join("\n---\n").slice(0, 3500),
  };
}

function buildAutoFixPrompt(diag = {}, cycle = 1, maxCycles = DEFAULT_MAX_CYCLES) {
  const summary = summarizeDiagnostics(diag);
  if (!summary) return "";
  const looksLikeTest = /test|spec|assert|failing|FAIL/i.test(summary.stderr || "")
    || (summary.commands || []).some((c) => /test/i.test(String(c)));
  return [
    `AUTO-FIX EDITCORE (${cycle}/${maxCycles}):`,
    looksLikeTest
      ? "- El diagnostico post-escritura (tests/runtime) FALLO tras tus cambios."
      : "- El diagnostico post-escritura (lint/typecheck/tests) FALLO tras tus cambios.",
    summary.commands.length ? `- Comandos: ${summary.commands.join(" | ")}` : "",
    "- Corrige AHORA con read_file → replace_in_file/write_file sobre los archivos reales citados en el error.",
    "- NO borres ni debilites tests para pasar en verde; arregla el codigo de produccion.",
    "- Luego vuelve a verificar (run_diagnostics / run_tdd_cycle / el mismo check). No narres la correccion sin mutacion.",
    "- Si el error es de entorno/deps (modulo no instalado), un solo npm install y reintenta.",
    "STDERR / salida:",
    summary.stderr || "(sin detalle)",
  ].filter(Boolean).join("\n");
}

async function runAutoFixDiagnostics(projectRoot, changedFiles = [], { runCommand } = {}) {
  return runDiagnostics(projectRoot, changedFiles, { runCommand });
}

function nextAutoFixState(state = {}, diag = {}, maxCycles = DEFAULT_MAX_CYCLES) {
  const cycles = Number(state.cycles) || 0;
  const prompt = buildAutoFixPrompt(diag, cycles + 1, maxCycles);
  if (!prompt) {
    return { ...state, cycles, prompt: "", triggered: false, passed: diag?.passed === true || diag?.skipped === true };
  }
  if (cycles >= maxCycles) {
    return {
      ...state,
      cycles,
      prompt: "",
      triggered: false,
      exhausted: true,
      message: `Auto-fix agoto ${maxCycles} ciclos. Quedan errores de lint/typecheck.`,
    };
  }
  return {
    ...state,
    cycles: cycles + 1,
    prompt,
    triggered: true,
    exhausted: false,
    lastDiag: summarizeDiagnostics(diag),
  };
}

module.exports = {
  DEFAULT_MAX_CYCLES,
  summarizeDiagnostics,
  buildAutoFixPrompt,
  runAutoFixDiagnostics,
  nextAutoFixState,
};
