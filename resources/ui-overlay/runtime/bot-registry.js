"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JARVIS_BOTS } = require("./jarvis-port");

function defaultRun(bot, context = {}) {
  return {
    ok: true,
    botId: bot.id,
    name: bot.name,
    subAgent: bot.subAgent,
    mode: "advisory",
    summary: `${bot.name} registrado en EditCore. Usa el sub-agente ${bot.subAgent} cuando el orquestador active ${bot.agentType}.`,
    skills: bot.skills || [],
    wakeConditions: bot.wakeConditions || [],
    projectRoot: context.projectRoot || "",
  };
}

async function runCodeHealth(bot, context = {}) {
  const root = String(context.projectRoot || "").trim();
  if (!root || !fs.existsSync(root)) return defaultRun(bot, context);
  let todoCount = 0;
  let largeFiles = 0;
  const walk = (dir, depth = 0) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          if (stat.size > 120_000) largeFiles += 1;
          if (/\.(js|ts|tsx|jsx|py|md)$/i.test(entry.name) && stat.size < 512_000) {
            const text = fs.readFileSync(full, "utf8");
            todoCount += (text.match(/\b(TODO|FIXME|HACK)\b/g) || []).length;
          }
        } catch { /* ignore */ }
      }
    }
  };
  walk(root);
  const findings = [];
  if (todoCount > 10) findings.push({ type: "todo_debt", count: todoCount });
  if (largeFiles > 0) findings.push({ type: "large_files", count: largeFiles });
  return {
    ok: true,
    botId: bot.id,
    name: bot.name,
    subAgent: bot.subAgent,
    mode: "scan",
    summary: findings.length
      ? `Auditoría rápida: ${findings.map((f) => `${f.type}=${f.count}`).join(", ")}`
      : "Auditoría rápida: sin hallazgos críticos en archivos de texto.",
    findings,
    projectRoot: root,
  };
}

const RUNNERS = {
  "jarvis-code-health": runCodeHealth,
};

class BotRegistry {
  constructor() {
    this.bots = new Map();
    for (const bot of JARVIS_BOTS) {
      this.bots.set(bot.id, {
        ...bot,
        status: "ready",
        lastRunAt: null,
        lastSummary: "",
      });
    }
  }

  list() {
    return [...this.bots.values()].map((bot) => ({
      id: bot.id,
      name: bot.name,
      agentType: bot.agentType,
      subAgent: bot.subAgent,
      description: bot.description,
      skills: bot.skills,
      wakeConditions: bot.wakeConditions,
      status: bot.status,
      lastRunAt: bot.lastRunAt,
      lastSummary: bot.lastSummary,
      source: bot.source,
    }));
  }

  get(id) {
    return this.bots.get(String(id || "")) || null;
  }

  matchWake(eventType) {
    const event = String(eventType || "").trim();
    if (!event) return [];
    return this.list().filter((bot) => (bot.wakeConditions || []).includes(event));
  }

  async run(id, context = {}) {
    const bot = this.get(id);
    if (!bot) throw new Error(`Bot no registrado: ${id}`);
    const runner = RUNNERS[bot.id] || defaultRun;
    const result = await runner(bot, context);
    bot.status = "ready";
    bot.lastRunAt = Date.now();
    bot.lastSummary = String(result.summary || "");
    return result;
  }

  directorStatus() {
    return {
      native: true,
      requiresSidecar: false,
      botCount: this.bots.size,
      bots: this.list(),
    };
  }

  formatDirectorContext() {
    const lines = [
      "DIRECTOR EDITCORE (bots Jarvis portados, runtime nativo):",
      ...this.list().map((bot) => `- ${bot.name} [${bot.subAgent}]: ${bot.description}`),
    ];
    return lines.join("\n");
  }
}

let singleton = null;

function getBotRegistry() {
  if (!singleton) singleton = new BotRegistry();
  return singleton;
}

module.exports = {
  BotRegistry,
  getBotRegistry,
};
