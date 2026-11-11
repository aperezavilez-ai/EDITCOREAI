"use strict";

// Convergencia (2ª vuelta) + enrutamiento por tarea + origen del admin:
// 1) project-analysis vive UNA sola vez (la raíz); runtime/ re-exporta.
// 2) La selección de skills vive UNA sola vez (selectSkillsForTurn);
//    skillsPrompt solo construye el texto con esa selección.
// 3) Auto gana un carril "build": una construcción desde cero va al modelo
//    de mayor nivel disponible, sin rotación por uso y sin modelos chicos.
// 4) Sin host Supabase por defecto: ni el admin recibe el servidor dado de
//    baja; su origen sale de su conexión configurada y cada usuario conecta
//    sus propias cuentas (regla del dueño, 2026-11-10).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const ProjectAnalysisRoot = require("../project-analysis");
const ProjectAnalysisRuntime = require("../runtime/project-analysis");
const { skillsPrompt, selectSkillsForTurn, MAX_SKILLS_IN_PROMPT } = require("../editcore-chat-kernel/skills-catalog");
const AutoModel = require("../auto-model-selection");
const defaults = require("../runtime/platform-defaults");

test("convergencia: runtime/project-analysis ES la implementación de la raíz (mismo módulo)", () => {
  assert.equal(ProjectAnalysisRuntime, ProjectAnalysisRoot);
  assert.equal(ProjectAnalysisRuntime.pickScaffoldTemplate("quiero una landing"), "pro-web-app");
  assert.equal(
    ProjectAnalysisRuntime.resolveExecutionMode("corrige este proyecto", { requestedAgent: false, projectOpen: false }).missingProject,
    true,
  );
});

test("convergencia: lo que inyecta skillsPrompt es exactamente lo que elige selectSkillsForTurn", () => {
  for (const message of [
    "créame una landing para mi taller mecánico",
    "corrige el error de sintaxis en el servidor de correo",
    "¿qué es una API?",
  ]) {
    const pickedIds = selectSkillsForTurn(REPO_ROOT, "EXECUTE", message, MAX_SKILLS_IN_PROMPT).map((p) => p.id);
    const prompt = skillsPrompt(REPO_ROOT, "EXECUTE", message);
    const injectedIds = [...prompt.matchAll(/^SKILL ([a-z0-9-]+) \(/gim)].map((m) => m[1]);
    assert.deepEqual(injectedIds, pickedIds, `mensaje: ${message}`);
  }
});

const ENTRIES = [
  { model: "meai/claude-haiku-4.5" },
  { model: "meai/claude-sonnet-4.6" },
  { model: "meai/claude-opus-4.8" },
];
const USAGE = { autoModelUsage: { "meai/claude-opus-4.8": 50, "meai/claude-sonnet-4.6": 1, "meai/claude-haiku-4.5": 0 } };

test("enrutamiento: clasificar — build solo con agente+tools; verify manda; el acento no rompe", () => {
  const base = { prompt: "", isAgent: false, usesProjectTools: false };
  assert.equal(AutoModel.classifyAutoTaskRole({ ...base, prompt: "créala como lo platicamos", isAgent: true, usesProjectTools: true, greenfieldCreate: true, planAuthorizedExecution: true }), "build");
  assert.equal(AutoModel.classifyAutoTaskRole({ ...base, prompt: "créame una app de citas para mi negocio", isAgent: true, usesProjectTools: true, needsAnalysisFirst: true }), "build");
  assert.equal(AutoModel.classifyAutoTaskRole({ ...base, prompt: "corrige el cálculo de impuestos", isAgent: true, usesProjectTools: true, planAuthorizedExecution: true }), "implement");
  assert.equal(AutoModel.classifyAutoTaskRole({ ...base, prompt: "auditoría de seguridad antes de producción", isAgent: true, usesProjectTools: true, greenfieldCreate: true }), "verify");
  assert.equal(AutoModel.classifyAutoTaskRole({ ...base, prompt: "¿qué es una API?" }), "chat");
});

test("enrutamiento: en build gana el mayor nivel SIN rotar por uso; haiku jamás", () => {
  const buildCtx = { prompt: "créame una app de citas", isAgent: true, usesProjectTools: true, greenfieldCreate: true, planAuthorizedExecution: true, ...USAGE };
  assert.equal(AutoModel.pickTaskFitEntry(ENTRIES, buildCtx)?.model, "meai/claude-opus-4.8");
  const sinFuertes = [{ model: "meai/claude-haiku-4.5" }, { model: "meai/qwen3.6-plus" }];
  assert.equal(AutoModel.pickTaskFitEntry(sinFuertes, buildCtx)?.model, "meai/qwen3.6-plus");
});

test("enrutamiento: en implement la rotación por uso se conserva (sin regresión)", () => {
  const implCtx = { prompt: "corrige el bug del login", isAgent: true, usesProjectTools: true, planAuthorizedExecution: true, ...USAGE };
  assert.equal(AutoModel.pickTaskFitEntry(ENTRIES, implCtx)?.model, "meai/claude-sonnet-4.6");
});

test("origen admin: sin host por defecto ni siquiera para el administrador", () => {
  defaults.setAdminInfra(true);
  try {
    assert.equal(defaults.ADMIN_SUPABASE_ORIGIN, "");
    assert.equal(defaults.defaultSupabaseOrigin(), "");
  } finally {
    defaults.setAdminInfra(false);
  }
  assert.equal(defaults.defaultSupabaseOrigin(), "");
});

test("origen admin: el renderer pasa la bandera greenfield al contexto de Auto", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "renderer.js"), "utf8");
  assert.match(source, /greenfieldCreate: Boolean\(plan\.greenfieldCreate\)/);
});
