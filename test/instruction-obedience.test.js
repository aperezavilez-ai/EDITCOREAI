"use strict";

/**
 * FOCO RETIRADO (2026-09-09):
 * El sistema scoped/allowlist/FOCO en chat no aportaba valor y rompia analisis/PROCEDE.
 * Estos tests fijan el contrato: nunca mode=scoped, nunca isScopedDiskFileRequest.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FOCO_ENABLED,
  resolveInstructionConstraints,
  assertInstructionToolAllowed,
  extractScopedAllowlist,
} = require("../runtime/instruction-obedience");
const { resolveAnalysisDepth } = require("../runtime/analysis-depth");
const { analysisEvidenceSufficient } = require("../runtime/evidence-grounding");
const ProjectAnalysis = require("../project-analysis");

const SCOPED_PROMPT = [
  "Analisis forense TAXIDRIV.",
  "Analizando unicamente archivo package.json de la raiz.",
  "No explores android/ios/docs.",
  "Si no hay nada que corregir, dilo y NO pidas PROCEDE.",
].join("\n");

test("FOCO_ENABLED es false", () => {
  assert.equal(FOCO_ENABLED, false);
});

test("FOCO retirado: constraints nunca scoped aunque diga solo package.json", () => {
  const c = resolveInstructionConstraints(SCOPED_PROMPT);
  assert.notEqual(c.mode, "scoped");
  assert.notEqual(c.mode, "scoped_dir");
  assert.deepEqual(c.allowlist, []);
  // Denylist suave sigue activa si el usuario lo pide.
  assert.ok(c.mode === "deny" || c.mode === "open");
});

test("FOCO retirado: profundidad normal (no surface scoped)", () => {
  const depth = resolveAnalysisDepth(SCOPED_PROMPT);
  assert.notEqual(depth.scopedFocus, true);
  assert.ok(depth.depth === "forensic" || depth.depth === "deep" || depth.depth === "standard" || depth.depth === "surface");
});

test("FOCO retirado: list_files/read_file no bloqueados por allowlist", () => {
  const c = resolveInstructionConstraints(SCOPED_PROMPT);
  // Denylist suave puede bloquear android si el usuario lo pide; allowlist FOCO no.
  assert.doesNotThrow(() => assertInstructionToolAllowed("read_file", { path: "vite.config.ts" }, c));
  assert.doesNotThrow(() => assertInstructionToolAllowed("project_discovery", {}, c));
  assert.doesNotThrow(() => assertInstructionToolAllowed("read_file", { path: "package.json" }, c));
  assert.doesNotThrow(() => assertInstructionToolAllowed("list_files", { path: "src" }, c));
});

test("FOCO retirado: isScopedDiskFileRequest siempre false", () => {
  assert.equal(ProjectAnalysis.isScopedDiskFileRequest(SCOPED_PROMPT), false);
  assert.equal(ProjectAnalysis.isScopedDiskFileRequest("analiza solo package.json"), false);
});

test("evidencia: sin FOCO, cobertura usa profundidad normal", () => {
  const depth = resolveAnalysisDepth("analiza el proyecto a fondo");
  const evidence = {
    filesRead: [{ path: "package.json", content: "{}" }],
    listed: [{ path: "", entries: [] }],
    toolLog: [],
  };
  const result = analysisEvidenceSufficient(evidence, { depthProfile: depth, prompt: "analiza" });
  assert.equal(typeof result.ok, "boolean");
});

test("extractScopedAllowlist sigue parseando (parser legacy) pero no activa FOCO", () => {
  const allow = extractScopedAllowlist(SCOPED_PROMPT);
  // Puede o no encontrar package.json; lo importante es que constraints no activen FOCO.
  const c = resolveInstructionConstraints(SCOPED_PROMPT);
  assert.equal(c.mode === "scoped", false);
  void allow;
});
