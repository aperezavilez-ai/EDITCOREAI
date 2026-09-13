"use strict";

function registerTaskIpc(ipcMain, manager, recovery, workflow = null) {
  if (!ipcMain?.handle || !manager || !recovery) throw new Error("No se pudo registrar Task IPC.");
  const handlers = {
    "task:create": (_event, input = {}) => manager.createTask(input),
    "task:get": (_event, taskId) => manager.getTask(taskId),
    "task:list": (_event, filter = {}) => manager.listTasks(filter),
    "task:update": (_event, taskId, patch = {}) => manager.updateTask(taskId, patch || {}),
    "task:pause": (_event, taskId) => manager.pauseTask(taskId),
    "task:resume": (_event, taskId) => manager.resumeTask(taskId),
    "task:cancel": (_event, taskId) => manager.cancelTask(taskId),
    "task:retry": (_event, taskId) => manager.retryTask(taskId),
    "task:events": (_event, taskId, options = {}) => manager.getEvents(taskId, options),
    "task:checkpoint": (_event, taskId) => manager.getCheckpoint(taskId),
    "task:status": (_event, taskId) => {
      if (workflow) {
        const durable = workflow.describeWorkflow(taskId);
        if (durable) return durable;
      }
      const description = recovery.describe(taskId);
      if (!description) return null;
      const task = manager.getTask(taskId);
      const plan = task?.planId ? manager.store.getPlan(taskId, task.planId) : manager.store.getLatestPlan(taskId);
      return {
        ...description,
        taskGoal: task?.goal || "",
        persistedPlan: plan?.content || "",
        planId: task?.planId || plan?.planId || "",
        approvalId: task?.approvalId || "",
        awaitingAuthorization: task?.status === "AWAITING_AUTHORIZATION",
      };
    },
    "task:recoverable": () => manager.listRecoverableTasks().map((task) => recovery.describe(task.taskId)),
    "workflow:describe": (_event, taskId) => workflow?.describeWorkflow(taskId) || null,
    "workflow:find-awaiting": (_event, filter = {}) => workflow?.findAwaitingTask(filter) || null,
    "workflow:approve": (_event, input = {}) => workflow?.recordPlanApproval(
      String(input.taskId || ""),
      String(input.planId || ""),
      input,
    ) || null,
    "workflow:persist-plan": (_event, input = {}) => {
      if (!workflow) return null;
      let taskId = String(input.taskId || "").trim();
      if (!taskId) {
        const task = manager.createTask({
          projectId: String(input.projectId || ""),
          projectRoot: String(input.projectRoot || ""),
          goal: String(input.goal || input.task || "Analisis autorizado"),
          originalRequest: String(input.goal || input.task || "Analisis autorizado"),
          status: "CREATED",
          nextAction: { type: "ANALYZE", description: "Plan listo para autorizacion.", status: "PENDING" },
        });
        taskId = task.taskId;
      }
      const current = manager.getTask(taskId);
      if (current && ["CREATED", "READY", "RECOVERABLE"].includes(current.status)) {
        try {
          manager.transition(taskId, "ANALYZING", { currentStage: "analysis" }, "ANALYSIS_STARTED");
        } catch { /* ignore */ }
      }
      const plan = workflow.persistPlan(taskId, {
        projectId: String(input.projectId || ""),
        content: String(input.content || input.plan || ""),
        summary: String(input.summary || input.content || input.plan || "").slice(0, 4000),
        status: "PENDING_APPROVAL",
        fixQueue: Array.isArray(input.fixQueue) ? input.fixQueue : undefined,
        planId: input.planId || undefined,
      });
      return { taskId, planId: plan?.planId || "", plan, workflow: workflow.describeWorkflow(taskId) };
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler);
  return Object.keys(handlers);
}

module.exports = { registerTaskIpc };
