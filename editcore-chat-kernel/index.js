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

const orchestrator = new ChatOrchestrator();

async function handleChat(input) {
  return orchestrator.handle(input || {});
}

function stopChat() {
  return orchestrator.stop();
}

module.exports = {
  handleChat,
  stopChat,
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
};