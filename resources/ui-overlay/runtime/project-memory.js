"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Memoria de proyecto local (sin servicios de pago).
 * Archivo: .editcore/memory.json
 */

function memoryPath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "memory.json");
}

function emptyMemory() {
  return {
    version: 2,
    updatedAt: "",
    summary: "",
    stack: [],
    decisions: [],
    recentFiles: [],
    recentTasks: [],
    architectureRules: [],
    styleGuides: [],
    profiles: {},
  };
}

function loadProjectMemory(projectRoot) {
  const file = memoryPath(projectRoot);
  try {
    if (!fs.existsSync(file)) return emptyMemory();
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...emptyMemory(),
      ...raw,
      stack: Array.isArray(raw.stack) ? raw.stack.slice(0, 12) : [],
      decisions: Array.isArray(raw.decisions) ? raw.decisions.slice(0, 20) : [],
      recentFiles: Array.isArray(raw.recentFiles) ? raw.recentFiles.slice(0, 30) : [],
      recentTasks: Array.isArray(raw.recentTasks) ? raw.recentTasks.slice(0, 12) : [],
      architectureRules: Array.isArray(raw.architectureRules) ? raw.architectureRules.slice(0, 40) : [],
      styleGuides: Array.isArray(raw.styleGuides) ? raw.styleGuides.slice(0, 20) : [],
      profiles: raw.profiles && typeof raw.profiles === "object" ? raw.profiles : {},
    };
  } catch {
    return emptyMemory();
  }
}

function saveProjectMemory(projectRoot, memory = {}) {
  const root = String(projectRoot || "");
  if (!root) return null;
  const file = memoryPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = {
    ...emptyMemory(),
    ...memory,
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, file);
  return next;
}

function rememberProjectEvent(projectRoot, event = {}) {
  const memory = loadProjectMemory(projectRoot);
  const task = String(event.task || event.prompt || "").trim().slice(0, 240);
  const summary = String(event.summary || event.status || "").trim().slice(0, 500);
  const files = (Array.isArray(event.files) ? event.files : [])
    .map((item) => String(item || "").replace(/\\/g, "/").trim())
    .filter(Boolean)
    .slice(0, 20);
  const stack = (Array.isArray(event.stack) ? event.stack : [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 12);
  const decision = String(event.decision || "").trim().slice(0, 240);

  if (task) {
    memory.recentTasks = [{ at: new Date().toISOString(), task, summary }, ...memory.recentTasks]
      .slice(0, 12);
  }
  if (summary) memory.summary = summary;
  if (files.length) {
    memory.recentFiles = [...new Set([...files, ...memory.recentFiles])].slice(0, 30);
  }
  if (stack.length) {
    memory.stack = [...new Set([...stack, ...memory.stack])].slice(0, 12);
  }
  if (decision) {
    memory.decisions = [{ at: new Date().toISOString(), text: decision }, ...memory.decisions].slice(0, 20);
  }
  const rule = String(event.architectureRule || event.rule || "").trim().slice(0, 400);
  if (rule) {
    memory.architectureRules = [
      { at: new Date().toISOString(), text: rule },
      ...memory.architectureRules.filter((row) => row.text !== rule),
    ].slice(0, 40);
  }
  const style = String(event.styleGuide || event.style || "").trim().slice(0, 400);
  if (style) {
    memory.styleGuides = [
      { at: new Date().toISOString(), text: style },
      ...memory.styleGuides.filter((row) => row.text !== style),
    ].slice(0, 20);
  }
  if (event.profile && typeof event.profile === "object") {
    const name = String(event.profile.name || event.profileId || "default").trim() || "default";
    memory.profiles[name] = {
      ...(memory.profiles[name] || {}),
      ...event.profile,
      updatedAt: new Date().toISOString(),
    };
  }
  return saveProjectMemory(projectRoot, memory);
}

function upsertArchitectureRule(projectRoot, ruleText) {
  return rememberProjectEvent(projectRoot, { architectureRule: ruleText });
}

function formatArchitectureBlock(memory = {}) {
  const rules = memory?.architectureRules || [];
  const styles = memory?.styleGuides || [];
  if (!rules.length && !styles.length) return "";
  return [
    "REGLAS DE ARQUITECTURA / ESTILO (.editcore/memory.json):",
    ...rules.slice(0, 12).map((row) => `- ${row.text}`),
    ...styles.slice(0, 8).map((row) => `- Estilo: ${row.text}`),
  ].join("\n");
}

function formatMemoryForPrompt(memory = {}) {
  const data = memory && typeof memory === "object" ? memory : emptyMemory();
  if (!data.summary && !(data.recentTasks || []).length && !(data.recentFiles || []).length) {
    return "";
  }
  return [
    "MEMORIA LOCAL DEL PROYECTO (.editcore/memory.json):",
    data.summary ? `- Resumen: ${data.summary}` : "",
    data.stack?.length ? `- Stack: ${data.stack.join(", ")}` : "",
    data.recentFiles?.length ? `- Archivos recientes: ${data.recentFiles.slice(0, 12).join(", ")}` : "",
    data.recentTasks?.length
      ? `- Tareas recientes:\n${data.recentTasks.slice(0, 5).map((row) => `  · ${row.task}`).join("\n")}`
      : "",
    data.decisions?.length
      ? `- Decisiones:\n${data.decisions.slice(0, 5).map((row) => `  · ${row.text}`).join("\n")}`
      : "",
    formatArchitectureBlock(data),
    "- Usa esta memoria para continuar sin redescubrir el proyecto; verifica en disco si dudas.",
  ].filter(Boolean).join("\n");
}

module.exports = {
  memoryPath,
  loadProjectMemory,
  saveProjectMemory,
  rememberProjectEvent,
  upsertArchitectureRule,
  formatArchitectureBlock,
  formatMemoryForPrompt,
  emptyMemory,
};
