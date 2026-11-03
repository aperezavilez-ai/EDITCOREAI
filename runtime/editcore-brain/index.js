"use strict";

/**
 * EDITCORE BRAIN - Public Module Interface
 */

const { EditCoreBrain } = require("./brain-core");
const { BrainMessageBuilder } = require("./message-builder");
const { AtomicFileEditor } = require("./file-editor");
const { DynamicAgentCoordinator } = require("./agent-coordinator");
const { BrainProviderGateway } = require("./provider-gateway");
const { BrainState, AgentRole, PermissionMode } = require("./types");

module.exports = {
  EditCoreBrain,
  BrainMessageBuilder,
  AtomicFileEditor,
  DynamicAgentCoordinator,
  BrainProviderGateway,
  BrainState,
  AgentRole,
  PermissionMode,
};
