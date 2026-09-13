"use strict";

const { classifyModelCapability } = require("../agent-runtime");
const { logWorkflow } = require("./workflow-logger");

const RECOVERABLE_MODEL_PATTERNS = [
  /timeout|timed out|ETIMEDOUT|ECONNRESET|ENOTFOUND|socket|network|fetch failed/i,
  /rate limit|too many requests|429/i,
  /402|payment required|insufficient (?:funds|balance|credit)|saldo insuficiente|sin saldo|out of credits|quota exceeded|credit(?:s)? exhausted|billing|usage limit|limit exceeded|plan limit|exceeded your current quota/i,
  /502|503|504|524|5\d\d|bad gateway|service unavailable|overloaded/i,
  /temporarily unavailable|temporalmente|unavailable|no respondio|no respondió/i,
  /respuesta vacia|empty response|EMPTY_PROVIDER/i,
  /unexpected token|invalid json|malformed|JSON\.parse/i,
  /model .* not found|unknown model|modelo no disponible|not supported by any/i,
  /provider unavailable|upstream|worker.*dead|heartbeat no recibido/i,
  /aborted.*limite|excedio el limite/i,
];

const BILLING_QUOTA_PATTERNS = [
  /402|payment required|insufficient (?:funds|balance|credit)|saldo insuficiente|sin saldo|out of credits|quota exceeded|credit(?:s)? exhausted|billing|usage limit|plan limit|exceeded your current quota|rate limit|too many requests|429/i,
];

const PROVIDER_COOLDOWN_MS = 60 * 60 * 1000;
/** @type {Map<string, number>} providerKey|baseUrl → cooldownUntil */
const providerCooldowns = new Map();

const TASK_LEVEL_PATTERNS = [
  /^loop detectado/i,
  /^la misma accion fallo dos veces/i,
  /^la ejecucion se detuvo por fallos consecutivos/i,
  /^el modelo repitio demasiadas acciones/i,
  /^permiso denegado|^acceso denegado|^no autorizado para escribir/i,
  /^validacion de proyecto fallo/i,
  /^archivo fuera del proyecto/i,
  /^la tarea requiere/i,
  /^transicion invalida/i,
];

function modelProfileKey(profile = {}) {
  return `${String(profile.providerKey || "")}|${String(profile.baseUrl || "")}|${String(profile.model || "")}`.toLowerCase();
}

function providerCooldownKey(profile = {}) {
  return `${String(profile.providerKey || "").toLowerCase()}|${String(profile.baseUrl || "").toLowerCase()}`;
}

function isBillingOrQuotaError(error) {
  if (!error) return false;
  const status = Number(error.status || 0);
  if (status === 402 || status === 429) return true;
  const message = String(error?.message || error || "");
  return BILLING_QUOTA_PATTERNS.some((pattern) => pattern.test(message));
}

function markProviderCooldown(profile = {}, ms = PROVIDER_COOLDOWN_MS) {
  const key = providerCooldownKey(profile);
  if (!key || key === "|") return;
  providerCooldowns.set(key, Date.now() + Math.max(60_000, Number(ms) || PROVIDER_COOLDOWN_MS));
}

function isProviderCoolingDown(profile = {}) {
  const key = providerCooldownKey(profile);
  if (!key || key === "|") return false;
  const until = Number(providerCooldowns.get(key) || 0);
  if (!until) return false;
  if (Date.now() >= until) {
    providerCooldowns.delete(key);
    return false;
  }
  return true;
}

function isRecoverableModelError(error) {
  if (!error) return false;
  if (error.code === "TASK_LEVEL_ERROR" || error.taskLevel === true) return false;
  if (error.code === "AGENT_STEER") return false;
  const status = Number(error.status || 0);
  if ([402, 408, 409, 425, 429, 500, 502, 503, 504, 524].includes(status)) return true;
  const message = String(error?.message || error || "");
  if (/401|403|无效|invalid.?token|inv[aá]lid.?token|forbidden|no available accounts|no est[aá] disponible|upstream|上游/i.test(message)) {
    return true;
  }
  return RECOVERABLE_MODEL_PATTERNS.some((pattern) => pattern.test(message));
}

function isTaskLevelError(error) {
  if (!error) return false;
  if (error.code === "TASK_LEVEL_ERROR" || error.taskLevel === true) return true;
  const message = String(error?.message || error || "");
  return TASK_LEVEL_PATTERNS.some((pattern) => pattern.test(message));
}

