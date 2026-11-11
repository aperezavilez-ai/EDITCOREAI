"use strict";

// Compuertas de reparación (sesión VIXERAI, 2026-11-10): el agente
// diagnosticó de memoria, editó 8 archivos en 3 turnos y declaró
// "corregido" tres veces con solo la comprobación ligera por archivo,
// sin capturar jamás el error real de la consola. Estos tests fijan los
// mecanismos que lo impiden: clasificador de turno de reparación,
// compuerta de evidencia antes de escribir, qué cuenta como
// verificación real aprobada, captura con errores de consola/overlay, y
// la skill de depuración forzada en turnos de reparación.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const guard = require(path.join(root, "editcore-chat-kernel", "repair-guard.js"));
const orchestrator = fs.readFileSync(path.join(root, "editcore-chat-kernel", "orchestrator.js"), "utf8");
const vision = fs.readFileSync(path.join(root, "editcore-chat-kernel", "vision-inspector.js"), "utf8");
const electronInspector = fs.readFileSync(path.join(root, "visual-preview-inspector.js"), "utf8");
const skillsCatalog = fs.readFileSync(path.join(root, "editcore-chat-kernel", "skills-catalog.js"), "utf8");

test("isRepairTask reconoce los reportes de daño reales de Luis", () => {
  for (const text of [
    "esta dañado el proyecto no abre correctamente",
    "sigue dañado",
    "no es verdad, sigue dañado y no se ve el preview",
    "corrige el error de consola",
    "la página está en blanco, no carga",
    "the app is still broken, blank page",
  ]) {
    assert.equal(guard.isRepairTask(text), true, text);
  }
});

test("isRepairTask no se dispara en creación ni en preguntas", () => {
  for (const text of [
    "créame la landing de un taller mecánico con servicios y precios",
    "¿qué es una API?",
    "agrega un botón de WhatsApp al encabezado",
    "¿qué tiene la carpeta public?",
  ]) {
    assert.equal(guard.isRepairTask(text), false, text);
  }
});

test("isBuildAffectingPath cubre CSS, configs y entradas; no componentes comunes", () => {
  for (const p of ["src/index.css", "postcss.config.cjs", "tailwind.config.cjs", "package.json", "index.html", "src/main.tsx", "vite.config.ts"]) {
    assert.equal(guard.isBuildAffectingPath(p), true, p);
  }
  for (const p of ["src/components/POSView.tsx", "README.md", "src/lib/utils.ts"]) {
    assert.equal(guard.isBuildAffectingPath(p), false, p);
  }
});

test("la evidencia del turno: captura o build cuentan; leer archivos no", () => {
  // [EDITCORE-INTEGRAL-B1] Actualizado A PROPÓSITO: antes una captura
  // FALLIDA (result ok:false) contaba como evidencia y liberaba la
  // compuerta — el comportamiento roto que el Bloque 1 corrige. Ahora
  // solo una captura con éxito es evidencia; la fallida NO libera.
  assert.equal(guard.turnHasEvidence([{ name: "capture_preview_screenshot", result: { ok: false } }]), false);
  assert.equal(guard.turnHasEvidence([{ name: "capture_preview_screenshot", result: { ok: true } }]), true);
  assert.equal(guard.turnHasEvidence([{ name: "run_command", input: { command: "npm run build" }, result: { ok: false } }]), true);
  assert.equal(guard.turnHasEvidence([{ name: "run_command", input: { command: "npm ls tailwindcss" }, result: { ok: true } }]), false);
  assert.equal(guard.turnHasEvidence([{ name: "read_file", input: { path: "src/index.css" }, result: { ok: true } }]), false);
  assert.equal(guard.turnHasEvidence([{ name: "capture_preview_screenshot", blocked: true, result: {} }]), false);
});

