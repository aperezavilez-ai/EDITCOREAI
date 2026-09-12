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
  assert.match(mainSource, /ipcMain\.handle\("editcore:chat"/);
  assert.match(mainSource, /callProvider\(/);
  assert.match(mainSource, /localConversationResponse/);
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
  assert.equal(plan.usesProjectTools, false);
  assert.equal(plan.conversationOnly, true);
  const reply = localConversationResponse(prompt);
  assert.equal(reply, "");
});

test("GATE: sub-agentes UNDERSTAND DISCOVER EXECUTE", () => {
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
    prompt: "Analiza el proyecto completo y dame un reporte",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: false,
  });
  assert.equal(discover.mode, MODES.DISCOVER);
  assert.equal(discover.runProfile.subAgent, SUB_AGENTS.EXPLORER);

  const execute = resolveUnifiedAgentPlan({
    prompt: "CREA EL PROYECTO AHORA con README y package.json",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(execute.mode, MODES.EXECUTE);
  assert.equal(execute.runProfile.subAgent, SUB_AGENTS.IMPLEMENTER);
  assert.equal(execute.runProfile.greenfieldCreate, true);

  const procede = resolveUnifiedAgentPlan({
    prompt: "procede",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    planAuthorizedExecution: true,
  });
  assert.equal(procede.mode, MODES.EXECUTE);
  assert.equal(procede.runProfile.phase, PHASES.EXECUTE);
});

test("GATE: capacidades Jarvis portadas nativamente", () => {
  const catalog = jarvisAgentCatalog();
  assert.ok(catalog.agents.length >= JARVIS_BOTS.length);
  assert.equal(catalog.native, true);
  assert.equal(catalog.requiresSidecar, false);
  const enriched = enrichAgentInventory({ skills: [], installed: [], catalog: [] });
  assert.ok(enriched.jarvis?.agents?.length >= 5);
  assert.ok(Array.isArray(enriched.installed));
});

test("GATE: bot registry nativo expuesto por IPC", () => {
  assert.match(mainSource, /ipcMain\.handle\("bots:list"/);
  assert.match(mainSource, /getBotRegistry/);
  const { getBotRegistry } = require("../runtime/bot-registry");
  assert.equal(getBotRegistry().list().length, 5);
});

test("GATE: 6 contratos de usuario (no-regresion)", () => {
  const contracts = path.join(appRoot, "test", "no-regression-contracts.test.js");
  assert.equal(fs.existsSync(contracts), true);
  assert.match(rendererSource, /promptField\.value = ""/);
  assert.match(rendererSource, /shouldSteerLiveAgent\(effectivePrompt\)/);
  assert.match(mainSource, /resolveRunDeadlineMs/);
  assert.doesNotMatch(mainSource, /1_500_000/);
  assert.match(mainSource, /Esto NO es un fallo de la herramienta run_command/);
  assert.match(rendererSource, /const options = verifiedChatModelOptions\(\)/);
});

test("GATE: errores tecnicos no se muestran al usuario", () => {
  assert.match(rendererSource, /function userFacingError/);
  assert.match(mainSource, /function toUserFacingError/);
});

test("GATE: panel de archivos y preview reaccionan a escrituras del agente", () => {
  assert.match(indexSource, /project-files-ui\.js/);
  assert.match(indexSource, /id="closeProjectBtn"/);
  assert.match(rendererSource, /function closeOpenProject/);
  assert.match(rendererSource, /handleProjectFilesChanged/);
  assert.match(rendererSource, /maybeRefreshPreviewAfterWrite/);
  assert.match(preloadSource, /project:files-changed/);
  assert.match(preloadSource, /project:preview-stop/);
  assert.match(mainSource, /emitProjectFilesChanged/);
  assert.match(mainSource, /project:preview-stop/);
  const { filesChangedPayload } = require("../runtime/project-files-ui");
  const payload = filesChangedPayload({
    name: "write_file",
    input: { path: "D:/PROGRAMAS IA/TICKETIA/README.md" },
  }, "D:/PROGRAMAS IA/TICKETIA");
  assert.equal(payload.viewDir, "");
  assert.equal(payload.fileName, "README.md");
});

test("GATE: version semver con segmentos de maximo 2 digitos", () => {
  const pkg = require("../package.json");
  const version = String(pkg.version || "");
  assert.match(version, /^\d+\.\d{1,2}\.\d{1,2}$/, `Version invalida: ${version}`);
  const [major, minor, patch] = version.split(".").map((part) => Number(part));
  assert.ok(minor <= 99 && patch <= 99, `Segmento > 99 en ${version}`);
  assert.ok(major >= 2, `Major inesperado en ${version}`);
});

test("GATE: modelo verificado se propaga igual a chat y sub-agentes", () => {
  assert.match(rendererSource, /EditCorePromptJobModel/);
  assert.match(rendererSource, /resolvePromptJobModelFields/);
  assert.match(indexSource, /prompt-job-model\.js/);

  const {
    resolvePromptJobModelFields,
    modelFieldsForSubAgentRoutes,
    sameModelFields,
  } = require("../runtime/prompt-job-model");

  const profile = {
    id: "gate:claude",
    providerKey: "apicredits",
    baseUrl: "https://api.apicredits.site/v1",
    apiKey: "sk-gate",
    model: "apicredits/claude-sonnet-4-6",
    status: "active",
  };
  const fields = resolvePromptJobModelFields(profile);
  const plans = [
    resolveUnifiedAgentPlan({ prompt: "hola", requestedAgent: false, projectOpen: true }),
    resolveUnifiedAgentPlan({ prompt: "Analiza el proyecto completo", requestedAgent: true, projectOpen: true }),
    resolveUnifiedAgentPlan({ prompt: "CREA EL PROYECTO AHORA con README", requestedAgent: true, projectOpen: true, allowWrite: true }),
  ];
  const routes = modelFieldsForSubAgentRoutes(profile, {}, plans);
  assert.equal(routes.length, 3);
  for (const route of routes) {
    assert.ok(sameModelFields(route.job, fields));
    assert.equal(route.job.model, profile.model);
    assert.equal(route.job.providerProfileId, profile.id);
  }
});
