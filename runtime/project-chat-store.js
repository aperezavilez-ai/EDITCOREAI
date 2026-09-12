"use strict";

/**
 * Chat durable por proyecto: <project>/.editcore/chats.json
 * Sobrevive a cierre accidental, apagado y hotfix del asar.
 */

const fs = require("node:fs");
const path = require("node:path");

const MAX_MESSAGES = 200;
const MAX_CONTENT = 16_000;

function chatsPath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "chats.json");
}

function stripMessage(message = {}) {
  return {
    role: message.role,
    content: String(message.content || "").slice(0, MAX_CONTENT),
    usage: message.usage || null,
    images: Array.isArray(message.images)
      ? message.images.map((img) => ({
        name: img?.name || "",
        mimeType: img?.mimeType || "",
        hadImage: Boolean(img?.dataUrl || img?.url || img?.hadImage),
      }))
      : [],
    documents: Array.isArray(message.documents)
      ? message.documents.map((doc) => ({
        name: doc?.name || "",
        mimeType: doc?.mimeType || "",
        hadDocument: true,
      }))
      : [],
    at: message.at || message.updatedAt || Date.now(),
  };
}

function compactChats(chats = []) {
  return (Array.isArray(chats) ? chats : []).map((chat) => ({
    id: chat.id,
    title: chat.title || "Chat",
    messages: (Array.isArray(chat.messages) ? chat.messages : []).slice(-MAX_MESSAGES).map(stripMessage),
    createdAt: chat.createdAt || Date.now(),
    updatedAt: chat.updatedAt || Date.now(),
  }));
}

function loadProjectChats(projectRoot) {
  const root = String(projectRoot || "").trim();
  if (!root) return null;
  const file = chatsPath(root);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return {
      version: 1,
      savedAt: raw.savedAt || 0,
      activeChatId: String(raw.activeChatId || ""),
      chats: Array.isArray(raw.chats) ? raw.chats : [],
      messages: Array.isArray(raw.messages) ? raw.messages : [],
    };
  } catch {
    return null;
  }
}

function saveProjectChats(projectRoot, payload = {}) {
  const root = String(projectRoot || "").trim();
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: "projectRoot invalido" };
  }
  const dir = path.join(root, ".editcore");
  fs.mkdirSync(dir, { recursive: true });
  const chats = compactChats(payload.chats);
  const activeChatId = String(payload.activeChatId || chats[0]?.id || "");
  const active = chats.find((c) => c.id === activeChatId) || chats[0] || null;
  const body = {
    version: 1,
    savedAt: Date.now(),
    activeChatId,
    chats,
    messages: active?.messages || (Array.isArray(payload.messages) ? payload.messages.slice(-MAX_MESSAGES).map(stripMessage) : []),
  };
  const file = chatsPath(root);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body), "utf8");
  fs.renameSync(tmp, file);
  return { ok: true, path: ".editcore/chats.json", chats: chats.length, savedAt: body.savedAt };
}

function messageCount(bundle) {
  if (!bundle) return 0;
  const chats = Array.isArray(bundle.chats) ? bundle.chats : [];
  return chats.reduce((n, c) => n + (Array.isArray(c.messages) ? c.messages.length : 0), 0)
    + (Array.isArray(bundle.messages) ? bundle.messages.length : 0);
}

/**
 * Fusiona chats en memoria con los del disco; gana el que tenga mas mensajes / updatedAt.
 */
function mergeProjectChatState(memoryProject = {}, diskBundle = null) {
  if (!diskBundle) return memoryProject;
  const memChats = Array.isArray(memoryProject.chats) ? memoryProject.chats : [];
  const diskChats = Array.isArray(diskBundle.chats) ? diskBundle.chats : [];
  if (!diskChats.length && !(diskBundle.messages || []).length) return memoryProject;

  const byId = new Map();
  for (const chat of [...diskChats, ...memChats]) {
    if (!chat?.id) continue;
    const prev = byId.get(chat.id);
    if (!prev) {
      byId.set(chat.id, chat);
      continue;
    }
    const prevN = (prev.messages || []).length;
    const nextN = (chat.messages || []).length;
    const keep = nextN > prevN
      || (nextN === prevN && (chat.updatedAt || 0) >= (prev.updatedAt || 0));
    byId.set(chat.id, keep ? chat : prev);
  }
  let chats = [...byId.values()];
  if (!chats.length && (diskBundle.messages || []).length) {
    chats = [{
      id: memoryProject.activeChatId || `chat_${Date.now()}`,
      title: "Chat 1",
      messages: diskBundle.messages,
      updatedAt: diskBundle.savedAt || Date.now(),
    }];
  }
  chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const activeChatId = memoryProject.activeChatId
    || diskBundle.activeChatId
    || chats[0]?.id
    || "";
  const active = chats.find((c) => c.id === activeChatId) || chats[0];
  return {
    ...memoryProject,
    activeChatId: active?.id || activeChatId,
    chats,
    messages: active?.messages || memoryProject.messages || [],
    updatedAt: Math.max(Number(memoryProject.updatedAt) || 0, Number(diskBundle.savedAt) || 0, Date.now()),
  };
}

module.exports = {
  chatsPath,
  loadProjectChats,
  saveProjectChats,
  mergeProjectChatState,
  messageCount,
  compactChats,
};
