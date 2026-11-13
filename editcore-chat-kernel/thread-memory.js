"use strict";

/**
 * Memoria de hilo persistente.
 * Corta: últimos turnos del chat.
 * Proyecto: objetivo, estilo, decisiones, “qué estaba haciendo”.
 * Recuperación: ranking por tokens de la consulta actual.
 */

const fs = require("fs");
const path = require("path");

const SHORT_TURNS = 3;
const SHORT_CHARS = 3_000;
const STORE_TURNS = 40;
const MAX_DECISIONS = 40;
const MAX_NOTES = 50;
// [EDITCORE-DOSSIER] Expediente persistente: lo verificado y lo descartado
// se guardan aparte de las decisiones, con tope propio, para que el turno
// no tenga que re-diagnosticar lo que ya se comprobó en vivo.
const MAX_VERIFIED = 20;
const MAX_DISCARDED = 20;
const DOSSIER_CHARS = 3_500;
// [EDITCORE-INTEGRAL-B3] Hechos estructurales del expediente (archivo↔
// sección/símbolo, asset↔dónde se usa, lecturas): viven en una sección
// PROPIA con reserva declarada DENTRO del tope de 3.500. Cuando hay que
// cortar, se corta la prosa; los hechos recientes/relevantes no se
// amputan por la cola como pasaba con el bloque de retrieveRelevant.
const MAX_FACTS = 80;
const FACTS_RESERVE_CHARS = 1_100;
// [EDITCORE-V500-A2] Registro VERBATIM del hilo: los mensajes TAL CUAL
// se enviaron al proveedor (el user ya ensamblado con su contexto, la
// respuesta en su forma guardada) para construir el turno siguiente
// como prefijo guardado + mensaje nuevo, en vez de reconstruir un
// historial recortado en cada turno. La ventana SOLO se aplica en una
// compactación declarada: al superar VERBATIM_MAX_MESSAGES entradas,
// las más viejas se adelgazan una vez y el contador de compactaciones
// lo deja registrado en el propio archivo del hilo.
const VERBATIM_MAX_MESSAGES = 48;
const VERBATIM_KEEP_FULL = 12;
const VERBATIM_OLD_USER_CHARS = 1_500;
const VERBATIM_OLD_ASSISTANT_CHARS = 2_000;
// [EDITCORE-V500-A3] Comprobantes de lectura ENTRE turnos: por archivo
// y rango, la huella (mtime + tamaño) de la última lectura real. Si el
// archivo no cambió, read_file responde con el comprobante y no con el
// contenido otra vez.
const MAX_READ_RECEIPTS = 80;

function storeDir(projectRoot) {
  return path.join(String(projectRoot || "."), ".editcore", "chat-memory");
}

function threadFile(projectRoot, threadId) {
  const id = safeId(threadId);
  return path.join(storeDir(projectRoot), `thread-${id}.json`);
}

function projectFile(projectRoot) {
  return path.join(storeDir(projectRoot), "project-state.json");
}

function safeId(id) {
  const raw = String(id || "default").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return raw || "default";
}

function emptyThread(threadId) {
  return {
    version: 2,
    threadId: safeId(threadId),
    updatedAt: null,
    turns: [],
    workingOn: "",
    // [EDITCORE-V500-A2] Registro verbatim (ver constantes arriba).
    verbatim: [],
    verbatimCompactions: 0,
  };
}

function emptyProject() {
  return {
    version: 2,
    objective: "",
    style: "",
    workingOn: "",
    decisions: [],
    notes: [],
    files: [],
    verified: [],
    discarded: [],
    // [EDITCORE-INTEGRAL-B3] Hechos estructurales destilados de los steps.
    facts: [],
    // [EDITCORE-V500-A3] Comprobantes de lectura entre turnos.
    readReceipts: [],
    updatedAt: null,
  };
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return fallback;
    return { ...fallback, ...raw };
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  } catch (_) {}
}

function normalizeTurn(turn) {
  const role = turn?.role === "assistant" || turn?.role === "tool" ? turn.role : "user";
  const content = String(turn?.content || turn?.text || "").trim();
  return {
    role,
    content: content.slice(0, 6_000),
    at: Number(turn?.at) || Date.now(),
  };
}

