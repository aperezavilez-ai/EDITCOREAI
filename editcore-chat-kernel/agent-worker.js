"use strict";

/**
 * Worker Thread de subagentes EditCore.
 * Escucha mensajes de parentPort y ejecuta runAnalyst / runVerifier / runExplorer / vision
 * en un hilo secundario.
 */

const { parentPort } = require("worker_threads");

function post(msg) {
  try {
    parentPort?.postMessage(msg);
  } catch (_) { /* ignore */ }
}

function progressBridge() {
  return (info) => {
    post({
      status: "progress",
      phase: info?.phase || "tool",
      name: info?.name || "",
      text: info?.text || info?.message || "",
      ok: info?.ok,
    });
  };
}

function normalizeType(taskType) {
  const t = String(taskType || "").toUpperCase();
  if (t === "ANALYZE" || t === "ANALYST") return "analyst";
  if (t === "LIST" || t === "ASK" || t === "EXPLORER") return "explorer";
  if (t === "VERIFY" || t === "VERIFIER" || t === "BUILD") return "verifier";
  if (t === "VISION" || t === "UI" || t === "SCREENSHOT") return "vision";
  return String(taskType || "analyst").toLowerCase();
}

async function executeTask({ taskId, taskType, taskData }) {
  const data = taskData && typeof taskData === "object" ? taskData : {};
  const projectRoot = String(data.projectRoot || "").trim();
  const kind = normalizeType(taskType);

  post({
    status: "running",
    text: `Ejecutando subagente ${kind}…`,
    taskId,
  });

  if (!projectRoot) {
    post({ status: "failed", error: "projectRoot requerido", taskId });
    return;
  }

  const onProgress = progressBridge();

  try {
    if (kind === "analyst") {
      const { runAnalyst } = require("./subagents/analyst");
      const result = await runAnalyst({
        projectRoot,
        onProgress,
        maxReads: Number(data.maxReads) || 8,
      });
      post({
        status: "completed",
        kind: "ANALYZE",
        text: result?.summary || result?.report || "Análisis completado",
        result,
        taskId,
      });
      return;
    }

    if (kind === "explorer") {
      const { runExplorer } = require("./subagents/explorer");
      const { extractListTarget } = require("./classify");
      const target = data.target || (extractListTarget ? extractListTarget(data.message || "") : ".") || ".";
      const result = await runExplorer({
        projectRoot,
        target,
        onProgress,
        maxItems: Number(data.maxItems) || 50,
      });
      post({
        status: "completed",
        kind: "LIST",
        text: result?.summary || "Exploración completada",
        result,
        taskId,
      });
      return;
    }

    if (kind === "verifier") {
      const { runVerifier } = require("./subagents/verifier");
      const result = await runVerifier({
        projectRoot,
        command: data.command || null,
        onProgress,
        scope: String(data.scope || ""),
        autoRollback: data.autoRollback !== false,
        timeoutMs: Number(data.timeoutMs) || 60_000,
      });
      post({
        status: "completed",
        kind: "VERIFY",
        text: result?.ok
          ? "Verificación OK."
          : `Verificación falló: ${String(result?.result?.error || result?.result?.stderr || "").slice(0, 400)}`,
        result,
        taskId,
      });
      return;
    }

    if (kind === "vision") {
      const { capture_preview_screenshot, DEFAULT_PREVIEW_URL } = require("./vision-inspector");
      const result = await capture_preview_screenshot({
        url: data.url || DEFAULT_PREVIEW_URL || "http://127.0.0.1:4568/",
        projectRoot,
        viewport: data.viewport || "desktop",
      });
      const { screenshotAbs: _a, imageDataUrl: _i, ...safe } = result || {};
      post({
        status: "completed",
        kind: "VISION",
        text: result?.ok !== false
          ? "Captura de preview lista."
          : `Vision falló: ${String(result?.error || "").slice(0, 300)}`,
        result: safe,
        taskId,
      });
      return;
    }

    post({ status: "failed", error: `Tipo no soportado: ${kind}`, taskId });
  } catch (error) {
    post({
      status: "failed",
      error: String(error?.message || error).slice(0, 800),
      taskId,
    });
  }
}

if (!parentPort) {
  console.warn("[agent-worker] parentPort no disponible; este archivo debe ejecutarse como Worker Thread.");
} else {
  parentPort.on("message", (msg) => {
    const message = msg && typeof msg === "object" ? msg : {};
    if (message.type === "cancel") {
      post({ status: "failed", error: "Cancelado", taskId: message.taskId });
      return;
    }
    if (message.type === "ping") {
      post({ type: "pong", taskId: message.taskId });
      return;
    }
    if (message.type === "run" || message.taskType || message.taskData) {
      executeTask({
        taskId: message.taskId,
        taskType: message.taskType,
        taskData: message.taskData || message.input || {},
      }).catch((err) => {
        post({
          status: "failed",
          error: String(err?.message || err).slice(0, 800),
          taskId: message.taskId,
        });
      });
    }
  });

  post({ status: "ready", text: "agent-worker listo" });
}