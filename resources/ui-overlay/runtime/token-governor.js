"use strict";

const CONTEXT_LEVELS = Object.freeze(["STATE_ONLY", "CHECKPOINT", "EVENTS", "FILES", "SYMBOLS", "EXPANDED"]);

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fingerprint(value = {}) {
  return JSON.stringify({
    error: String(value.error || "").slice(0, 240).toLowerCase(),
    strategy: String(value.strategy || ""),
    action: String(value.action || ""),
    stage: String(value.stage || ""),
  });
}

class TokenGovernor {
  constructor({ maxRetries = 3, loopWindow = 3 } = {}) {
    this.maxRetries = Math.max(1, Number(maxRetries) || 3);
    this.loopWindow = Math.max(2, Number(loopWindow) || 3);
  }

  decide(input = {}) {
    const history = Array.isArray(input.history) ? input.history : [];
    const budget = Math.max(0, finite(input.remainingBudget, finite(input.budget)));
    const failures = history.filter((item) => item?.ok === false || item?.error).length;
    const fingerprints = history.slice(-this.loopWindow).map(fingerprint);
    const loop = fingerprints.length >= this.loopWindow && new Set(fingerprints).size === 1;
    const progress = Math.max(0, finite(input.progress, 0));
    const estimatedCost = Math.max(1, finite(input.estimatedCost, 1));
    let decision = "CONTINUE";
    let contextLevel = Math.max(0, Math.min(CONTEXT_LEVELS.length - 1, Number(input.contextLevel) || 0));
    let reason = "La siguiente accion tiene presupuesto y no hay evidencia de estancamiento.";
    let nextStrategy = String(input.strategy || "continue");
    if (loop) {
      decision = failures >= this.maxRetries ? "HUMAN_INTERVENTION" : "CHANGE_STRATEGY";
      contextLevel = Math.min(CONTEXT_LEVELS.length - 1, contextLevel + 2);
      nextStrategy = failures >= this.maxRetries ? "stop-repeated-failure" : "change-tool-or-context";
      reason = failures >= this.maxRetries ? "Se alcanzo el limite de fallos equivalentes." : "Se detecto un loop; repetir la misma estrategia no aporta progreso.";
    } else if (input.lastError) {
      decision = budget >= estimatedCost ? "RETRY" : "STOP";
      contextLevel = Math.min(CONTEXT_LEVELS.length - 1, contextLevel + 1);
      nextStrategy = "retry-with-more-context";
      reason = decision === "RETRY" ? "El error tiene presupuesto para un reintento con contexto adicional." : "No hay presupuesto suficiente para reintentar de forma responsable.";
    } else if (budget < estimatedCost * 0.25) {
      decision = "STOP";
      reason = "El presupuesto restante no cubre ni una accion minima razonable.";
    } else if (budget < estimatedCost) {
      decision = "REDUCE_CONTEXT";
      contextLevel = Math.max(0, contextLevel - 1);
      nextStrategy = "minimum-cost-context";
      reason = "El presupuesto es reducido; se intentara una accion economica con menos contexto.";
    } else if (input.verificationRequired) {
      decision = "VERIFY";
      reason = "La mutacion o accion requiere verificacion persistida antes de continuar.";
    }
    return {
      decision, reason, contextLevel, contextName: CONTEXT_LEVELS[contextLevel],
      estimatedCost, remainingBudget: budget, progress, loopDetected: loop,
      retryCount: failures, previousStrategy: String(input.strategy || ""), nextStrategy,
    };
  }
}

module.exports = { CONTEXT_LEVELS, TokenGovernor, fingerprint };