function loadThread(projectRoot, threadId) {
  const data = readJson(threadFile(projectRoot, threadId), emptyThread(threadId));
  data.turns = Array.isArray(data.turns) ? data.turns.map(normalizeTurn).filter((t) => t.content) : [];
  data.verbatim = Array.isArray(data.verbatim) ? data.verbatim.map(sanitizeVerbatimEntry).filter(Boolean) : [];
  data.verbatimCompactions = Number(data.verbatimCompactions) || 0;
  return data;
}

// [EDITCORE-V500-A2] Entrada del registro verbatim: solo user/assistant
// con contenido de texto. Las partes de imagen NO se persisten como
// datos (una data URL por turno hincharía el archivo del hilo y la
// imagen ya se juzgó en su turno): se sustituyen por una nota de texto
// declarada, igual que la retirada de capturas del array en vivo.
function sanitizeVerbatimEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const role = entry.role === "assistant" ? "assistant" : entry.role === "user" ? "user" : null;
  if (!role) return null;
  if (typeof entry.content === "string") {
    return entry.content ? { role, content: entry.content } : null;
  }
  if (Array.isArray(entry.content)) {
    const parts = [];
    for (const part of entry.content) {
      if (part && part.type === "text" && typeof part.text === "string" && part.text) {
        parts.push({ type: "text", text: part.text });
      } else if (part && (part.type === "image_url" || part.type === "image")) {
        parts.push({ type: "text", text: "[imagen adjunta en ese turno: ya se mostró y se juzgó; no se repite en el historial]" });
      }
    }
    if (!parts.length) return null;
    if (parts.length === 1 && parts[0].type === "text") return { role, content: parts[0].text };
    return { role, content: parts };
  }
  return null;
}

// [EDITCORE-V500-A2] Compactación DECLARADA del registro verbatim: se
// ejecuta una sola vez al superar el tope, adelgaza las entradas viejas
// (conserva íntegras las VERBATIM_KEEP_FULL más recientes) y deja el
// hecho contado en thread.verbatimCompactions. Fuera de este momento,
// el registro es append-only: las entradas no se reescriben.
// [EDITCORE-V512-R2] Desde la v5.1.2 la entrada del usuario guarda su
// texto original, no el mensaje ensamblado (ver rememberExchange).
function compactVerbatimInPlace(data) {
  const list = Array.isArray(data.verbatim) ? data.verbatim : [];
  if (list.length <= VERBATIM_MAX_MESSAGES) return data;
  const keepFrom = Math.max(0, list.length - VERBATIM_KEEP_FULL);
  data.verbatim = list.map((entry, idx) => {
    if (idx >= keepFrom || typeof entry.content !== "string") return entry;
    const cap = entry.role === "assistant" ? VERBATIM_OLD_ASSISTANT_CHARS : VERBATIM_OLD_USER_CHARS;
    if (entry.content.length <= cap) return entry;
    return { role: entry.role, content: `${entry.content.slice(0, cap)}\n[mensaje antiguo adelgazado en una compactación declarada del historial]` };
  });
  data.verbatimCompactions = (Number(data.verbatimCompactions) || 0) + 1;
  return data;
}

// [EDITCORE-V500-A2] Mensajes del registro verbatim, listos para ser el
// tramo de historial del payload (copias: el llamador no debe mutar el
// registro).
function verbatimMessages(projectRoot, threadId) {
  const data = loadThread(projectRoot, threadId);
  return data.verbatim.map((entry) => (Array.isArray(entry.content)
    ? { role: entry.role, content: entry.content.map((p) => ({ ...p })) }
    : { role: entry.role, content: entry.content }));
}

// [EDITCORE-V500-A2] Anexa los mensajes de UN turno ya cerrado al
// registro (el user en su texto original [EDITCORE-V512-R2] y la
// respuesta en su forma guardada). Devuelve el hilo actualizado.
function appendVerbatimTurn(projectRoot, threadId, entries) {
  const data = loadThread(projectRoot, threadId);
  const clean = (Array.isArray(entries) ? entries : []).map(sanitizeVerbatimEntry).filter(Boolean);
  if (!clean.length) return data;
  data.verbatim = [...data.verbatim, ...clean];
  compactVerbatimInPlace(data);
  return saveThread(projectRoot, threadId, data);
}

