"use strict";

const { parentPort } = require("worker_threads");
const fs = require("node:fs");
const path = require("node:path");

// Integración con patch-engine del proyecto
let buildUnifiedDiff = null;
let createMutationCheckpoint = null;
try {
  ({ buildUnifiedDiff } = require("../../patch-engine"));
} catch {
  buildUnifiedDiff = null;
}

try {
  ({ createMutationCheckpoint } = require("../../runtime/mutation-checkpoint"));
} catch {
  createMutationCheckpoint = null;
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function processDiffTask(taskData = {}) {
  const { filePath, before, after, action = "diff", checkpoint = true } = taskData;

  if (!filePath || typeof filePath !== "string") {
    return { ok: false, error: "filePath is required" };
  }

  const resolvedPath = path.resolve(filePath);

  if (action === "diff") {
    const currentContent = fs.existsSync(resolvedPath) ? fs.readFileSync(resolvedPath, "utf8") : "";
    const diff = buildUnifiedDiff
      ? buildUnifiedDiff(resolvedPath, currentContent, after)
      : `--- a/${resolvedPath}\n+++ b/${resolvedPath}\n@@ Diff unavailable @@\n`;

    return {
      ok: true,
      action: "diff",
      filePath: resolvedPath,
      diff,
      exists: fs.existsSync(resolvedPath),
    };
  }

  if (action === "apply") {
    if (!createMutationCheckpoint) {
      return { ok: false, error: "mutation-checkpoint unavailable" };
    }

    const checkpointResult = createMutationCheckpoint({
      filePath: resolvedPath,
      content: after,
    });

    if (!checkpointResult.ok) {
      return {
        ok: false,
        error: checkpointResult.reason || "checkpoint-failed",
        checkpoint: checkpointResult,
      };
    }

    return {
      ok: true,
      action: "apply",
      filePath: resolvedPath,
      checkpoint: checkpointResult,
      applied: !checkpointResult.skipped,
    };
  }

  return { ok: false, error: `Unknown action: ${action}` };
}

parentPort.on("message", async (message) => {
  if (!message || message.type !== "TASK") {
    parentPort.postMessage({ type: "ERROR", error: "Invalid message format" });
    return;
  }

  try {
    const result = await processDiffTask(message.payload || {});
    parentPort.postMessage({
      type: "RESULT",
      taskId: message.taskId,
      result,
    });
  } catch (error) {
    parentPort.postMessage({
      type: "ERROR",
      taskId: message.taskId,
      error: error && error.message ? error.message : String(error),
    });
  }
});

parentPort.postMessage({ type: "READY" });
