const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { MultiAgentSidecarManager } = require('../runtime/multiagent-sidecar-manager');
const { MultiAgentClient } = require('../runtime/multiagent-client');

describe('EditCore AI - MultiAgent Engine Integration', () => {
  let manager;
  let client;
  const testPort = 55440;
  const testGatewayPort = 55460;

  before(async () => {
    manager = new MultiAgentSidecarManager({
      port: testPort,
      gatewayPort: testGatewayPort,
      dataDir: path.join(__dirname, 'fixtures', 'multiagent_test_data')
    });
    const info = await manager.start();
    assert.strictEqual(info.status, 'ready');
    assert.strictEqual(info.port, testPort);

    client = new MultiAgentClient(manager.getEndpoint());
  });

  const testDataDir = path.join(__dirname, 'fixtures', 'multiagent_test_data');

  after(() => {
    if (manager) {
      manager.stop();
    }
    try {
      const fs = require('fs');
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch (e) {}
  });

  test('Sidecar reports healthy status and engine metadata', async () => {
    const health = await client.getHealth();
    assert.strictEqual(health.status, 'healthy');
    assert.strictEqual(health.engine, 'Agno + OpenHands Core');
    assert.strictEqual(health.version, '1.0.0');
    assert.strictEqual(typeof health.memory_mb, 'number');
  });

  test('Registry lists all specialized agents', async () => {
    const res = await client.listAgents();
    assert(Array.isArray(res.agents));
    assert(res.agents.length >= 8);

    const roles = res.agents.map((a) => a.name);
    assert(roles.includes('Architect'));
    assert(roles.includes('Developer'));
    assert(roles.includes('QA'));
    assert(roles.includes('Security'));
    assert(roles.includes('Analyst'));
  });

  let testTaskId;

  test('Submits task and executes full multi-agent pipeline', async () => {
    testTaskId = 'INTEG_TASK_' + Date.now();
    const subRes = await client.submitTask({
      taskId: testTaskId,
      title: 'Fullstack Service Pipeline',
      spec: 'Create robust service with business logic and automated test runner'
    });
    assert.strictEqual(subRes.status, 'QUEUED');
    assert.strictEqual(subRes.task_id, testTaskId);

    // Poll until completed (up to 10s)
    let finalTask = null;
    for (let i = 0; i < 40; i++) {
      const t = await client.getTask(testTaskId);
      if (t.status === 'COMPLETED' || t.status === 'FAILED') {
        finalTask = t;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    assert(finalTask !== null, 'Task did not reach terminal state');
    assert.strictEqual(finalTask.status, 'COMPLETED');

    // Verify all checkpoints reached
    const checkpoints = finalTask.checkpoints.map((c) => c.checkpoint);
    assert(checkpoints.includes('PLANNING'));
    assert(checkpoints.includes('CODED'));
    assert(checkpoints.includes('ANALYZED'));
    assert(checkpoints.includes('AUDITED'));
    assert(checkpoints.includes('VALIDATED'));

    // Verify output payload
    const output = finalTask.output_data;
    assert(output !== null);
    assert.strictEqual(output.qa_verdict.verdict, 'PASS');
    assert.strictEqual(output.security.security_clearance, true);
    assert(Array.isArray(output.files));
    assert(output.files.includes('service.py'));
  });

  test('Retrieves agent communication messages for task audit', async () => {
    const res = await client.getMessages(testTaskId);
    assert(Array.isArray(res.messages));
    assert(res.messages.length > 0);

    const topics = res.messages.map((m) => m.topic);
    assert(topics.includes('planning:start'));
    assert(topics.includes('task:delegate'));
    assert(topics.includes('qa:verdict'));
  });
});