// [EDITCORE-V500-A2] Siembra del registro desde el historial que trae
// el llamador (p. ej. la UI al abrir una conversación que el kernel aún
// no ha corrido): SOLO si el registro está vacío — una vez que el
// kernel corre un turno, su registro manda y no se re-siembra.
function seedVerbatim(projectRoot, threadId, historyInput) {
  const data = loadThread(projectRoot, threadId);
  if (data.verbatim.length) return false;
  const clean = (Array.isArray(historyInput) ? historyInput : [])
    .map((h) => sanitizeVerbatimEntry({
      role: h?.role,
      content: typeof h?.content === "string" ? h.content : (typeof h?.text === "string" ? h.text : ""),
    }))
    .filter(Boolean);
  if (!clean.length) return false;
  data.verbatim = clean;
  compactVerbatimInPlace(data);
  saveThread(projectRoot, threadId, data);
  return true;
}

function saveThread(projectRoot, threadId, data) {
  const next = {
    ...emptyThread(threadId),
    ...data,
    threadId: safeId(threadId),
    turns: (data.turns || []).slice(-STORE_TURNS),
    updatedAt: new Date().toISOString(),
  };
  writeJson(threadFile(projectRoot, threadId), next);
  return next;
}

function appendTurns(projectRoot, threadId, turns) {
  const store = loadThread(projectRoot, threadId);
  const incoming = (Array.isArray(turns) ? turns : [turns]).map(normalizeTurn).filter((t) => t.content);
  store.turns = [...store.turns, ...incoming].slice(-STORE_TURNS);
  if (incoming.length) {
    const lastUser = [...incoming].reverse().find((t) => t.role === "user");
    if (lastUser) store.workingOn = lastUser.content.slice(0, 240);
  }
  return saveThread(projectRoot, threadId, store);
}

function loadProjectState(projectRoot) {
  const data = readJson(projectFile(projectRoot), emptyProject());
  data.decisions = Array.isArray(data.decisions) ? data.decisions : [];
  data.notes = Array.isArray(data.notes) ? data.notes : [];
  data.files = Array.isArray(data.files) ? data.files : [];
  data.verified = Array.isArray(data.verified) ? data.verified : [];
  data.discarded = Array.isArray(data.discarded) ? data.discarded : [];
  // [EDITCORE-INTEGRAL-B3]
  data.facts = Array.isArray(data.facts) ? data.facts.filter((f) => f && typeof f === "object" && f.kind) : [];
  // [EDITCORE-V500-A3]
  data.readReceipts = Array.isArray(data.readReceipts) ? data.readReceipts.filter((r) => r && typeof r === "object" && r.file) : [];
  return data;
}

// [EDITCORE-V500-A3] Clave de un comprobante de lectura: ruta
// normalizada (minúsculas, barras /) + rango pedido, la misma
// normalización que usa la caché de lecturas del turno.
function readReceiptKey(file, startLine, endLine) {
  const clean = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return `${clean}#${Number(startLine) || 1}-${Number(endLine) || 0}`;
}

// [EDITCORE-V500-A3] Registra (o refresca) la huella de una lectura
// REAL entre turnos: mtime + tamaño + líneas del archivo leído.
function noteReadReceipt(projectRoot, entry) {
  if (!projectRoot || !entry || !entry.file) return loadProjectState(projectRoot);
  const clean = {
    key: readReceiptKey(entry.file, entry.startLine, entry.endLine),
    file: String(entry.file).replace(/\\/g, "/").slice(0, 300),
    startLine: Number(entry.startLine) || 1,
    endLine: Number(entry.endLine) || 0,
    mtimeMs: Number(entry.mtimeMs) || 0,
    size: Number(entry.size) || 0,
    totalLines: Number(entry.totalLines) || 0,
    at: Date.now(),
  };
  const state = loadProjectState(projectRoot);
  state.readReceipts = [...(state.readReceipts || []).filter((r) => r.key !== clean.key), clean].slice(-MAX_READ_RECEIPTS);
  return saveProjectState(projectRoot, state);
}

