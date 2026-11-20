/**
 * EditCore AI - MultiAgent IPC Handlers
 * Exposes multiagent engine operations to Electron renderer processes.
 */

const { MultiAgentSidecarManager } = require('./multiagent-sidecar-manager');
const { MultiAgentClient } = require('./multiagent-client');

let sidecarManager = null;
let sidecarClient = null;

async function ensureSidecar() {
  if (!sidecarManager) {
    sidecarManager = new MultiAgentSidecarManager();
  }
  if (!sidecarManager.isReady) {
    await sidecarManager.start();
    sidecarClient = new MultiAgentClient(sidecarManager.getEndpoint());
  }
  return { manager: sidecarManager, client: sidecarClient };
}

function registerMultiAgentIpc(ipcMain) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') return;

  ipcMain.handle('multiagent:health', async () => {
    try {
      const { client } = await ensureSidecar();
      return await client.getHealth();
    } catch (err) {
      return { status: 'offline', error: err.message };
    }
  });

  ipcMain.handle('multiagent:agents', async () => {
    const { client } = await ensureSidecar();
    return await client.listAgents();
  });

  ipcMain.handle('multiagent:submit', async (_event, input = {}) => {
    const { client } = await ensureSidecar();
    const taskId = input.taskId || `TASK_${Date.now()}`;
    return await client.submitTask({
      taskId,
      title: input.title || 'MultiAgent Task',
      spec: input.spec || ''
    });
  });

  ipcMain.handle('multiagent:status', async (_event, input = {}) => {
    const { client } = await ensureSidecar();
    return await client.getTask(input.taskId);
  });

  ipcMain.handle('multiagent:tasks', async (_event, input = {}) => {
    const { client } = await ensureSidecar();
    return await client.listTasks(input.limit || 50);
  });

  ipcMain.handle('multiagent:messages', async (_event, input = {}) => {
    const { client } = await ensureSidecar();
    return await client.getMessages(input.taskId);
  });

  ipcMain.handle('multiagent:cancel', async (_event, input = {}) => {
    const { client } = await ensureSidecar();
    return await client.cancelTask(input.taskId);
  });
}

function stopMultiAgentSidecar() {
  if (sidecarManager) {
    sidecarManager.stop();
  }
}

module.exports = {
  registerMultiAgentIpc,
  stopMultiAgentSidecar,
  ensureSidecar
};
