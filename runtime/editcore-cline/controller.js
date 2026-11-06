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

function normalizeToolName(rawName = "") {
  const n = String(rawName || "").trim().toLowerCase();
  if (["write_to_file", "writefile"].includes(n)) return "write_file";
  if (["replace_in_file", "replaceinfile"].includes(n)) return "replace_in_file";
  if (["execute_command", "executecommand", "terminal", "bash", "sh"].includes(n)) return "run_command";
  if (["read_file", "readfile"].includes(n)) return "read_file";
  if (["list_files", "listfiles", "dir", "ls"].includes(n)) return "list_files";
  if (["grep", "grep_search", "search_files", "file_search", "search", "search_dir"].includes(n)) return "grep";
  return n;
}

function cleanRawToolCallsFromText(text = "") {
  if (!text || typeof text !== "string") return "";
  let clean = text;
  // 1. Elimina wrappers completos <dots_function_call>...</dots_function_call>
  clean = clean.replace(/<(?:dots_function_call|tool_call|function_call)>[\s\S]*?<\/(?:dots_function_call|tool_call|function_call)>/gi, "");
  // 2. Elimina cualquier bloque <invoke ...>...</invoke>
  clean = clean.replace(/<invoke[\s\S]*?<\/invoke>/gi, "");
  // 3. Elimina tags sueltos de wrapper o parámetros si quedaron huérfanos
  clean = clean.replace(/<\/?(?:dots_function_call|tool_call|function_call|invoke|parameter|param|arg|argument)[^>]*>/gi, "");
  // 4. Elimina tags XML estándar de herramientas
  const toolNames = [
    "grep", "grep_search", "search_files", "file_search",
    "write_file", "write_to_file", "replace_in_file", "read_file",
    "run_command", "execute_command", "list_files",
    "create_pdf", "create_word", "create_excel"
  ];
  for (const name of toolNames) {
    clean = clean.replace(new RegExp(`<(?:tool_call>\\s*)?<${name}>[\\s\\S]*?<\\/${name}>(?:\\s*<\\/tool_call>)?`, "gi"), "");
    clean = clean.replace(new RegExp(`<\/?${name}[^>]*>`, "gi"), "");
  }
  // 5. Elimina bloques json de herramientas en markdown
  clean = clean.replace(/```(?:json)?\s*\{[\s\S]*?"(?:tool|tool_name|action|name)"\s*:\s*"[^"]+"[\s\S]*?\}\s*```/gi, "");
  return clean.replace(/TASK_COMPLETE/g, "").trim();
}

