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

const { BrainProviderGateway } = require("../editcore-brain/provider-gateway");

const QUESTION_WORDS_RE = /^(?:por\s*qu[eé]|prque|qu[eé]\s+(?:pas[oó]|sucede|ocurre|es|significa|fall[oó]|error)|c[oó]mo|explicame|expl[ií]came|dime|cu[aá]l\s+es|por\s*que\s+tanto\s+error|por\s*que\s+paras|prque\s+paras|analiza|qu[eé]\s+haces|quien\s+eres|qui[eé]n\s+eres|[?¿])/i;

const APPROVAL_WORDS_RE = /\b(?:procede|proceder|autorizo|autorizado|autoriza|continua|contin[uú]a|dale|adelante|hazlo|aplica(?:lo)?|ejecuta(?:lo)?|s[ií]\s*,\s*(?:hazlo|procede|autorizo)|ok\s*,\s*(?:hazlo|procede)|de\s+acuerdo)\b/i;

function isQuestionInput(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  if (/^[?¿]/.test(trimmed) || /[?¿]$/.test(trimmed)) return true;
  if (QUESTION_WORDS_RE.test(trimmed)) return true;
  if (/\b(?:por\s*qu[eé]\s+tanto\s+error|por\s*qu[eé]\s+(?:hay|da|tienes?)\s+error|por\s*qu[eé]\s+paras|prque\s+paras|expl[ií]came\s+por\s*qu[eé]|qu[eé]\s+pas[oó]\s+aqu[ií])\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isApprovalInput(text = "") {
  return APPROVAL_WORDS_RE.test(String(text || "").trim());
}

class EditCoreClineController {
  constructor(deps = {}) {
    this.providerGateway = new BrainProviderGateway(deps);
    this.callChat = deps.callChat || ((params) => this.providerGateway.requestTurn(params));
    this.existingTools = deps.existingTools || null;
    this.uiBridge = deps.uiBridge || {
      updateStatus: () => {},
      requestApproval: async () => false,
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

    const isQuestion = isQuestionInput(prompt);
    const isApproved = isApprovalInput(prompt);
    const isStepMode = !fullAccess && permissionMode !== "full";

    const toolExecutor = new EditCoreClineTools(projectRoot, this.existingTools);
    const systemPrompt = buildEditCoreSystemPrompt({
      workspaceRoot: projectRoot,
      mode,
      permissionMode,
      isQuestion,
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
      text: isQuestion
        ? "Analizando consulta y diagnosticando el estado..."
        : "Iniciando análisis con motor EditCoreAI..."
    });

    let turnCount = 0;
    let toolFailureCount = 0;
    const maxTurnsThisRun = isStepMode ? Math.min(this.maxTurns, 4) : this.maxTurns;

    // Si el usuario hace una pregunta, solo ofrecemos herramientas de solo lectura
    const allTools = toolExecutor.getDefinitions();
    const availableTools = isQuestion
      ? allTools.filter((t) => !["write_file", "write_to_file", "replace_in_file", "run_command", "execute_command"].includes(t.function?.name))
      : allTools;

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

        // Bloqueo 1: Modo Pregunta / Diagnóstico no permite mutaciones ("no escribir como loco")
        if (isQuestion && isMutation) {
          this.messages.push({
            role: "tool",
            tool_call_id: call.id,
            name: toolName,
            content: JSON.stringify({
              error: `[EditCoreAI] El usuario hizo una pregunta o solicitó diagnóstico ('${prompt}'). No debes modificar código ni ejecutar comandos mutantes. Responde a su pregunta explicando técnicamente la causa del error y el plan propuesto, solicitando confirmación con 'procede' o 'autorizo'.`
            })
          });
          notify({ phase: "tool", stage: "rejected", name: toolName, input: toolArgs, error: "Modo diagnóstico: mutaciones no permitidas" });
          continue;
        }

        // Bloqueo 2: Modo Solo Lectura
        const isReadonly = permissionMode === "readonly";
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

        // Bloqueo 3: Modo Paso a Paso (Step) sin autorización explícita ("procede", "autorizo")
        if (isStepMode && isMutation && !isApproved) {
          this.state = STATE.WAITING_APPROVAL;
          notify({ phase: "approval", name: toolName, input: toolArgs, stage: "waiting" });

          const approved = await this.uiBridge.requestApproval(toolName, toolArgs);
          if (!approved) {
            this.messages.push({
              role: "tool",
              tool_call_id: call.id,
              name: toolName,
              content: JSON.stringify({
                status: "waiting_authorization",
                message: `[EditCoreAI - Esperando Autorización] La herramienta '${toolName}' requiere confirmación explícita del usuario ('procede' o 'autorizo') antes de modificar archivos o ejecutar comandos. Explica al usuario qué cambios vas a realizar y pídele autorización.`
              })
            });
            notify({ phase: "tool", stage: "rejected", name: toolName, input: toolArgs });
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

        if (result && result.ok === false) {
          toolFailureCount++;
        }

        this.messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: toolName,
          content: JSON.stringify(result)
        });

        notify({ phase: "tool", stage: "done", name: toolName, input: toolArgs, result, ok: result.ok !== false });
      }

      // Si se acumulan fallos de herramientas consecutivas, detener bucle y dar respuesta al usuario
      if (toolFailureCount >= 2) {
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
            finalText = `Se presentó la siguiente situación al inspeccionar el código: ${parsed.error}`;
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
        finalText = "Consulta analizada correctamente.";
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