// [EDITCORE-V500-A3] Comprobante vigente para un archivo+rango, o null.
function findReadReceipt(projectRoot, file, startLine, endLine) {
  if (!projectRoot) return null;
  const key = readReceiptKey(file, startLine, endLine);
  const state = loadProjectState(projectRoot);
  return (state.readReceipts || []).find((r) => r.key === key) || null;
}

// [EDITCORE-V500-A3] Una escritura sobre el archivo invalida TODOS sus
// comprobantes: jamás deben tapar el contenido nuevo.
function invalidateReadReceipts(projectRoot, file) {
  if (!projectRoot || !file) return loadProjectState(projectRoot);
  const state = loadProjectState(projectRoot);
  const prefix = `${String(file).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase()}#`;
  const kept = (state.readReceipts || []).filter((r) => !String(r.key || "").startsWith(prefix));
  if (kept.length === (state.readReceipts || []).length) return state;
  state.readReceipts = kept;
  return saveProjectState(projectRoot, state);
}

function saveProjectState(projectRoot, patch = {}) {
  const prev = loadProjectState(projectRoot);
  const next = {
    ...prev,
    ...patch,
    decisions: Array.isArray(patch.decisions) ? patch.decisions : prev.decisions,
    notes: Array.isArray(patch.notes) ? patch.notes : prev.notes,
    files: Array.isArray(patch.files) ? patch.files : prev.files,
    verified: Array.isArray(patch.verified) ? patch.verified : prev.verified,
    discarded: Array.isArray(patch.discarded) ? patch.discarded : prev.discarded,
    // [EDITCORE-INTEGRAL-B3]
    facts: Array.isArray(patch.facts) ? patch.facts : prev.facts,
    updatedAt: new Date().toISOString(),
  };
  if (next.decisions.length > MAX_DECISIONS) next.decisions = next.decisions.slice(-MAX_DECISIONS);
  if (next.notes.length > MAX_NOTES) next.notes = next.notes.slice(-MAX_NOTES);
  if (next.files.length > 80) next.files = next.files.slice(-80);
  if (next.facts.length > MAX_FACTS) next.facts = next.facts.slice(-MAX_FACTS);
  if (next.verified.length > MAX_VERIFIED) next.verified = next.verified.slice(-MAX_VERIFIED);
  if (next.discarded.length > MAX_DISCARDED) next.discarded = next.discarded.slice(-MAX_DISCARDED);
  writeJson(projectFile(projectRoot), next);
  return next;
}

// [EDITCORE-DOSSIER] Hecho verificado en vivo (captura/build en verde):
// queda en el expediente para no re-verificarlo ni re-diagnosticarlo.
// Si ok es false, el hecho va a descartados en vez de verificados.
function noteVerified(projectRoot, text, ok = true) {
  const clipped = String(text || "").trim().slice(0, 400);
  if (!clipped) return loadProjectState(projectRoot);
  const state = loadProjectState(projectRoot);
  // [EDITCORE-INTEGRAL-B3] Sin duplicados exactos: el mismo verificado
  // puede llegar por dos costuras en el mismo cierre (appendRealVerification
  // y rememberExchange) y no debe ocupar dos huecos del expediente.
  const bucket = ok === false ? state.discarded : state.verified;
  if ((bucket || []).some((e) => String(e?.text || "") === clipped)) return state;
  const entry = { t: Date.now(), text: clipped };
  if (ok === false) {
    state.discarded = [...(state.discarded || []), entry];
    return saveProjectState(projectRoot, state);
  }
  state.verified = [...(state.verified || []), entry];
  return saveProjectState(projectRoot, state);
}

// [EDITCORE-DOSSIER] Hipótesis descartada por evidencia (no por opinión):
// el próximo turno la ve y no vuelve a intentarla sin evidencia nueva.
function noteDiscarded(projectRoot, text) {
  return noteVerified(projectRoot, text, false);
}

