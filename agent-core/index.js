"use strict";

const { runAgent, planTask, CORE_VERSION } = require("./src/orchestrator");
const { classifyMode, extractPathsFromPrompt } = require("./src/modes");
const { verifyAndReport } = require("./src/verifier");
const { parseToolCalls, toolDefsForMode } = require("./src/llm-loop");

module.exports = {
  runAgent,
  planTask,
  classifyMode,
  classify: require("./src/classify").classify,
  isFullAccess: require("./src/classify").isFullAccess,
  extractPathsFromPrompt,
  extractCreateFileSpec: require("./src/modes").extractCreateFileSpec,
  extractReplaceSpec: require("./src/modes").extractReplaceSpec,
  extractReplaceSpecs: require("./src/modes").extractReplaceSpecs,
  extractDeleteSpec: require("./src/modes").extractDeleteSpec,
  extractSwapSpec: require("./src/modes").extractSwapSpec,
  extractVerifyCommand: require("./src/modes").extractVerifyCommand,
  verifyAndReport,
  parseToolCalls,
  toolDefsForMode,
  version: CORE_VERSION || "0.2.0",
};
