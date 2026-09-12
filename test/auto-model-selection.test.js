"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const AutoModel = require("../auto-model-selection");

const profiles = [
  { id: "p1", providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", status: "active", apiKey: "k1" },
  { id: "p2", providerKey: "custom:gafcore-gateway", model: "meai/claude-haiku-4.5", status: "active", apiKey: "k1" },
  { id: "p3", providerKey: "custom:gafcore-gateway", model: "meai/deepseek-v4-flash", status: "active", apiKey: "k1" },
];

const options = profiles.map((profile) => ({
  providerKey: profile.providerKey,
  profileId: profile.id,
  model: profile.model,
}));

function sixteenModelProfiles() {
  const meai = [
    "meai/claude-sonnet-4.6",
    "meai/claude-haiku-4-5",
    "meai/claude-opus-4.8",
    "meai/qwen3.6-plus",
    "meai/glm-5",
    "meai/deepseek-v4-pro",
    "meai/kimi-k2.6",
  ];
  const apicredits = [
    "apicredits/claude-fable-5",
    "apicredits/claude-haiku-4-5",
    "apicredits/claude-opus-4-7",
    "apicredits/claude-opus-4-8",
    "apicredits/claude-sonnet-4-6",
    "apicredits/claude-sonnet-5",
    "apicredits/gpt-5.6-luna",
    "apicredits/gpt-5.6-terra",
    "apicredits/gpt-5.6-sol",
    "apicredits/gemini-2.5-flash",
    "apicredits/grok-4.3",
    "apicredits/grok-4.5",
    "apicredits/deepseek-v4-pro",
  ];
  return [...meai, ...apicredits].map((model, index) => ({
    id: `p${index}`,
    providerKey: "custom:gafcore-gateway",
    model,
    status: "active",
    apiKey: "k1",
  }));
}

test("Auto elige un modelo ME AI disponible para agente", () => {
  const profile = AutoModel.resolveAutoModelProfile(options, profiles, {
    prompt: "procede con los cambios",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
  });
  assert.match(profile?.model || "", /^meai\//);
});

test("Auto elige fable-5 cuando solo hay APICredits Claude", () => {
  const fableProfiles = [
    { id: "f1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-fable-5", status: "active", apiKey: "k1" },
    { id: "s1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-sonnet-5", status: "active", apiKey: "k1" },
  ];
  const fableOptions = fableProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const profile = AutoModel.resolveAutoModelProfile(fableOptions, fableProfiles, {
    prompt: "analiza el proyecto",
    isAgent: true,
    usesProjectTools: true,
    needsAnalysisFirst: true,
  });
  assert.match(profile?.model || "", /^apicredits\/claude-/);
});

test("Auto elige modelo ligero para chat simple", () => {
  const profile = AutoModel.resolveAutoModelProfile(options, profiles, {
    prompt: "hola",
    isAgent: false,
    usesProjectTools: false,
  });
  assert.match(profile?.model || "", /^meai\//);
});

test("isAutoModelSelection detecta la opcion Auto", () => {
  assert.equal(AutoModel.isAutoModelSelection(AutoModel.AUTO_MODEL_SELECTION), true);
  assert.equal(AutoModel.isAutoModelSelection(AutoModel.autoSelectionValue("meai")), true);
  assert.equal(AutoModel.isAutoModelSelection(AutoModel.autoSelectionValue("apicredits")), true);
  assert.equal(AutoModel.isAutoModelSelection({ value: AutoModel.AUTO_MODEL_SELECTION, dataset: {} }), true);
  assert.equal(AutoModel.isAutoModelSelection({ value: "x", dataset: { auto: "1" } }), true);
  assert.equal(AutoModel.parseAutoSelectionScope(AutoModel.autoSelectionValue("meai")), "meai");
  assert.equal(AutoModel.parseAutoSelectionScope(AutoModel.autoSelectionValue("apicredits")), "apicredits");
  assert.equal(AutoModel.formatAutoLabel("meai"), "Auto · ME AI");
  assert.equal(AutoModel.formatAutoLabel("apicredits"), "Auto · APICredits");
});

test("Auto con scope meai no elige APICredits", () => {
  const mixed = sixteenModelProfiles();
  const options = mixed.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
    modelProviderGroup: String(profile.model).split("/", 1)[0],
  }));
  for (let i = 0; i < 12; i += 1) {
    const profile = AutoModel.resolveAutoModelProfile(options, mixed, {
      prompt: "procede e implementa el fix",
      isAgent: true,
      usesProjectTools: true,
      planAuthorizedExecution: true,
      autoProviderScope: "meai",
      lastAutoResolvedModel: i ? `meai/claude-sonnet-4.6` : "",
      autoUpstreamUsage: { meai: i, apicredits: i },
      autoModelUsage: {},
    });
    assert.match(profile?.model || "", /^meai\//, `turno ${i}: ${profile?.model}`);
  }
});

test("Auto con scope apicredits no elige ME AI", () => {
  const mixed = sixteenModelProfiles();
  const options = mixed.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
    modelProviderGroup: String(profile.model).split("/", 1)[0],
  }));
  for (let i = 0; i < 12; i += 1) {
    const profile = AutoModel.resolveAutoModelProfile(options, mixed, {
      prompt: "procede e implementa el fix",
      isAgent: true,
      usesProjectTools: true,
      planAuthorizedExecution: true,
      autoProviderScope: "apicredits",
      lastAutoResolvedModel: i ? `apicredits/claude-fable-5` : "",
      autoUpstreamUsage: { meai: i, apicredits: i },
      autoModelUsage: {},
    });
    assert.match(profile?.model || "", /^apicredits\//, `turno ${i}: ${profile?.model}`);
  }
});

