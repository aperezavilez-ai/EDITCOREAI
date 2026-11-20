"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { handleChatKernel } = require("../runtime/chat-kernel-bridge");

test("chat-kernel-bridge: enruta correctamente hacia EditCore Brain cuando se solicita", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-brain-test-"));
  
  let approvalCalled = false;
  const mockCallChat = async ({ messages }) => {
    const last = messages[messages.length - 1];
    if (last.role === "tool") {
      return { text: "Brain completó la tarea TASK_COMPLETE", toolCalls: [] };
    }
    return {
      text: "Modificando archivo vía bridge",
      toolCalls: [{
        id: "call_bridge_1",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: "bridge-result.txt", content: "ok from brain" })
        }
      }]
    };
  };

  // Reemplazar temporalmente provider gateway para la prueba
  const { EditCoreBrain } = require("../runtime/editcore-brain");
  const origRequestTurn = EditCoreBrain.prototype.executeTask;

  const res = await handleChatKernel({
    message: "Genera bridge-result.txt",
    projectRoot: tmpDir,
    apiKey: "test-key",
    model: "test-model",
    helpers: {
      useEditCoreBrain: true,
      callChat: mockCallChat,
      requestApproval: async () => {
        approvalCalled = true;
        return true;
      }
    }
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.brain, true);
  assert.ok(res.text.includes("Brain completó la tarea"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});
