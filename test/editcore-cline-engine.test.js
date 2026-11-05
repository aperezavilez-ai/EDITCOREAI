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
  assert.ok(result.text.includes("Todo listo"));

  const createdFile = path.join(tmpDir, "test.txt");
  const content = await fs.readFile(createdFile, "utf-8");
  assert.strictEqual(content, "hola mundo");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineTools: list_files y run_command ejecutan limpiamente en Windows/Unix", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-cmd-"));
  await fs.writeFile(path.join(tmpDir, "fileA.txt"), "A", "utf-8");
  await fs.mkdir(path.join(tmpDir, "subDir"));

  const tools = new EditCoreClineTools(tmpDir);

  // 1. list_files
  const listRes = await tools.execute("list_files", { path: "." });
  assert.strictEqual(listRes.ok, true);
  assert.ok(Array.isArray(listRes.entries));
  const fileNames = listRes.entries.map((e) => e.name);
  assert.ok(fileNames.includes("fileA.txt"));
  assert.ok(fileNames.includes("subDir"));

  // 2. run_command exitoso con sanitización
  const echoRes = await tools.execute("run_command", { command: "node -e \"console.log('hola cline')\" 2>&1 | tail -5" });
  assert.strictEqual(echoRes.ok, true);
  assert.strictEqual(echoRes.exitCode, 0);
  assert.ok(echoRes.output.includes("hola cline"));

  // 3. run_command con fallo no revienta ni produce [object Object]
  const failRes = await tools.execute("run_command", { command: "node -e \"process.exit(2)\"" });
  assert.strictEqual(failRes.ok, false);
  assert.strictEqual(failRes.exitCode, 2);
  assert.strictEqual(typeof failRes.output, "string");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("isQuestionInput y isApprovalInput: clasificación de intenciones", () => {
  const { isQuestionInput, isApprovalInput } = require("../runtime/editcore-cline/index");

  // Preguntas / Diagnósticos
  assert.strictEqual(isQuestionInput("¿Por qué tanto error?"), true);
  assert.strictEqual(isQuestionInput("PORQUE PARAS"), true);
  assert.strictEqual(isQuestionInput("por que tanto error"), true);
  assert.strictEqual(isQuestionInput("¿Qué significa este error de build?"), true);
  assert.strictEqual(isQuestionInput("explícame qué pasó"), true);
  assert.strictEqual(isQuestionInput("cómo funciona el sistema"), true);

  // Aprobaciones explícitas
  assert.strictEqual(isApprovalInput("procede con el cambio"), true);
  assert.strictEqual(isApprovalInput("autorizo"), true);
  assert.strictEqual(isApprovalInput("continua"), true);
  assert.strictEqual(isApprovalInput("hazlo ahora"), true);
  assert.strictEqual(isApprovalInput("dale"), true);
  assert.strictEqual(isApprovalInput("adelante"), true);
});

