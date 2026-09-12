"use strict";

(function exposePromptJobModel(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCorePromptJobModel = api;
})(typeof window !== "undefined" ? window : globalThis, function createPromptJobModel() {
  const PROMPT_JOB_MODEL_KEYS = ["model", "baseUrl", "apiKey", "providerKey", "providerProfileId"];

  function isVerifiedProviderProfile(profile) {
    if (!profile || typeof profile !== "object") return false;
    return ["active", "enabled"].includes(String(profile.status || "").toLowerCase())
      && Boolean(String(profile.model || "").trim())
      && Boolean(String(profile.apiKey || "").trim());
  }

  function resolvePromptJobModelFields(profile, providers = {}, providerDefaults = {}) {
    if (!isVerifiedProviderProfile(profile)) return null;
    const providerKey = String(profile.providerKey || "").trim();
    const providerData = providers?.[providerKey] || {};
    const defaults = providerDefaults?.[providerKey] || {};
    const apiKey = String(profile.apiKey || "").trim();
    const model = String(profile.model || "").trim();
    const baseUrl = String(profile.baseUrl || providerData.baseUrl || defaults.baseUrl || "").trim();
    const providerProfileId = String(profile.id || "").trim();
    if (!apiKey || !model || !providerKey || !providerProfileId) return null;
    return {
      model,
      apiKey,
      baseUrl,
      providerKey,
      providerProfileId,
    };
  }

  function attachModelFieldsToPromptJob(base = {}, modelFields = {}) {
    if (!modelFields) return { ...base };
    return {
      ...base,
      model: modelFields.model,
      baseUrl: modelFields.baseUrl,
      apiKey: modelFields.apiKey,
      providerKey: modelFields.providerKey,
      providerProfileId: modelFields.providerProfileId,
    };
  }

  function sameModelFields(left = {}, right = {}) {
    return PROMPT_JOB_MODEL_KEYS.every((key) => String(left?.[key] || "") === String(right?.[key] || ""));
  }

  /**
   * Garantiza que chat y agente (cualquier sub-agente) reciben los mismos campos de modelo
   * para un perfil verificado y distintos planes del orquestador.
   */
  function modelFieldsForSubAgentRoutes(profile, providers, plans = [], providerDefaults = {}) {
    const fields = resolvePromptJobModelFields(profile, providers, providerDefaults);
    if (!fields) return null;
    return (Array.isArray(plans) ? plans : []).map((plan) => ({
      mode: plan?.mode || "",
      subAgent: plan?.runProfile?.subAgent || "",
      usesProjectTools: plan?.usesProjectTools === true,
      job: attachModelFieldsToPromptJob({ orchestratorPlan: plan }, fields),
    }));
  }

  return {
    PROMPT_JOB_MODEL_KEYS,
    isVerifiedProviderProfile,
    resolvePromptJobModelFields,
    attachModelFieldsToPromptJob,
    sameModelFields,
    modelFieldsForSubAgentRoutes,
  };
});
