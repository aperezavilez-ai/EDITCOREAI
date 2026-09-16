"use strict";

/**
 * Tablero compartido por threadId.
 * Explorer, analyst, implementer, verifier y workers leen/escriben el mismo estado.
 */

const fs = require("fs");
const path = require("path");

function busFile(projectRoot, threadId) {
  const id = String(threadId || "default").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "default";
  return path.join(String(projectRoot || "."), ".editcore", "chat-memory", `bus-${id}.json`);
}

function emptyBus(threadId) {
  return {
    version: 1,
    threadId: threadId || "default",
    updatedAt: null,
    goal: "",
    phase: "idle",
    findings: [],
    files: [],
    skillsUsed: [],
    toolsUsed: [],
    subagents: [],
    lastResult: "",
  };
}

function loadBus(projectRoot, threadId) {
  const file = busFile(projectRoot, threadId);
  try {
    if (!fs.existsSync(file)) return emptyBus(threadId);
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...emptyBus(threadId), ...raw };
  } catch {
    return emptyBus(threadId);
  }
}

function saveBus(projectRoot, threadId, data) {
  const next = {
    ...emptyBus(threadId),
    ...data,
    findings: (data.findings || []).slice(-40),
    files: (data.files || []).slice(-60),
    skillsUsed: (data.skillsUsed || []).slice(-20),
    toolsUsed: (data.toolsUsed || []).slice(-40),
    subagents: (data.subagents || []).slice(-20),
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(busFile(projectRoot, threadId)), { recursive: true });
    const tmp = `${busFile(projectRoot, threadId)}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, busFile(projectRoot, threadId));
  } catch (_) {}
  return next;
}

function record(projectRoot, threadId, entry = {}) {
  const bus = loadBus(projectRoot, threadId);
  if (entry.goal) bus.goal = String(entry.goal).slice(0, 400);
  if (entry.phase) bus.phase = String(entry.phase).slice(0, 40);
  if (entry.lastResult) bus.lastResult = String(entry.lastResult).slice(0, 2000);
  if (entry.finding) {
    bus.findings.push({ t: Date.now(), agent: entry.agent || "kernel", text: String(entry.finding).slice(0, 600) });
  }
  if (entry.file) {
    bus.files.push({ t: Date.now(), rel: entry.file, action: entry.action || "touch", agent: entry.agent || "kernel" });
  }
  if (entry.tool) bus.toolsUsed.push({ t: Date.now(), name: entry.tool, agent: entry.agent || "kernel" });
  if (entry.skill) {
    const name = String(entry.skill);
    if (!bus.skillsUsed.includes(name)) bus.skillsUsed.push(name);
  }
  if (entry.agent && entry.summary) {
    bus.subagents.push({
      t: Date.now(),
      agent: entry.agent,
      ok: entry.ok !== false,
      summary: String(entry.summary).slice(0, 800),
    });
  }
  return saveBus(projectRoot, threadId, bus);
}

function promptBlock(projectRoot, threadId) {
  const bus = loadBus(projectRoot, threadId);
  if (!bus.updatedAt && !bus.goal && !bus.findings.length) return "";
  const lines = ["[BUS COMPARTIDO — mismos agentes, misma tarea]"];
  if (bus.goal) lines.push(`Objetivo vivo: ${bus.goal}`);
  if (bus.phase) lines.push(`Fase: ${bus.phase}`);
  if (bus.lastResult) lines.push(`Último resultado: ${bus.lastResult.replace(/\s+/g, " ").slice(0, 280)}`);
  if (bus.subagents.length) {
    lines.push("Subagentes recientes:");
    for (const s of bus.subagents.slice(-5)) {
      lines.push(`- ${s.agent}${s.ok === false ? " (falló)" : ""}: ${s.summary}`);
    }
  }
  if (bus.findings.length) {
    lines.push("Hallazgos:");
    for (const f of bus.findings.slice(-5)) lines.push(`- [${f.agent}] ${f.text}`);
  }
  if (bus.files.length) {
    lines.push("Archivos en el bus:");
    for (const f of bus.files.slice(-6)) lines.push(`- ${f.action} ${f.rel} (${f.agent})`);
  }
  if (bus.toolsUsed.length) {
    const names = [...new Set(bus.toolsUsed.slice(-12).map((t) => t.name))];
    lines.push(`Tools usadas: ${names.join(", ")}`);
  }
  if (bus.skillsUsed.length) lines.push(`Skills activas: ${bus.skillsUsed.slice(-6).join(", ")}`);
  lines.push("Usa este bus. No relances el mapa entero. No ignores el trabajo del otro subagente.");
  return lines.join("\n").slice(0, 2200);
}

function wrapSubagentResult(projectRoot, threadId, agent, result) {
  const summary = String(result?.summary || result?.report || result?.text || result?.error || JSON.stringify({
    ok: result?.ok,
    role: result?.role,
  })).slice(0, 800);
  record(projectRoot, threadId, {
    agent,
    summary,
    ok: result?.ok !== false,
    finding: summary,
    lastResult: summary,
    phase: agent,
    tool: agent,
  });
  if (Array.isArray(result?.steps)) {
    for (const step of result.steps.slice(-12)) {
      if (step?.name) record(projectRoot, threadId, { tool: step.name, agent, file: step?.input?.path, action: step.name });
    }
  }
  return result;
}

module.exports = {
  loadBus,
  saveBus,
  record,
  promptBlock,
  wrapSubagentResult,
  busFile,
};
