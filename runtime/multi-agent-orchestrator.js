"use strict";

/**
 * Multi-Agent Orchestrator — Ciclo 16.
 *
 * Roles:
 * - Planner: descompone la tarea en pasos ejecutables.
 * - Coder: implementa cambios concretos por archivo.
 * - Reviewer: valida calidad, estilo y riesgos antes de aplicar.
 */

const fs = require("node:fs");
const path = require("node:path");
const { McpClient } = require("./mcp-client");

const DEFAULT_WORKSPACE = process.cwd();

class MultiAgentOrchestrator {
  constructor(options = {}) {
    this.workspace = options.workspace || DEFAULT_WORKSPACE;
    this.agents = {
      planner: options.planner || new PlannerAgent(),
      coder: options.coder || new CoderAgent(),
      reviewer: options.reviewer || new ReviewerAgent(),
    };
    this.mcpServers = new Map();
  }

  async registerMcpServer(id, config = {}) {
    const client = new McpClient({
      id,
      name: config.name || id,
      transport: config.transport || "stdio",
      command: config.command,
      args: config.args || [],
      env: config.env || {},
      cwd: this.workspace,
      timeoutMs: config.timeoutMs || 120000,
    });

    await client.connect();
    await client.initialize();
    this.mcpServers.set(id, client);
    return { ok: true, id, serverInfo: client.serverInfo, capabilities: client.capabilities };
  }

  async unregisterMcpServer(id) {
    const client = this.mcpServers.get(id);
    if (!client) {
      return { ok: false, error: `Servidor MCP '${id}' no encontrado.` };
    }
    await client.shutdown();
    this.mcpServers.delete(id);
    return { ok: true, id };
  }

  async listMcpTools() {
    const allTools = [];
    for (const [id, client] of this.mcpServers) {
      try {
        const tools = await client.listTools();
        for (const tool of tools) {
          allTools.push({ server: id, ...tool });
        }
      } catch {
        // skip servers that fail listing tools
      }
    }
    return allTools;
  }

  async callMcpTool(serverId, toolName, args = {}) {
    const client = this.mcpServers.get(serverId);
    if (!client) {
      return { ok: false, error: `Servidor MCP '${serverId}' no encontrado.` };
    }
    return client.callTool(toolName, args);
  }

  async run(input = {}) {
    const task = String(input.task || "").trim();
    if (!task) {
      return { ok: false, error: "Falta 'task' para el orquestador multi-agente." };
    }

    const mcpContext = {
      listTools: () => this.listMcpTools(),
      callTool: (serverId, toolName, args) => this.callMcpTool(serverId, toolName, args),
    };

    const plan = await this.agents.planner.plan({ task, workspace: this.workspace, mcp: mcpContext });
    if (!plan.ok) {
      return plan;
    }

    const implementation = await this.agents.coder.implement({ plan: plan.plan, workspace: this.workspace, mcp: mcpContext });
    if (!implementation.ok) {
      return implementation;
    }

    const review = await this.agents.reviewer.review({ implementation, workspace: this.workspace, mcp: mcpContext });
    if (!review.ok) {
      return review;
    }

    return {
      ok: true,
      task,
      plan: plan.plan,
      changes: implementation.changes,
      review: review.review,
      applied: review.applied,
    };
  }
}

class PlannerAgent {
  async plan(input = {}) {
    const task = String(input.task || "").trim();
    const workspace = String(input.workspace || process.cwd());

    const steps = [
      { id: "analyze", description: `Analizar alcance de: ${task}` },
      { id: "locate", description: "Identificar archivos objetivo en el workspace" },
      { id: "draft", description: "Generar borrador de cambios por archivo" },
      { id: "validate", description: "Validar coherencia y dependencias" },
    ];

    const plan = {
      task,
      workspace,
      steps,
      estimatedComplexity: steps.length > 3 ? "medium" : "low",
    };

    return { ok: true, plan };
  }
}

class CoderAgent {
  async implement(input = {}) {
    const plan = input.plan || {};
    const workspace = String(input.workspace || process.cwd());

    const changes = [];
    const targets = Array.isArray(plan.steps) ? plan.steps : [];

    for (const step of targets) {
      const fileCandidates = this._candidateFiles(workspace, step.description || step.id || "");
      const selected = fileCandidates[0] || null;

      changes.push({
        stepId: step.id,
        description: step.description,
        targetFile: selected,
        status: selected ? "ready" : "needs_manual_selection",
      });
    }

    return {
      ok: true,
      changes,
      note: "Implementación simbólica; la aplicación real se delega a smart-diff o al agente parcheador.",
    };
  }

  _candidateFiles(workspace, hint = "") {
    const normalizedHint = hint.toLowerCase();
    const candidates = [];

    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const skip = [".git", "node_modules", "dist", "out", ".editcore"].includes(entry.name);
          if (!skip) walk(fullPath);
          continue;
        }

        const rel = path.relative(workspace, fullPath);
        const score = this._scoreFile(rel, normalizedHint);
        if (score > 0) candidates.push({ path: rel, score });
      }
    };

    walk(workspace);
    candidates.sort((a, b) => b.score - a.score);
    return candidates.map((item) => item.path);
  }

  _scoreFile(relPath, hint) {
    const lower = relPath.toLowerCase();
    let score = 0;

    if (lower.includes("runtime")) score += 2;
    if (lower.includes("test")) score += 1;
    if (lower.includes("main")) score += 1;
    if (lower.includes("preload")) score += 1;

    if (!hint) return score;

    const tokens = hint.split(/[^a-z0-9]+/i).filter(Boolean);
    for (const token of tokens) {
      if (lower.includes(token)) score += 3;
    }

    return score;
  }
}

class ReviewerAgent {
  async review(input = {}) {
    const implementation = input.implementation || {};
    const changes = Array.isArray(implementation.changes) ? implementation.changes : [];

    const issues = [];
    const unresolved = changes.filter((change) => change.status === "needs_manual_selection");

    if (unresolved.length > 0) {
      issues.push({
        severity: "warning",
        message: `${unresolved.length} cambio(s) sin archivo objetivo claro.`,
        items: unresolved,
      });
    }

    const applied = issues.length === 0;

    return {
      ok: true,
      review: {
        status: applied ? "approved" : "approved_with_warnings",
        issues,
        summary: applied
          ? "Listo para aplicar sin bloqueos."
          : "Aprobado con advertencias; revisar selección de archivos.",
      },
      applied,
    };
  }
}

module.exports = { MultiAgentOrchestrator };
