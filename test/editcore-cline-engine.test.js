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

test("isQuestionInput y isApprovalInput: clasificación precisa de intenciones", () => {
  const { isQuestionInput, isApprovalInput } = require("../runtime/editcore-cline/index");

  // Preguntas / Diagnósticos
  assert.strictEqual(isQuestionInput("¿Por qué tanto error?"), true);
  assert.strictEqual(isQuestionInput("PORQUE PARAS"), true);
  assert.strictEqual(isQuestionInput("por que tanto error"), true);
  assert.strictEqual(isQuestionInput("¿Qué significa este error de build?"), true);
  assert.strictEqual(isQuestionInput("explícame qué pasó"), true);
  assert.strictEqual(isQuestionInput("cómo funciona el sistema"), true);
  assert.strictEqual(isQuestionInput("analiza este código"), true);

  // Aprobaciones explícitas
  assert.strictEqual(isApprovalInput("procede con el cambio"), true);
  assert.strictEqual(isApprovalInput("autorizo"), true);
  assert.strictEqual(isApprovalInput("continua"), true);
  assert.strictEqual(isApprovalInput("hazlo ahora"), true);
  assert.strictEqual(isApprovalInput("dale"), true);
  assert.strictEqual(isApprovalInput("adelante"), true);
  assert.strictEqual(isApprovalInput("sí, procede"), true);

  // Instrucciones sin aprobación previa
  assert.strictEqual(isApprovalInput("Crea el archivo POSView.tsx"), false);
  assert.strictEqual(isApprovalInput("Corrige el fallo"), false);
  assert.strictEqual(isQuestionInput("Crea el archivo POSView.tsx"), false);
});

test("EditCoreClineController: en modo Pregunta no ofrece herramientas de mutación y responde técnicamente", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");
  let offeredTools = [];

  const mockCallChat = async ({ messages, tools }) => {
    offeredTools = tools ? tools.map(t => t.function?.name) : [];
    return {
      text: "El error se debe a un template literal no cerrado en la línea 346 de POSView.tsx. Para corregirlo, escribe 'procede' o 'autorizo'. TASK_COMPLETE",
      toolCalls: []
    };
  };

  const controller = new EditCoreClineController({
    callChat: mockCallChat
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-question-"));
  const result = await controller.runTask({
    prompt: "¿Por qué tanto error en el build?",
    projectRoot: tmpDir,
    permissionMode: "step"
  });

  assert.strictEqual(result.ok, true);
  // Ninguna herramienta mutante (write_file, replace_in_file, run_command) fue ofrecida
  assert.ok(!offeredTools.includes("write_file"));
  assert.ok(!offeredTools.includes("replace_in_file"));
  assert.ok(!offeredTools.includes("run_command"));
  // Respondió la explicación técnica limpia
  assert.ok(result.text.includes("template literal"));
  assert.ok(!result.text.includes("{"));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineController: compuerta de aprobación bloquea mutación en step mode si no hay 'procede' o 'autorizo'", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  let toolExecuted = false;
  const mockCallChat = async ({ messages }) => {
    const last = messages[messages.length - 1];
    if (last.role === "tool") {
      // El asistente nota que la herramienta fue bloqueada esperando autorización
      return {
        text: "He preparado el plan para crear el archivo. Responde con 'procede' o 'autorizo' para aplicarlo. TASK_COMPLETE",
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
      requestApproval: async () => false // No aprobado en UI
    }
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-gate-"));
  const result = await controller.runTask({
    prompt: "Crea el archivo seguridad.txt", // No contiene "procede" ni "autorizo"
    projectRoot: tmpDir,
    permissionMode: "step",
    fullAccess: false
  });

  assert.strictEqual(result.ok, true);
  // El archivo NO debe haber sido creado en disco
  const fileExists = await fs.access(path.join(tmpDir, "seguridad.txt")).then(() => true).catch(() => false);
  assert.strictEqual(fileExists, false);
  assert.ok(result.text.includes("procede") || result.text.includes("autorizo"));

  // Ahora simulamos que el usuario autoriza explícitamente con "procede"
  const approvedController = new EditCoreClineController({
    callChat: async ({ messages }) => {
      const last = messages[messages.length - 1];
      if (last.role === "tool") {
        return { text: "Archivo creado exitosamente. TASK_COMPLETE", toolCalls: [] };
      }
      return {
        text: "Procediendo a escribir",
        toolCalls: [{
          id: "call_mutation_2",
          function: {
            name: "write_file",
            arguments: JSON.stringify({ path: "seguridad.txt", content: "contenido seguro" })
          }
        }]
      };
    }
  });

  const approvedResult = await approvedController.runTask({
    prompt: "procede y crea el archivo",
    projectRoot: tmpDir,
    permissionMode: "step",
    fullAccess: false
  });

  assert.strictEqual(approvedResult.ok, true);
  const createdContent = await fs.readFile(path.join(tmpDir, "seguridad.txt"), "utf-8");
  assert.strictEqual(createdContent, "contenido seguro");

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("EditCoreClineController: nunca devuelve JSON crudo de tools en finalText", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  // Simulamos que el asistente ejecuta una tool que falla y el loop termina sin mensaje de texto
  const mockCallChat = async ({ messages }) => {
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
    maxTurns: 1 // Forzar fin de turnos tras la herramienta
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-rawjson-"));
  const result = await controller.runTask({
    prompt: "procede a ejecutar build",
    projectRoot: tmpDir,
    permissionMode: "step"
  });

  // finalText no debe ser el JSON crudo {"stderr":"", "exitCode": 1, ...}
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

test("EditCoreClineController: acota los turnos en step mode a máximo 4 turnos para evitar bucles descontrolados", async () => {
  const { EditCoreClineController } = require("../runtime/editcore-cline/index");

  let turnsExecuted = 0;
  const mockCallChat = async () => {
    turnsExecuted++;
    return {
      text: "Leyendo archivo",
      toolCalls: [{
        id: `call_${turnsExecuted}`,
        function: {
          name: "list_files",
          arguments: JSON.stringify({ path: "." })
        }
      }]
    };
  };

  const controller = new EditCoreClineController({
    callChat: mockCallChat,
    maxTurns: 50 // Aunque el controller tenga maxTurns: 50
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ec-cline-pacing-"));
  const result = await controller.runTask({
    prompt: "continua",
    projectRoot: tmpDir,
    permissionMode: "step",
    fullAccess: false
  });

  // En step mode no debe ejecutar 50 turnos ni 7 turnos: máximo 4 turnos y se detiene
  assert.ok(turnsExecuted <= 4, `Ejecutó ${turnsExecuted} turnos, debe ser <= 4`);
  assert.ok(result.turns <= 4);

  await fs.rm(tmpDir, { recursive: true, force: true });
});
