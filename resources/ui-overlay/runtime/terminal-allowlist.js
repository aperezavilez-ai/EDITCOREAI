"use strict";

/**
 * Allowlist de terminal (anti-Yolo por defecto).
 * Yolo Mode: permite cualquier comando del proyecto (con aviso).
 */

const fs = require("node:fs");
const path = require("node:path");

const SAFE_PREFIXES = [
  "node ",
  "npm ",
  "npx ",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "dir ",
  "ls ",
  "type ",
  "cat ",
  "echo ",
  "python ",
  "py ",
];

function allowlistPath(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "terminal-allowlist.json");
}

function defaultAllowlist() {
  return {
    version: 1,
    yolo: false,
    prefixes: [...SAFE_PREFIXES],
    updatedAt: new Date().toISOString(),
  };
}

function readTerminalPolicy(projectRoot) {
  const file = allowlistPath(projectRoot);
  if (!fs.existsSync(file)) return defaultAllowlist();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      version: 1,
      yolo: parsed.yolo === true,
      prefixes: Array.isArray(parsed.prefixes) && parsed.prefixes.length
        ? parsed.prefixes.map(String)
        : [...SAFE_PREFIXES],
      updatedAt: String(parsed.updatedAt || ""),
    };
  } catch {
    return defaultAllowlist();
  }
}

function writeTerminalPolicy(projectRoot, policy) {
  const file = allowlistPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const next = {
    version: 1,
    yolo: policy.yolo === true,
    prefixes: Array.isArray(policy.prefixes) ? policy.prefixes.map(String) : [...SAFE_PREFIXES],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function setYoloMode(projectRoot, enabled) {
  const current = readTerminalPolicy(projectRoot);
  return writeTerminalPolicy(projectRoot, { ...current, yolo: enabled === true });
}

function isCommandAllowed(projectRoot, command = "") {
  const policy = readTerminalPolicy(projectRoot);
  const cmd = String(command || "").trim();
  if (!cmd) return { ok: false, reason: "comando vacio" };
  try {
    const { evaluateAgentCommandPolicy } = require("./rules-engine");
    const risk = evaluateAgentCommandPolicy(cmd, { fullAccess: policy.yolo === true });
    if (risk.level === "block") {
      return { ok: false, yolo: false, policy, reason: risk.reason || "bloqueado por RulesEngine" };
    }
    if (risk.level === "confirm" && risk.enforceEvenFullAccess && policy.yolo) {
      return {
        ok: false,
        yolo: true,
        policy,
        reason: `YOLO no salta confirmacion destructiva: ${risk.kind || risk.message || "confirm"}`,
        requiresConfirm: true,
        risk,
      };
    }
  } catch {
    // si falla el motor, no bloquear el allowlist legado
  }
  if (policy.yolo) return { ok: true, yolo: true, policy };
  const lower = cmd.toLowerCase();
  if (policy.prefixes.some((p) => lower.startsWith(String(p).toLowerCase()))) {
    return { ok: true, yolo: false, policy };
  }
  return {
    ok: false,
    yolo: false,
    policy,
    reason: "Comando fuera de allowlist. Activa YOLO MODE o anade el prefijo en .editcore/terminal-allowlist.json",
  };
}

module.exports = {
  allowlistPath,
  readTerminalPolicy,
  writeTerminalPolicy,
  setYoloMode,
  isCommandAllowed,
  SAFE_PREFIXES,
};
