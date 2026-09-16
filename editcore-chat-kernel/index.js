"use strict";

/**
 * Núcleo de chat EditCore — entrada única.
 *
 *   const { handleChat, stopChat } = require("./editcore-chat-kernel");
 *   const out = await handleChat({ message, projectRoot, apiBaseUrl, apiKey, model, onProgress });
 */

const { ChatOrchestrator } = require("./orchestrator");
const { classify } = require("./classify");
const { SKILL_IDS } = require("./skills-catalog");
const { uiDesignSystemPrompt } = require("./ui-design-prompt");
const { scaffoldNextApp } = require("./scaffold");
const { detectDevLogIssue } = require("./dev-log-detector");
const tools = require("./tools");
const snapshot = require("./snapshot");
const processRunner = require("./process-runner");
const visionInspector = require("./vision-inspector");
const globalMemory = require("./global-memory");
const taskQueue = require("./task-queue");
const threadCore = require("./thread-core");
const threadMemory = require("./thread-memory");
const modelRouter = require("./model-router");
const agentBus = require("./agent-bus");

const orchestrator = new ChatOrchestrator();

// 🔒 Lock serializado: impide que dos mensajes concurrentes pisen el estado
// interno del orchestrator (abort, turnAbort, _currentUserText, _threadId).
let _chain = Promise.resolve();

async function handleChat(input) {
  const prev = _chain;
  let release;
  _chain = new Promise((r) => { release = r; });
  await prev;
  try {
    if (orchestrator.isRunning()) {
      return {
        kind: "CHAT",
        text: "Hay un proceso activo. Envía **detente** para cancelarlo antes de mandar otro mensaje.",
        blocked: true,
      };
    }
    return await orchestrator.handle(input || {});
  } finally {
    release();
  }
}

function stopChat() {
  return orchestrator.stop();
}

function steerChat(instruction) {
  return orchestrator.steer(instruction);
}

function isChatRunning() {
  return orchestrator.isRunning();
}

module.exports = {
  handleChat,
  stopChat,
  steerChat,
  isChatRunning,
  classify,
  SKILL_IDS,
  ChatOrchestrator,
  taskQueue,
  uiDesignSystemPrompt,
  scaffoldNextApp,
  detectDevLogIssue,
  TOOL_RESULT_CAP: tools.TOOL_RESULT_CAP,
  tools,
  snapshot,
  rollbackLastChange: snapshot.rollbackLastChange,
  listSnapshots: snapshot.listSnapshots,
  processRunner,
  runProcess: processRunner.runProcess,
  visionInspector,
  capture_preview_screenshot: visionInspector.capture_preview_screenshot,
  globalMemory,
  recordSolution: globalMemory.recordSolution,
  globalMemoryPrompt: globalMemory.promptBlock,
  threadCore,
  threadMemory,
  modelRouter,
  agentBus,
};