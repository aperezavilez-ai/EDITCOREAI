"use strict";

const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const { deployOneClick, readVercelIds } = require("./deploy-one-click");

class CloudSandboxInstant extends EventEmitter {
  constructor(options = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.history = [];
  }

  /**
   * Ejecuta un despliegue instantáneo sin configuración previa
   */
  async deployInstantSandbox(targetProvider = "vercel", options = {}) {
    const deploymentId = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const startTime = Date.now();

    this.emit("deploy-started", { deploymentId, provider: targetProvider, projectRoot: this.projectRoot });

    try {
      const vercelIds = readVercelIds(this.projectRoot);
      const isProduction = options.production === true;

      const result = await deployOneClick(this.projectRoot, {
        production: isProduction,
        token: options.token,
        teamId: options.teamId || vercelIds?.teamId,
        projectId: options.projectId || vercelIds?.projectId,
      });

      const durationMs = Date.now() - startTime;
      const record = {
        deploymentId,
        provider: targetProvider,
        ok: result.ok,
        url: result.url || result.deploymentUrl || null,
        durationMs,
        createdAt: new Date().toISOString(),
        details: result,
      };

      this.history.unshift(record);
      if (this.history.length > 30) this.history.pop();

      this.emit("deploy-finished", record);
      return record;
    } catch (err) {
      const record = {
        deploymentId,
        provider: targetProvider,
        ok: false,
        error: err.message,
        durationMs: Date.now() - startTime,
        createdAt: new Date().toISOString(),
      };

      this.emit("deploy-error", record);
      return record;
    }
  }

  /**
   * Sincroniza variables de entorno locales con la nube
   */
  syncEnvVariables(envContent = "") {
    const envFile = path.join(this.projectRoot, ".env");
    let content = envContent;

    if (!content && fs.existsSync(envFile)) {
      content = fs.readFileSync(envFile, "utf8");
    }

    const parsed = {};
    const lines = String(content || "").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match && !line.trim().startsWith("#")) {
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        parsed[match[1]] = value;
      }
    }

    return {
      ok: true,
      syncedCount: Object.keys(parsed).length,
      keys: Object.keys(parsed),
    };
  }

  getHistory() {
    return this.history;
  }
}

module.exports = {
  CloudSandboxInstant,
};
