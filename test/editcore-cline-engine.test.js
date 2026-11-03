"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  EditCoreClineController,
  ContextCompactor,
  EditCoreClineTools,
  buildEditCoreSystemPrompt
} = require("../runtime/editcore-cline/index");

test("ContextCompactor: poda lecturas obsoletas y trunca outputs masivos", () => {
  const compactor = new ContextCompactor({ maxToolResultChars: 100 });
  const rawMessages = [
    { role: "system", content: "system" },
    { role: "user", content: "read file" },
    { role: "tool", name: "read_file", content: JSON.stringify({ path: "app.js", data: "v1" }) },
    { role: "assistant", content: "modificando" },
    { role: "tool", name: "read_file", content: JSON.stringify({ path: "app.js", data: "v2" }) },
    { role: "tool", name: "list_files", content: "A".repeat(500) }
  ];

  const compacted = compactor.compactMessages(rawMessages);
  assert.strictEqual(compacted.length, 6);
  // La primera lectura de app.js debe estar marcada como obsoleta
  assert.ok(compacted[2].content.includes("lectura anterior compactada"));
  // La salida de list_files debe estar truncada a ~100 caracteres con marcador
  assert.ok(compacted[5].content.includes("caracteres truncados"));
});

test("EditCoreClineTools: replace_in_file preciso y atómico", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-test-"));
  const testFile = path.join(tmpDir, "sample.txt");
  await fs.writeFile(testFile, "const x = 10;\nconst y = 20;\n", "utf-8");

  const tools = new EditCoreClineTools(tmpDir);

  // 1. Reemplazo exitoso
  const res = await tools.replaceInFile("sample.txt", "const y = 20;", "const y = 30;");
  assert.strictEqual(res.ok, true);
  assert.ok(res.diff.includes("-2: const y = 20;"));
  assert.ok(res.diff.includes("+2: const y = 30;"));

  const updatedContent = await fs.readFile(testFile, "utf-8");
  assert.strictEqual(updatedContent, "const x = 10;\nconst y = 30;\n");

  // 2. Error si no se encuentra
  await assert.rejects(
    async () => tools.replaceInFile("sample.txt", "inexistente", "nuevo"),
    /Texto no encontrado/
  );

  // Limpieza
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineController: ejecuta máquina de estados con aprobación y completion", async () => {
  let approvalRequested = false;
  const mockCallChat = async ({ messages }) => {
    const last = messages[messages.length - 1];
    if (last.role === "tool") {
      return { text: "Todo listo TASK_COMPLETE", toolCalls: [] };
    }
    return {
      text: "Modificaré el archivo",
      toolCalls: [{
        id: "call_1",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: "test.txt", content: "hola mundo" })
        }
      }]
    };
  };

  const controller = new EditCoreClineController({
    callChat: mockCallChat,
    uiBridge: {
      requestApproval: async () => {
        approvalRequested = true;
        return true;
      }
    }
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-ctrl-"));
  const result = await controller.runTask({
    prompt: "Crea test.txt",
    projectRoot: tmpDir,
    permissionMode: "step",
    fullAccess: false
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(approvalRequested, true);
  assert.ok(result.text.includes("TASK_COMPLETE"));

  const createdFile = path.join(tmpDir, "test.txt");
  const content = await fs.readFile(createdFile, "utf-8");
  assert.strictEqual(content, "hola mundo");

  await fs.rm(tmpDir, { recursive: true, force: true });
});