test("verificación real aprobada: captura limpia o build en verde; la ligera no cuenta", () => {
  assert.equal(guard.turnHasPassingRealVerification([{ name: "capture_preview_screenshot", result: { renderOk: true, diagnostics: { consoleErrors: [] } } }]), true);
  assert.equal(guard.turnHasPassingRealVerification([{ name: "capture_preview_screenshot", result: { renderOk: true, diagnostics: { consoleErrors: [{ type: "error", text: "x" }] } } }]), false);
  assert.equal(guard.turnHasPassingRealVerification([{ name: "capture_preview_screenshot", result: { renderOk: false, diagnostics: {} } }]), false);
  assert.equal(guard.turnHasPassingRealVerification([{ name: "run_command", input: { command: "npm run build" }, ok: true, result: { ok: true } }]), true);
  assert.equal(guard.turnHasPassingRealVerification([{ name: "run_command", input: { command: "npm run build" }, ok: false, result: { ok: false } }]), false);
});

test("la compuerta bloquea la primera escritura sin evidencia y se libera sola", () => {
  const blocked = guard.maybeBlockWriteBeforeEvidence("write_file", [], 0);
  assert.equal(blocked?.evidenceGate, true);
  assert.equal(guard.maybeBlockWriteBeforeEvidence("write_file", [{ name: "capture_preview_screenshot", result: { ok: true } }], 0), null);
  assert.equal(guard.maybeBlockWriteBeforeEvidence("write_file", [], 2), null);
  assert.equal(guard.maybeBlockWriteBeforeEvidence("read_file", [], 0), null);
});

test("los ojos solo se arman si el daño es visible o el proyecto es web", () => {
  assert.equal(guard.isVisualRepairTask("esta dañado el proyecto no abre correctamente"), true);
  assert.equal(guard.isVisualRepairTask("el preview quedó en blanco"), true);
  assert.equal(guard.isVisualRepairTask("corrige el cálculo de impuestos en el servidor"), false);
  const os = require("node:os");
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ec-repair-"));
  assert.equal(guard.projectLooksWeb(empty), false);
  fs.writeFileSync(path.join(empty, "index.html"), "<html></html>");
  assert.equal(guard.projectLooksWeb(empty), true);
  const backend = fs.mkdtempSync(path.join(os.tmpdir(), "ec-repair-"));
  fs.writeFileSync(path.join(backend, "package.json"), JSON.stringify({ dependencies: { express: "^4" } }));
  assert.equal(guard.projectLooksWeb(backend), false);
});

test("el orquestador trae las tres compuertas cableadas", () => {
  assert.match(orchestrator, /this\._repairTask = true;\s*\n\s*this\._repairExtra = repairGuard\.repairProtocolPrompt\(\);/);
  assert.match(orchestrator, /repairGuard\.isVisualRepairTask\(taskText\) \|\| repairGuard\.projectLooksWeb\(projectRoot\)/);
  assert.match(orchestrator, /repairGuard\.maybeBlockWriteBeforeEvidence\(name, steps, evidenceBlocks\)/);
  assert.match(orchestrator, /const unverifiedRepair = this\._repairTask === true/);
  assert.equal((orchestrator.match(/await appendRealVerification\(projectRoot, written, steps/g) || []).length, 2);
});

test("la captura ahora devuelve errores de consola y el texto del overlay", () => {
  assert.equal((vision.match(/page\.on\("console"/g) || []).length, 2);
  assert.equal((vision.match(/page\.on\("pageerror"/g) || []).length, 2);
  assert.match(vision, /vite-error-overlay/);
  assert.match(vision, /mergeConsoleErrors/);
  assert.match(electronInspector, /console-message/);
  assert.match(electronInspector, /vite-error-overlay/);
});

test("la skill de depuración sistemática se fuerza en turnos de reparación", () => {
  assert.match(skillsCatalog, /const REPAIR_SKILL_IDS = \["as-debugging-and-error-recovery"\];/);
  assert.match(skillsCatalog, /const forcedRepair = forcedRepairSkills\(message, valid\);/);
});