function noteDecision(projectRoot, text) {
  const clipped = String(text || "").trim().slice(0, 400);
  if (!clipped) return loadProjectState(projectRoot);
  const state = loadProjectState(projectRoot);
  // [EDITCORE-INTEGRAL-B3] Sin duplicados exactos (la misma autorización
  // destilada en dos cierres no se repite en el expediente).
  if (state.decisions.some((d) => String(d?.text || "") === clipped)) return state;
  state.decisions.push({ t: Date.now(), text: clipped });
  return saveProjectState(projectRoot, state);
}

// [EDITCORE-INTEGRAL-B3] Texto plano de un hecho: es lo que se puntúa en
// la recuperación y lo que se lista en la sección de hechos del bloque.
function factText(fact) {
  if (!fact || typeof fact !== "object") return "";
  const file = String(fact.file || "").replace(/\\/g, "/");
  if (fact.kind === "section") {
    return fact.relation === "renderiza"
      ? `${file} renderiza/usa la sección/símbolo ${fact.name} (no lo define)`
      : `${file} contiene la sección/símbolo ${fact.name}`;
  }
  if (fact.kind === "asset") {
    return `${fact.asset} se usa en ${file}${fact.section ? ` (sección ${fact.section})` : ""}`;
  }
  if (fact.kind === "read") {
    return `leído: ${file}${fact.why ? ` — ${fact.why}` : ""}`;
  }
  return String(fact.text || "");
}

function factKey(fact) {
  return [
    fact.kind || "",
    String(fact.file || "").replace(/\\/g, "/").toLowerCase(),
    normalizeLoose(fact.name || ""),
    normalizeLoose(fact.asset || ""),
    fact.relation || "",
    normalizeLoose(fact.section || ""),
  ].join("|");
}

// [EDITCORE-INTEGRAL-B3] Registra hechos estructurales destilados por el
// kernel (thread-core). Dedupe por clave semántica: si el hecho ya
// existe, se REFRESCA su marca de tiempo y pasa al final (recencia),
// sin duplicarlo. Nunca infiere: solo guarda lo que el llamador afirmó.
function noteFacts(projectRoot, facts) {
  const incoming = (Array.isArray(facts) ? facts : []).filter((f) => f && typeof f === "object" && f.kind && (f.file || f.text));
  if (!incoming.length) return loadProjectState(projectRoot);
  const state = loadProjectState(projectRoot);
  const byKey = new Map();
  for (const f of state.facts || []) byKey.set(factKey(f), f);
  for (const f of incoming) {
    const clean = {
      kind: String(f.kind),
      file: String(f.file || "").replace(/\\/g, "/").slice(0, 200),
      t: Date.now(),
    };
    if (f.name) clean.name = String(f.name).slice(0, 80);
    if (f.relation) clean.relation = String(f.relation).slice(0, 20);
    if (f.asset) clean.asset = String(f.asset).replace(/\\/g, "/").slice(0, 200);
    if (f.section) clean.section = String(f.section).slice(0, 80);
    if (f.why) clean.why = String(f.why).slice(0, 160);
    if (f.text) clean.text = String(f.text).slice(0, 300);
    const key = factKey(clean);
    byKey.delete(key);
    byKey.set(key, clean);
  }
  state.facts = [...byKey.values()];
  return saveProjectState(projectRoot, state);
}

function noteFact(projectRoot, fact) {
  return noteFacts(projectRoot, [fact]);
}

function noteWorkingOn(projectRoot, text, threadId) {
  const clipped = String(text || "").slice(0, 400);
  saveProjectState(projectRoot, { ...loadProjectState(projectRoot), workingOn: clipped });
  if (threadId) {
    const th = loadThread(projectRoot, threadId);
    th.workingOn = clipped;
    saveThread(projectRoot, threadId, th);
  }
}

