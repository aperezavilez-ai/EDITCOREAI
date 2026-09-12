"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const reportPath = process.env.EDITCORE_PHASE4_SECURE_REPORT
  || path.join(process.cwd(), "phase4-results", "secure-state-audit.json");

function hostOf(value) {
  try { return new URL(String(value || "")).hostname; } catch { return ""; }
}

function itemShape(item) {
  if (!item || typeof item !== "object") return { type: typeof item };
  return {
    id: String(item.id || ""),
    name: String(item.name || ""),
    providerKey: String(item.providerKey || ""),
    model: String(item.model || ""),
    status: String(item.status || ""),
    baseHost: hostOf(item.baseUrl),
    modelCount: Array.isArray(item.models) ? item.models.length : Number(item.modelCount || 0),
    enabledModelCount: Array.isArray(item.enabledModels) ? item.enabledModels.length : 0,
    hasCredential: Boolean(String(item.apiKey || item.token || item.secret || item.projectKey || "").trim()),
  };
}

function stateShape(value) {
  const report = { keys: Object.keys(value || {}).sort(), entries: {} };
  for (const key of report.keys) {
    const entry = value[key];
    if (Array.isArray(entry)) {
      report.entries[key] = { type: "array", count: entry.length, items: entry.slice(0, 100).map(itemShape) };
    } else if (entry && typeof entry === "object") {
      report.entries[key] = {
        type: "object",
        count: Object.keys(entry).length,
        keys: Object.keys(entry).filter((name) => !/key|token|secret|password/i.test(name)).sort(),
      };
    } else {
      report.entries[key] = { type: typeof entry };
    }
  }
  return report;
}

function readEncrypted(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, bytes: 0, state: { keys: [], entries: {} } };
  if (!safeStorage.isEncryptionAvailable()) throw new Error("El almacenamiento seguro de Windows no esta disponible.");
  const payload = fs.readFileSync(filePath);
  const value = JSON.parse(safeStorage.decryptString(payload));
  return { exists: true, bytes: payload.length, state: stateShape(value) };
}

app.whenReady().then(() => {
  const userData = path.join(app.getPath("appData"), "EDITCOREAI");
  const report = {
    generatedAt: new Date().toISOString(),
    userData,
    secureConfig: readEncrypted(path.join(userData, "editcore-secure-config.bin")),
    gatewayProjects: readEncrypted(path.join(userData, "editcore-gafcore-projects.bin")),
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  app.quit();
}).catch((error) => {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), error: String(error?.message || error) }, null, 2)}\n`, "utf8");
  app.exit(2);
});
