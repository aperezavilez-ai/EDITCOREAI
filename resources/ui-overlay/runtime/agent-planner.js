/**
 * runtime/agent-planner.js
 * EditCoreAI - Plan-First & Human-In-The-Loop Execution Gate (Ciclo 35)
 */

const WRITE_TOOLS = new Set([
  "write_file",
  "write_to_file",
  "replace_file_content",
  "multi_file_patch",
  "delete_file",
  "apply_patch",
  "execute_command",
  "run_command",
]);

class AgentPlanner {
  constructor(options = {}) {
    this.options = options;
    this.plans = new Map(); // planId -> PlanObject
  }

  /**
   * Crea un plan estructurado y lo congela en espera de aprobación humana
   */
  createPlan({ goal = "", targetFiles = [], steps = [], diffPreview = "" } = {}) {
    const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const normalizedFiles = (Array.isArray(targetFiles) ? targetFiles : []).map((file) => {
      if (typeof file === "string") {
        return {
          filePath: file,
          changeType: "MODIFY",
          summary: "Modificación de archivo propuesta",
        };
      }
      return {
        filePath: file.filePath || "unknown",
        changeType: file.changeType || "MODIFY",
        summary: file.summary || "Modificación propuesta",
        diffPreview: file.diffPreview || "",
      };
    });

    const plan = {
      planId,
      goal: goal || "Plan de modificación autónomo",
      status: "WAITING_FOR_APPROVAL",
      targetFiles: normalizedFiles,
      steps: Array.isArray(steps) && steps.length > 0 ? steps : ["Analizar contexto", "Proponer cambios", "Aplicar modificaciones validadas"],
      diffPreview: diffPreview || "",
      createdAt: new Date().toISOString(),
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
    };

    this.plans.set(planId, plan);
    return plan;
  }

  /**
   * Obtiene el plan por ID
   */
  getPlan(planId) {
    if (!planId) return null;
    return this.plans.get(planId) || null;
  }

  /**
   * Lista todos los planes pendientes de aprobación
   */
  listPendingPlans() {
    return Array.from(this.plans.values()).filter(
      (p) => p.status === "WAITING_FOR_APPROVAL" || p.status === "PROPOSED"
    );
  }

  /**
   * Aprueba explícitamente un plan por el usuario, desbloqueando la ejecución en disco
   */
  approvePlan(planId, options = {}) {
    const plan = this.plans.get(planId);
    if (!plan) {
      return { success: false, error: "Plan no encontrado" };
    }

    if (plan.status === "REJECTED") {
      return { success: false, error: "No se puede aprobar un plan rechazado" };
    }

    plan.status = "APPROVED";
    plan.approvedAt = new Date().toISOString();
    plan.approvalOptions = options;

    return {
      success: true,
      planId,
      status: plan.status,
      approvedAt: plan.approvedAt,
    };
  }

  /**
   * Rechaza un plan propuesto, impidiendo cualquier escritura en disco
   */
  rejectPlan(planId, reason = "Rechazado por el usuario") {
    const plan = this.plans.get(planId);
    if (!plan) {
      return { success: false, error: "Plan no encontrado" };
    }

    plan.status = "REJECTED";
    plan.rejectedAt = new Date().toISOString();
    plan.rejectionReason = reason;

    return {
      success: true,
      planId,
      status: plan.status,
      rejectedAt: plan.rejectedAt,
      reason,
    };
  }

  /**
   * Puerta de Ejecución: Verifica si una herramienta está permitida según el estado del plan
   */
  isToolAllowed(planId, toolName = "") {
    const cleanTool = (toolName || "").toLowerCase().trim();

    // Herramientas de sólo lectura y análisis siempre están permitidas
    if (!WRITE_TOOLS.has(cleanTool)) {
      return {
        allowed: true,
        reason: "Herramienta de lectura/análisis permitida en cualquier fase",
      };
    }

    // Para herramientas de escritura, se exige un plan aprobado
    if (!planId) {
      return {
        allowed: false,
        reason: "Plan-First Gate: Se requiere un plan estructurado antes de ejecutar herramientas de escritura",
      };
    }

    const plan = this.plans.get(planId);
    if (!plan) {
      return {
        allowed: false,
        reason: `Plan-First Gate: El plan '${planId}' no existe`,
      };
    }

    if (plan.status === "APPROVED" || plan.status === "EXECUTING") {
      return {
        allowed: true,
        reason: "Plan aprobado por el usuario: herramienta de escritura autorizada",
      };
    }

    return {
      allowed: false,
      reason: `Plan-First Gate: Operación bloqueada. El plan '${planId}' está en estado '${plan.status}' y requiere aprobación humana previa.`,
    };
  }

  /**
   * Marca un plan como ejecutado
   */
  markPlanExecuted(planId) {
    const plan = this.plans.get(planId);
    if (plan && plan.status === "APPROVED") {
      plan.status = "EXECUTED";
      plan.executedAt = new Date().toISOString();
      return true;
    }
    return false;
  }
}

const agentPlannerInstance = new AgentPlanner();

module.exports = {
  AgentPlanner,
  agentPlanner: agentPlannerInstance,
  WRITE_TOOLS,
};