function extractToolCallsFromText(text = "") {
  const toolCalls = [];
  if (!text || typeof text !== "string") return toolCalls;

  // 1. Formato <invoke name="..."> o <invoke tool="..."> (incluso dentro de <dots_function_call>, <tool_call>, etc.)
  const invokeRegex = /<invoke\s+(?:name|tool|function)=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi;
  let invMatch;
  while ((invMatch = invokeRegex.exec(text)) !== null) {
    const rawName = invMatch[1].trim();
    const body = invMatch[2];
    const args = {};
    const paramMatches = [...body.matchAll(/<(?:parameter|param|arg|argument)\s+name=["']([^"']+)["']>([\s\S]*?)<\/(?:parameter|param|arg|argument)>/gi)];
    for (const p of paramMatches) {
      args[p[1].trim()] = p[2].trim();
    }
    // Si no usó <parameter name="...">, buscar tags directos como <pattern>val</pattern>
    if (paramMatches.length === 0) {
      const directMatches = [...body.matchAll(/<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g)];
      for (const p of directMatches) {
        args[p[1]] = p[2].trim();
      }
    }
    toolCalls.push({
      id: `call_${Date.now()}_${toolCalls.length}`,
      function: {
        name: normalizeToolName(rawName),
        arguments: args,
      }
    });
  }

  // 2. Formato XML estándar <tool_name><param>valor</param></tool_name>
  if (toolCalls.length === 0) {
    const toolNames = [
      "grep", "grep_search", "search_files", "file_search",
      "write_file", "write_to_file", "replace_in_file", "read_file",
      "run_command", "execute_command", "list_files",
      "create_pdf", "create_word", "create_excel"
    ];
    for (const name of toolNames) {
      const regex = new RegExp(`<(?:tool_call>\\s*)?<${name}>([\\s\\S]*?)<\\/${name}>(?:\\s*<\\/tool_call>)?`, "gi");
      let match;
      while ((match = regex.exec(text)) !== null) {
        const body = match[1];
        const args = {};
        const paramMatches = [...body.matchAll(/<([a-zA-Z0-9_]+)>([\s\S]*?)<\/\1>/g)];
        for (const p of paramMatches) {
          args[p[1]] = p[2].trim();
        }
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          function: {
            name: normalizeToolName(name),
            arguments: args,
          }
        });
      }
    }
  }

  // 3. Formato bloque JSON en Markdown
  if (toolCalls.length === 0) {
    const jsonBlockRegex = /```(?:json)?\s*\{[\s\S]*?"(?:tool|tool_name|action|name)"\s*:\s*"([^"]+)"[\s\S]*?\}\s*```/gi;
    let jMatch;
    while ((jMatch = jsonBlockRegex.exec(text)) !== null) {
      try {
        const raw = jMatch[0].replace(/^```(?:json)?|```$/g, "").trim();
        const parsed = JSON.parse(raw);
        const name = parsed.tool || parsed.tool_name || parsed.action || parsed.name;
        delete parsed.tool;
        delete parsed.tool_name;
        delete parsed.action;
        delete parsed.name;
        const args = parsed.arguments || parsed.params || parsed.parameters || parsed.input || parsed;
        toolCalls.push({
          id: `call_${Date.now()}_${toolCalls.length}`,
          function: {
            name: normalizeToolName(name),
            arguments: args,
          }
        });
      } catch { /* ignore */ }
    }
  }

  return toolCalls;
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
    images = [],
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
    const hasImages = Array.isArray(images) && images.length > 0;
    const toolExecutor = new EditCoreClineTools(projectRoot, this.existingTools);
    const systemPrompt = buildEditCoreSystemPrompt({
      workspaceRoot: projectRoot,
      mode,
      permissionMode,
      rules,
      hasImages
    });

    let userContent = prompt;
    if (Array.isArray(images) && images.length > 0) {
      userContent = [{ type: "text", text: String(prompt || "") }];
      for (const img of images) {
        const url = typeof img === "string" ? img : (img.dataUrl || img.url || "");
        if (url) {
          userContent.push({
            type: "image_url",
            image_url: { url }
          });
        }
      }
    }

    this.messages = [
      { role: "system", content: systemPrompt },
      ...(Array.isArray(history) && history.length > 0 ? history : []),
      { role: "user", content: userContent }
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

      let rawStreamBuffer = "";
      const handleDelta = (delta) => {
        rawStreamBuffer += delta;
        if (/<(?:dots_function_call|invoke|tool_call|function_call|parameter|param|arg|argument)\b/i.test(rawStreamBuffer)) {
          return;
        }
        notify({ phase: "delta", text: delta });
      };

      let response;
      try {
        response = await this.callChat({
          apiBaseUrl,
          apiKey,
          model,
          messages: safeMessages,
          tools: availableTools,
          toolChoice: "auto",
          onTextDelta: handleDelta
        });
      } catch (err) {
        if (/openai_error|tools|function|unsupported|not allowed|malformed|400/i.test(String(err?.message || ""))) {
          try {
            notify({ phase: "thought", text: "Reintentando en modo de ejecución directa compatible..." });
            response = await this.callChat({
              apiBaseUrl,
              apiKey,
              model,
              messages: safeMessages,
              tools: undefined,
              toolChoice: undefined,
              onTextDelta: handleDelta
            });
          } catch (retryErr) {
            this.state = STATE.ERROR;
            const errMsg = String(retryErr?.message || retryErr || "Error en el proveedor de IA");
            notify({ phase: "error", error: errMsg });
            return {
              ok: false,
              error: errMsg,
              text: `[Error de EditCoreAI] ${errMsg}`,
              messages: this.messages
            };
          }
        } else {
          this.state = STATE.ERROR;
          const errMsg = String(err?.message || err || "Error en el proveedor de IA");
          notify({ phase: "error", error: errMsg });
          return {
            ok: false,
            error: errMsg,
            text: `[Error de EditCoreAI] ${errMsg}`,
            messages: this.messages
          };
        }
      }

      if (this.isAborted) break;

      const rawToolCalls = Array.isArray(response.toolCalls) && response.toolCalls.length > 0
        ? response.toolCalls
        : extractToolCallsFromText(response.text || "");

      const cleanText = cleanRawToolCallsFromText(response.text || "");

      const assistantMessage = {
        role: "assistant",
        content: cleanText,
        tool_calls: rawToolCalls
      };
      this.messages.push(assistantMessage);

      // 2. Si el asistente completó o respondió directamente sin herramientas
      const hasTools = assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0;
      const claimsCompletion = (response.text || "").includes("TASK_COMPLETE");

      if (!hasTools || claimsCompletion) {
        this.state = STATE.DONE;
        notify({ phase: "done", text: cleanText || "Tarea completada exitosamente." });
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

    // Si la última interacción fue una herramienta (el modelo no formuló la respuesta final),
    // realizamos un turno de síntesis para que EditCoreAI explique o resuma el resultado al usuario.
    const lastMsg = this.messages[this.messages.length - 1];
    if (lastMsg && lastMsg.role === "tool" && !this.isAborted) {
      notify({ phase: "thought", text: "Elaborando respuesta final..." });
      try {
        const synthResponse = await this.callChat({
          apiBaseUrl,
          apiKey,
          model,
          messages: this.compactor.compactMessages(this.messages),
          tools: undefined,
          toolChoice: undefined,
          onTextDelta: (delta) => notify({ phase: "delta", text: delta })
        });
        if (synthResponse && synthResponse.text) {
          const cleanSynth = cleanRawToolCallsFromText(synthResponse.text);
          if (cleanSynth) {
            this.messages.push({
              role: "assistant",
              content: cleanSynth
            });
            this.state = STATE.DONE;
            notify({ phase: "done", text: cleanSynth });
          }
        }
      } catch {
        // Fallback al extracto de herramientas si falla la llamada
      }
    }

    // Extraer siempre respuesta limpia y legible en vez de volcar JSON crudo de tools o tags XML
    let finalText = "";
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.role === "assistant" && typeof msg.content === "string") {
        const cleaned = cleanRawToolCallsFromText(msg.content);
        if (cleaned.length > 0) {
          finalText = cleaned;
          break;
        }
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