function profileCapability(profile = {}, requiredCapability = "agent") {
  const explicit = String(profile.capability || "").toLowerCase();
  if (explicit === "agent" || explicit === "chat") return explicit;
  if (profile.toolOK === true) return "agent";
  if (profile.chatOK === true && profile.toolOK !== false) return profile.toolOK === false ? "chat" : "agent";
  if (profile.chatOK === true) return "chat";
  const classified = classifyModelCapability({
    toolOK: profile.toolOK,
    chatOK: profile.chatOK,
  });
  if (classified !== "unavailable") return classified;
  const model = String(profile.model || "").toLowerCase();
  if (/claude|gpt-4|gpt-5|gemini|sonnet|opus|deepseek|qwen|kimi|glm/.test(model)) {
    return requiredCapability === "chat" ? "chat" : "agent";
  }
  return requiredCapability === "chat" ? "chat" : "unavailable";
}

function hasRequiredCapability(profile, requiredCapability = "agent") {
  const cap = profileCapability(profile, requiredCapability);
  if (requiredCapability === "agent") return cap === "agent";
  return cap === "agent" || cap === "chat";
}

function rankCandidate(profile, capabilities = {}) {
  const model = String(profile.model || "").toLowerCase();
  let score = 0;
  const cap = Object.values(capabilities).find((entry) => String(entry?.model || "").toLowerCase() === model);
  if (cap?.ok) score += 100 + Number(cap.lastOkAt || 0) / 1e12;
  if (Number(cap?.failStreak || 0) > 0) score -= 50 * Number(cap.failStreak || 0);
  if (profile.toolOK) score += 20;
  if (profile.verified) score += 15;
  return score;
}

class ModelFailoverCoordinator {
  constructor(options = {}) {
    this.taskContext = options.taskContext || {};
    this.candidates = Array.isArray(options.candidates) ? options.candidates.slice() : [];
    this.current = options.current || null;
    this.capabilities = options.capabilities || {};
    this.requiredCapability = options.requiredCapability || "agent";
    this.maxChainLength = Math.max(1, Number(options.maxChainLength) || 8);
    this.maxRetriesPerModel = options.maxRetriesPerModel !== undefined
      ? Math.max(0, Number(options.maxRetriesPerModel))
      : 1;
    this.onCheckpoint = typeof options.onCheckpoint === "function" ? options.onCheckpoint : async () => null;
    this.failedModels = new Map();
    this.retryLog = [];
    this.failoverCount = 0;
    this.waitingForProvider = false;
    this.lastCheckpoint = null;
    this.completedFailovers = new Set();
  }

  log(event, fields = {}) {
    const ctx = this.taskContext || {};
    logWorkflow(event, {
      taskId: ctx.taskId,
      planId: ctx.planId,
      approvalId: ctx.approvalId,
      runId: ctx.runId,
      provider: fields.provider || this.current?.providerKey,
      model: fields.model || this.current?.model,
      capability: fields.capability || this.requiredCapability,
      checkpointId: fields.checkpointId,
      error: fields.error,
      ...fields,
    });
  }

  markExecutionStarted() {
    if (!this.current) return;
    this.log("MODEL_EXECUTION_STARTED", {
      provider: this.current.providerKey,
      model: this.current.model,
      capability: profileCapability(this.current, this.requiredCapability),
    });
  }

  markExecutionResumed(profile) {
    this.log("MODEL_EXECUTION_RESUMED", {
      provider: profile?.providerKey,
      model: profile?.model,
      capability: profileCapability(profile, this.requiredCapability),
    });
  }

  recordRetry(error, profile = this.current) {
    const entry = {
      provider: profile?.providerKey || "",
      model: profile?.model || "",
      error: String(error?.message || error || "").slice(0, 240),
      timestamp: new Date().toISOString(),
      retryCount: Number(this.failedModels.get(modelProfileKey(profile))?.retryCount || 0) + 1,
    };
    this.retryLog.push(entry);
    this.log("MODEL_RETRY", entry);
    return entry;
  }

