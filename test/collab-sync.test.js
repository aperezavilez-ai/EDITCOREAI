/**
 * test/collab-sync.test.js
 * Unit tests for CollabSyncManager and CRDTDocument (Ciclo 31)
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { CRDTDocument, CollabSyncManager } = require("../runtime/collab-sync.js");

describe("Cycle 31: Real-Time Collab Sync (CRDTs)", () => {
  test("CRDTDocument handles insertions and deletions with deterministic convergence", () => {
    const doc1 = new CRDTDocument("doc-1", "node-a");
    const doc2 = new CRDTDocument("doc-1", "node-b");

    doc1.setText("Hello World");
    doc2.setText("Hello World");

    assert.strictEqual(doc1.getText(), "Hello World");

    // Node A inserts " Great" at position 5
    const insertOps = doc1.insert(5, " Great", "node-a");
    assert.strictEqual(doc1.getText(), "Hello Great World");

    // Replicate insert ops to Node B
    for (const op of insertOps) {
      doc2.applyRemoteOp(op);
    }
    assert.strictEqual(doc2.getText(), "Hello Great World");

    // Node B deletes " Great"
    const deleteOps = doc2.delete(5, 6, "node-b");
    assert.strictEqual(doc2.getText(), "Hello World");

    // Replicate delete ops to Node A
    for (const op of deleteOps) {
      doc1.applyRemoteOp(op);
    }
    assert.strictEqual(doc1.getText(), "Hello World");
  });

  test("CollabSyncManager manages sessions, peer presence and cursor tracking", () => {
    const manager = new CollabSyncManager();

    const session = manager.createSession({
      docId: "main.js",
      initialText: "const a = 10;",
      siteId: "host-1",
    });

    assert.ok(session.sessionId);
    assert.strictEqual(manager.getDocumentText(session.sessionId), "const a = 10;");

    // Join peer
    const joinRes = manager.joinSession(session.sessionId, "peer-2", { name: "Alice" });
    assert.strictEqual(joinRes.peers.length, 2);

    // Update cursor
    const cursorUpdated = manager.updateCursor(session.sessionId, "peer-2", { line: 5, column: 12 });
    assert.strictEqual(cursorUpdated, true);

    const peers = manager.getPeers(session.sessionId);
    const alice = peers.find((p) => p.siteId === "peer-2");
    assert.ok(alice);
    assert.strictEqual(alice.cursor.line, 5);

    // Apply operation through manager
    const opRes = manager.applyOperation(session.sessionId, {
      type: "insert",
      position: 13,
      text: "\nconsole.log(a);",
      siteId: "peer-2",
    });

    assert.strictEqual(opRes.success, true);
    assert.strictEqual(manager.getDocumentText(session.sessionId), "const a = 10;\nconsole.log(a);");

    // Peer leaves
    const left = manager.leaveSession(session.sessionId, "peer-2");
    assert.strictEqual(left, true);
    assert.strictEqual(manager.getPeers(session.sessionId).length, 1);
  });
});
