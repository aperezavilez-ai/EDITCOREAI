"use strict";

function logWorkflow(event, fields = {}) {
  const parts = [
    `[WORKFLOW] event=${String(event || "UNKNOWN")}`,
    fields.taskId ? `taskId=${fields.taskId}` : "",
    fields.runId ? `runId=${fields.runId}` : "",
    fields.planId ? `planId=${fields.planId}` : "",
    fields.approvalId ? `approvalId=${fields.approvalId}` : "",
    fields.previousState ? `previousState=${fields.previousState}` : "",
    fields.nextState ? `nextState=${fields.nextState}` : "",
    fields.action ? `action=${fields.action}` : "",
    fields.tool ? `tool=${fields.tool}` : "",
    fields.error ? `error=${String(fields.error).slice(0, 200)}` : "",
    fields.provider ? `provider=${fields.provider}` : "",
    fields.model ? `model=${fields.model}` : "",
    fields.capability ? `capability=${fields.capability}` : "",
    fields.checkpointId ? `checkpointId=${fields.checkpointId}` : "",
    fields.agentId ? `agentId=${fields.agentId}` : "",
    `timestamp=${new Date().toISOString()}`,
  ].filter(Boolean);
  console.log(parts.join(" "));
}

module.exports = { logWorkflow };
