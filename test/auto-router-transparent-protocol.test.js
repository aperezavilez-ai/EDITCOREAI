"use strict";

const assert = require("assert");
const Protocol = require("../runtime/auto-router-transparent-protocol");
const Elite = require("../runtime/elite-communication-policy");
const AutoModel = require("../auto-model-selection");

const raw = Protocol.withAutoRouterTransparentProtocol("Eres agente.");
assert.ok(Protocol.hasAutoRouterProtocol(raw), "protocol marker present");
assert.ok(raw.includes("Diagnóstico") || raw.includes("Paso 1"), "diagnose step present");
assert.ok(raw.includes("CUMPLIMIENTO DE STREAMING"), "streaming compliance present");

const viaElite = Elite.withEliteCommunicationPolicy("Responde en español.");
assert.ok(Protocol.hasAutoRouterProtocol(viaElite), "elite wraps auto-router protocol");
assert.strictEqual(
  (viaElite.match(/AUTO_ROUTER_TRANSPARENT_PROTOCOL_V1/g) || []).length,
  1,
  "protocol not duplicated via elite",
);

const viaAuto = AutoModel.withTransparentAgentProtocol("Auto mode test");
assert.ok(Protocol.hasAutoRouterProtocol(viaAuto), "auto-model helper injects protocol");

console.log("auto-router-transparent-protocol.test.js OK");
