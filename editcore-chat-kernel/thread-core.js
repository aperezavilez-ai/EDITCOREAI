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

const FAILED_TURN_RE = /^Algo fall[oó] durante la ejecuci[oó]n:/;

function buildMessageList({ system, userText, projectRoot, threadId, historyInput, query, now, images }) {
  const messages = [{ role: "system", content: `${system}\n\n${runtimeContextLine(now)}` }];
  const short = threadMemory.shortHistoryMessages(historyInput, projectRoot, threadId, query);
  for (const m of short) {
    if (m.role === "assistant" && FAILED_TURN_RE.test(String(m.content || ""))) continue;
    messages.push({ role: m.role, content: m.content });
  }
  const hasImages = Array.isArray(images) && images.length > 0;
  messages.push({ role: "user", content: hasImages ? buildOpenAiImageContent(userText, images) : userText });
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
