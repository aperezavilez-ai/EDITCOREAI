"use strict";

/**
 * EditCoreAI - Core Agent Controller (Motor Estilo Cline)
 * 
 * Reemplaza los orquestadores antiguos con una máquina de estados unidireccional y robusta:
 * - IDLE -> THINKING -> WAITING_APPROVAL -> EXECUTING -> THINKING -> DONE
 * - Intercepta cada mutación y solicita aprobación en la UI si el modo no es 'full'.
 * - Aplica compactación de contexto automática antes de cada llamada LLM.
 * - Soporta streaming y reporte en vivo de eventos.
 */

const { ContextCompactor } = require("./context-compactor");
const { buildEditCoreSystemPrompt, FormatResponse } = require("./prompt-builder");
const { EditCoreClineTools } = require("./tool-executor");

const STATE = {
  IDLE: "IDLE",
  THINKING: "THINKING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  EXECUTING: "EXECUTING",
  DONE: "DONE",
  ERROR: "ERROR"
};

class EditCoreClineController {
  constructor(deps = {}) {
    this.callChat = deps.callChat; // Motor de llamada a proveedores (provider.js)
    this.existingTools = deps.existingTools || null;
    this.uiBridge = deps.uiBridge || {
      updateStatus: () => {},
      requestApproval: async () => true,
      onProgress: () => {}
    };
    this.compactor = new ContextCompactor();
    this.state = STATE.IDLE;
    this.messages = [];
    this.isAborted = false;
    this.maxTurns = deps.maxTurns || 50;
  }

  abort() {
    this.isAborted = true;
    this.state = STATE.IDLE;
  }

  async runTask({
    prompt,
    projectRoot,
    model,
    apiKey,
    apiBaseUrl,
    mode = "act",
    permissionMode = "step",
    fullAccess = false,
    rules = "",
    history = [],
    onProgress = null
  }) {
    this.isAborted = false;
    this.state = STATE.THINKING;

    const toolExecutor = new EditCoreClineTools(projectRoot, this.existingTools);
    const systemPrompt = buildEditCoreSystemPrompt({
      workspaceRoot: projectRoot,
      mode,
      rules
    });

    this.messages = [
      { role: "system", content: systemPrompt },
      ...(Array.isArray(history) && history.length > 0 ? history : []),
      { role: "user", content: prompt }
    ];

    const notify = (data) => {
      if (typeof onProgress === "function") onProgress(data);
      this.uiBridge.onProgress?.(data);
    };

    notify({ phase: "thought", text: "Iniciando análisis con motor EditCoreAI..." });

    let turnCount = 0;
    const isStepMode = !fullAccess && permissionMode !== "full";

    while (this.state !== STATE.DONE && !this.isAborted && turnCount < this.maxTurns) {
      turnCount++;

      // 1. Poda y compactación de memoria antes del turno del modelo
      const safeMessages = this.compactor.compactMessages(this.messages);

      this.state = STATE.THINKING;
      notify({ phase: "thought", text: `Pensando (turno ${turnCount})...` });

      let response;
      try {
        response = await this.callChat({
          apiBaseUrl,
          apiKey,
          model,
          messages: safeMessages,
          tools: toolExecutor.getDefinitions(),
          toolChoice: "auto",
          onTextDelta: (delta) => notify({ phase: "delta", text: delta })
        });
      } catch (err) {
        this.state = STATE.ERROR;
        notify({ phase: "error", error: err.message });
        return {
          ok: false,
          error: err.message,
          messages: this.messages
        };
      }

      if (this.isAborted) break;

      const assistantMessage = {
        role: "assistant",
        content: response.text || "",
        tool_calls: response.toolCalls || []
      };
      this.messages.push(assistantMessage);

      // 2. Si el asistente completó o no ejecutó herramientas
      const hasTools = assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0;
      const claimsCompletion = assistantMessage.content && assistantMessage.content.includes("TASK_COMPLETE");

      if (claimsCompletion) {
        this.state = STATE.DONE;
        notify({ phase: "done", text: "Tarea completada exitosamente." });
        break;
      }

      if (!hasTools) {
        // En lugar de detenerse o romper el contexto, forzar al modelo a avanzar o terminar
        this.messages.push({
          role: "user",
          content: FormatResponse.noToolsUsed()
        });
        continue;
      }

      // 3. Procesamiento de llamadas a herramientas
      for (const call of assistantMessage.tool_calls) {
        if (this.isAborted) break;

        const toolName = call.function.name;
        let toolArgs = {};
        try {
          toolArgs = typeof call.function.arguments === "string"
            ? JSON.parse(call.function.arguments || "{}")
            : call.function.arguments || {};
        } catch {
          toolArgs = {};
        }

        // 4. Intercepción de permisos / Escudo de seguridad estilo Cline
        const isMutation = ["write_file", "write_to_file", "replace_in_file", "run_command"].includes(toolName);
        if (isStepMode && isMutation) {
          this.state = STATE.WAITING_APPROVAL;
          notify({ phase: "approval", name: toolName, input: toolArgs, stage: "waiting" });

          const approved = await this.uiBridge.requestApproval(toolName, toolArgs);
          if (!approved) {
            this.messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify({ error: FormatResponse.toolDenied(toolName) })
            });
            notify({ phase: "tool", stage: "rejected", name: toolName });
            continue;
          }
        }

        // 5. Ejecución segura de la herramienta
        this.state = STATE.EXECUTING;
        notify({ phase: "tool", stage: "running", name: toolName, input: toolArgs });

        let result;
        try {
          result = await toolExecutor.execute(toolName, toolArgs);
        } catch (execError) {
          result = { ok: false, error: execError.message };
        }

        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: toolName,
          content: JSON.stringify(result)
        });

        notify({ phase: "tool", stage: "done", name: toolName, result, ok: result.ok !== false });
      }
    }

    return {
      ok: this.state === STATE.DONE || !this.isAborted,
      text: this.messages[this.messages.length - 1]?.content || "",
      turns: turnCount,
      messages: this.messages
    };
  }
}

module.exports = {
  EditCoreClineController,
  STATE
};
