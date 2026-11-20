const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { handleChatKernel, isChatKernelRunning } = require('../runtime/chat-kernel-bridge');
const { stopMultiAgentSidecar } = require('../runtime/multiagent-ipc');

describe('EditCore AI - Single Brain MultiAgent Engine', () => {
  after(() => {
    stopMultiAgentSidecar();
  });

  test('handleChatKernel runs order through autonomous MultiAgent engine', async () => {
    const progressList = [];
    const out = await handleChatKernel({
      message: 'Desarrolla e inspecciona el servicio de inventario',
      projectRoot: path.resolve(__dirname, '..'),
      onProgress: (p) => {
        progressList.push(p);
      }
    });

    assert(out, 'Expected result from handleChatKernel');
    assert.strictEqual(out.kernel, true);
    assert.strictEqual(out.kind, 'DONE');
    assert(typeof out.text === 'string');
    assert(out.text.includes('Motor Multiagente de EditCoreAI'));
    assert(out.text.includes('Archivos generados/modificados'));
    assert(out.text.includes('Auditoría de Seguridad'));
    assert(out.text.includes('Control de Calidad (QA)'));

    // Verify progress events were streamed
    assert(progressList.length > 0, 'Expected live progress events streamed');
    console.log(`Streamed ${progressList.length} progress events. Final output:\n${out.text.slice(0, 180)}...`);
  });
});
