"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  EditCoreBrain,
  BrainMessageBuilder,
  AtomicFileEditor,
  DynamicAgentCoordinator,
  BrainState,
  AgentRole
} = require("../runtime/editcore-brain/index");

test("BrainMessageBuilder: Poda lecturas duplicadas y preserva anclaje", () => {
  const builder = new BrainMessageBuilder({ maxToolResultChars: 120 });
  const transcript = [
    { role: "system", content: "Prompt base" },
    { role: "user", content: "Revisa server.js" },
    { role: "tool", name: "read_file", content: JSON.stringify({ path: "server.js", content: "const a = 1;" }) },
    { role: "assistant", content: "analizando..." },
    { role: "tool", name: "read_file", content: JSON.stringify({ path: "server.js", content: "const a = 2;" }) },
    { role: "tool", name: "run_command", content: "X".repeat(500) }
  ];

  const safe = builder.buildSafeTranscript(transcript);
  assert.strictEqual(safe.length, 6);
  // La primera lectura de server.js debe quedar compactada
  assert.ok(safe[2].content.includes("lectura previa compactada"));
  // La segunda lectura de server.js debe permanecer intacta
  assert.ok(safe[4].content.includes("const a = 2;"));
  // La salida del comando debe estar acotada con marcador
  assert.ok(safe[5].content.includes("caracteres truncados"));
});

test("AtomicFileEditor: Edición quirúrgica precisa con detección de EOL", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-file-test-"));
  const editor = new AtomicFileEditor(tmpDir);

  // 1. Escritura inicial
  await editor.writeFile("index.ts", "export const PORT = 3000;\nexport const HOST = 'localhost';\n");

  // 2. Reemplazo quirúrgico exacto
  const result = await editor.replaceInFile("index.ts", "export const PORT = 3000;", "export const PORT = 8080;");
  assert.strictEqual(result.ok, true);
  assert.ok(result.diff.includes("-1: export const PORT = 3000;"));
  assert.ok(result.diff.includes("+1: export const PORT = 8080;"));

  const finalContent = await fs.readFile(path.join(tmpDir, "index.ts"), "utf-8");
  assert.ok(finalContent.includes("PORT = 8080;"));

  // 3. Fallo controlado si el old_text no existe
  await assert.rejects(
    async () => editor.replaceInFile("index.ts", "INEXISTENTE", "OTRO"),
    /Texto no encontrado/
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("DynamicAgentCoordinator: Selección de roles especializados", () => {
  const coordinator = new DynamicAgentCoordinator();

  assert.strictEqual(coordinator.determineRequiredRole("Tengo un error de TypeError: undefined is not a function"), AgentRole.DEBUGGER);
  assert.strictEqual(coordinator.determineRequiredRole("Corre los tests y verifica el coverage"), AgentRole.QA_VERIFIER);
  assert.strictEqual(coordinator.determineRequiredRole("Diseña la tabla de usuarios en postgres con RLS"), AgentRole.DATABASE);
  assert.strictEqual(coordinator.determineRequiredRole("Centra este botón y ajusta el responsive en mobile"), AgentRole.FRONTEND);
  assert.strictEqual(coordinator.determineRequiredRole("Crea una función para calcular el IVA"), AgentRole.DEVELOPER);
});

test("EditCoreBrain: Ciclo autónomo de ejecución con verificación y aprobación", async () => {
  let approvalPrompted = false;
  const mockCallChat = async ({ messages }) => {
    const last = messages[messages.length - 1];
    if (last.role === "tool") {
      return { text: "Operación exitosa TASK_COMPLETE", toolCalls: [] };
    }
    return {
      text: "Creando archivo de configuración",
      toolCalls: [{
        id: "call_abc",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: "config.json", content: '{"status":"ok"}' })
        }
      }]
    };
  };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "brain-core-test-"));
  const brain = new EditCoreBrain({
    callChat: mockCallChat,
    uiBridge: {
      requestApproval: async () => {
        approvalPrompted = true;
        return true;
      }
    }
  });

  const res = await brain.executeTask({
    prompt: "Genera config.json",
    projectRoot: tmpDir,
    apiKey: "test-key",
    model: "test-model"
  });

  assert.strictEqual(res.ok, true);
  assert.strictEqual(approvalPrompted, true);
  assert.strictEqual(brain.state, BrainState.DONE);

  const fileExists = await fs.readFile(path.join(tmpDir, "config.json"), "utf-8");
  assert.strictEqual(fileExists, '{"status":"ok"}');

  await fs.rm(tmpDir, { recursive: true, force: true });
});
