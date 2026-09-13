"use strict";

const { Notification } = require("electron");
const { checkAllProjects } = require("./project-maintainer");

const CONFIG_KEY = "editcore-maintenance-scheduler";
const REGISTRY_KEY = "editcore-project-registry";

const DEFAULT_CONFIG = {
  enabled: true,
  intervalHours: 24,
  notifyOnIssues: true,
  lastRunAt: null,
  lastResult: null,
};

function normalizeConfig(raw = {}) {
  const intervalHours = Math.max(1, Math.min(168, Number(raw.intervalHours) || 24));
  return {
    enabled: raw.enabled !== false,
    intervalHours,
    notifyOnIssues: raw.notifyOnIssues !== false,
    lastRunAt: raw.lastRunAt || null,
    lastResult: raw.lastResult || null,
  };
}

function getSchedulerConfig(readSecureState) {
  const secure = typeof readSecureState === "function" ? readSecureState() : {};
  return normalizeConfig(secure[CONFIG_KEY] || {});
}

function setSchedulerConfig(readSecureState, writeSecureState, patch = {}) {
  const secure = typeof readSecureState === "function" ? readSecureState() : {};
  const next = normalizeConfig({ ...(secure[CONFIG_KEY] || {}), ...patch });
  secure[CONFIG_KEY] = next;
  if (typeof writeSecureState === "function") writeSecureState(secure);
  return next;
}

function getProjectRegistry(readSecureState) {
  const secure = typeof readSecureState === "function" ? readSecureState() : {};
  const list = Array.isArray(secure[REGISTRY_KEY]) ? secure[REGISTRY_KEY] : [];
  return list.filter((item) => item?.projectRoot && typeof item.projectRoot === "string");
}

function syncProjectRegistry(readSecureState, writeSecureState, projects = []) {
  const secure = typeof readSecureState === "function" ? readSecureState() : {};
  const normalized = [];
  const seen = new Set();
  for (const project of projects) {
    const root = String(project?.projectRoot || project?.root || "").trim();
    if (!root || seen.has(root.toLowerCase())) continue;
    seen.add(root.toLowerCase());
    normalized.push({
      id: String(project?.id || root),
      name: String(project?.name || root.split(/[\\/]/).pop() || "proyecto"),
      projectRoot: root,
      updatedAt: Date.now(),
    });
  }
  secure[REGISTRY_KEY] = normalized;
  if (typeof writeSecureState === "function") writeSecureState(secure);
  return normalized;
}

async function runMaintenanceCheck({
  readSecureState,
  writeSecureState,
  readConnections,
  projects = null,
  notify = true,
} = {}) {
  const registry = Array.isArray(projects) ? projects : getProjectRegistry(readSecureState);
  const connections = typeof readConnections === "function" ? readConnections() : {};
  const result = await checkAllProjects(registry, connections);
  const unhealthy = (result.projects || []).filter((item) => !item.ok);
  const payload = {
    ok: unhealthy.length === 0,
    at: new Date().toISOString(),
    count: result.count || 0,
    healthy: result.healthy || 0,
    unhealthy: unhealthy.length,
    projects: result.projects || [],
    issues: unhealthy.map((item) => ({
      name: item.name,
      projectRoot: item.projectRoot,
      issues: item.issues || [],
    })),
  };
  setSchedulerConfig(readSecureState, writeSecureState, {
    lastRunAt: payload.at,
    lastResult: {
      ok: payload.ok,
      count: payload.count,
      healthy: payload.healthy,
      unhealthy: payload.unhealthy,
    },
  });
  const config = getSchedulerConfig(readSecureState);
  if (notify && config.notifyOnIssues && unhealthy.length > 0 && Notification.isSupported()) {
    const names = unhealthy.slice(0, 3).map((item) => item.name).join(", ");
    new Notification({
      title: "EditCore — alertas de mantenimiento",
      body: `${unhealthy.length} proyecto(s) con problemas: ${names}${unhealthy.length > 3 ? "…" : ""}`,
    }).show();
  }
  return payload;
}

function createMaintenanceScheduler({
  readSecureState,
  writeSecureState,
  readConnections,
  getBrowserWindows,
  onResult,
} = {}) {
  let timer = null;
  let running = false;

  async function tick({ notify = true } = {}) {
    if (running) return { ok: false, skipped: true, message: "Chequeo en curso." };
    running = true;
    try {
      const result = await runMaintenanceCheck({
        readSecureState,
        writeSecureState,
        readConnections,
        notify,
      });
      const windows = typeof getBrowserWindows === "function" ? getBrowserWindows() : [];
      for (const win of windows) {
        if (!win?.isDestroyed?.()) {
          win.webContents.send("maintenance:completed", result);
        }
      }
      if (typeof onResult === "function") onResult(result);
      return result;
    } finally {
      running = false;
    }
  }

  function scheduleNext() {
    if (timer) clearInterval(timer);
    timer = null;
    const config = getSchedulerConfig(readSecureState);
    if (!config.enabled) return;
    const intervalMs = config.intervalHours * 60 * 60 * 1000;
    timer = setInterval(() => {
      tick({ notify: true }).catch(() => undefined);
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function start() {
    scheduleNext();
    const config = getSchedulerConfig(readSecureState);
    if (!config.enabled || !config.lastRunAt) {
      setTimeout(() => tick({ notify: false }).catch(() => undefined), 15_000);
    } else {
      const elapsed = Date.now() - Date.parse(config.lastRunAt);
      const due = elapsed >= config.intervalHours * 60 * 60 * 1000;
      if (due) setTimeout(() => tick({ notify: true }).catch(() => undefined), 5_000);
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function updateConfig(patch = {}) {
    const next = setSchedulerConfig(readSecureState, writeSecureState, patch);
    scheduleNext();
    return next;
  }

  return { start, stop, tick, updateConfig, getConfig: () => getSchedulerConfig(readSecureState) };
}

module.exports = {
  CONFIG_KEY,
  REGISTRY_KEY,
  DEFAULT_CONFIG,
  getSchedulerConfig,
  setSchedulerConfig,
  getProjectRegistry,
  syncProjectRegistry,
  runMaintenanceCheck,
  createMaintenanceScheduler,
};
