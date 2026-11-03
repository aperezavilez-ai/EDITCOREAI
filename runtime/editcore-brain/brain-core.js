"use strict";

/**
 * EDITCORE BRAIN - Core Engine Architecture
 * 
 * Orquestador principal autónomo:
 * - Ciclo de vida determinista (Thinking -> Approval -> Execution -> Verification -> Completion).
 * - Compactación de contexto con BrainMessageBuilder.
 * - Despacho de agentes dinámicos mediante DynamicAgentCoordinator.
 * - Operaciones atómicas de archivos con AtomicFileEditor.
 * - Escudo de aprobación en la UI para mutaciones.
 */

const { BrainState, PermissionMode } = require("./types");
const { BrainMessageBuilder } = require("./message-builder");
const { AtomicFileEditor } = require("./file-editor");
const { DynamicAgentCoordinator } = require("./agent-coordinator");
const { BrainProviderGateway } = require("./provider-gateway");

class EditCoreBrain {
  constructor(deps = {}) {
    this.providerGateway = new BrainProviderGateway(deps);
    this.messageBuilder = new BrainMessageBuilder();
    this.agentCoordinator = new DynamicAgentCoordinator();
    this.uiBridge = deps.uiBridge || {
      onProgress: () => {},
      requestApproval: async () => true,
    };
    this.state = BrainState.IDLE;
    this.isAborted = false;
    this.maxTurns = deps.maxTurns || 45;
  }

  abort() {
    this.isAborted = true;
    this.state = BrainState.IDLE;
  }

