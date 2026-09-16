"use strict";

/**
 * Memoria de hilo persistente.
 * Corta: últimos turnos del chat.
 * Proyecto: objetivo, estilo, decisiones, “qué estaba haciendo”.
 * Recuperación: ranking por tokens de la consulta actual.
 */

const fs = require("fs");
const path = require("path");

const SHORT_TURNS = 12;
const SHORT_CHARS = 10_000;
const STORE_TURNS = 80;
const MAX_DECISIONS = 40;
const MAX_NOTES = 50;

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
    updatedAt: new Date().toISOString(),
  };
  if (next.decisions.length > MAX_DECISIONS) next.decisions = next.decisions.slice(-MAX_DECISIONS);
  if (next.notes.length > MAX_NOTES) next.notes = next.notes.slice(-MAX_NOTES);
  if (next.files.length > 80) next.files = next.files.slice(-80);
  writeJson(projectFile(projectRoot), next);
  return next;
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
    merged.push({ role: role === "assistant" ? "assistant" : "user", content: text.slice(0, 1800) });
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
  const project = loadProjectState(projectRoot);
  const thread = loadThread(projectRoot, threadId);
  const relevant = retrieveRelevant(projectRoot, threadId, query, 5);
  const parts = ["[ESTADO DEL HILO — no empieces en frío]"];
  if (project.objective) parts.push(`Objetivo: ${project.objective}`);
  const working = thread.workingOn || project.workingOn;
  if (working) parts.push(`Qué estaba haciendo: ${working}`);
  if (project.style) parts.push(`Estilo: ${project.style}`);
  if (project.decisions.length) {
    parts.push("Decisiones recientes:");
    for (const d of project.decisions.slice(-5)) parts.push(`- ${d.text}`);
  }
  if (project.files.length) {
    parts.push("Archivos recientes:");
    for (const f of project.files.slice(-6)) parts.push(`- ${f.action || "touch"} ${f.rel || f}`);
  }
  if (relevant.length) {
    parts.push("Recuerdo relevante a este mensaje:");
    for (const r of relevant.slice(0, 4)) {
      parts.push(`- (${r.source}) ${String(r.text).replace(/\s+/g, " ").slice(0, 220)}`);
    }
  }
  parts.push("Continúa el MISMO hilo. No pidas contexto que ya está arriba. No reinicies la tarea.");
  try {
    const busTxt = require("./agent-bus").promptBlock(projectRoot, threadId);
    if (busTxt) parts.push(busTxt);
  } catch { /* optional */ }
  return parts.join("\n").slice(0, 3_600);
}

module.exports = {
  loadThread,
  saveThread,
  appendTurns,
  loadProjectState,
  saveProjectState,
  noteDecision,
  noteWorkingOn,
  retrieveRelevant,
  shortHistoryMessages,
  projectPromptBlock,
  safeId,
};
