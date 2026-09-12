"use strict";

const fs = require("node:fs");
const path = require("node:path");

const appDir = path.resolve(__dirname, "..");
const mainSrc = fs.readFileSync(path.join(appDir, "main.js"), "utf8");
const preloadSrc = fs.readFileSync(path.join(appDir, "preload.js"), "utf8");
const taskIpcSrc = fs.readFileSync(path.join(appDir, "runtime", "task-ipc.js"), "utf8");

const report = {
  timestamp: new Date().toISOString(),
  ipc: {
    mainHandlers: [],
    taskIpcHandlers: [],
    allHandlers: [],
    preloadCalls: [],
    unhandledInMain: [],
  },
  tools: {
    registeredTools: [],
  },
  models: {
    roles: [],
  },
};

// 1. Audit IPC Handlers
for (const m of mainSrc.matchAll(/ipcMain\.(?:handle|on)\(\s*["']([^"']+)["']/g)) {
  report.ipc.mainHandlers.push(m[1]);
}

for (const m of taskIpcSrc.matchAll(/["'](task:[a-z-]+|workflow:[a-z-]+)["']\s*:/g)) {
  report.ipc.taskIpcHandlers.push(m[1]);
}

report.ipc.allHandlers = [...new Set([...report.ipc.mainHandlers, ...report.ipc.taskIpcHandlers])];

for (const m of preloadSrc.matchAll(/ipcRenderer\.(?:invoke|send)\(\s*["']([^"']+)["']/g)) {
  report.ipc.preloadCalls.push(m[1]);
}

const allHandlersSet = new Set(report.ipc.allHandlers);
for (const ch of report.ipc.preloadCalls) {
  if (!allHandlersSet.has(ch)) {
    report.ipc.unhandledInMain.push(ch);
  }
}

// 2. Audit Tools Registered in main.js
for (const m of mainSrc.matchAll(/dispatcher\.register\(\s*\{\s*name:\s*["']([^"']+)["']/g)) {
  report.tools.registeredTools.push(m[1]);
}

// 3. Check Auto Model Selection Roles
const autoModelSrc = fs.readFileSync(path.join(appDir, "auto-model-selection.js"), "utf8");
for (const m of autoModelSrc.matchAll(/([a-zA-Z_]+):\s*Object\.freeze\(\[/g)) {
  report.models.roles.push(m[1]);
}

// Output Report
console.log("==================================================");
console.log("       AUDITORÍA DE PUNTA A PUNTA EDITCORE        ");
console.log("==================================================");
console.log(`[IPC] Canales en main.js: ${report.ipc.mainHandlers.length}`);
console.log(`[IPC] Canales en task-ipc.js: ${report.ipc.taskIpcHandlers.length}`);
console.log(`[IPC] Total canales implementados: ${report.ipc.allHandlers.length}`);
console.log(`[IPC] Total llamadas en preload.js: ${report.ipc.preloadCalls.length}`);
console.log(`[IPC] Canales sin implementar: ${report.ipc.unhandledInMain.length === 0 ? "0 (100% CUBIERTOS)" : report.ipc.unhandledInMain.join(", ")}`);
console.log(`[TOOLS] Herramientas registradas en runtime: ${report.tools.registeredTools.length} (${report.tools.registeredTools.join(", ")})`);
console.log(`[AUTO-ROUTING] Roles activos de balanceo: ${report.models.roles.join(", ")}`);
console.log("==================================================");