  /**
   * Ejecuta una tarea autónoma completa de principio a fin.
   */
  async executeTask({
    prompt,
    projectRoot,
    apiKey,
    model,
    apiBaseUrl,
    permissionMode = PermissionMode.STEP,
    fullAccess = false,
    rules = "",
    history = [],
    onProgress = null,
  }) {
    this.isAborted = false;
    this.state = BrainState.ANALYZING;

    const fileEditor = new AtomicFileEditor(projectRoot);
    const selectedRole = this.agentCoordinator.determineRequiredRole(prompt);
    const specialistDirectives = this.agentCoordinator.getSpecialistDirectives(selectedRole);

    const notify = (data) => {
      if (typeof onProgress === "function") onProgress(data);
      this.uiBridge.onProgress?.(data);
    };

    notify({
      phase: "brain_init",
      role: selectedRole,
      text: `EditCore Brain activado [Agente: ${selectedRole.toUpperCase()}]`,
    });

    const systemPrompt = `Eres EDITCORE BRAIN, el sistema operativo inteligente y autónomo de desarrollo de software dentro de EditCoreAI.
Tu objetivo es resolver la tarea encomendada de forma proactiva, quirúrgica y profesional.

<entorno>
Directorio de Trabajo: ${projectRoot}
Modo de Permisos: ${fullAccess ? "ACCESO TOTAL (Autónomo)" : permissionMode.toUpperCase()}
</entorno>

${specialistDirectives}

${rules ? `<directivas_proyecto>\n${rules}\n</directivas_proyecto>` : ""}

REGLAS PRIMORDIALES:
1. Inspecciona antes de modificar. Usa read_file o run_command para validar rutas y dependencias reales.
2. Todo código debe ser completo y funcional; jamás omitas partes con '// resto igual'.
3. Usa replace_in_file para cambios quirúrgicos precisos o write_file para archivos nuevos.
4. Cuando hayas completado y validado la tarea con éxito, incluye 'TASK_COMPLETE' en tu mensaje con un resumen conciso de los cambios.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(Array.isArray(history) && history.length > 0 ? history : []),
      { role: "user", content: prompt },
    ];

    let turns = 0;
    const isStep = !fullAccess && permissionMode !== PermissionMode.FULL;

    const toolDefinitions = [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Lee un archivo del proyecto.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo" },
              startLine: { type: "number", description: "Línea inicial" },
              endLine: { type: "number", description: "Línea final" },
            },
            required: ["path"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "replace_in_file",
          description: "Aplica una edición quirúrgica exacta reemplazando old_text por new_text.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo" },
              old_text: { type: "string", description: "Texto existente exacto a reemplazar" },
              new_text: { type: "string", description: "Nuevo texto" },
            },
            required: ["path", "old_text", "new_text"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_file",
          description: "Crea o sobrescribe un archivo completo.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo" },
              content: { type: "string", description: "Contenido completo" },
            },
            required: ["path", "content"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "run_command",
          description: "Ejecuta un comando en la terminal del proyecto.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Comando a ejecutar" },
            },
            required: ["command"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "list_files",
          description: "Lista los archivos del directorio especificado (o raíz del proyecto).",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directorio a listar (por defecto '.')" },
            },
          },
        },
      },
    ];

    while (this.state !== BrainState.DONE && !this.isAborted && turns < this.maxTurns) {
      turns++;

      // 1. Compactación y control estricto de ventana de tokens
      const safeTranscript = this.messageBuilder.buildSafeTranscript(messages);

      this.state = BrainState.THINKING;
      notify({ phase: "thought", text: `Razonando (Turno ${turns})...` });

      let response;
      try {
        response = await this.providerGateway.requestTurn({
          apiBaseUrl,
          apiKey,
          model,
          messages: safeTranscript,
          tools: toolDefinitions,
          onTextDelta: (delta) => notify({ phase: "delta", text: delta }),
        });
      } catch (err) {
        this.state = BrainState.ERROR;
        notify({ phase: "error", error: err.message });
        return { ok: false, error: err.message, messages };
      }

      if (this.isAborted) break;

      const assistantMsg = {
        role: "assistant",
        content: response.text || "",
        tool_calls: response.toolCalls || [],
      };
      messages.push(assistantMsg);

      const hasTools = assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0;
      const isComplete = assistantMsg.content && assistantMsg.content.includes("TASK_COMPLETE");

      if (isComplete) {
        this.state = BrainState.DONE;
        notify({ phase: "done", text: "Tarea completada exitosamente." });
        break;
      }

      if (!hasTools) {
        // Obliga al modelo a actuar o concluir en lugar de detenerse
        messages.push({
          role: "user",
          content: "[EditCore Brain] No usaste herramientas en tu turno. Ejecuta una herramienta para avanzar o escribe TASK_COMPLETE si el trabajo ha concluido.",
        });
        continue;
      }

      // 2. Procesamiento de herramientas
      for (const call of assistantMsg.tool_calls) {
        if (this.isAborted) break;

        const name = call.function.name;
        let args = {};
        try {
          args = typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments || "{}")
            : call.function.arguments || {};
        } catch {
          args = {};
        }

        // 3. Escudo de aprobación en modo STEP
        const isMutation = ["write_file", "replace_in_file", "run_command"].includes(name);
        if (isStep && isMutation) {
          this.state = BrainState.WAITING_APPROVAL;
          notify({ phase: "approval", name, input: args, stage: "waiting" });

          const approved = await this.uiBridge.requestApproval(name, args);
          if (!approved) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              name,
              content: JSON.stringify({ error: `[EditCore Brain] Ejecución de '${name}' denegada por el usuario.` }),
            });
            notify({ phase: "tool", stage: "rejected", name });
            continue;
          }
        }

        // 4. Ejecución de la herramienta
        this.state = BrainState.EXECUTING;
        notify({ phase: "tool", stage: "running", name, input: args });

        let result;
        try {
          if (name === "read_file") {
            result = await fileEditor.readFile(args.path, { startLine: args.startLine, endLine: args.endLine });
          } else if (name === "write_file") {
            result = await fileEditor.writeFile(args.path, args.content);
          } else if (name === "replace_in_file") {
            result = await fileEditor.replaceInFile(args.path, args.old_text, args.new_text);
          } else if (name === "list_files") {
            const fs = require("node:fs/promises");
            const targetDir = fileEditor.resolveSafePath(args.path || ".");
            const entries = await fs.readdir(targetDir, { withFileTypes: true });
            result = {
              ok: true,
              path: args.path || ".",
              entries: entries.slice(0, 100).map((e) => ({
                name: e.name,
                isDirectory: e.isDirectory(),
              })),
            };
          } else if (name === "run_command") {
            const { exec } = require("node:child_process");
            result = await new Promise((resolve) => {
              exec(args.command, { cwd: projectRoot }, (error, stdout, stderr) => {
                resolve({
                  ok: !error,
                  stdout: (stdout || "").slice(-4000),
                  stderr: (stderr || "").slice(-2000),
                  exitCode: error ? error.code || 1 : 0,
                });
              });
            });
          } else {
            result = { ok: false, error: `Herramienta desconocida: ${name}` };
          }
        } catch (execErr) {
          result = { ok: false, error: execErr.message };
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result),
        });

        notify({ phase: "tool", stage: "done", name, result, ok: result.ok !== false });
      }
    }

    return {
      ok: this.state === BrainState.DONE || !this.isAborted,
      text: messages[messages.length - 1]?.content || "",
      turns,
      role: selectedRole,
      messages,
    };
  }
}

module.exports = {
  EditCoreBrain,
};
