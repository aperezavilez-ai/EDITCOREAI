"use strict";

/**
 * Ciclo 52: El Núcleo Omega - Gobernanza Simbiótica Universal (Omega Core)
 * Nivel supremo de control y gobernanza simbiótica hombre-máquina, ajuste dinámico
 * del nivel de autonomía y bloqueos de seguridad de grado empresarial.
 */
class OmegaGovernor {
  constructor() {
    this.autonomyLevel = 3; // 1 (Assisted) to 5 (Singularity Master)
    this.autonomyModes = {
      1: { name: "ASSISTED", description: "Humano conduce cada paso; IA solo sugiere" },
      2: { name: "CO_PILOT", description: "IA genera código; humano aprueba cada bloque" },
      3: { name: "SEMI_AUTONOMOUS", description: "IA ejecuta tareas con Plan-First Gate obligatorio" },
      4: { name: "FULL_AUTONOMOUS", description: "IA orquesta enjambres y pipelines de forma desatendida" },
      5: { name: "SINGULARITY_MASTER", description: "Simbiosis cognitiva total y auto-evolución continua" },
    };
    this.safetyInterlocksEnabled = true;
    this.symbioticAlignmentScore = 0.98;
  }

  /**
   * Ajusta el nivel de autonomía del ecosistema
   */
  setAutonomyLevel(level) {
    const num = Math.min(5, Math.max(1, parseInt(level, 10) || 3));
    this.autonomyLevel = num;
    return {
      level: this.autonomyLevel,
      mode: this.autonomyModes[this.autonomyLevel],
      safetyInterlocksEnabled: this.safetyInterlocksEnabled,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Evalúa si una acción requiere aprobación humana según el nivel de autonomía
   */
  evaluateActionSafety(actionType = "WRITE_FILE", criticality = "MEDIUM") {
    if (this.safetyInterlocksEnabled && this.autonomyLevel <= 3) {
      if (criticality === "HIGH" || actionType === "SYSTEM_MUTATION" || actionType === "DELETE_FILE") {
        return {
          allowedImmediately: false,
          requiresHumanApproval: true,
          gate: "PLAN_FIRST_REQUIRED",
          reason: `Autonomía en Nivel ${this.autonomyLevel} (${this.autonomyModes[this.autonomyLevel].name}) exige confirmación para acciones ${criticality}.`,
        };
      }
    }

    return {
      allowedImmediately: true,
      requiresHumanApproval: false,
      gate: "PASSED_AUTONOMOUS",
      reason: `Nivel de autonomía ${this.autonomyLevel} permite ejecución directa.`,
    };
  }

  /**
   * Obtiene el estado supremo del Núcleo Omega
   */
  getOmegaStatus() {
    return {
      status: "OMEGA_HORIZON_ACTIVE",
      autonomyLevel: this.autonomyLevel,
      currentMode: this.autonomyModes[this.autonomyLevel],
      safetyInterlocks: this.safetyInterlocksEnabled,
      symbioticAlignmentScore: this.symbioticAlignmentScore,
      activeSubsystems: [
        "Swarm Mesh Network (Ciclo 45)",
        "Singularity Engine (Ciclo 46)",
        "Compute Economy (Ciclo 47)",
        "Quantum Cryptography (Ciclo 48)",
        "Neural UI Builder (Ciclo 49)",
        "3D Architecture Visualizer (Ciclo 50)",
        "Ecosystem Replication (Ciclo 51)",
        "Omega Symbiotic Core (Ciclo 52)",
      ],
      timestamp: new Date().toISOString(),
    };
  }
}

const omegaGovernor = new OmegaGovernor();

module.exports = {
  OmegaGovernor,
  omegaCore: omegaGovernor,
};