// [EDITCORE-INTEGRAL-B3] Normalización suelta para comparar hechos y
// consultas: minúsculas y SIN acentos («está» = «esta», «sección» =
// «seccion»). La recuperación anterior era subcadena literal sensible a
// acentos y devolvía el top-6 aunque nada casara (ruido con +1 base).
function normalizeLoose(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// [EDITCORE-INTEGRAL-B3] Palabras vacías fuera de los tokens de
// consulta: sin esto, un «del» o un «para» casaba con cualquier texto y
// el umbral de relevancia no umbralaba nada.
const QUERY_STOPWORDS = new Set([
  "del", "los", "las", "una", "unos", "unas", "con", "para", "por", "que",
  "esta", "este", "esto", "estan", "donde", "como", "cuando", "cuanto",
  "cuanta", "cual", "cuales", "hay", "fue", "son", "era", "mas", "muy",
  "sin", "sobre", "entre", "desde", "hasta", "tiene", "tienen",
]);

function tokens(text) {
  return normalizeLoose(text)
    .split(/[^a-z0-9._/-]+/)
    .filter((t) => t.length > 2 && !QUERY_STOPWORDS.has(t));
}

// [EDITCORE-INTEGRAL-B3] Sinónimos DECLARADOS y mínimos (bidireccionales):
// solo equivalencias seguras del dominio de una landing. Nada de stemming
// general ni de inferencias: si un par no está aquí, no se expande.
const QUERY_SYNONYMS = {
  hero: ["portada"],
  portada: ["hero"],
  foto: ["imagen"],
  fotos: ["imagen"],
  imagen: ["foto"],
  home: ["inicio"],
  inicio: ["home"],
};

function expandQueryTokens(queryTokens) {
  const out = new Set(queryTokens);
  for (const t of queryTokens) {
    for (const syn of QUERY_SYNONYMS[t] || []) out.add(syn);
  }
  return [...out];
}

function scoreText(hay, queryTokens) {
  const blob = normalizeLoose(hay);
  let score = 0;
  for (const t of queryTokens) {
    if (t && blob.includes(t)) score += 2;
  }
  return score;
}

// [EDITCORE-INTEGRAL-B3] Recuperación con UMBRAL y hechos primero: un
// hecho solo entra si algún token de la consulta (o su sinónimo
// declarado) casa con él; la prosa solo entra si casa de verdad (fuera
// el +1/+2 base que devolvía ruido siempre). Orden: hechos que casan,
// luego decisiones/notas/turnos que casan.
function retrieveRelevant(projectRoot, threadId, query, limit = 6) {
  const q = expandQueryTokens(tokens(query));
  if (!q.length) return [];
  const thread = loadThread(projectRoot, threadId);
  const project = loadProjectState(projectRoot);
  const factHits = [];
  for (const f of project.facts || []) {
    const text = factText(f);
    const score = scoreText(text, q);
    if (text && score > 0) factHits.push({ source: "fact", role: "system", text, fact: f, score });
  }
  factHits.sort((a, b) => b.score - a.score);
  const rest = [];
  for (const d of project.decisions) {
    const score = scoreText(d.text, q);
    if (score > 0) rest.push({ source: "decision", role: "system", text: d.text, score: score + 1 });
  }
  for (const n of project.notes) {
    const text = n.text || n;
    const score = scoreText(text, q);
    if (score > 0) rest.push({ source: "note", role: "system", text, score });
  }
  for (const turn of thread.turns) {
    const score = scoreText(turn.content, q);
    if (score > 0) rest.push({ source: "thread", role: turn.role, text: turn.content, score });
  }
  rest.sort((a, b) => b.score - a.score);
  return [...factHits, ...rest].slice(0, Math.max(1, limit));
}

function shortHistoryMessages(historyInput, projectRoot, threadId, query) {
  const fromInput = Array.isArray(historyInput) ? historyInput : [];
  const persisted = loadThread(projectRoot, threadId).turns;
  const merged = [];
  const seen = new Set();
  const push = (role, content) => {
    const text = String(content || "").trim();
    if (!text) return;
    const key = `${role}:${text.slice(0, 180)}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push({ role: role === "assistant" ? "assistant" : "user", content: text.slice(0, 1000) });
  };
  for (const t of persisted) push(t.role === "assistant" ? "assistant" : "user", t.content);
  for (const t of fromInput) {
    const role = t?.role === "assistant" ? "assistant" : "user";
    push(role, t?.content || t?.text);
  }
  // Drop trailing copy of the current user query (added separately).
  const q = String(query || "").trim();
  while (merged.length && merged[merged.length - 1].role === "user" && merged[merged.length - 1].content === q) {
    merged.pop();
  }
  let out = merged.slice(-SHORT_TURNS);
  let total = out.reduce((n, m) => n + m.content.length, 0);
  while (out.length > 2 && total > SHORT_CHARS) {
    total -= out[0].content.length;
    out = out.slice(1);
  }
  return out;
}

// [EDITCORE-INTEGRAL-B3] Sección de hechos del expediente, compacta y
// legible (archivo ↔ sección ↔ asset). Orden: primero los hechos que
// casan con la consulta (recuperación con umbral), después los más
// recientes. Las lecturas de archivos que ya tienen hecho de sección o
// de asset no se duplican como línea suelta. La sección ENTERA vive
// dentro de FACTS_RESERVE_CHARS: si no cabe, salen los hechos menos
// relevantes/recientes, nunca se desborda sobre la prosa.
function buildFactsSection(project, query) {
  const facts = Array.isArray(project?.facts) ? project.facts : [];
  if (!facts.length) return "";
  const coveredFiles = new Set();
  for (const f of facts) {
    if (f.kind === "section" || f.kind === "asset") coveredFiles.add(String(f.file || "").toLowerCase());
  }
  const visible = facts.filter((f) => f.kind !== "read" || !coveredFiles.has(String(f.file || "").toLowerCase()));
  if (!visible.length) return "";
  const q = expandQueryTokens(tokens(query || ""));
  const scored = visible.map((f, idx) => ({ f, idx, score: q.length ? scoreText(factText(f), q) : 0 }));
  scored.sort((a, b) => (b.score - a.score) || (b.idx - a.idx));
  const header = "Hechos del expediente (archivo ↔ sección ↔ asset; úsalos en vez de re-explorar):";
  const lines = [header];
  let used = header.length;
  for (const { f } of scored) {
    let line = "";
    const file = String(f.file || "").replace(/\\/g, "/");
    if (f.kind === "section") {
      line = f.relation === "renderiza"
        ? `- \`${file}\` renderiza/usa «${f.name}» (no lo define)`
        : `- \`${file}\` contiene «${f.name}»`;
    } else if (f.kind === "asset") {
      line = `- \`${f.asset}\` se usa en \`${file}\`${f.section ? ` (sección ${f.section})` : ""}`;
    } else if (f.kind === "read") {
      line = `- leído: \`${file}\`${f.why ? ` — ${f.why}` : ""}`;
    } else if (f.text) {
      line = `- ${f.text}`;
    }
    if (!line) continue;
    if (used + line.length + 1 > FACTS_RESERVE_CHARS) continue;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function projectPromptBlock(projectRoot, threadId, query) {
  if (!projectRoot) return "";
  const project = loadProjectState(projectRoot);
  const thread = loadThread(projectRoot, threadId);
  const parts = [];
  const working = thread.workingOn || project.workingOn;
  if (working) parts.push(`Tarea en curso: ${working.slice(0, 300)}`);
  if (project.objective) parts.push(`Objetivo: ${String(project.objective).slice(0, 200)}`);
  if (project.style) parts.push(`Estilo: ${String(project.style).slice(0, 200)}`);
  // Antes solo llegaba LA ÚLTIMA decisión (150 caracteres): el resto de lo
  // acordado se perdía y el agente volvía a preguntarlo o a re-explorarlo.
  if (project.decisions.length) {
    const last = project.decisions.slice(-5)
      .map((d) => String(d?.text || "").trim()).filter(Boolean)
      .map((t) => `- ${t.slice(0, 200)}`);
    if (last.length) parts.push(`Decisiones:\n${last.join("\n")}`);
  }
  if (project.notes.length) {
    const last = project.notes.slice(-5)
      .map((n) => String(n?.text || n || "").trim()).filter(Boolean)
      .map((t) => `- ${t.slice(0, 200)}`);
    if (last.length) parts.push(`Notas:\n${last.join("\n")}`);
  }
  if (project.files.length) {
    const last = project.files.slice(-8)
      .map((f) => `- ${f?.action || "tocado"} ${f?.rel || f?.path || ""}`.trim());
    if (last.length) parts.push(`Archivos clave:\n${last.join("\n")}`);
  }
  // [EDITCORE-DOSSIER] Lo verificado no se re-diagnostica; lo descartado
  // no se reintenta sin evidencia nueva. Es lo que evita el bucle de
  // VIXERAI (mismo diagnóstico, tres turnos, 100k+ tokens por turno).
  if (project.verified.length) {
    const last = project.verified.slice(-5)
      .map((v) => String(v?.text || "").trim()).filter(Boolean)
      .map((t) => `- ${t.slice(0, 200)}`);
    if (last.length) parts.push(`Verificado en vivo (no lo re-verifiques ni lo re-diagnostiques):\n${last.join("\n")}`);
  }
  if (project.discarded.length) {
    const last = project.discarded.slice(-5)
      .map((d) => String(d?.text || "").trim()).filter(Boolean)
      .map((t) => `- ${t.slice(0, 200)}`);
    if (last.length) parts.push(`Descartado por evidencia (no lo reintentes sin evidencia nueva):\n${last.join("\n")}`);
  }
  // [EDITCORE-DOSSIER] retrieveRelevant existía pero NADIE lo llamaba: el
  // historial corto solo trae los últimos 3 turnos y todo lo anterior se
  // re-exploraba. Ahora los turnos viejos relevantes al pedido actual
  // llegan aquí, sin duplicar los 3 que ya van en el historial corto.
  try {
    const q = String(query || "").trim();
    if (q) {
      const recent = new Set(
        (thread.turns || []).slice(-SHORT_TURNS).map((t) => String(t?.content || "").slice(0, 180))
      );
      const hits = retrieveRelevant(projectRoot, threadId, q, 6)
        .filter((r) => r?.source === "thread" && r?.text)
        .filter((r) => !recent.has(String(r.text).slice(0, 180)))
        .slice(0, 3);
      if (hits.length) {
        const lines = hits.map((h) => `- [${h.role === "assistant" ? "agente" : "usuario"}] ${String(h.text).replace(/\s+/g, " ").slice(0, 300)}`);
        parts.push(`De turnos anteriores, relevante a este pedido (no está en el historial corto):\n${lines.join("\n")}`);
      }
    }
  } catch { /* el expediente nunca tumba el turno */ }
  // [EDITCORE-INTEGRAL-B3] Montaje con reserva protegida: la sección de
  // hechos se coloca JUSTO tras el encabezado y su espacio se descuenta
  // del presupuesto de la prosa ANTES de cortar. Antes todo el bloque se
  // cortaba por la cola a 3.500 y la recuperación (al final de parts) era
  // lo primero amputado; ahora, si hay que cortar, se corta la PROSA.
  const factsSection = buildFactsSection(project, query);
  if (!parts.length && !factsSection) return "";
  const header = "EXPEDIENTE DEL PROYECTO (memoria persistente — úsalo en vez de re-explorar el proyecto):";
  const prose = parts.join("\n\n");
  const fixedChars = header.length + (factsSection ? factsSection.length + 2 : 0);
  const proseBudget = Math.max(0, DOSSIER_CHARS - fixedChars - (prose ? 2 : 0));
  const proseClipped = prose.length > proseBudget ? prose.slice(0, proseBudget) : prose;
  return [header, factsSection, proseClipped].filter(Boolean).join("\n\n").slice(0, DOSSIER_CHARS);
}

module.exports = {
  loadThread,
  saveThread,
  appendTurns,
  // [EDITCORE-V500-A2] Registro verbatim del hilo.
  verbatimMessages,
  appendVerbatimTurn,
  seedVerbatim,
  VERBATIM_MAX_MESSAGES,
  // [EDITCORE-V500-A3] Comprobantes de lectura entre turnos.
  noteReadReceipt,
  findReadReceipt,
  invalidateReadReceipts,
  readReceiptKey,
  loadProjectState,
  saveProjectState,
  noteDecision,
  noteWorkingOn,
  noteVerified,
  noteDiscarded,
  // [EDITCORE-INTEGRAL-B3]
  noteFact,
  noteFacts,
  factText,
  buildFactsSection,
  normalizeLoose,
  FACTS_RESERVE_CHARS,
  DOSSIER_CHARS,
  retrieveRelevant,
  shortHistoryMessages,
  projectPromptBlock,
  safeId,
};
