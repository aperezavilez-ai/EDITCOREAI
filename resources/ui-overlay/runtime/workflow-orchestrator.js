"use strict";

const { id, now } = require("./task-models");
const { logWorkflow } = require("./workflow-logger");

const AWAITING_STATES = new Set(["AWAITING_AUTHORIZATION", "PLAN_READY"]);
const EXECUTION_ACTIVE_STATES = new Set(["APPROVED", "EXECUTING", "VALIDATING", "IMPLEMENTING", "VERIFYING"]);

function isAuthorizationGoal(goal = "") {
  return /^\s*(?:procede|contin[uú]a|adelante|autorizo|hazlo|ejecuta|s[ií])\b/i.test(String(goal || "").trim());
}

class WorkflowOrchestrator {
  constructor({ manager } = {}) {
    if (!manager) throw new Error("WorkflowOrchestrator requiere TaskManager.");
    this.manager = manager;
  }

  getPlan(taskId, planId) {
    return this.manager.store.getPlan(taskId, planId);
  }

  getLatestPlan(taskId) {
    const task = this.manager.getTask(taskId);
    if (!task?.planId) return null;
    return this.manager.store.getPlan(taskId, task.planId);
  }

  persistPlan(taskId, input = {}) {
    const task = this.manager.getTask(taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
    // No degradar una ejecucion ya autorizada con un plan tardio de analisis.
    if (["APPROVED", "EXECUTING", "VALIDATING", "COMPLETED"].includes(task.status)) {
      const plan = this.manager.store.savePlan(taskId, {
        planId: input.planId || task.planId,
        taskId,
        projectId: String(input.projectId || task.projectId || ""),
        version: Math.max(1, Number(input.version) || 1),
        status: String(input.status || "APPROVED"),
        content: String(input.content || ""),
        summary: String(input.summary || "").slice(0, 4000),
        createdAt: input.createdAt,
        fixQueue: Array.isArray(input.fixQueue) ? input.fixQueue : undefined,
      });
      logWorkflow("PLAN_PERSISTED", {
        taskId,
        planId: plan.planId,
        previousState: task.status,
        nextState: task.status,
      });
      return plan;
    }
    const plan = this.manager.store.savePlan(taskId, {
      planId: input.planId,
      taskId,
      projectId: String(input.projectId || task.projectId || ""),
      version: Math.max(1, Number(input.version) || 1),
      status: String(input.status || "PENDING_APPROVAL"),
      content: String(input.content || ""),
      summary: String(input.summary || "").slice(0, 4000),
      createdAt: input.createdAt,
      fixQueue: Array.isArray(input.fixQueue) ? input.fixQueue : undefined,
    });
    const previous = task.status;
    const patch = {
      planId: plan.planId,
      planReference: plan.planId,
      currentStage: "plan_ready",
    };
    if (task.status === "ANALYZING" || task.status === "DISCOVERY") {
      this.manager.transition(taskId, "PLAN_READY", patch, "PLAN_CREATED");
      this.manager.transition(taskId, "AWAITING_AUTHORIZATION", {
        ...patch,
        currentStage: "awaiting_authorization",
        nextAction: {
          type: "AUTHORIZE",
          description: "Esperar autorizacion del usuario para ejecutar el plan.",
          status: "WAITING",
        },
      }, "ANALYSIS_AWAITING_AUTHORIZATION");
    } else if (AWAITING_STATES.has(task.status) || task.status === "READY") {
      this.manager.updateTask(taskId, {
        ...patch,
        status: task.status === "READY" ? "AWAITING_AUTHORIZATION" : task.status,
        currentStage: "awaiting_authorization",
        nextAction: {
          type: "AUTHORIZE",
          description: "Esperar autorizacion del usuario para ejecutar el plan.",
          status: "WAITING",
        },
      });
      if (task.status === "READY") {
        this.manager.store.appendTaskEvent(taskId, {
          type: "ANALYSIS_AWAITING_AUTHORIZATION",
          previousState: previous,
          newState: "AWAITING_AUTHORIZATION",
          payloadReference: plan.planId,
        });
      }
    } else {
      this.manager.updateTask(taskId, patch);
    }
    logWorkflow("PLAN_PERSISTED", {
      taskId,
      planId: plan.planId,
      previousState: previous,
      nextState: "AWAITING_AUTHORIZATION",
    });
    return plan;
  }

  recordPlanApproval(taskId, planId, input = {}) {
    let task = this.manager.getTask(taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
    let resolvedPlanId = String(planId || task.planId || "").trim();
    let plan = resolvedPlanId ? this.manager.store.getPlan(taskId, resolvedPlanId) : null;
    if (!plan) {
      plan = this.manager.store.getLatestPlan(taskId) || null;
      if (plan) resolvedPlanId = plan.planId;
    }
    if (!plan) {
      // PlanId huérfano tras reinicio: limpia y recrea desde evidencia durable.
      const recoveredContent = String(task.planReference || task.lastAssistantText || task.goal || "").trim();
      const minPlanChars = ["AWAITING_AUTHORIZATION", "PLAN_READY", "READY", "RECOVERABLE", "IMPLEMENTING", "ANALYZING", "DISCOVERY", "INTERRUPTED"].includes(task.status) ? 20 : 120;
      if (recoveredContent.length >= minPlanChars) {
        const persisted = this.persistPlan(taskId, {
          projectId: task.projectId,
          content: recoveredContent,
          summary: recoveredContent.slice(0, 4000),
          status: "PENDING_APPROVAL",
        });
        resolvedPlanId = persisted.planId;
        plan = this.manager.store.getPlan(taskId, resolvedPlanId);
      } else if (resolvedPlanId) {
        this.manager.updateTask(taskId, { planId: "", planReference: "" });
        throw Object.assign(
          new Error("El plan anterior ya no está en memoria (se reinició EditCore). Escribe CONTINUA para retomar el análisis, o un análisis nuevo; cuando haya reporte escribe PROCEDE."),
          { code: "WORKFLOW_PLAN_MISSING", recoverable: true },
        );
      }
    }
    // Siempre refrescar: persistPlan puede haber movido ANALYZING/READY -> AWAITING.
    task = this.manager.getTask(taskId) || task;
    if (!resolvedPlanId) {
      throw Object.assign(
        new Error("No hay un plan de analisis listo. Escribe CONTINUA o «analiza el proyecto», espera el reporte y luego procede."),
        { code: "WORKFLOW_PLAN_MISSING" },
      );
    }
    if (!plan) {
      throw Object.assign(
        new Error(`Plan no encontrado: ${resolvedPlanId}. Escribe CONTINUA para retomar el análisis (sin exigir el plan viejo), o analiza de nuevo y luego PROCEDE.`),
        { code: "WORKFLOW_PLAN_MISSING", recoverable: true },
      );
    }
    const existing = this.manager.store.findActivePlanApproval(taskId, resolvedPlanId);
    if (existing && ["APPROVED", "EXECUTING"].includes(task.status)) {
      logWorkflow("APPROVAL_DUPLICATE", {
        taskId,
        planId: resolvedPlanId,
        approvalId: existing.approvalId,
        previousState: task.status,
        nextState: task.status,
      });
      return { duplicate: true, approval: existing, task };
    }

    const approval = this.manager.store.saveApproval(taskId, {
      approvalId: input.approvalId,
      taskId,
      planId: resolvedPlanId,
      type: "PLAN_EXECUTION",
      status: "APPROVED",
      approvedAt: now(),
    });
    const previous = task.status;
    const approvalPatch = {
      approvalId: approval.approvalId,
      planId: resolvedPlanId,
      planReference: resolvedPlanId,
      currentStage: "approved",
      nextAction: {
        type: "EXECUTE",
        description: "Ejecutar plan autorizado por el usuario.",
        status: "PENDING",
      },
    };

    // Un solo camino de autorizacion: dejar la tarea en APPROVED siempre.
    const { canTransition } = require("./task-models");
    if (task.status === "ANALYZING" || task.status === "DISCOVERY") {
      this.manager.transition(taskId, "PLAN_READY", {
        planId: resolvedPlanId,
        planReference: resolvedPlanId,
        currentStage: "plan_ready",
      }, "PLAN_CREATED");
      this.manager.transition(taskId, "AWAITING_AUTHORIZATION", {
        planId: resolvedPlanId,
        currentStage: "awaiting_authorization",
      }, "ANALYSIS_AWAITING_AUTHORIZATION");
      task = this.manager.getTask(taskId);
    } else if (task.status === "PLAN_READY") {
      this.manager.transition(taskId, "AWAITING_AUTHORIZATION", {
        planId: resolvedPlanId,
        currentStage: "awaiting_authorization",
      }, "ANALYSIS_AWAITING_AUTHORIZATION");
      task = this.manager.getTask(taskId);
    } else if (!["AWAITING_AUTHORIZATION", "APPROVED", "EXECUTING"].includes(task.status)
      && canTransition(task.status, "AWAITING_AUTHORIZATION")) {
      this.manager.transition(taskId, "AWAITING_AUTHORIZATION", {
        planId: resolvedPlanId,
        currentStage: "awaiting_authorization",
      }, "ANALYSIS_AWAITING_AUTHORIZATION");
      task = this.manager.getTask(taskId);
    }

    task = this.manager.getTask(taskId);
    if (task.status === "AWAITING_AUTHORIZATION" || task.status === "PLAN_READY") {
      this.manager.transition(taskId, "APPROVED", approvalPatch, "APPROVAL_RECORDED");
    } else if (task.status === "APPROVED" || task.status === "EXECUTING") {
      this.manager.updateTask(taskId, { approvalId: approval.approvalId, currentStage: "approved" });
    } else if (canTransition(task.status, "APPROVED")) {
      this.manager.transition(taskId, "APPROVED", approvalPatch, "APPROVAL_RECORDED");
    } else {
      this.manager.updateTask(taskId, {
        approvalId: approval.approvalId,
        currentStage: "approved",
      });
      this.manager.store.appendTaskEvent(taskId, {
        type: "APPROVAL_RECORDED",
        previousState: previous,
        newState: task.status,
        payloadReference: approval.approvalId,
        metadata: { planId: resolvedPlanId },
      });
    }

    this.manager.store.savePlan(taskId, { ...plan, status: "APPROVED" });
    const approvedTask = this.manager.getTask(taskId);
    logWorkflow("APPROVAL_RECORDED", {
      taskId,
      planId: resolvedPlanId,
      approvalId: approval.approvalId,
      previousState: previous,
      nextState: approvedTask?.status || "APPROVED",
    });
    return { duplicate: false, approval, task: approvedTask };
  }

  beginAnalysisRun(taskId, input = {}) {
    const task = this.manager.getTask(taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
    if (AWAITING_STATES.has(task.status) || task.status === "AWAITING_AUTHORIZATION") {
      throw Object.assign(new Error("La tarea ya tiene un plan pendiente de autorizacion."), { code: "WORKFLOW_AWAITING_APPROVAL", task });
    }
    if (EXECUTION_ACTIVE_STATES.has(task.status) && task.activeRunId) {
      throw Object.assign(new Error("La tarea ya tiene una ejecucion activa."), { code: "WORKFLOW_RUN_ACTIVE", task });
    }
    const previous = task.status;
    // Tras un fallo recuperable, reabrir analisis sin forzar al usuario a otra tarea.
    if (task.status === "RECOVERABLE") {
      this.manager.transition(taskId, "RECOVERING", {
        currentStage: "recovery",
        nextAction: { type: "ANALYZE", description: "Reabrir analisis tras recuperacion.", status: "PENDING" },
      }, "ANALYSIS_RECOVERY");
    }
    const current = this.manager.getTask(taskId);
    if (current.status !== "ANALYZING") {
      this.manager.transition(taskId, "ANALYZING", {
        currentStage: "analysis",
        nextAction: { type: "ANALYZE", description: "Analizar el proyecto.", status: "RUNNING" },
      }, "ANALYSIS_STARTED");
    }
    logWorkflow("ANALYSIS_STARTED", { taskId, previousState: previous, nextState: "ANALYZING" });
    return this.manager.getTask(taskId);
  }

  beginAuthorizedExecution(taskId, runId = "") {
    let task = this.manager.getTask(taskId);
    if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
    // CRITICAL: COMPLETED/FAILED/CANCELLED bloqueaban procede/continua para siempre.
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
      this.manager.reopenTerminalTask(taskId, {
        reason: "PROCEDE/CONTINUA sobre tarea terminal; reabriendo para ejecucion autorizada.",
      });
      task = this.manager.getTask(taskId);
    }
    if (task.activeRunId) {
      const active = this.manager.store.getRun(taskId, task.activeRunId);
      if (active && ["RUN_CREATED", "RUNNING", "PAUSED"].includes(active.status)) {
        // Si el usuario ya autorizo, cierra el run de analisis previo y continua.
        const hasApproval = Boolean(task.approvalId)
          || Boolean(this.manager.store.findActivePlanApproval(taskId, task.planId || ""));
        if (hasApproval || ["APPROVED", "AWAITING_AUTHORIZATION", "PLAN_READY"].includes(task.status)) {
          this.manager.updateRun(taskId, task.activeRunId, {
            status: "INTERRUPTED",
            recoveryReason: "Sustituido por ejecucion autorizada (PROCEDE).",
          });
          this.manager.updateTask(taskId, { activeRunId: "" });
          task = this.manager.getTask(taskId);
        } else {
          return { task, duplicate: true, run: active };
        }
      }
    }
    const previous = task.status;
    if (task.status === "RECOVERABLE") {
      this.manager.transition(taskId, "RECOVERING", {
        currentStage: "recovery",
        nextAction: { type: "EXECUTE", description: "Reanudar ejecucion autorizada tras recuperacion.", status: "PENDING" },
      }, "EXECUTION_RECOVERY");
    }
    let current = this.manager.getTask(taskId);
    // Red de seguridad: si aun espera autorizacion pero ya hay approval, aprobar aqui.
    if (["AWAITING_AUTHORIZATION", "PLAN_READY"].includes(current.status)) {
      let approval = current.approvalId
        ? this.manager.store.getApproval(taskId, current.approvalId)
        : this.manager.store.findActivePlanApproval(taskId, current.planId || "");
      if (!approval) {
        const recorded = this.recordPlanApproval(taskId, {
          planId: current.planId || `plan_${taskId}`,
          notes: "Aprobacion automatica por instruccion del usuario.",
        });
        approval = recorded?.approval;
        current = this.manager.getTask(taskId);
      }
      if (approval && ["AWAITING_AUTHORIZATION", "PLAN_READY"].includes(current.status)) {
        if (current.status === "PLAN_READY") {
          this.manager.transition(taskId, "AWAITING_AUTHORIZATION", { currentStage: "awaiting_authorization" });
          current = this.manager.getTask(taskId);
        }
        this.manager.transition(taskId, "APPROVED", {
          approvalId: approval.approvalId,
          currentStage: "approved",
          nextAction: { type: "EXECUTE", description: "Ejecutar plan autorizado por el usuario.", status: "PENDING" },
        }, "APPROVAL_RECORDED");
        current = this.manager.getTask(taskId);
      }
    }
    if (current.status === "APPROVED") {
      this.manager.transition(taskId, "EXECUTING", {
        currentStage: "implementation",
        nextAction: { type: "EXECUTE", description: "Ejecutar plan autorizado.", status: "RUNNING" },
      }, "EXECUTION_STARTED");
    } else if (current.status === "RECOVERING") {
      this.manager.transition(taskId, "EXECUTING", {
        currentStage: "implementation",
        nextAction: { type: "EXECUTE", description: "Ejecutar plan autorizado.", status: "RUNNING" },
      }, "EXECUTION_STARTED");
    } else if (current.status !== "EXECUTING") {
      const { canTransition } = require("./task-models");
      if (!canTransition(current.status, "EXECUTING")) {
        throw Object.assign(
          new Error(`No se puede iniciar ejecucion desde el estado ${current.status}.`),
          { code: "TASK_TRANSITION_INVALID", task: current },
        );
      }
      this.manager.transition(taskId, "EXECUTING", {
        currentStage: "implementation",
      }, "EXECUTION_STARTED");
    }
    logWorkflow("EXECUTION_STARTED", {
      taskId,
      runId,
      planId: task.planId,
      approvalId: task.approvalId,
      previousState: previous,
      nextState: "EXECUTING",
    });
    return { task: this.manager.getTask(taskId), duplicate: false };
  }

  completeAnalysisRun(taskId, content = "", metadata = {}) {
    const { buildFixQueueFromReport } = require("./fix-queue");
    let evidence = metadata.evidence || null;
    if (!evidence && Array.isArray(metadata.steps)) {
      try {
        evidence = require("./evidence-grounding").collectToolEvidence(
          metadata.steps,
          metadata.projectRoot || "",
        );
      } catch {
        evidence = { findings: [] };
      }
    }
    const fixQueue = Array.isArray(metadata.fixQueue)
      ? metadata.fixQueue
      : buildFixQueueFromReport(content, evidence || {}, { maxItems: 12 });
    return this.persistPlan(taskId, {
      projectId: metadata.projectId,
      content: String(content || ""),
      summary: String(content || "").slice(0, 4000),
      status: "PENDING_APPROVAL",
      fixQueue,
    });
  }

  completeImplementationRun(taskId, runId, { ok = true, error = "" } = {}) {
    const task = this.manager.getTask(taskId);
    if (!task) return null;
    const previous = task.status;
    if (ok) {
      if (task.status === "EXECUTING") {
        this.manager.transition(taskId, "VALIDATING", { currentStage: "verification" }, "VALIDATION_STARTED");
      }
      this.manager.markTaskCompleted(taskId, { verificationStatus: "passed", currentStage: "completed" });
      logWorkflow("WORKFLOW_COMPLETED", {
        taskId,
        runId,
        planId: task.planId,
        previousState: previous,
        nextState: "COMPLETED",
      });
    } else {
      this.manager.markTaskFailed(taskId, new Error(error || "Ejecucion fallida."), {
        recoverable: true,
        runId,
        stage: "implementation",
      });
      logWorkflow("WORKFLOW_FAILED", {
        taskId,
        runId,
        planId: task.planId,
        previousState: previous,
        nextState: "RECOVERABLE",
        error,
      });
    }
    return this.manager.getTask(taskId);
  }

  describeWorkflow(taskId) {
    const task = this.manager.getTask(taskId);
    if (!task) return null;
    const plan = task.planId ? this.manager.store.getPlan(taskId, task.planId) : null;
    const approval = task.approvalId
      ? this.manager.store.getApproval(taskId, task.approvalId)
      : this.manager.store.getLatestApproval(taskId);
    return {
      taskId: task.taskId,
      state: task.status,
      goal: task.goal,
      planId: task.planId || "",
      approvalId: task.approvalId || approval?.approvalId || "",
      planStatus: plan?.status || "",
      planContent: plan?.content || "",
      planSummary: plan?.summary || "",
      fixQueue: Array.isArray(plan?.fixQueue) ? plan.fixQueue : [],
      activeRunId: task.activeRunId || "",
      currentStage: task.currentStage || "",
      nextAction: task.nextAction || null,
      awaitingAuthorization: task.status === "AWAITING_AUTHORIZATION",
      canApprove: task.status === "AWAITING_AUTHORIZATION" && Boolean(task.planId || plan),
    };
  }

  findAwaitingTask({ projectId = "", projectRoot = "" } = {}) {
    const tasks = this.manager.listTasks({ projectId, projectRoot });
    return tasks.find((task) => task.status === "AWAITING_AUTHORIZATION" && (task.planId || task.planReference)) || null;
  }

  prepareAgentRun(input = {}) {
    let taskId = String(input.taskId || "").trim();
    const planAuthorized = input.planAuthorized === true || input.executionMode === "AUTHORIZED_PLAN";
    const analysisMode = input.analysisMode === true && !planAuthorized;
    const projectId = String(input.projectId || "");
    const projectRoot = String(input.projectRoot || "");
    const rawGoal = String(input.goal || input.prompt || "").trim();
    const goal = isAuthorizationGoal(rawGoal) ? "" : rawGoal;

    if (planAuthorized) {
      if (!taskId) {
        const awaiting = this.findAwaitingTask({ projectId, projectRoot })
          || (projectId || projectRoot ? this.manager.listTasks({ projectId, projectRoot }).find((t) => !["COMPLETED", "FAILED", "CANCELLED"].includes(t.status)) : null);
        if (awaiting) {
          taskId = awaiting.taskId;
        } else if (goal || (input.prompt && !isAuthorizationGoal(input.prompt))) {
          const taskGoal = goal || String(input.prompt).trim();
          const newTask = this.manager.createTask({
            projectId,
            projectRoot,
            goal: taskGoal,
            originalRequest: taskGoal,
            status: "READY",
            currentStage: "implementation",
            nextAction: { type: "EXECUTE", description: "Ejecutar con herramientas y evidencia.", status: "PENDING" },
          });
          taskId = newTask.taskId;
        } else {
          throw Object.assign(new Error("La ejecucion autorizada requiere taskId."), { code: "WORKFLOW_TASK_ID_REQUIRED" });
        }
      }
      let task = this.manager.getTask(taskId);
      if (!task) throw new Error(`Tarea no encontrada: ${taskId}`);
      if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
        this.manager.reopenTerminalTask(taskId, {
          reason: "Ejecucion autorizada sobre tarea terminal; reabriendo.",
        });
        task = this.manager.getTask(taskId);
      }
      let planId = String(input.planId || task.planId || "").trim();
      let plan = planId ? this.manager.store.getPlan(taskId, planId) : null;
      if (!plan) {
        const latest = this.getLatestPlan(taskId);
        if (latest) {
          plan = latest;
          planId = latest.planId;
        } else {
          const autoPlan = this.manager.store.savePlan(taskId, {
            planId: planId || `plan-${taskId}`,
            taskId,
            goal: task.goal,
            content: `Plan de ejecución autorizado para: ${task.goal || "Crear proyecto"}`,
            status: "PENDING_APPROVAL",
            createdAt: now(),
          });
          plan = autoPlan;
          planId = autoPlan.planId;
          this.manager.updateTask(taskId, { planId, planReference: planId });
        }
      }
      // Un solo camino: autorizar -> APPROVED -> EXECUTING (sin re-decidir modo).
      const approvalResult = this.recordPlanApproval(taskId, planId, { approvalId: input.approvalId });
      task = this.manager.getTask(taskId) || approvalResult.task;
      if (["AWAITING_AUTHORIZATION", "PLAN_READY"].includes(task.status)) {
        this.manager.transition(taskId, task.status === "PLAN_READY" ? "AWAITING_AUTHORIZATION" : "APPROVED", {
          approvalId: approvalResult.approval.approvalId,
          currentStage: task.status === "PLAN_READY" ? "awaiting_authorization" : "approved",
        }, "APPROVAL_RECORDED");
        task = this.manager.getTask(taskId);
        if (task.status === "AWAITING_AUTHORIZATION") {
          this.manager.transition(taskId, "APPROVED", {
            approvalId: approvalResult.approval.approvalId,
            currentStage: "approved",
            nextAction: { type: "EXECUTE", description: "Ejecutar plan autorizado por el usuario.", status: "PENDING" },
          }, "APPROVAL_RECORDED");
        }
      }
      plan = this.getLatestPlan(taskId) || plan;
      const exec = this.beginAuthorizedExecution(taskId, input.runId);
      return {
        taskId,
        task: exec.task,
        plan,
        planId: plan?.planId || task.planId || "",
        approvalId: approvalResult.approval.approvalId,
        goal: task.goal,
        analysisMode: false,
        planAuthorized: true,
        executionMode: "AUTHORIZED_PLAN",
        duplicateExecution: exec.duplicate === true || approvalResult.duplicate === true,
        durableTaskContext: this.buildExecutionContext(task, plan),
      };
    }

    let task = taskId ? this.manager.getTask(taskId) : null;
    if (task && analysisMode && (
      ["RECOVERABLE", "RECOVERING", "FAILED", "CANCELLED"].includes(task.status)
      || (input.freshAnalysisRun === true && AWAITING_STATES.has(task.status))
    )) {
      // Analisis nuevo: no reutilizar tarea rota ni plan stale.
      // COMPLETED se reabre abajo (conserva goal/plan) en vez de crear Task huérfana.
      task = null;
      taskId = "";
    }
    if (task && analysisMode && task.status === "COMPLETED" && input.freshAnalysisRun !== true) {
      this.manager.reopenTerminalTask(taskId, {
        reason: "CONTINUA/analisis sobre tarea COMPLETED prematura; reabriendo.",
      });
      task = this.manager.getTask(taskId);
    }
    if (task && !analysisMode && !planAuthorized && ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
      this.manager.reopenTerminalTask(taskId, {
        reason: "Continuacion del usuario sobre tarea terminal; reabriendo.",
      });
      task = this.manager.getTask(taskId);
    }
    if (!task) {
      if (!goal) throw new Error("La tarea requiere un objetivo valido.");
      task = this.manager.createTask({
        projectId,
        projectRoot,
        goal,
        originalRequest: goal,
        status: "CREATED",
        nextAction: { type: "ANALYZE", description: "Analizar el proyecto.", status: "PENDING" },
      });
      taskId = task.taskId;
    } else if (isAuthorizationGoal(rawGoal)) {
      throw Object.assign(new Error("No se puede crear ni continuar una tarea con goal de autorizacion sin taskId/plan."), { code: "WORKFLOW_INVALID_GOAL" });
    }

    if (analysisMode) {
      task = this.beginAnalysisRun(taskId, input);
    } else if (task && !EXECUTION_ACTIVE_STATES.has(task.status) && task.status !== "APPROVED") {
      const { canTransition } = require("./task-models");
      const targetStatus = canTransition(task.status, "IMPLEMENTING") ? "IMPLEMENTING"
        : canTransition(task.status, "EXECUTING") ? "EXECUTING"
          : "";
      if (targetStatus) {
        task = this.manager.transition(taskId, targetStatus, {
          currentStage: "implementation",
          nextAction: { type: "EXECUTE", description: "Ejecutar solicitud del usuario.", status: "RUNNING" },
        }, "EXECUTION_STARTED");
      }
    }

    return {
      taskId,
      task,
      plan: null,
      planId: task.planId || "",
      approvalId: "",
      goal: task.goal,
      analysisMode: analysisMode === true,
      planAuthorized: false,
      executionMode: analysisMode ? "ANALYSIS" : "DIRECT_EXECUTION",
      duplicateExecution: false,
      durableTaskContext: "",
    };
  }

  buildExecutionContext(task, plan) {
    if (!task) return "";
    const { formatFixQueueBlock, syncFixQueueWithSteps } = require("./fix-queue");
    const queue = Array.isArray(plan?.fixQueue) ? plan.fixQueue : [];
    const synced = syncFixQueueWithSteps(queue, [], "");
    return [
      "MEMORIA DURABLE DE LA TAREA ACTIVA:",
      `Solicitud original: ${task.goal || ""}`,
      plan?.content ? `Plan autorizado (${plan.planId}):\n${plan.content}` : "",
      queue.length ? formatFixQueueBlock(synced.queue, { focusOnly: true }) : "",
      `Estado: ${task.status}`,
      `PlanId: ${task.planId || plan?.planId || ""}`,
      `ApprovalId: ${task.approvalId || ""}`,
      "Continua desde este estado hasta completar y verificar la solicitud. No vuelvas a pedir autorizacion ni sustituyas la ejecucion por otro plan.",
      "DISPATCHER: un archivo de la cola a la vez (FOCO), mutacion + verificacion, luego el siguiente.",
    ].filter(Boolean).join("\n\n");
  }
}

module.exports = { WorkflowOrchestrator, isAuthorizationGoal, AWAITING_STATES, EXECUTION_ACTIVE_STATES };