test("Auto omite APICredits con fallos recientes y elige ME AI", () => {
  const mixedProfiles = [
    { id: "m1", providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", status: "active", apiKey: "k1" },
    { id: "a1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-opus-4.8", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const capabilities = {
    "host|apicredits/claude-opus-4.8": {
      model: "apicredits/claude-opus-4.8",
      ok: false,
      failStreak: 2,
      lastFailAt: Date.now(),
      lastError: "APICredits no está disponible",
    },
  };
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "procede con los cambios",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
    capabilities,
  });
  assert.equal(profile?.model, "meai/claude-opus-4.8");
});

test("Auto rota entre modelos APICredits verificados", () => {
  const mixedProfiles = [
    { id: "f1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-fable-5", status: "active", apiKey: "k1" },
    { id: "s1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-sonnet-5", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const capabilities = {
    "host|apicredits/claude-sonnet-5": {
      model: "apicredits/claude-sonnet-5",
      ok: true,
      lastOkAt: Date.now(),
      failStreak: 0,
    },
    "host|apicredits/claude-fable-5": {
      model: "apicredits/claude-fable-5",
      ok: true,
      lastOkAt: Date.now(),
      failStreak: 0,
    },
  };
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "analiza",
    isAgent: true,
    usesProjectTools: true,
    needsAnalysisFirst: true,
    capabilities,
    lastAutoResolvedModel: "apicredits/claude-fable-5",
  });
  assert.equal(profile?.model, "apicredits/claude-sonnet-5");
});

test("filterAutoModelOptions bloquea modelos APICredits con fallos recientes", () => {
  const options = [
    { providerKey: "custom:gafcore-gateway", model: "apicredits/claude-sonnet-5", profileId: "a1" },
    { providerKey: "custom:gafcore-gateway", model: "apicredits/gpt-5.6-sol", profileId: "a2" },
    { providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", profileId: "m1" },
  ];
  // Endurecido: un solo fallo reciente (ok:false, failStreak>=1) ya saca al modelo de Auto.
  const soft = {
    a: { model: "apicredits/claude-sonnet-5", ok: false, failStreak: 1, lastFailAt: Date.now() },
    b: { model: "apicredits/gpt-5.6-sol", ok: false, failStreak: 1, lastFailAt: Date.now() },
  };
  assert.deepEqual(AutoModel.filterAutoModelOptions(options, soft).map((entry) => entry.model), ["meai/claude-sonnet-4.6"]);
  const capabilities = {
    a: { model: "apicredits/claude-sonnet-5", ok: false, failStreak: 2, lastFailAt: Date.now() },
    b: { model: "apicredits/gpt-5.6-sol", ok: false, failStreak: 2, lastFailAt: Date.now() },
  };
  const filtered = AutoModel.filterAutoModelOptions(options, capabilities);
  assert.deepEqual(filtered.map((entry) => entry.model), ["meai/claude-sonnet-4.6"]);
});

test("Auto endurecido: solo elige ok:true y prefiere menor latencia", () => {
  const mixedProfiles = [
    { id: "slow", providerKey: "custom:gafcore-gateway", model: "meai/glm-5", status: "active", apiKey: "k1" },
    { id: "fail", providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", status: "active", apiKey: "k1" },
    { id: "fast", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-fable-5", status: "active", apiKey: "k1" },
    { id: "mid", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const capabilities = {
    "h|glm": { model: "meai/glm-5", ok: true, lastOkAt: Date.now(), lastLatencyMs: 51000, failStreak: 0 },
    "h|opus": { model: "meai/claude-opus-4.8", ok: false, lastFailAt: Date.now(), failStreak: 1, lastError: "respuesta vacia" },
    "h|fable": { model: "apicredits/claude-fable-5", ok: true, lastOkAt: Date.now(), lastLatencyMs: 10200, failStreak: 0 },
    "h|sonnet": { model: "meai/claude-sonnet-4.6", ok: true, lastOkAt: Date.now(), lastLatencyMs: 12500, failStreak: 0 },
  };
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "analiza el proyecto CALILI",
    isAgent: true,
    usesProjectTools: true,
    needsAnalysisFirst: true,
    capabilities,
  });
  assert.equal(profile?.model, "apicredits/claude-fable-5");
});

test("isRecentlyFailedCapability marca ok:false con un solo fallo", () => {
  assert.equal(AutoModel.isRecentlyFailedCapability({
    ok: false,
    failStreak: 1,
    lastFailAt: Date.now(),
  }), true);
  assert.equal(AutoModel.isHealthyCapability({
    ok: true,
    lastOkAt: Date.now(),
  }), true);
});

test("Auto en agente evita gpt-5.6-sol (solo chat) y elige otro modelo", () => {
  const mixedProfiles = [
    { id: "f1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-fable-5", status: "active", apiKey: "k1" },
    { id: "g1", providerKey: "custom:gafcore-gateway", model: "apicredits/gpt-5.6-sol", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "procede con los cambios",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
  });
  assert.equal(profile?.model, "apicredits/claude-fable-5");
});

test("Auto alterna de GPT a Claude APICredits en el siguiente turno", () => {
  const mixedProfiles = [
    { id: "f1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-fable-5", status: "active", apiKey: "k1" },
    { id: "g1", providerKey: "custom:gafcore-gateway", model: "apicredits/gpt-5.6-luna", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "continua",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
    lastAutoResolvedModel: "apicredits/gpt-5.6-luna",
  });
  assert.equal(profile?.model, "apicredits/claude-fable-5");
});

test("Auto rota modelos ME AI del mismo carril (chat primary)", () => {
  const meaiProfiles = [
    { id: "m1", providerKey: "custom:gafcore-gateway", model: "meai/claude-haiku-4.5", status: "active", apiKey: "k1" },
    { id: "m2", providerKey: "custom:gafcore-gateway", model: "meai/kimi-k2.6", status: "active", apiKey: "k1" },
    { id: "m3", providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", status: "active", apiKey: "k1" },
  ];
  const meaiOptions = meaiProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const first = AutoModel.resolveAutoModelProfile(meaiOptions, meaiProfiles, {
    prompt: "hola",
    isAgent: false,
    usesProjectTools: false,
  });
  // Chat primary = haiku/kimi; opus esta prohibido en chat.
  assert.match(first?.model || "", /haiku|kimi/i);
  assert.doesNotMatch(first?.model || "", /opus/i);
  const second = AutoModel.resolveAutoModelProfile(meaiOptions, meaiProfiles, {
    prompt: "hola",
    isAgent: false,
    usesProjectTools: false,
    lastAutoResolvedModel: first?.model || "",
    autoModelUsage: AutoModel.bumpModelUsage({}, first?.model || ""),
  });
  assert.match(second?.model || "", /haiku|kimi/i);
  assert.notEqual(first?.model, second?.model);
});

test("Auto rota a ME AI tras APICredits", () => {
  const mixedProfiles = [
    { id: "f1", providerKey: "custom:gafcore-gateway", model: "apicredits/claude-fable-5", status: "active", apiKey: "k1" },
    { id: "g1", providerKey: "custom:gafcore-gateway", model: "apicredits/gpt-5.6-luna", status: "active", apiKey: "k1" },
    { id: "m1", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "continua",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
    lastAutoResolvedModel: "apicredits/claude-fable-5",
    autoUpstreamUsage: { meai: 0, apicredits: 3 },
  });
  assert.equal(profile?.model, "meai/claude-sonnet-4.6");
});

test("Auto clasifica roles tipo Cursor y rota aptos por tarea", () => {
  assert.equal(AutoModel.classifyAutoTaskRole({
    prompt: "procede con los cambios",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
  }), "implement");
  assert.equal(AutoModel.classifyAutoTaskRole({
    prompt: "analiza el proyecto",
    isAgent: true,
    usesProjectTools: true,
    needsAnalysisFirst: true,
  }), "analyze");
  assert.equal(AutoModel.classifyAutoTaskRole({
    prompt: "hola",
    isAgent: false,
    usesProjectTools: false,
  }), "chat");
  assert.equal(AutoModel.classifyAutoTaskRole({
    prompt: "verifica seguridad en produccion",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
  }), "verify");

  const all = sixteenModelProfiles();
  const opts = all.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const byRole = { implement: [], analyze: [], chat: [] };
  let usage = { meai: 0, apicredits: 0 };
  let modelUsage = {};
  let last = "";
  const prompts = [
    { role: "implement", prompt: "crea el endpoint", isAgent: true, usesProjectTools: true, planAuthorizedExecution: true },
    { role: "analyze", prompt: "analiza el codigo", isAgent: true, usesProjectTools: true, needsAnalysisFirst: true },
    { role: "chat", prompt: "hola", isAgent: false, usesProjectTools: false },
  ];
  for (let i = 0; i < 18; i += 1) {
    const spec = prompts[i % prompts.length];
    const profile = AutoModel.resolveAutoModelProfile(opts, all, {
      ...spec,
      lastAutoResolvedModel: last,
      autoUpstreamUsage: usage,
      autoModelUsage: modelUsage,
    });
    assert.ok(profile?.model, `turno ${i} sin modelo`);
    byRole[spec.role].push(profile.model);
    last = profile.model;
    usage = AutoModel.bumpUpstreamUsage(usage, profile.model);
    modelUsage = AutoModel.bumpModelUsage(modelUsage, profile.model);
  }
  assert.ok(byRole.implement.every((m) => !/deepseek/i.test(m) || /sonnet|opus|fable|terra|grok-4\.5|qwen/.test(m)));
  assert.ok(byRole.implement.some((m) => /sonnet|opus|fable|grok-4\.5|terra|qwen/i.test(m)));
  assert.ok(byRole.analyze.some((m) => /sonnet|fable|grok-4\.3|gemini|haiku|luna|qwen/i.test(m)));
  assert.ok(byRole.chat.some((m) => /haiku|luna|gemini|grok-4\.3|kimi|glm|qwen/i.test(m)));
  assert.ok(byRole.chat.every((m) => !/claude-opus|gpt-5\.6-terra/i.test(m)), "chat no debe usar opus/terra");
  assert.ok(new Set([...byRole.implement, ...byRole.analyze, ...byRole.chat]).size >= 8, "pocos modelos distintos entre roles");
});

test("Catalogo explicito: implement usa carril primario, no pelea con DeepSeek", () => {
  assert.ok(Array.isArray(AutoModel.MODEL_DUTY_CATALOG) && AutoModel.MODEL_DUTY_CATALOG.length >= 10);
  assert.ok(AutoModel.ROLE_LANES?.implement?.primary?.length >= 3);
  assert.match(AutoModel.describeModelDuty("apicredits/deepseek-v4-pro").duty, /reserve/i);
  assert.match(AutoModel.describeModelDuty("meai/claude-sonnet-4.6").duty, /implement|analyze/i);

  const all = sixteenModelProfiles();
  const opts = all.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const picked = [];
  let usage = { meai: 0, apicredits: 0 };
  let modelUsage = {};
  let last = "";
  for (let i = 0; i < 12; i += 1) {
    const profile = AutoModel.resolveAutoModelProfile(opts, all, {
      prompt: "procede con los cambios del runtime",
      isAgent: true,
      usesProjectTools: true,
      planAuthorizedExecution: true,
      lastAutoResolvedModel: last,
      autoUpstreamUsage: usage,
      autoModelUsage: modelUsage,
    });
    picked.push(profile.model);
    last = profile.model;
    usage = AutoModel.bumpUpstreamUsage(usage, profile.model);
    modelUsage = AutoModel.bumpModelUsage(modelUsage, profile.model);
  }
  assert.ok(picked.every((m) => !/deepseek/i.test(m)), `DeepSeek no debe salir en implement con primario disponible: ${picked.join(", ")}`);
  assert.ok(picked.every((m) => !/gemini-2\.5-flash|gpt-5\.6-sol/i.test(m)));
  assert.ok(picked.every((m) => /sonnet|opus|fable|terra|grok-4\.5|qwen/i.test(m)));
});

test("DeepSeek queda fuera cuando supera share 12%", () => {
  const all = sixteenModelProfiles();
  const opts = all.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const heavy = {
    "meai/deepseek-v4-pro": 8,
    "apicredits/deepseek-v4-pro": 8,
    "meai/claude-sonnet-4.6": 2,
    "apicredits/claude-fable-5": 2,
  };
  const profile = AutoModel.resolveAutoModelProfile(opts, all, {
    prompt: "hola",
    isAgent: false,
    usesProjectTools: false,
    autoModelUsage: heavy,
    autoUpstreamUsage: { meai: 10, apicredits: 10 },
  });
  assert.doesNotMatch(profile?.model || "", /deepseek/i);
});

test("Auto equilibra consumo entre ME AI y APICredits en pool ampliado", () => {
  const all = sixteenModelProfiles();
  const opts = all.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  let usage = { meai: 0, apicredits: 0 };
  let modelUsage = {};
  let last = "";
  const picked = [];
  const turns = 20;
  for (let i = 0; i < turns; i += 1) {
    const profile = AutoModel.resolveAutoModelProfile(opts, all, {
      prompt: `turno ${i}`,
      isAgent: true,
      usesProjectTools: true,
      planAuthorizedExecution: true,
      lastAutoResolvedModel: last,
      autoUpstreamUsage: usage,
      autoModelUsage: modelUsage,
    });
    assert.ok(profile?.model, `turno ${i} sin modelo`);
    // gpt-5.6-sol es solo chat; no debe salir en agente
    assert.doesNotMatch(profile.model, /gpt-5\.6-sol/);
    assert.doesNotMatch(profile.model, /gemini-2\.5-flash/);
    picked.push(profile.model);
    last = profile.model;
    usage = AutoModel.bumpUpstreamUsage(usage, profile.model);
    modelUsage = AutoModel.bumpModelUsage(modelUsage, profile.model);
  }
  const meaiCount = picked.filter((model) => model.startsWith("meai/")).length;
  const apicreditsCount = picked.filter((model) => model.startsWith("apicredits/")).length;
  assert.equal(meaiCount + apicreditsCount, turns);
  assert.ok(Math.abs(meaiCount - apicreditsCount) <= 2, `desbalance meai=${meaiCount} apicredits=${apicreditsCount}`);
  assert.equal(usage.meai, meaiCount);
  assert.equal(usage.apicredits, apicreditsCount);
  // Carril implement primario: Claude/Grok/Qwen/Terra — sin DeepSeek/Gemini.
  assert.ok(new Set(picked).size >= 6, `pocos modelos distintos: ${new Set(picked).size} -> ${picked.join(", ")}`);
  assert.ok(picked.every((model) => !/deepseek/i.test(model)), "DeepSeek no pertenece al carril primario de implement");
  assert.ok(picked.some((model) => /apicredits\/(claude|grok|gpt-5\.6-terra)/.test(model)), "faltan modelos APICredits del carril implement");
});
