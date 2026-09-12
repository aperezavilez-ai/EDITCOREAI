"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROMPT_JOB_MODEL_KEYS,
  isVerifiedProviderProfile,
  resolvePromptJobModelFields,
  attachModelFieldsToPromptJob,
  sameModelFields,
  modelFieldsForSubAgentRoutes,
} = require("../runtime/prompt-job-model");
const { resolveUnifiedAgentPlan, MODES, SUB_AGENTS } = require("../runtime/intent-orchestrator");

const PROVIDERS = {
  anthropic: { baseUrl: "https://api.anthropic.com/v1" },
  openai: { baseUrl: "https://api.openai.com/v1" },
  "custom:gafcore-gateway": { baseUrl: "https://gateway.example/v1" },
};

const VERIFIED_PROFILES = [
  {
    id: "apicredits:claude-sonnet-4-6",
    providerKey: "apicredits",
    baseUrl: "https://api.apicredits.site/v1",
    apiKey: "sk-apicredits-test",
    model: "apicredits/claude-sonnet-4-6",
    status: "active",
  },
  {
    id: "meai:gpt",
    providerKey: "meai",
    baseUrl: "https://api.meai.example/v1",
    apiKey: "sk-meai-test",
    model: "meai/gpt-5.6-sol-medium",
    status: "enabled",
  },
  {
    id: "gateway:glm",
    providerKey: "custom:gafcore-gateway",
    apiKey: "sk-gateway-test",
    model: "glm-5",
    status: "active",
  },
];

test("perfil verificado requiere status, model y apiKey", () => {
  assert.equal(isVerifiedProviderProfile(VERIFIED_PROFILES[0]), true);
  assert.equal(isVerifiedProviderProfile({ ...VERIFIED_PROFILES[0], status: "disabled" }), false);
  assert.equal(isVerifiedProviderProfile({ ...VERIFIED_PROFILES[0], apiKey: "" }), false);
  assert.equal(isVerifiedProviderProfile(null), false);
});

test("resolvePromptJobModelFields conserva los 5 campos del job", () => {
  for (const profile of VERIFIED_PROFILES) {
    const fields = resolvePromptJobModelFields(profile, {}, PROVIDERS);
    assert.ok(fields, `perfil ${profile.id} debe resolver campos`);
    assert.deepEqual(Object.keys(fields).sort(), [...PROMPT_JOB_MODEL_KEYS].sort());
    assert.equal(fields.model, profile.model);
    assert.equal(fields.apiKey, profile.apiKey);
    assert.equal(fields.providerKey, profile.providerKey);
    assert.equal(fields.providerProfileId, profile.id);
    assert.ok(fields.baseUrl, `baseUrl requerida para ${profile.id}`);
  }
});

test("cualquier perfil verificado propaga los mismos model fields en chat y sub-agentes", () => {
  const plans = [
    resolveUnifiedAgentPlan({
      prompt: "QUIERO CREAR UN PROYECTO DE TICKETS PARA EVENTOS",
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
    }),
    resolveUnifiedAgentPlan({
      prompt: "Analiza el proyecto completo y dame un reporte",
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
    }),
    resolveUnifiedAgentPlan({
      prompt: "CREA EL PROYECTO AHORA con README y package.json",
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
    }),
    resolveUnifiedAgentPlan({
      prompt: "procede",
      requestedAgent: true,
      projectOpen: true,
      allowWrite: true,
      planAuthorizedExecution: true,
    }),
  ];

  assert.equal(plans[0].mode, MODES.CHAT);
  assert.equal(plans[1].mode, MODES.DISCOVER);
  assert.equal(plans[2].mode, MODES.EXECUTE);
  assert.equal(plans[0].runProfile.subAgent, SUB_AGENTS.INTENT);
  assert.equal(plans[1].runProfile.subAgent, SUB_AGENTS.EXPLORER);
  assert.equal(plans[2].runProfile.subAgent, SUB_AGENTS.IMPLEMENTER);

  for (const profile of VERIFIED_PROFILES) {
    const expected = resolvePromptJobModelFields(profile, {}, PROVIDERS);
    const routes = modelFieldsForSubAgentRoutes(profile, {}, plans, PROVIDERS);
    assert.ok(routes);
    assert.equal(routes.length, plans.length);
    for (const route of routes) {
      assert.ok(sameModelFields(route.job, expected), [
        `modelo distinto en modo ${route.mode} / ${route.subAgent}`,
        JSON.stringify({ expected, got: route.job }),
      ].join(" "));
      assert.equal(route.job.orchestratorPlan.mode, route.mode);
      if (route.mode === MODES.CHAT) assert.equal(route.usesProjectTools, false);
      if (route.mode === MODES.DISCOVER || route.mode === MODES.EXECUTE) assert.equal(route.usesProjectTools, true);
    }
  }
});

test("attachModelFieldsToPromptJob no altera otros campos del job", () => {
  const fields = resolvePromptJobModelFields(VERIFIED_PROFILES[0], {}, PROVIDERS);
  const job = attachModelFieldsToPromptJob({
    prompt: "hola",
    usesProjectTools: false,
    orchestratorPlan: { mode: MODES.CHAT },
  }, fields);
  assert.equal(job.prompt, "hola");
  assert.equal(job.usesProjectTools, false);
  assert.equal(job.model, fields.model);
  assert.equal(job.providerProfileId, fields.providerProfileId);
});
