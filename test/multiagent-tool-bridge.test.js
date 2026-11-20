const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { MultiAgentSidecarManager } = require('../runtime/multiagent-sidecar-manager');
const { MultiAgentClient } = require('../runtime/multiagent-client');

describe('EditCore AI - MultiAgent Tool & Skill Bridge', () => {
  let manager;
  let client;
  const testPort = 55470;
  const testGatewayPort = 55490;
  const testDataDir = path.join(__dirname, 'fixtures', 'bridge_test_data');

  before(async () => {
    manager = new MultiAgentSidecarManager({
      port: testPort,
      gatewayPort: testGatewayPort,
      dataDir: testDataDir,
      projectRoot: path.resolve(__dirname, '..')
    });

    const info = await manager.start();
    assert.strictEqual(info.status, 'ready');
    client = new MultiAgentClient(manager.getEndpoint());
  });

  after(() => {
    if (manager) {
      manager.stop();
    }
    try {
      if (fs.existsSync(testDataDir)) {
        fs.rmSync(testDataDir, { recursive: true, force: true });
      }
    } catch (e) {}
  });

  test('Sidecar queries all 74 EditCore tools through gateway', async () => {
    const res = await client.getEditCoreTools();
    assert(res && Array.isArray(res.tools), 'Expected tools array');
    assert(res.tools.length >= 70, `Expected at least 70 tools, received ${res.tools.length}`);

    const toolNames = res.tools.map((t) => t.name);
    assert(toolNames.includes('git_status'));
    assert(toolNames.includes('git_commit'));
    assert(toolNames.includes('web_search'));
    assert(toolNames.includes('list_skills'));
    assert(toolNames.includes('supabase_migrate'));
  });

  test('Sidecar queries all installed EditCore skills through gateway', async () => {
    const res = await client.getEditCoreSkills();
    assert(res && Array.isArray(res.skills), 'Expected skills array');
    assert(res.skills.length >= 50, `Expected at least 50 skills, received ${res.skills.length}`);
  });

  test('Python agent executes EditCore git_status tool via gateway', async () => {
    const res = await client.executeEditCoreTool('git_status', {});
    assert(res.ok === true, 'Tool execution failed');
    assert(res.result && res.result.ok === true, 'git_status result not ok');
    assert(typeof res.result.output === 'string');
    assert(res.result.output.startsWith('##'));
  });

  test('Python agent executes EditCore list_skills tool via gateway', async () => {
    const res = await client.executeEditCoreTool('list_skills', {});
    assert(res.ok === true, 'Tool execution failed');
    assert(res.result && res.result.ok === true, 'list_skills result not ok');
    assert(typeof res.result.count === 'number' && res.result.count > 0);
  });
});