test("EditCoreClineController: modo Solo Lectura bloquea mutaciones limpiamente", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  const mockCallChat = async ({ messages }) => {
    const last = messages[messages.length - 1];
    if (last.role === "tool") {
      return { text: "Entendido, modo solo lectura activo TASK_COMPLETE", toolCalls: [] };
    }
    return {
      text: "Intentando escribir",
      toolCalls: [{
        id: "call_ro_1",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: "test.txt", content: "data" })
        }
      }]
    };
  };

  const controller = new EditCoreClineController({
    callChat: mockCallChat
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-ro-"));
  const result = await controller.runTask({
    prompt: "Escribe test.txt",
    projectRoot: tmpDir,
    permissionMode: "readonly"
  });

  assert.strictEqual(result.ok, true);
  const toolMsg = result.messages.find(m => m.role === "tool");
  assert.ok(toolMsg.content.includes("Solo Lectura"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineController: uiBridge.requestApproval puede denegar mutaciones", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  const mockCallChat = async ({ messages }) => {
    const last = messages[messages.length - 1];
    if (last.role === "tool") {
      return {
        text: "Operación cancelada por el usuario. TASK_COMPLETE",
        toolCalls: []
      };
    }
    return {
      text: "Intentaré escribir el archivo",
      toolCalls: [{
        id: "call_mutation_1",
        function: {
          name: "write_file",
          arguments: JSON.stringify({ path: "seguridad.txt", content: "contenido" })
        }
      }]
    };
  };

  const controller = new EditCoreClineController({
    callChat: mockCallChat,
    uiBridge: {
      requestApproval: async () => false // Usuario deniega en la UI
    }
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-gate-"));
  const result = await controller.runTask({
    prompt: "Crea el archivo seguridad.txt",
    projectRoot: tmpDir,
    permissionMode: "step",
    fullAccess: false
  });

  assert.strictEqual(result.ok, true);
  const fileExists = await fs.access(path.join(tmpDir, "seguridad.txt")).then(() => true).catch(() => false);
  assert.strictEqual(fileExists, false);
  assert.ok(result.text.includes("cancelada"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineController: detección de bucle repetitivo corta llamadas idénticas", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  let loopCalls = 0;
  const mockCallChat = async () => {
    loopCalls++;
    return {
      text: "",
      toolCalls: [{
        id: `call_${loopCalls}`,
        function: {
          name: "list_files",
          arguments: JSON.stringify({ path: "." })
        }
      }]
    };
  };

  const controller = new EditCoreClineController({
    callChat: mockCallChat,
    maxTurns: 20
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-loop-"));
  const result = await controller.runTask({
    prompt: "lista archivos",
    projectRoot: tmpDir,
    permissionMode: "step",
    fullAccess: true
  });

  // Al 3er llamado idéntico detecta bucle y corta
  assert.ok(loopCalls <= 4, `Llamó ${loopCalls} veces, debe haber cortado por bucle`);
  const loopTool = result.messages.find(m => m.role === "tool" && m.content.includes("Bucle Detectado"));
  assert.ok(loopTool, "Debe registrar herramienta con Bucle Detectado");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineController: nunca devuelve JSON crudo de tools en finalText", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  const mockCallChat = async () => {
    return {
      text: "",
      toolCalls: [{
        id: "call_cmd_1",
        function: {
          name: "run_command",
          arguments: JSON.stringify({ command: "node -e \"process.exit(1)\"" })
        }
      }]
    };
  };

  const controller = new EditCoreClineController({
    callChat: mockCallChat,
    maxTurns: 1
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-rawjson-"));
  const result = await controller.runTask({
    prompt: "ejecuta build",
    projectRoot: tmpDir,
    permissionMode: "step"
  });

  assert.ok(!result.text.startsWith('{"'));
  assert.ok(!result.text.includes('"exitCode":'));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineTools: protección estricta contra escritura o lectura en carpetas (anti-EISDIR)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-eisdir-"));
  const subFolder = path.join(tmpDir, "src");
  await fs.mkdir(subFolder);

  const tools = new EditCoreClineTools(tmpDir);

  // 1. Escribir con ruta vacía o "." debe fallar
  await assert.rejects(
    async () => tools.writeFile("", "contenido"),
    /Ruta de archivo no especificada o inválida/
  );
  await assert.rejects(
    async () => tools.writeFile(".", "contenido"),
    /Ruta.*inv[aá]lida/i
  );

  // 2. Escribir directamente en la carpeta raíz o una subcarpeta debe fallar con error explicativo
  await assert.rejects(
    async () => tools.writeFile(tmpDir, "contenido"),
    /apunta a la ra[ií]z|es un directorio/i
  );
  await assert.rejects(
    async () => tools.writeFile("src", "contenido"),
    /es un directorio existente/
  );

  // 3. Leer una carpeta con read_file debe sugerir list_files
  await assert.rejects(
    async () => tools.readFile("src"),
    /es un directorio, no un archivo/
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineController: preserva y pasa imágenes en formato multimodal al modelo", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  let receivedMessages = [];
  const mockCallChat = async ({ messages }) => {
    receivedMessages = messages;
    return {
      text: "Veo la imagen claramente. TASK_COMPLETE",
      toolCalls: []
    };
  };

  const controller = new EditCoreClineController({ callChat: mockCallChat });
  const result = await controller.runTask({
    prompt: "Analiza esta captura",
    images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" }],
    permissionMode: "step"
  });

  assert.strictEqual(result.ok, true);
  const userMsg = receivedMessages.find((m) => m.role === "user");
  assert.ok(Array.isArray(userMsg.content), "El contenido del usuario debe ser un array multimodal");
  const textPart = userMsg.content.find((p) => p.type === "text");
  const imgPart = userMsg.content.find((p) => p.type === "image_url");
  assert.strictEqual(textPart.text, "Analiza esta captura");
  assert.ok(imgPart.image_url.url.startsWith("data:image/png;base64,"));
});

test("EditCoreClineTools: soporta creación y lectura de documentos (create_pdf, create_word)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-docs-"));
  const tools = new EditCoreClineTools(tmpDir);

  // 1. Crear PDF
  const pdfRes = await tools.execute("create_pdf", {
    path: "reporte.pdf",
    title: "Reporte Técnico",
    content: "Contenido del informe en PDF."
  });
  assert.strictEqual(pdfRes.ok, true);
  const pdfExists = await fs.access(path.join(tmpDir, "reporte.pdf")).then(() => true).catch(() => false);
  assert.strictEqual(pdfExists, true);

  // 2. Crear Word
  const wordRes = await tools.execute("create_word", {
    path: "documento.docx",
    title: "Documento Oficial",
    content: "Texto del documento oficial en Word."
  });
  assert.strictEqual(wordRes.ok, true);
  const wordExists = await fs.access(path.join(tmpDir, "documento.docx")).then(() => true).catch(() => false);
  assert.strictEqual(wordExists, true);

  // 3. Leer documento Word con readFile (debe extraer texto limpio)
  const readDoc = await tools.readFile("documento.docx");
  assert.strictEqual(readDoc.ok, true);
  assert.strictEqual(readDoc.format, "word-docx");
  assert.ok(readDoc.content.includes("Documento Oficial") || readDoc.content.includes("Texto del documento"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

