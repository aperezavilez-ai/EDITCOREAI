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
  return data;
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
  return data;
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
    updatedAt: new Date().toISOString(),
  };
  if (next.decisions.length > MAX_DECISIONS) next.decisions = next.decisions.slice(-MAX_DECISIONS);
  if (next.notes.length > MAX_NOTES) next.notes = next.notes.slice(-MAX_NOTES);
  if (next.files.length > 80) next.files = next.files.slice(-80);
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
  const state = loadProjectState(projectRoot);
  state.decisions.push({ t: Date.now(), text: String(text || "").slice(0, 400) });
  return saveProjectState(projectRoot, state);
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

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-záéíóúñ0-9._/-]+/i)
    .filter((t) => t.length > 2);
}

function scoreText(hay, queryTokens) {
  const blob = String(hay || "").toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    if (blob.includes(t)) score += 2;
  }
  return score;
}

function retrieveRelevant(projectRoot, threadId, query, limit = 6) {
  const q = tokens(query);
  const thread = loadThread(projectRoot, threadId);
  const project = loadProjectState(projectRoot);
  const ranked = [];
  for (const turn of thread.turns) {
    ranked.push({ source: "thread", role: turn.role, text: turn.content, score: scoreText(turn.content, q) + 1 });
  }
  for (const d of project.decisions) {
    ranked.push({ source: "decision", role: "system", text: d.text, score: scoreText(d.text, q) + 2 });
  }
  for (const n of project.notes) {
    ranked.push({ source: "note", role: "system", text: n.text || n, score: scoreText(n.text || n, q) });
  }
  return ranked
    .filter((r) => r.text)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
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
  if (!parts.length) return "";
  return `EXPEDIENTE DEL PROYECTO (memoria persistente — úsalo en vez de re-explorar el proyecto):\n${parts.join("\n\n")}`.slice(0, DOSSIER_CHARS);
}

module.exports = {
  loadThread,
  saveThread,
  appendTurns,
  loadProjectState,
  saveProjectState,
  noteDecision,
  noteWorkingOn,
  noteVerified,
  noteDiscarded,
  retrieveRelevant,
  shortHistoryMessages,
  projectPromptBlock,
  safeId,
};
