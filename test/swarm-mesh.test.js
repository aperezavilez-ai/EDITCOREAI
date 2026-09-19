"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { swarmMesh } = require("../runtime/swarm-mesh");

test("Ciclo 45: Cloud-Native Swarm Mesh Network", () => {
  const meshInfo = swarmMesh.startMesh(9876, "editcore-test-mesh");
  assert.equal(meshInfo.status, "ONLINE");
  assert.ok(meshInfo.nodeId);

  const peer = swarmMesh.connectPeer({ name: "Worker-Alpha", port: 9878, role: "WORKER" });
  assert.ok(peer.id);
  assert.equal(peer.status, "CONNECTED");

  const block = swarmMesh.proposeConsensusBlock({ astMutation: "ADD_SYMBOL", symbol: "OmegaModule" });
  assert.ok(block.hash);
  assert.equal(block.status, "COMMITTED");
  assert.ok(block.votesReceived >= 2);

  const topo = swarmMesh.getMeshTopology();
  assert.ok(topo.totalPeers >= 2);
  assert.equal(topo.consensusBlocksCommitted, 1);
});
