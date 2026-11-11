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

// [EDITCORE-INTEGRAL-B3] DESTILACIÓN DE HECHOS desde los steps del turno.
// El expediente no guardaba NINGÚN hecho estructural: files[] solo llevaba
// {rel, action:"modified"} de escrituras y las lecturas no dejaban rastro,
// así que el mapa sección→archivo de un turno moría con los steps (la
// cadena M-5 de la auditoría). Aquí el KERNEL destila, al cerrar, solo lo
// que los steps AFIRMAN:
//  - archivo↔sección/símbolo: un símbolo DEFINIDO en el contenido leído o
//    escrito («contiene») se distingue de un componente IMPORTADO y
//    RENDERIZADO («renderiza») — el riesgo (d) del Bloque 3: confundirlos
//    registraría asociaciones falsas.
//  - asset↔dónde se usa: toda referencia a un asset (ruta con extensión
//    de imagen/vídeo) dentro del contenido de un archivo; la sección se
//    adjunta solo si hay un marcador (definición o <section>) inequívoco
//    antes de la referencia, o un único candidato en el archivo.
//  - lecturas: read_file correcto deja hecho «read» (con el para-qué SOLO
//    si el pedido del usuario nombra el archivo o la sección hallada).
//  - decisiones: SOLO hechos del USUARIO afirmables por el kernel — su
//    mensaje de aprobación («procede»…), la opción que eligió con verbo
//    explícito, o su descarte explícito. NADA se infiere de la prosa del
//    modelo. Lo demasiado frágil queda fuera a propósito (ver reporte):
//    p. ej. el para-qué de una escritura no se inventa.
const ASSET_REF_RE = /([A-Za-z0-9_@][A-Za-z0-9_@.\/-]*\.(?:png|jpe?g|webp|gif|svg|avif|mp4|webm))/gi;
const DEF_SYMBOL_RE = /(?:export\s+(?:default\s+)?)?(?:function|class)\s+([A-Za-z][A-Za-z0-9_]*)/g;
const CONST_SYMBOL_RE = /(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*(?:=|:)/g;
const SECTION_TAG_RE = /<section\b[^>]*?(?:id|className|class)\s*=\s*["'`]([^"'`]+)["'`]/gi;
const IMPORT_DEFAULT_RE = /import\s+([A-Z][A-Za-z0-9_]*)\s*(?:,\s*\{[^}]*\})?\s+from/g;
const IMPORT_NAMED_RE = /import\s*\{([^}]*)\}\s*from/g;
const FACT_SCAN_CAP = 20_000;

function looseKey(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function contentMarkers(content) {
  const markers = [];
  const seen = new Set();
  const push = (index, name) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const key = looseKey(clean);
    if (seen.has(key)) return;
    seen.add(key);
    markers.push({ index, name: clean });
  };
  for (const m of content.matchAll(DEF_SYMBOL_RE)) push(m.index, m[1]);
  for (const m of content.matchAll(CONST_SYMBOL_RE)) push(m.index, m[1]);
  for (const m of content.matchAll(SECTION_TAG_RE)) push(m.index, String(m[1] || "").split(/\s+/)[0]);
  markers.sort((a, b) => a.index - b.index);
  return markers;
}

function importedComponents(content) {
  const names = new Set();
  for (const m of content.matchAll(IMPORT_DEFAULT_RE)) names.add(m[1]);
  for (const m of content.matchAll(IMPORT_NAMED_RE)) {
    for (const part of String(m[1] || "").split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Z]/.test(name)) names.add(name);
    }
  }
  return names;
}

function factsFromContent(file, content, facts) {
  const text = String(content || "").slice(0, FACT_SCAN_CAP);
  if (!text.trim()) return;
  const rel = String(file || "").replace(/\\/g, "/");
  if (!rel) return;
  const markers = contentMarkers(text);
  const definedKeys = new Set(markers.map((mk) => looseKey(mk.name)));
  for (const mk of markers) {
    facts.push({ kind: "section", file: rel, name: mk.name, relation: "contiene" });
  }
  // «renderiza»: componente importado Y usado como JSX en ESTE archivo y
  // NO definido en él. Sin import + uso no se afirma nada.
  for (const name of importedComponents(text)) {
    if (definedKeys.has(looseKey(name))) continue;
    if (new RegExp(`<${name}[\\s/>]`).test(text)) {
      facts.push({ kind: "section", file: rel, name, relation: "renderiza" });
    }
  }
  for (const m of text.matchAll(ASSET_REF_RE)) {
    const asset = String(m[1] || "").replace(/^\.\//, "");
    if (!asset || asset.toLowerCase() === rel.toLowerCase()) continue;
    let section = "";
    const before = markers.filter((mk) => mk.index < m.index);
    if (before.length) section = before[before.length - 1].name;
    else if (markers.length === 1) section = markers[0].name;
    const fact = { kind: "asset", file: rel, asset };
    if (section) fact.section = section;
    facts.push(fact);
  }
}

const APPROVAL_TURN_RE = /^\s*(?:procede|procedo|adelante|hazlo|autorizado|s[ií]|ok|dale|va)\b/i;
const USER_CHOICE_RE = /(?:elijo|escojo|me quedo con|quiero la|hagamos la|va la)\s+(?:opci[óo]n\s+)?([^.,;\n]{2,60})/i;
// Descarte explícito del usuario, ACOTADO a verbos de descarte/reversión:
// los verbos de edición ordinarios («quita», «elimina») NO cuentan — son
// instrucciones de cambio, no hipótesis descartadas, y registrarlos
// ensuciaría la sección de descartados del expediente.
const USER_DISCARD_RE = /(?:descarta(?:r)?|desecha(?:r)?|no uses?|no usar|revert[ií](?:r)?|revertir|deshaz|deshacer)\b[:\s]+([^.,;\n]{3,80})/i;

function distillTurnFacts(steps = [], context = {}) {
  const facts = [];
  const decisions = [];
  const discarded = [];
  const userText = String(context.userText || "");
  const list = Array.isArray(steps) ? steps : [];
  for (const s of list) {
    if (!s || s.ok === false || s.result?.ok === false || s.blocked) continue;
    const file = String(s.input?.path || s.result?.path || "").replace(/\\/g, "/");
    if (s.name === "read_file" && file) {
      const content = String(s.result?.content || s.result?.text || "");
      const beforeCount = facts.length;
      factsFromContent(file, content, facts);
      // Para-qué de la lectura: solo si el pedido del usuario nombra el
      // archivo o alguna sección/símbolo hallado en él en este turno.
      const stem = looseKey(file.split("/").pop().replace(/\.[a-z0-9]+$/i, ""));
      const userLoose = looseKey(userText);
      const namesHere = facts.slice(beforeCount).filter((f) => f.kind === "section").map((f) => looseKey(f.name));
      const why = userText && (userLoose.includes(stem) || namesHere.some((n) => n && userLoose.includes(n)))
        ? `pedido del turno: «${userText.trim().slice(0, 110)}»`
        : "";
      const readFact = { kind: "read", file };
      if (why) readFact.why = why;
      facts.push(readFact);
    } else if (s.name === "write_file" && file) {
      factsFromContent(file, String(s.input?.content || ""), facts);
    } else if (s.name === "replace_in_file" && file) {
      // Solo el texto NUEVO afirma lo que el archivo pasa a contener/usar;
      // el viejo afirma lo contrario y no se registra.
      factsFromContent(file, String(s.input?.newText || ""), facts);
    }
  }
  // Decisiones: solo hechos del usuario que el kernel puede afirmar.
  const rawUser = userText.trim();
  if (rawUser) {
    const authorizedMarker = /INSTRUCCI[OÓ]N AUTORIZADA DEL USUARIO/i.test(rawUser);
    if ((rawUser.length <= 60 && APPROVAL_TURN_RE.test(rawUser)) || (context.userAuthorized === true && authorizedMarker)) {
      decisions.push("Autorización: el usuario aceptó ejecutar con un mensaje de aprobación («procede») en este hilo.");
    }
    const choice = rawUser.match(USER_CHOICE_RE);
    if (choice) decisions.push(`Opción elegida por el usuario: ${choice[1].trim()}`);
    const discard = rawUser.match(USER_DISCARD_RE);
    if (discard) {
      const target = discard[1].trim();
      discarded.push(`Descartado por el usuario (su mensaje lo dice): ${target}`);
      decisions.push(`El usuario descartó: ${target}`);
    }
  }
  return { facts, decisions, discarded };
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
      // [EDITCORE-INTEGRAL-B3] Hechos destilados de los steps de ESTE
      // turno (la misma fuente que el resumen factual del Bloque 1):
      // archivo↔sección, asset↔uso y lecturas quedan persistidos, y las
      // decisiones afirmables alimentan noteDecision — que hasta ahora
      // tenía 0 llamadores en producción y las «decisiones» del
      // expediente estaban vacías en uso real.
      if (meta && Array.isArray(meta.steps) && typeof threadMemory.noteFacts === "function") {
        const distilled = distillTurnFacts(meta.steps, {
          userText: String(userText || ""),
          userAuthorized: meta.userAuthorized === true,
        });
        if (distilled.facts.length) threadMemory.noteFacts(projectRoot, distilled.facts);
        for (const d of distilled.decisions) threadMemory.noteDecision(projectRoot, d);
        for (const d of distilled.discarded) threadMemory.noteDiscarded(projectRoot, d);
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
  // [EDITCORE-INTEGRAL-B3]
  distillTurnFacts,
  slimStoredAssistantText,
  subagentContext,
  threadMemory,
};
