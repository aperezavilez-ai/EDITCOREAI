"use strict";

/**
 * EditCoreAI - Core Agent Controller (Motor Estilo Cline)
 * 
 * Máquina de estados unidireccional y robusta:
 * - IDLE -> THINKING -> WAITING_APPROVAL -> EXECUTING -> THINKING -> DONE
 * - Sin barreras de regex que bloqueen herramientas legítimas.
 * - Soporte de Modo Solo Lectura y Modo Paso a Paso con UI Bridge.
 * - Detección de bucles repetitivos y cadencia determinista.
 * - Compactación de contexto automática antes de cada llamada LLM.
 * - Soporta streaming y reporte en vivo de eventos.
 */

const { ContextCompactor } = require("./context-compactor");
const { buildEditCoreSystemPrompt, FormatResponse } = require("./prompt-builder");
const { EditCoreClineTools } = require("./tool-executor");
const { BrainProviderGateway } = require("../editcore-brain/provider-gateway");

const STATE = {
  IDLE: "IDLE",
  THINKING: "THINKING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  EXECUTING: "EXECUTING",
  DONE: "DONE",
  ERROR: "ERROR"
};

// Funciones de utilidad para clasificación / metadatos si se requieren
function isQuestionInput(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  return /^[?¿]|^(?:por\s*qu[eé]|prque|qu[eé]\s+(?:pas[oó]|sucede|ocurre|es|significa|fall[oó]|error)|c[oó]mo|explicame|expl[ií]came|dime|cu[aá]l\s+es|quien\s+eres|qui[eé]n\s+eres)/i.test(trimmed);
}

function isApprovalInput(text = "") {
  return /\b(?:procede|proceder|autorizo|autorizado|autoriza|continua|contin[uú]a|dale|adelante|hazlo|aplica(?:lo)?|ejecuta(?:lo)?)\b/i.test(String(text || "").trim());
}

class EditCoreClineController {
  constructor(deps = {}) {
    this.providerGateway = new BrainProviderGateway(deps);
    this.callChat = deps.callChat || ((params) => this.providerGateway.requestTurn(params));
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
    this.maxTurns = deps.maxTurns || 25;
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

    const isReadonly = permissionMode === "readonly";
    const toolExecutor = new EditCoreClineTools(projectRoot, this.existingTools);
    const systemPrompt = buildEditCoreSystemPrompt({
      workspaceRoot: projectRoot,
      mode,
      permissionMode,
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

    notify({
      phase: "thought",
      text: "Iniciando análisis con motor EditCoreAI..."
    });

    let turnCount = 0;
    const maxTurnsThisRun = Math.min(this.maxTurns, 25);
    const recentToolCalls = [];

    // Todas las herramientas disponibles para el modelo sin restricciones artificiales
    const availableTools = toolExecutor.getDefinitions();

    while (this.state !== STATE.DONE && !this.isAborted && turnCount < maxTurnsThisRun) {
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
          tools: availableTools,
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

      // 2. Si el asistente completó o respondió directamente sin herramientas
      const hasTools = assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0;
      const claimsCompletion = assistantMessage.content && assistantMessage.content.includes("TASK_COMPLETE");

      if (!hasTools || claimsCompletion) {
        this.state = STATE.DONE;
        const cleanContent = (assistantMessage.content || "").replace(/TASK_COMPLETE/g, "").trim();
        notify({ phase: "done", text: cleanContent || "Tarea completada exitosamente." });
        break;
      }

      // 3. Procesamiento de llamadas a herramientas
      let loopDetected = false;

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

        const isMutation = ["write_file", "write_to_file", "replace_in_file", "run_command", "execute_command"].includes(toolName);

        // Bloqueo 1: Modo Solo Lectura
        if (isReadonly && isMutation) {
          this.messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: toolName,
            content: JSON.stringify({ error: `[EditCore Cline] La herramienta '${toolName}' está bloqueada en modo Solo Lectura. No se permiten modificaciones ni ejecución de comandos.` })
          });
          notify({ phase: "tool", stage: "rejected", name: toolName, input: toolArgs, error: "Modo Solo Lectura activo" });
          continue;
        }

        // Bloqueo 2: Modo Paso a Paso (Step) con UI Bridge interactivo si el usuario deniega
        if (!fullAccess && permissionMode === "step" && isMutation && typeof this.uiBridge.requestApproval === "function") {
          this.state = STATE.WAITING_APPROVAL;
          notify({ phase: "approval", name: toolName, input: toolArgs, stage: "waiting" });

          const approved = await this.uiBridge.requestApproval(toolName, toolArgs);
          if (approved === false) {
            this.messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify({
                status: "denied",
                message: `[EditCoreAI] La herramienta '${toolName}' fue denegada por el usuario desde la interfaz.`
              })
            });
            notify({ phase: "tool", stage: "rejected", name: toolName, input: toolArgs });
            continue;
          }
        }

        // Detección de bucle repetitivo (misma herramienta con exactamente mismos argumentos 3 veces consecutivas)
        const callSig = `${toolName}:${JSON.stringify(toolArgs)}`;
        recentToolCalls.push(callSig);
        if (recentToolCalls.length >= 3) {
          const last3 = recentToolCalls.slice(-3);
          if (last3[0] === last3[1] && last3[1] === last3[2]) {
            loopDetected = true;
            this.messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify({
                ok: false,
                error: `[EditCoreAI - Bucle Detectado] La herramienta '${toolName}' se ha invocado repetidamente con los mismos argumentos sin cambios. Detén las llamadas idénticas y explica el estado al usuario.`
              })
            });
            break;
          }
        }

        // 4. Ejecución segura de la herramienta
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

        notify({ phase: "tool", stage: "done", name: toolName, input: toolArgs, result, ok: result.ok !== false });
      }

      if (loopDetected) {
        break;
      }
    }

    // Extraer siempre respuesta limpia y legible en vez de volcar JSON crudo de tools
    let finalText = "";
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === "assistant" && typeof msg.content === "string" && msg.content.trim().length > 0) {
        finalText = msg.content.replace(/TASK_COMPLETE/g, "").trim();
        break;
      }
    }

    if (!finalText) {
      const toolMessages = this.messages.filter((m) => m.role === "tool");
      if (toolMessages.length > 0) {
        const lastTool = toolMessages[toolMessages.length - 1];
        try {
          const parsed = JSON.parse(lastTool.content || "{}");
          if (parsed.message) {
            finalText = parsed.message;
          } else if (parsed.error) {
            finalText = `Se presentó la siguiente situación: ${parsed.error}`;
          } else if (parsed.output) {
            const lines = String(parsed.output).trim().split("\n");
            finalText = `Resultado de la ejecución:\n\n${lines.slice(-15).join("\n")}`;
          } else {
            finalText = "Operación procesada.";
          }
        } catch {
          finalText = "Operación procesada.";
        }
      } else {
        finalText = "Operación completada exitosamente.";
      }
    }

    return {
      ok: this.state === STATE.DONE || !this.isAborted,
      text: finalText,
      turns: turnCount,
      messages: this.messages
    };
  }
}

module.exports = {
  EditCoreClineController,
  STATE,
  isQuestionInput,
  isApprovalInput,
};
