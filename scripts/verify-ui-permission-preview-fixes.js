"use strict";
/**
 * Comprobacion fisica de los 3 fixes: preview ruido, boton restore, Acceso completo.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "runtime/editcore-claude-adapter.js"), "utf8");

const evidence = [];

// 1) Boton Restaurar eliminado
assert.doesNotMatch(html, /restoreSnapshotBtn/);
assert.doesNotMatch(html, /Restaurar versi[oó]n anterior/i);
evidence.push("OK index.html: sin boton Restaurar version anterior");

// 2) Preview ignora ruido de main/preload/importReportPath
assert.match(renderer, /cannot find module \['"\]\?main\\\.js/);
assert.match(renderer, /importreportpath/);
assert.match(renderer, /Sin URL de preview activa/);
evidence.push("OK renderer: filtro de errores fantasma del preview");

// 3) PROCEDE + tarea resumible NO debe quedar en DISCOVER
const proceedPlan = resolveUnifiedAgentPlan({
  prompt: "PROCEDE",
  requestedAgent: true,
  projectOpen: true,
  allowWrite: true,
  permissionMode: "full",
  resumableTask: true,
  workflowPhase: "executing",
});
assert.equal(proceedPlan.mode, MODES.EXECUTE, `PROCEDE debia ser EXECUTE, fue ${proceedPlan.mode} (${proceedPlan.reason})`);
assert.equal(proceedPlan.analysisMode, false);
evidence.push(`OK PROCEDE+full+resumible → EXECUTE (${proceedPlan.reason})`);

// 4) Acceso completo sin PROCEDE: ejecuta tarea concreta
const fixPlan = resolveUnifiedAgentPlan({
  prompt: "Corrige el error del preview y aplica el cambio en renderer.js",
  requestedAgent: true,
  projectOpen: true,
  allowWrite: true,
  permissionMode: "full",
  resumableTask: false,
});
assert.equal(fixPlan.mode, MODES.EXECUTE, `fix+full debia ser EXECUTE, fue ${fixPlan.mode} (${fixPlan.reason})`);
evidence.push(`OK corrige+full → EXECUTE (${fixPlan.reason})`);

// 5) Adapter no pausa auth con Acceso completo
assert.match(adapter, /permissionFullNowPause/);
assert.match(adapter, /!permissionFullNowPause/);
evidence.push("OK adapter: auth-pause desactivado con Acceso completo");

// 6) isPlanAuthorizedExecution full+PROCEDE
assert.match(renderer, /strictProceed && state\.permissionMode === "full"\) return true/);
evidence.push("OK renderer: PROCEDE con Acceso completo autoriza plan");

console.log("EVIDENCIA_FISICA");
for (const line of evidence) console.log(" -", line);
console.log("ALL_CHECKS_PASSED");
