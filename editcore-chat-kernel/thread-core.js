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
  let context = String(turnContext || "").trim();
  try {
    if (projectRoot) {
      const memoryBlock = threadMemory.projectPromptBlock(projectRoot, threadId, query);
      if (memoryBlock) {
        context = context ? `${memoryBlock}\n\n${context}` : memoryBlock;
      }
    }
  } catch { /* ignore */ }
  const timedText = context
    ? `${currentTimeLine(now)}\n=== CONTEXTO DE EDITCOREAI PARA ESTE TURNO (lo agrega el IDE, no el usuario) ===\n${context}\n=== FIN CONTEXTO ===\n\n${userText}`
    : `${currentTimeLine(now)}\n${userText}`;
  messages.push({ role: "user", content: hasImages ? buildOpenAiImageContent(timedText, images) : timedText });
  return messages;
}

// [EDITCORE-CONSOLIDADA] Dieta de contexto: el historial guardado se
// reinyecta ENTERO en cada turno siguiente (shortHistoryMessages), y
// las respuestas de los turnos de construcción arrastran diffs
// completos y el bloque de verificación post-escritura — en vivo,
// turnos sueltos costaron 189k–250k tokens reenviando ese peso. La
// dieta actúa SOLO sobre lo que se GUARDA (la respuesta en vivo que ve
// el usuario no se toca): cada región de diff (cerca ```diff/```patch
// o diff unificado crudo --- a/ +++ b/ con hunks @@) y el bloque
// «## 🔍 Verificación post-escritura» se sustituyen por UNA línea
// resumen con los nombres de archivo. Lo que el hilo necesita recordar
// es QUÉ archivos cambiaron y que se verificó, no el diff otra vez.
const VERIFY_BLOCK_HEADER_RE = /^##\s*🔍\s*Verificación post-escritura/i;
const VERIFY_FILE_LINE_RE = /^-\s+`([^`]+)`\s*:/;
const VERIFY_TAIL_LINE_RE = /^(?:Falló|Saltada|Verificación ejecutada)\b/;
const DIFF_FENCE_OPEN_RE = /^```(?:diff|patch)\s*$/i;
const DIFF_FILE_LINE_RE = /^(?:---|\+\+\+)\s+(\S+)/;

function slimStoredAssistantText(text = "") {
  const src = String(text || "");
  if (!src.trim()) return src;
  const lines = src.split(/\r?\n/);
  const out = [];
  let current = null;
  const begin = () => { if (!current) current = { count: 0, files: new Set() }; };
  const flush = () => {
    if (!current) return;
    const files = [...current.files].slice(0, 6);
    out.push(`[diff y verificación de ${current.count} líneas omitidos del historial${files.length ? ` — ${files.join(", ")}` : ""}]`);
    current = null;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Bloque de verificación post-escritura: encabezado + su lista.
    if (VERIFY_BLOCK_HEADER_RE.test(line)) {
      begin();
      current.count += 1; i += 1;
      while (i < lines.length) {
        const m = lines[i].match(VERIFY_FILE_LINE_RE);
        if (m) { current.files.add(m[1]); current.count += 1; i += 1; continue; }
        if (VERIFY_TAIL_LINE_RE.test(lines[i]) || /^\s*$/.test(lines[i]) || /^\s+/.test(lines[i])) { current.count += 1; i += 1; continue; }
        break;
      }
      continue;
    }
    // Cerca ```diff / ```patch completa.
    if (DIFF_FENCE_OPEN_RE.test(line.trim())) {
      begin();
      current.count += 1; i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        const m = lines[i].match(DIFF_FILE_LINE_RE);
        if (m) current.files.add(m[1].replace(/^[ab]\//, ""));
        current.count += 1; i += 1;
      }
      if (i < lines.length) { current.count += 1; i += 1; }
      continue;
    }
    // Diff unificado crudo: --- a/x, +++ b/x y un hunk @@ cerca.
    if (/^---\s+\S/.test(line) && i + 1 < lines.length && /^\+\+\+\s+\S/.test(lines[i + 1])
      && lines.slice(i + 2, i + 8).some((l) => /^@@\s/.test(l))) {
      begin();
      const m1 = line.match(/^---\s+(\S+)/); if (m1) current.files.add(m1[1].replace(/^[ab]\//, ""));
      const m2 = lines[i + 1].match(/^\+\+\+\s+(\S+)/); if (m2) current.files.add(m2[1].replace(/^[ab]\//, ""));
      current.count += 2; i += 2;
      while (i < lines.length && (/^(?:[+\-@\\]| |---\s|\+{3}\s)/.test(lines[i])
        || (/^\s*$/.test(lines[i]) && i + 1 < lines.length && /^(?:[+\-@\\]|---\s|\+{3}\s)/.test(lines[i + 1])))) {
        current.count += 1; i += 1;
      }
      continue;
    }
    flush();
    out.push(line);
    i += 1;
  }
  flush();
  return out.join("\n");
}

function rememberExchange(projectRoot, threadId, userText, assistantText, meta = {}) {
  const turns = [];
  if (userText) turns.push({ role: "user", content: String(userText), at: Date.now() });
  // [EDITCORE-CONSOLIDADA] La dieta se aplica al guardar, nunca a la
  // respuesta en vivo: el usuario ve su diff completo; el historial
  // solo conserva la línea resumen.
  if (assistantText) turns.push({ role: "assistant", content: slimStoredAssistantText(String(assistantText)).slice(0, 6_000), at: Date.now() });
  if (turns.length) threadMemory.appendTurns(projectRoot, threadId, turns);

  if (projectRoot) {
    try {
      const written = Array.isArray(meta.written) ? meta.written : [];
      if (written.length) {
        const state = threadMemory.loadProjectState(projectRoot);
        const existing = new Set((state.files || []).map((f) => (typeof f === "string" ? f : f?.rel || f?.path)));
        for (const file of written) {
          if (!existing.has(file)) {
            state.files.push({ rel: file, action: "modified", at: Date.now() });
          }
        }
        threadMemory.saveProjectState(projectRoot, state);
      }
      const rawUser = String(userText || "").trim();
      if (rawUser && rawUser.length > 5 && !/^(?:contin[uú]a|sigue|ok|si|dale|procede)\b/i.test(rawUser)) {
        threadMemory.noteWorkingOn(projectRoot, rawUser.slice(0, 300), threadId);
      }
      // [EDITCORE-DOSSIER] Antes la PRIMERA línea de cada respuesta del
      // agente se guardaba como "decisión": el expediente se llenaba de
      // narrativa ("Listo, corregí…") y la decisión real se perdía entre
      // ruido. Las decisiones ya no se infieren aquí: solo entran por
      // noteDecision explícito o por verificación real (noteVerified /
      // noteDiscarded en el orquestador). Lo verificado y lo descartado
      // llegan por meta.verified / meta.discarded cuando el llamador los
      // conoce; si no vienen, no se inventa nada.
      if (meta && typeof threadMemory.noteVerified === "function") {
        if (typeof meta.verified === "string" && meta.verified.trim()) {
          threadMemory.noteVerified(projectRoot, meta.verified, true);
        }
        if (typeof meta.discarded === "string" && meta.discarded.trim()) {
          threadMemory.noteDiscarded(projectRoot, meta.discarded);
        }
      }
    } catch { /* ignore */ }
  }
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
  slimStoredAssistantText,
  subagentContext,
  threadMemory,
};
