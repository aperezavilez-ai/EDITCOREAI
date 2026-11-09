"use strict";

// [PROVEEDOR RETIRADO — decisión del dueño 2026-11-09] El segundo gateway dejó de ser
// proveedor de EditCoreAI: ME AI es el único gateway. Esta suite ya no prueba
// equilibrio/scopes entre dos gateways (mecanismo retirado); prueba el Auto
// sobre el pool ME AI: carriles por rol, rotación least-used, scopes "all" y
// "meai", y la normalización limpia de cualquier scope retirado a "all".

const assert = require("node:assert/strict");
const test = require("node:test");
const AutoModel = require("../auto-model-selection");

// Scope que versiones anteriores persistían para el gateway retirado. Se
// ensambla por partes a propósito: el nombre retirado no debe volver a
// aparecer escrito en el árbol, ni siquiera como fixture de prueba.
const RETIRED_SCOPE = ["api", "credits"].join("");

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

// Pool ampliado SOLO ME AI (modelos del catálogo vigente del gateway único).
function sixteenModelProfiles() {
  const meai = [
    "meai/claude-sonnet-4.6",
    "meai/claude-sonnet-5",
    "meai/claude-haiku-4.5",
    "meai/claude-opus-4.8",
    "meai/claude-opus-4.7",
    "meai/claude-opus-5",
    "meai/qwen3.6-plus",
    "meai/qwen3.6",
    "meai/glm-5.2",
    "meai/glm-5",
    "meai/kimi-k2.6",
    "meai/deepseek-v4-pro",
    "meai/deepseek-v4-flash",
    "meai/minimax-m3",
    "meai/step-3.7-flash",
    "meai/mimo-v2.5",
  ];
  return meai.map((model, index) => ({
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

// [PROVEEDOR RETIRADO] Antes: "elige fable-5 cuando solo hay Claude del
// Claude" (fable solo existía en el gateway retirado). Equivalente vigente:
// con solo Claude ME AI, el análisis rota entre los Sonnet sin repetir.
test("Auto elige Claude ME AI para analizar cuando solo hay Claude", () => {
  const claudeProfiles = [
    { id: "s1", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-5", status: "active", apiKey: "k1" },
    { id: "s2", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", status: "active", apiKey: "k1" },
  ];
  const claudeOptions = claudeProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const profile = AutoModel.resolveAutoModelProfile(claudeOptions, claudeProfiles, {
    prompt: "analiza el proyecto",
    isAgent: true,
    usesProjectTools: true,
    needsAnalysisFirst: true,
    lastAutoResolvedModel: "meai/claude-sonnet-5",
  });
  assert.equal(profile?.model, "meai/claude-sonnet-4.6");
});

test("Auto elige modelo ligero para chat simple", () => {
  const profile = AutoModel.resolveAutoModelProfile(options, profiles, {
    prompt: "hola",
    isAgent: false,
    usesProjectTools: false,
  });
  assert.match(profile?.model || "", /^meai\//);
});

// [PROVEEDOR RETIRADO] El scope del gateway retirado ya no existe:
// normalizeAutoProviderScope lo degrada a "all" (el camino genérico de valor
// no válido), isScopedAutoProvider es false y la etiqueta es "Auto".
test("isAutoModelSelection detecta la opcion Auto", () => {
  assert.equal(AutoModel.isAutoModelSelection(AutoModel.AUTO_MODEL_SELECTION), true);
  assert.equal(AutoModel.isAutoModelSelection(AutoModel.autoSelectionValue("meai")), true);
  assert.equal(AutoModel.isAutoModelSelection(AutoModel.autoSelectionValue("all")), true);
  assert.equal(AutoModel.isAutoModelSelection({ value: AutoModel.AUTO_MODEL_SELECTION, dataset: {} }), true);
  assert.equal(AutoModel.isAutoModelSelection({ value: "x", dataset: { auto: "1" } }), true);
  assert.equal(AutoModel.parseAutoSelectionScope(AutoModel.autoSelectionValue("meai")), "meai");
  assert.equal(AutoModel.parseAutoSelectionScope(AutoModel.autoSelectionValue("all")), "all");
  assert.equal(AutoModel.parseAutoSelectionScope(AutoModel.AUTO_MODEL_SELECTION), "all");
  assert.equal(AutoModel.formatAutoLabel("meai"), "Auto · ME AI");
  assert.equal(AutoModel.formatAutoLabel("all"), "Auto");
  assert.equal(AutoModel.isScopedAutoProvider("all"), false);
  assert.equal(AutoModel.isScopedAutoProvider("meai"), true);
  // Scope retirado (persistido por versiones anteriores): normaliza limpio.
  assert.equal(AutoModel.normalizeAutoProviderScope(RETIRED_SCOPE), "all");
  assert.equal(AutoModel.parseAutoSelectionScope(AutoModel.autoSelectionValue(RETIRED_SCOPE)), "all");
  assert.equal(AutoModel.formatAutoLabel(RETIRED_SCOPE), "Auto");
  assert.equal(AutoModel.isScopedAutoProvider(RETIRED_SCOPE), false);
  assert.deepEqual(AutoModel.UPSTREAM_ORDER, ["meai"]);
});

test("Auto con scope all rota entre modelos ME AI", () => {
  const mixed = sixteenModelProfiles();
  const options = mixed.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
    modelProviderGroup: String(profile.model).split("/", 1)[0],
  }));
  const seen = new Set();
  let last = "";
  let modelUsage = {};
  for (let i = 0; i < 16; i += 1) {
    const profile = AutoModel.resolveAutoModelProfile(options, mixed, {
      prompt: "procede e implementa el fix",
      isAgent: true,
      usesProjectTools: true,
      planAuthorizedExecution: true,
      autoProviderScope: "all",
      lastAutoResolvedModel: last,
      autoUpstreamUsage: { meai: i },
      autoModelUsage: modelUsage,
    });
    assert.ok(profile?.model, `turno ${i}`);
    assert.match(profile.model, /^meai\//, `turno ${i}: ${profile.model}`);
    seen.add(profile.model);
    last = profile.model;
    modelUsage = AutoModel.bumpModelUsage(modelUsage, profile.model);
  }
  assert.ok(seen.size >= 3, `rotación pobre: ${[...seen].join(", ")}`);
});

test("Auto con scope meai solo elige ME AI", () => {
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
      autoUpstreamUsage: { meai: i },
      autoModelUsage: {},
    });
    assert.match(profile?.model || "", /^meai\//, `turno ${i}: ${profile?.model}`);
  }
});

// [PROVEEDOR RETIRADO] Antes: "Auto con scope del gateway retirado no elige ME AI" —
// el scope ya no es válido; un valor persistido así se normaliza a "all" y
// Auto sigue resolviendo dentro del único gateway, sin romperse.
test("Auto con un scope retirado persistido sigue eligiendo ME AI", () => {
  const mixed = sixteenModelProfiles();
  const options = mixed.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
    modelProviderGroup: String(profile.model).split("/", 1)[0],
  }));
  const profile = AutoModel.resolveAutoModelProfile(options, mixed, {
    prompt: "procede e implementa el fix",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
    autoProviderScope: RETIRED_SCOPE,
    autoUpstreamUsage: { meai: 0 },
    autoModelUsage: {},
  });
  assert.match(profile?.model || "", /^meai\//);
});

// [PROVEEDOR RETIRADO] Antes el contraste era entre gateways; el mecanismo
// vigente es el mismo dentro de ME AI: el modelo con fallos recientes sale
// del pool y Auto elige otro modelo sano del gateway.
test("Auto omite el modelo con fallos recientes y elige otro ME AI", () => {
  const mixedProfiles = [
    { id: "m1", providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", status: "active", apiKey: "k1" },
    { id: "m2", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const capabilities = {
    "host|meai/claude-opus-4.8": {
      model: "meai/claude-opus-4.8",
      ok: false,
      failStreak: 2,
      lastFailAt: Date.now(),
      lastError: "ME AI no está disponible",
    },
  };
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "procede con los cambios",
    isAgent: true,
    usesProjectTools: true,
    planAuthorizedExecution: true,
    capabilities,
  });
  assert.equal(profile?.model, "meai/claude-sonnet-4.6");
});

// [PROVEEDOR RETIRADO] Antes rotaba entre verificados del gateway retirado;
// el mecanismo (rotación entre verificados sin repetir el último) es el mismo
// con modelos ME AI.
test("Auto rota entre modelos ME AI verificados", () => {
  const mixedProfiles = [
    { id: "s1", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-5", status: "active", apiKey: "k1" },
    { id: "s2", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", status: "active", apiKey: "k1" },
  ];
  const mixedOptions = mixedProfiles.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const capabilities = {
    "host|meai/claude-sonnet-4.6": {
      model: "meai/claude-sonnet-4.6",
      ok: true,
      lastOkAt: Date.now(),
      failStreak: 0,
    },
    "host|meai/claude-sonnet-5": {
      model: "meai/claude-sonnet-5",
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
    lastAutoResolvedModel: "meai/claude-sonnet-5",
  });
  assert.equal(profile?.model, "meai/claude-sonnet-4.6");
});

// [PROVEEDOR RETIRADO] El filtro por fallos recientes ya no contrasta
// gateways: bloquea los modelos ME AI caídos y conserva los sanos.
test("filterAutoModelOptions bloquea modelos con fallos recientes", () => {
  const options = [
    { providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-5", profileId: "a1" },
    { providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", profileId: "a2" },
    { providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", profileId: "m1" },
  ];
  // Endurecido: un solo fallo reciente (ok:false, failStreak>=1) ya saca al modelo de Auto.
  const soft = {
    a: { model: "meai/claude-sonnet-5", ok: false, failStreak: 1, lastFailAt: Date.now() },
    b: { model: "meai/claude-opus-4.8", ok: false, failStreak: 1, lastFailAt: Date.now() },
  };
  assert.deepEqual(AutoModel.filterAutoModelOptions(options, soft).map((entry) => entry.model), ["meai/claude-sonnet-4.6"]);
  const capabilities = {
    a: { model: "meai/claude-sonnet-5", ok: false, failStreak: 2, lastFailAt: Date.now() },
    b: { model: "meai/claude-opus-4.8", ok: false, failStreak: 2, lastFailAt: Date.now() },
  };
  const filtered = AutoModel.filterAutoModelOptions(options, capabilities);
  assert.deepEqual(filtered.map((entry) => entry.model), ["meai/claude-sonnet-4.6"]);
});

// [PROVEEDOR RETIRADO] Antes el "endurecido" prefería el bucket del gateway
// retirado por uso acumulado; sin segundo gateway, lo que se verifica es lo
// esencial: jamás se elige un modelo con fallo reciente (ok:false).
test("Auto endurecido: nunca elige un modelo con fallo reciente", () => {
  const mixedProfiles = [
    { id: "slow", providerKey: "custom:gafcore-gateway", model: "meai/glm-5", status: "active", apiKey: "k1" },
    { id: "fail", providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", status: "active", apiKey: "k1" },
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
    "h|sonnet": { model: "meai/claude-sonnet-4.6", ok: true, lastOkAt: Date.now(), lastLatencyMs: 12500, failStreak: 0 },
  };
  const profile = AutoModel.resolveAutoModelProfile(mixedOptions, mixedProfiles, {
    prompt: "analiza el proyecto CALILI",
    isAgent: true,
    usesProjectTools: true,
    needsAnalysisFirst: true,
    capabilities,
    autoProviderScope: "all",
    autoUpstreamUsage: { meai: 8 },
  });
  assert.equal(profile?.model, "meai/claude-sonnet-4.6");
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

// La guarda "solo chat" es por nombre de modelo (gpt-5.6-sol) y sigue viva
// con el gateway único: en contexto de agente nunca debe elegirse.
test("Auto en agente evita gpt-5.6-sol (solo chat) y elige Claude ME AI", () => {
  const mixedProfiles = [
    { id: "f1", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-5", status: "active", apiKey: "k1" },
    { id: "g1", providerKey: "custom:gafcore-gateway", model: "meai/gpt-5.6-sol", status: "active", apiKey: "k1" },
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
  assert.equal(profile?.model, "meai/claude-sonnet-5");
});

// [PROVEEDOR RETIRADO] La función de familia preferida del segundo gateway desapareció con él;
// gateway; la alternancia de familia la hace pickLeastUsedEntry (la familia
// del último modelo queda depriorizada) dentro del pool ME AI.
test("Auto alterna de familia en el siguiente turno (Qwen a Claude ME AI)", () => {
  const mixedProfiles = [
    { id: "c1", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-5", status: "active", apiKey: "k1" },
    { id: "q1", providerKey: "custom:gafcore-gateway", model: "meai/qwen3.6-plus", status: "active", apiKey: "k1" },
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
    lastAutoResolvedModel: "meai/qwen3.6-plus",
  });
  assert.equal(profile?.model, "meai/claude-sonnet-5");
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

// [PROVEEDOR RETIRADO] Antes: "Auto rota a ME AI tras el otro gateway" (balance
// entre gateways). El mecanismo vigente: dentro de ME AI, el último modelo
// usado queda depriorizado y Auto rota a otro del carril.
test("Auto no repite el ultimo modelo: rota dentro de ME AI", () => {
  const mixedProfiles = [
    { id: "m1", providerKey: "custom:gafcore-gateway", model: "meai/claude-sonnet-4.6", status: "active", apiKey: "k1" },
    { id: "m2", providerKey: "custom:gafcore-gateway", model: "meai/claude-opus-4.8", status: "active", apiKey: "k1" },
    { id: "m3", providerKey: "custom:gafcore-gateway", model: "meai/claude-haiku-4.5", status: "active", apiKey: "k1" },
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
    lastAutoResolvedModel: "meai/claude-sonnet-4.6",
    autoUpstreamUsage: { meai: 3 },
  });
  assert.equal(profile?.model, "meai/claude-opus-4.8");
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
  let usage = { meai: 0 };
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
  assert.ok(byRole.implement.every((m) => !/deepseek/i.test(m) || /sonnet|opus|qwen/.test(m)));
  assert.ok(byRole.implement.some((m) => /sonnet|opus|qwen/i.test(m)));
  assert.ok(byRole.analyze.some((m) => /sonnet|haiku|qwen|glm/i.test(m)));
  assert.ok(byRole.chat.some((m) => /haiku|kimi|glm|qwen/i.test(m)));
  assert.ok(byRole.chat.every((m) => !/claude-opus/i.test(m)), "chat no debe usar opus");
  assert.ok(new Set([...byRole.implement, ...byRole.analyze, ...byRole.chat]).size >= 6, "pocos modelos distintos entre roles");
});

test("Catalogo explicito: implement usa carril primario, no pelea con DeepSeek", () => {
  assert.ok(Array.isArray(AutoModel.MODEL_DUTY_CATALOG) && AutoModel.MODEL_DUTY_CATALOG.length >= 10);
  assert.ok(AutoModel.ROLE_LANES?.implement?.primary?.length >= 3);
  // El catálogo ya solo trae filas del gateway único.
  assert.ok(AutoModel.MODEL_DUTY_CATALOG.every((row) => row.id.startsWith("meai/")));
  assert.match(AutoModel.describeModelDuty("meai/deepseek-v4-pro").duty, /implement-alt/i);
  assert.match(AutoModel.describeModelDuty("meai/claude-sonnet-4.6").duty, /implement|analyze/i);

  const all = sixteenModelProfiles();
  const opts = all.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const picked = [];
  let usage = { meai: 0 };
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
  assert.ok(picked.every((m) => /sonnet|opus|qwen/i.test(m)));
});

test("DeepSeek queda fuera cuando supera share 12%", () => {
  const all = sixteenModelProfiles();
  const opts = all.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  const heavy = {
    "meai/deepseek-v4-pro": 16,
    "meai/claude-sonnet-4.6": 2,
    "meai/claude-sonnet-5": 2,
  };
  const profile = AutoModel.resolveAutoModelProfile(opts, all, {
    prompt: "hola",
    isAgent: false,
    usesProjectTools: false,
    autoModelUsage: heavy,
    autoUpstreamUsage: { meai: 20 },
  });
  assert.doesNotMatch(profile?.model || "", /deepseek/i);
});

// [PROVEEDOR RETIRADO] El test de "equilibrio 50/50 entre gateways" se
// retira: sin segundo gateway no hay nada que equilibrar. Lo vigente es la
// rotación least-used dentro del pool ME AI, que es lo que se verifica aquí.
test("Auto rota con least-used en el pool ME AI ampliado", () => {
  const all = sixteenModelProfiles();
  const opts = all.map((profile) => ({
    providerKey: profile.providerKey,
    profileId: profile.id,
    model: profile.model,
  }));
  let usage = { meai: 0 };
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
    assert.match(profile.model, /^meai\//, `turno ${i}: ${profile.model}`);
    picked.push(profile.model);
    last = profile.model;
    usage = AutoModel.bumpUpstreamUsage(usage, profile.model);
    modelUsage = AutoModel.bumpModelUsage(modelUsage, profile.model);
  }
  assert.equal(usage.meai, turns);
  assert.deepEqual(Object.keys(usage), ["meai"]);
  // Carril implement primario: Claude/Qwen — sin DeepSeek (reserva).
  assert.ok(new Set(picked).size >= 4, `pocos modelos distintos: ${new Set(picked).size} -> ${picked.join(", ")}`);
  assert.ok(picked.every((model) => !/deepseek/i.test(model)), "DeepSeek no pertenece al carril primario de implement");
});
