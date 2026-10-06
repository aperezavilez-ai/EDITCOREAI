"use strict";

const threadMemory = require("./thread-memory");
const { buildOpenAiImageContent } = require("../runtime/vision-intake");

function resolveThreadId(input = {}) {
  return threadMemory.safeId(
    input.threadId || input.chatId || input.conversationId || input.sessionId || "default"
  );
}

function incomingHistory(input = {}) {
  if (Array.isArray(input.history) && input.history.length) return input.history;
  if (Array.isArray(input.messages) && input.messages.length) return input.messages;
  return [];
}

function seedThreadFromInput(projectRoot, threadId, input, currentMessage) {
  const hist = incomingHistory(input);
  if (hist.length) {
    threadMemory.appendTurns(projectRoot, threadId, hist);
  }
  if (currentMessage) {
    threadMemory.noteWorkingOn(projectRoot, currentMessage, threadId);
  }
}

// El modelo no sabe la fecha, la hora ni el sistema operativo si no se le dicen.
function runtimeContextLine(now = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const local = now.toLocaleString("es", { dateStyle: "full", timeStyle: "short", timeZone });
  const osName = process.platform === "win32" ? "Windows (PowerShell)" : process.platform;
  return `Contexto del sistema: ahora es ${local} (zona ${timeZone}; ISO ${now.toISOString()}). Sistema operativo: ${osName}. `
    + "Responde fecha u hora con este dato; no pidas al usuario ejecutar comandos para obtenerlas.";
}

// El system lleva solo el día: si cambiara cada minuto, el proveedor no podría reusar la caché del prompt entre turnos.
function stableContextLine(now = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const day = now.toLocaleDateString("es", { dateStyle: "full", timeZone });
  const osName = process.platform === "win32" ? "Windows (PowerShell)" : process.platform;
  return `Contexto del sistema: hoy es ${day} (zona ${timeZone}). Sistema operativo: ${osName}. `
    + "La hora exacta va al inicio del último mensaje del usuario; responde fecha u hora con esos datos y no pidas al usuario ejecutar comandos para obtenerlas.";
}

function currentTimeLine(now = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const time = now.toLocaleTimeString("es", { timeStyle: "short", timeZone });
  return `[Hora actual: ${time} · ISO ${now.toISOString()}]`;
}

const FAILED_TURN_RE = /^Algo fall[oó] durante la ejecuci[oó]n:/;

// El proveedor cachea por prefijo exacto: system (fijo) + historial se releen a una fracción del precio.
// Lo que cambia en cada turno (turnContext, hora) va en el último mensaje, que nunca es parte del prefijo.
function buildMessageList({ system, systemPrefix = "", turnContext = "", userText, projectRoot, threadId, historyInput, query, now, images }) {
  const systemText = `${system}\n\n${stableContextLine(now)}`;
  const messages = [{ role: "system", content: systemPrefix ? `${systemPrefix}\n\n${systemText}` : systemText }];
  const short = threadMemory.shortHistoryMessages(historyInput, projectRoot, threadId, query);
  for (const m of short) {
    if (m.role === "assistant" && FAILED_TURN_RE.test(String(m.content || ""))) continue;
    messages.push({ role: m.role, content: m.content });
  }
  const hasImages = Array.isArray(images) && images.length > 0;
  const context = String(turnContext || "").trim();
  const timedText = context
    ? `${currentTimeLine(now)}\n=== CONTEXTO DE EDITCOREAI PARA ESTE TURNO (lo agrega el IDE, no el usuario) ===\n${context}\n=== FIN CONTEXTO ===\n\n${userText}`
    : `${currentTimeLine(now)}\n${userText}`;
  messages.push({ role: "user", content: hasImages ? buildOpenAiImageContent(timedText, images) : timedText });
  return messages;
}

function rememberExchange(projectRoot, threadId, userText, assistantText) {
  const turns = [];
  if (userText) turns.push({ role: "user", content: String(userText), at: Date.now() });
  if (assistantText) turns.push({ role: "assistant", content: String(assistantText).slice(0, 6_000), at: Date.now() });
  if (turns.length) threadMemory.appendTurns(projectRoot, threadId, turns);
}

function subagentContext({ projectRoot, threadId, task, extra = "" }) {
  const block = threadMemory.projectPromptBlock(projectRoot, threadId, task);
  return [
    "SUBAGENTE — misma conversación, no un chat nuevo.",
    `Tarea: ${String(task || "").slice(0, 800)}`,
    block,
    extra ? `Contexto extra:\n${String(extra).slice(0, 1500)}` : "",
    "Devuelve un resultado concreto al orquestador. No saludes. No reinicies el objetivo.",
  ].filter(Boolean).join("\n\n");
}

module.exports = {
  resolveThreadId,
  incomingHistory,
  seedThreadFromInput,
  buildMessageList,
  runtimeContextLine,
  rememberExchange,
  subagentContext,
  threadMemory,
};
