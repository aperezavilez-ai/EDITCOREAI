"use strict";

const fs = require("node:fs");
const path = require("node:path");

function auditPath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "audit.jsonl");
}

function appendAuditEvent(projectRoot, event = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root) return { ok: false, message: "projectRoot invalido" };
  const file = auditPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = JSON.stringify({
    at: new Date().toISOString(),
    action: String(event.action || "unknown"),
    ok: event.ok !== false,
    branch: event.branch || "",
    sha: event.sha || "",
    url: event.url || "",
    message: String(event.message || "").slice(0, 2000),
    steps: Array.isArray(event.steps) ? event.steps.slice(0, 30) : undefined,
  });
  fs.appendFileSync(file, `${line}\n`, "utf8");
  return { ok: true, path: ".editcore/audit.jsonl" };
}

function readAuditEvents(projectRoot, { limit = 50 } = {}) {
  const file = auditPath(projectRoot);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try { return JSON.parse(line); } catch { return { raw: line }; }
  }).reverse();
}

module.exports = {
  auditPath,
  appendAuditEvent,
  readAuditEvents,
};
