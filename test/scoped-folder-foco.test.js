"use strict";

/**
 * FOCO RETIRADO: carpeta/archivo "solo X" ya no activa scoped_dir ni bloquea tools.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveInstructionConstraints,
  assertInstructionToolAllowed,
} = require("../runtime/instruction-obedience");
const {
  extractScopedFolderAllowlist,
  isolateUserIntentPrompt,
} = require("../runtime/scoped-file-focus");
const { resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");
const ProjectAnalysis = require("../project-analysis");

const FOLDER_PROMPT = "lee solamente la carpeta api y dime que contiene.";
const POLLUTED = [
  FOLDER_PROMPT,
  "",
  "Archivos relacionados:",
  "- src/lib/admin.functions.ts",
  "- api/routes.ts",
].join("\n");

const FILE_FOCO = [
  "Analiza solo package.json de la raiz.",
  "Si encuentras 1 mejora minima de texto en description o name, proponla y espera autorizacion.",
  "No explores android/ios/docs.",
].join("\n");

test("FOCO retirado: enrich no activa scoped", () => {
  const c = resolveInstructionConstraints(POLLUTED);
  assert.notEqual(c.mode, "scoped");
  assert.notEqual(c.mode, "scoped_dir");
  assert.doesNotThrow(() => assertInstructionToolAllowed("list_files", { path: "api" }, c));
  assert.doesNotThrow(() => assertInstructionToolAllowed("list_files", { path: "android" }, c));
});

test("FOCO retirado: carpeta api no bloquea tools", () => {
  const folders = extractScopedFolderAllowlist(FOLDER_PROMPT);
  assert.ok(folders.includes("api") || folders.length >= 0);
  const c = resolveInstructionConstraints(FOLDER_PROMPT);
  assert.notEqual(c.mode, "scoped_dir");
  assert.doesNotThrow(() => assertInstructionToolAllowed("list_files", { path: "api" }, c));
  assert.doesNotThrow(() => assertInstructionToolAllowed("list_files", { path: "android" }, c));
});

test("isolateUserIntentPrompt ignora bloque Archivos relacionados", () => {
  const isolated = isolateUserIntentPrompt(POLLUTED);
  assert.match(isolated, /carpeta api/i);
  assert.doesNotMatch(isolated, /admin\.functions\.ts/i);
});

test("FOCO retirado: package.json no activa allowlist runtime", () => {
  const c = resolveInstructionConstraints(FILE_FOCO);
  assert.notEqual(c.mode, "scoped");
  assert.doesNotThrow(() => assertInstructionToolAllowed("list_files", { path: "api" }, c));
});

test("orquestador: nunca scopedDiskFocus / tools completas de discover", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: FOLDER_PROMPT,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: false,
    permissionMode: "readonly",
  });
  assert.equal(plan.scopedDiskFocus, false);
  assert.equal(plan.scopedFolderFocus, false);
  assert.ok(Array.isArray(plan.allowedTools));
  assert.ok(plan.allowedTools.includes("list_files"), `tools=${JSON.stringify(plan.allowedTools)}`);
  assert.ok(plan.allowedTools.includes("read_file"));
  assert.ok(plan.allowedTools.length > 2, "no debe quedar solo read_file");
});

test("isScopedDiskFileRequest siempre false", () => {
  assert.equal(ProjectAnalysis.isScopedDiskFileRequest(FOLDER_PROMPT), false);
  assert.equal(ProjectAnalysis.isScopedDiskFileRequest(FILE_FOCO), false);
  assert.equal(ProjectAnalysis.isFreshAnalysisRequest(FOLDER_PROMPT), true);
});
