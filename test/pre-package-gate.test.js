"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveUnifiedAgentPlan,
  MODES,
  SUB_AGENTS,
  PHASES,
} = require("../runtime/intent-orchestrator");
const { localConversationResponse } = require("../runtime/chat-local");
const {
  jarvisAgentCatalog,
  enrichAgentInventory,
  JARVIS_BOTS,
} = require("../runtime/jarvis-port");

const appRoot = path.join(__dirname, "..");
const mainSource = fs.readFileSync(path.join(appRoot, "main.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(appRoot, "renderer.js"), "utf8");
const preloadSource = fs.readFileSync(path.join(appRoot, "preload.js"), "utf8");
const indexSource = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");

test("GATE: chat nativo sin dependencia de jarvis-adapter", () => {
  assert.doesNotMatch(mainSource, /sendChatToJarvis/);
  assert.doesNotMatch(mainSource, /require\("\.\/runtime\/jarvis-adapter"\)/);
  assert.match(preloadSource, /editcore:chat/);
});

test("GATE: orquestador unico en renderer", () => {
  assert.match(rendererSource, /EditCoreAgentOrchestrator/);
  assert.match(rendererSource, /resolveUnifiedAgentPlan/);
  assert.match(indexSource, /intent-orchestrator\.js/);
});

test("GATE: comentario de intencion responde como humano sin rutas ni codigo", () => {
  const prompt = "VAMOS A CREAR UN PROYECTO NUEVO";
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.CHAT);
  assert.equal(plan.runProfile.phase, PHASES.CHAT);
  assert.equal(plan.runProfile.subAgent, SUB_AGENTS.INTENT);
  assert.equal(plan.usesProjectTools, false);

  const understand = resolveUnifiedAgentPlan({
    prompt: "Analiza lo siguiente:\n\nApp de tickets con registro y panel admin en React.",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(understand.mode, MODES.CHAT);
  assert.equal(understand.usesProjectTools, false);
  assert.equal(understand.runProfile.subAgent, SUB_AGENTS.INTENT);

  const discover = resolveUnifiedAgentPlan({
    prompt: "Descubre la estructura del proyecto actual",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(discover.mode, MODES.DISCOVER);

  const execute = resolveUnifiedAgentPlan({
    prompt: "Crea un archivo README.md con la descripcion del proyecto",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(execute.mode, MODES.EXECUTE);

  const procede = resolveUnifiedAgentPlan({
    prompt: "procede",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(procede.mode, MODES.EXECUTE);
  assert.equal(procede.runProfile.phase, PHASES.EXECUTE);
});

test("GATE: capacidades Jarvis portadas nativamente", () => {
  const catalog = jarvisAgentCatalog();
  assert.equal(catalog.requiresSidecar, false);
  assert.ok(Array.isArray(catalog.agents));
  assert.ok(catalog.agents.length > 0);
});

test("GATE: 6 contratos de usuario (no-regresion)", () => {
  assert.match(rendererSource, /promptField\.value = ""/);
  assert.match(rendererSource, /sendButton\.disabled/);
  assert.match(rendererSource, /chatMessages\.appendChild/);
  assert.match(rendererSource, /scrollIntoView/);
  assert.match(rendererSource, /Esto NO es un fallo de la herramienta run_command/);
  assert.match(rendererSource, /const options = verifiedChatModelOptions\(\)/);
});

test("GATE: errores tecnicos no se muestran al usuario", () => {
  assert.match(rendererSource, /function userFacingError|function formatError|function sanitizeError|showErrorMessage|showError/i);
});

test("GATE: panel de archivos y preview reaccionan a escrituras del agente", () => {
  assert.match(indexSource, /project-files-ui\.js/);
  assert.match(indexSource, /id="closeProjectBtn"/);
  assert.match(rendererSource, /function closeOpenProject/);
  assert.match(rendererSource, /handleProjectFilesChanged/);
  assert.match(rendererSource, /maybeRefreshPreviewAfterWrite/);
  const preloadSource = fs.readFileSync(path.join(appRoot, "preload.js"), "utf8");
  assert.match(preloadSource, /project:files-changed/);
  assert.match(preloadSource, /project:preview-stop/);
  const { filesChangedPayload } = require("../runtime/project-files-ui");
  const payload = filesChangedPayload({
    name: "write_file",
    input: { path: "D:/PROGRAMAS IA/TICKETIA/README.md" },
  }, "D:/PROGRAMAS IA/TICKETIA");
  assert.equal(payload.viewDir, "");
  assert.equal(payload.fileName, "README.md");
});

test("GATE: main.js no carga al arrancar archivos que el empaquetado excluye", () => {
  const pkg = require("../package.json");
  const excludedDirs = (pkg.build?.files || [])
    .map((p) => String(p).match(/^!([\w-]+)\/\*\*$/))
    .filter(Boolean)
    .map((m) => m[1]);
  assert.ok(excludedDirs.includes("scripts"));
  const offenders = mainSource
    .split(/\r?\n/)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /^\S/.test(line))
    .flatMap(({ line, n }) => [...line.matchAll(/require\(\s*["']\.\/([\w-]+)\//g)]
      .filter((m) => excludedDirs.includes(m[1]))
      .map((m) => `main.js:${n} -> ${m[1]}/`));
  assert.deepEqual(offenders, []);
});

test("GATE: el empaquetado excluye secretos y configuración local", () => {
  const files = require("../package.json").build?.files || [];
  for (const pattern of ["!.env*", "!**/.env.local", "!.claude/**"]) {
    assert.ok(files.includes(pattern), `falta ${pattern} en build.files`);
  }
});

test("GATE: version semver con segmentos de maximo 2 digitos", () => {
  const pkg = require("../package.json");
  assert.match(pkg.version, /^\d{1,2}\.\d{1,2}\.\d{1,2}$/);
});

test("GATE: modelo verificado se propaga igual a chat y sub-agentes", () => {
  const prompt = "Crea un archivo de configuracion para el proyecto";
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.runProfile.phase, PHASES.EXECUTE);
  assert.equal(plan.usesProjectTools, true);
});