  async persistCheckpoint(context = {}) {
    const payload = {
      ...context,
      taskId: this.taskContext.taskId,
      planId: this.taskContext.planId,
      approvalId: this.taskContext.approvalId,
      runId: this.taskContext.runId,
      failedModel: context.failedModel || this.current,
      completedSteps: context.completedSteps || [],
      pendingSteps: context.pendingSteps || [],
      modifiedFiles: context.modifiedFiles || [],
      partialResult: context.partialResult || "",
      currentStage: context.currentStage || "",
      error: context.error ? String(context.error?.message || context.error).slice(0, 500) : "",
    };
    const checkpoint = await this.onCheckpoint(payload);
    this.lastCheckpoint = checkpoint;
    this.log("CHECKPOINT_PERSISTED", {
      checkpointId: checkpoint?.checkpointId,
      provider: payload.failedModel?.providerKey,
      model: payload.failedModel?.model,
    });
    return checkpoint;
  }

  selectNextModel({ excludeKeys = new Set() } = {}) {
    const pool = this.candidates
      .filter((candidate) => {
        const key = modelProfileKey(candidate);
        if (!key || key === modelProfileKey(this.current)) return false;
        if (excludeKeys.has(key)) return false;
        if (this.failedModels.has(key)) return false;
        if (isProviderCoolingDown(candidate)) return false;
        return hasRequiredCapability(candidate, this.requiredCapability);
      })
      .sort((left, right) => {
        const leftKey = `${String(left.providerKey || "")}|${String(left.model || "")}`.toLowerCase();
        const rightKey = `${String(right.providerKey || "")}|${String(right.model || "")}`.toLowerCase();
        return leftKey.localeCompare(rightKey, undefined, { sensitivity: "base", numeric: true });
      });

    if (!pool.length) {
      for (const candidate of this.candidates) {
        if (!hasRequiredCapability(candidate, this.requiredCapability)) {
          this.log("MODEL_SKIPPED_INCOMPATIBLE", {
            provider: candidate.providerKey,
            model: candidate.model,
            capability: profileCapability(candidate, this.requiredCapability),
          });
        }
      }
      return null;
    }

    const idx = this.failoverCount % pool.length;
    return pool[idx] || pool[0] || null;
  }

  async handleFailure(error, executionContext = {}) {
    if (isTaskLevelError(error)) {
      return { action: "task_error", error };
    }
    if (!isRecoverableModelError(error)) {
      return { action: "task_error", error };
    }

    const failedProfile = this.current;
    const failedKey = modelProfileKey(failedProfile);
    const billingHit = isBillingOrQuotaError(error);
    if (billingHit) markProviderCooldown(failedProfile, PROVIDER_COOLDOWN_MS);

    const previous = this.failedModels.get(failedKey) || { retryCount: 0 };
    // Saldo/cuota: no reintentar el mismo modelo; saltar al siguiente de inmediato.
    const retryCount = billingHit ? this.maxRetriesPerModel + 1 : previous.retryCount + 1;
    this.failedModels.set(failedKey, {
      error: String(error?.message || error || ""),
      timestamp: Date.now(),
      retryCount,
      provider: failedProfile?.providerKey,
      model: failedProfile?.model,
      billing: billingHit,
    });

    this.log("MODEL_EXECUTION_FAILED", {
      provider: failedProfile?.providerKey,
      model: failedProfile?.model,
      error: String(error?.message || error || ""),
      billing: billingHit,
    });

    if (retryCount <= this.maxRetriesPerModel) {
      this.recordRetry(error, failedProfile);
      await this.persistCheckpoint({
        ...executionContext,
        failedModel: failedProfile,
        error,
        retrySameModel: true,
      });
      return { action: "retry_same_model", profile: failedProfile, checkpoint: this.lastCheckpoint, retryCount };
    }

    if (this.failoverCount >= this.maxChainLength) {
      this.waitingForProvider = true;
      await this.persistCheckpoint({ ...executionContext, failedModel: failedProfile, error });
      this.log("WAITING_FOR_PROVIDER", { error: "Se agotaron los modelos compatibles en esta ejecucion." });
      return { action: "waiting_for_provider", checkpoint: this.lastCheckpoint };
    }

    await this.persistCheckpoint({ ...executionContext, failedModel: failedProfile, error });
    this.log("FAILOVER_STARTED", {
      provider: failedProfile?.providerKey,
      model: failedProfile?.model,
      checkpointId: this.lastCheckpoint?.checkpointId,
      silent: true,
      billing: billingHit,
    });

    const next = this.selectNextModel();
    if (!next) {
      this.waitingForProvider = true;
      this.log("PROVIDER_UNAVAILABLE", { error: "No hay modelos compatibles disponibles." });
      this.log("WAITING_FOR_PROVIDER", { error: "No hay modelos compatibles disponibles." });
      return { action: "waiting_for_provider", checkpoint: this.lastCheckpoint };
    }

    const failoverKey = `${failedKey}->${modelProfileKey(next)}`;
    if (this.completedFailovers.has(failoverKey)) {
      return { action: "duplicate_failover", profile: next, checkpoint: this.lastCheckpoint };
    }
    this.completedFailovers.add(failoverKey);
    this.current = next;
    this.failoverCount += 1;
    this.log("MODEL_SELECTED", {
      provider: next.providerKey,
      model: next.model,
      capability: profileCapability(next, this.requiredCapability),
      checkpointId: this.lastCheckpoint?.checkpointId,
      silent: true,
    });
    this.log("FAILOVER_COMPLETED", {
      provider: next.providerKey,
      model: next.model,
      checkpointId: this.lastCheckpoint?.checkpointId,
      silent: true,
      fromModel: failedProfile?.model,
    });
    return {
      action: "failover",
      profile: next,
      checkpoint: this.lastCheckpoint,
      silent: true,
      fromModel: failedProfile?.model,
      reason: billingHit ? "billing_quota" : "recoverable",
    };
  }

