"use strict";

/**
 * Persistencia de UI (proyectos + chats) en userData.
 * localStorage solo no sobrevive bien a relaunch/hotfix entre builds.
 */

const fs = require("node:fs");
const path = require("node:path");

const SESSION_FILE = "editcore-ui-session.json";
const MAX_MESSAGES_PER_CHAT = 120;
const MAX_CONTENT_CHARS = 12_000;

function sessionPath(userDataPath) {
  return path.join(String(userDataPath || ""), SESSION_FILE);
}

function stripHeavyMessage(message = {}) {
  const images = Array.isArray(message.images)
    ? message.images.map((img) => ({
      name: img?.name || "",
      mimeType: img?.mimeType || "",
      // No persistir dataUrl gigante; basta metadato.
      hadImage: Boolean(img?.dataUrl || img?.url),
    }))
    : [];
  const documents = Array.isArray(message.documents)
    ? message.documents.map((doc) => ({
      name: doc?.name || "",
      mimeType: doc?.mimeType || "",
      hadDocument: true,
    }))
    : [];
  return {
    role: message.role,
    content: String(message.content || "").slice(0, MAX_CONTENT_CHARS),
    usage: message.usage || null,
    images,
    documents,
    at: message.at || message.updatedAt || Date.now(),
  };
}

function compactProject(project = {}) {
  const chats = Array.isArray(project.chats) ? project.chats : [];
  const compactChats = chats.map((chat) => {
    const messages = Array.isArray(chat.messages) ? chat.messages : [];
    const trimmed = messages.slice(-MAX_MESSAGES_PER_CHAT).map(stripHeavyMessage);
    return {
      id: chat.id,
      title: chat.title || "Chat",
      messages: trimmed,
      createdAt: chat.createdAt || chat.updatedAt || Date.now(),
      updatedAt: chat.updatedAt || Date.now(),
    };
  });
  const messages = Array.isArray(project.messages)
    ? project.messages.slice(-MAX_MESSAGES_PER_CHAT).map(stripHeavyMessage)
    : (compactChats[0]?.messages || []);
  return {
    id: project.id,
    title: project.title || "Proyecto",
    projectRoot: project.projectRoot || "",
    mode: project.mode,
    model: project.model,
    permissionMode: project.permissionMode,
    activeChatId: project.activeChatId || compactChats[0]?.id || "",
    chats: compactChats,
    messages,
    analysisMemory: project.analysisMemory || null,
    agentWorkflow: project.agentWorkflow
      ? {
        taskId: project.agentWorkflow.taskId || "",
        planId: project.agentWorkflow.planId || "",
        task: String(project.agentWorkflow.task || "").slice(0, 4000),
        plan: String(project.agentWorkflow.plan || "").slice(0, 8000),
        phase: project.agentWorkflow.phase || "",
        updatedAt: project.agentWorkflow.updatedAt || Date.now(),
      }
      : null,
    updatedAt: project.updatedAt || Date.now(),
  };
}

function loadUiSession(userDataPath) {
  const file = sessionPath(userDataPath);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return {
      version: 1,
      savedAt: raw.savedAt || 0,
      activeProjectId: String(raw.activeProjectId || ""),
      projects: Array.isArray(raw.projects) ? raw.projects : [],
    };
  } catch {
    return null;
  }
}

function saveUiSession(userDataPath, payload = {}) {
  const file = sessionPath(userDataPath);
  const projects = Array.isArray(payload.projects)
    ? payload.projects.map(compactProject)
    : [];

  // Proteccion contra sobreescritura accidental con lista vacia si en disco ya existian proyectos
  if (projects.length === 0 && payload.allowEmpty !== true) {
    const existing = loadUiSession(userDataPath);
    if (existing && Array.isArray(existing.projects) && existing.projects.length > 0) {
      return { ok: true, path: file, projects: existing.projects.length, savedAt: existing.savedAt, skipped: true };
    }
  }

  const body = {
    version: 1,
    savedAt: Date.now(),
    activeProjectId: String(payload.activeProjectId || ""),
    projects,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body), "utf8");
  fs.renameSync(tmp, file);
  return { ok: true, path: file, projects: projects.length, savedAt: body.savedAt };
}

module.exports = {
  loadUiSession,
  saveUiSession,
  sessionPath,
  compactProject,
};