  applyProfileToInput(input, profile) {
    if (!input || !profile) return input;
    input.model = profile.model;
    input.apiKey = profile.apiKey;
    input.baseUrl = profile.baseUrl;
    input.providerKey = profile.providerKey;
    return input;
  }

  recordIntraTurnFallback(fromProfile, toProfile) {
    const from = fromProfile || {};
    const to = toProfile || {};
    const fromKey = modelProfileKey(from);
    if (fromKey) {
      this.failedModels.set(fromKey, {
        error: "intra-turn fallback",
        timestamp: Date.now(),
        retryCount: this.maxRetriesPerModel + 1,
        provider: from.providerKey,
        model: from.model,
      });
    }
    this.current = to;
    this.log("INTRA_TURN_FALLBACK", {
      provider: to.providerKey,
      model: to.model,
      fromProvider: from.providerKey,
      fromModel: from.model,
    });
    return to;
  }

  createWorkerDeathError(ageMs = 0) {
    const error = new Error(`Worker DEAD: heartbeat no recibido (${ageMs}ms).`);
    error.code = "WORKER_DEAD";
    return error;
  }

  getFailureHistory() {
    return [...this.failedModels.entries()].map(([key, value]) => ({ key, ...value }));
  }
}

function mergeCandidateProfiles(current = {}, lists = []) {
  const seen = new Set();
  const merged = [];
  const add = (profile) => {
    const normalized = {
      providerKey: String(profile?.providerKey || ""),
      baseUrl: String(profile?.baseUrl || ""),
      apiKey: String(profile?.apiKey || ""),
      model: String(profile?.model || ""),
      toolOK: profile?.toolOK,
      chatOK: profile?.chatOK,
      capability: profile?.capability,
      verified: profile?.verified === true,
    };
    const key = modelProfileKey(normalized);
    if (!key || key === modelProfileKey(current) || seen.has(key)) return;
    if (!normalized.baseUrl || !normalized.apiKey || !normalized.model) return;
    seen.add(key);
    merged.push(normalized);
  };
  for (const list of lists) {
    for (const profile of list || []) add(profile);
  }
  return merged;
}

function recordIntraTurnFallback(coordinator, input, fallbackMeta = {}) {
  if (!coordinator || !fallbackMeta?.to) return null;
  const toProfile = coordinator.recordIntraTurnFallback(fallbackMeta.from, fallbackMeta.to);
  if (input && toProfile) coordinator.applyProfileToInput(input, toProfile);
  return toProfile;
}

module.exports = {
  ModelFailoverCoordinator,
  isRecoverableModelError,
  isBillingOrQuotaError,
  isTaskLevelError,
  hasRequiredCapability,
  modelProfileKey,
  mergeCandidateProfiles,
  profileCapability,
  recordIntraTurnFallback,
  markProviderCooldown,
  isProviderCoolingDown,
  PROVIDER_COOLDOWN_MS,
};
