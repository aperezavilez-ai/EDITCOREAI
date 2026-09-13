"use strict";

/**
 * RulesEngine ejecutable (aditivo): refuerza classifyCommandRisk
 * para que Acceso completo / YOLO no salten confirms destructivos.
 */

const { classifyCommandRisk } = require("../command-policy");

/**
 * @returns {{ level: 'none'|'confirm'|'block', kind?: string, message?: string, reason?: string, enforceEvenFullAccess?: boolean }}
 */
function evaluateAgentCommandPolicy(command = "", { fullAccess = false } = {}) {
  const raw = String(command || "").trim();
  if (!raw) return { level: "none" };

  // Bloqueos duros (nunca en agente, ni con Acceso completo).
  const hardBlock = [
    [/\bdrop\s+(table|database|schema)\b/i, "SQL destructivo (DROP)"],
    [/\btruncate\s+table\b/i, "SQL destructivo (TRUNCATE)"],
    [/\bgit\s+push\b[^\n]*\s(--force|-f)\b/i, "git push --force"],
    [/\bgit\s+push\s+--force\b/i, "git push --force"],
    [/\bformat\s+[a-z]:/i, "Formateo de volumen"],
    [/\bmkfs\./i, "Formateo de disco"],
    [/\bdd\s+if=/i, "Escritura directa a dispositivo"],
    [/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/i, "Eliminacion de la raiz"],
  ];
  for (const [pattern, reason] of hardBlock) {
    if (pattern.test(raw)) return { level: "block", reason, enforceEvenFullAccess: true };
  }

  // Confirm obligatorio incluso en Acceso completo.
  const alwaysConfirm = [
    [/\bgit\s+reset\s+--hard\b/i, "git reset --hard", "Restablecer el worktree con reset --hard"],
    [/\bgit\s+clean\s+-[a-zA-Z]*f/i, "git clean -f", "Borrar archivos no trackeados"],
    [/\bgit\s+push\b/i, "git push", "Publicar en remoto"],
    [/\brm\s+-rf\b/i, "eliminacion recursiva", "Eliminar archivos/carpetas de forma masiva"],
    [/\bdel\s+\/s\b/i, "eliminacion recursiva", "Eliminar archivos/carpetas de forma masiva"],
    [/\bremove-item\b.*-recurse\b/i, "eliminacion recursiva", "Eliminar archivos/carpetas de forma masiva"],
    [/\bsupabase\s+db\s+reset\b/i, "supabase db reset", "Resetear base Supabase"],
  ];
  for (const [pattern, kind, message] of alwaysConfirm) {
    if (pattern.test(raw)) {
      return {
        level: "confirm",
        kind,
        message,
        enforceEvenFullAccess: true,
      };
    }
  }

  const base = classifyCommandRisk(raw);
  if (base.level === "block") {
    return { ...base, enforceEvenFullAccess: true };
  }
  if (base.level === "confirm") {
    const kind = String(base.kind || "").toLowerCase();
    const enforce = /git push|deploy|eliminacion|supabase|github remoto|interprete shell/i.test(kind)
      || fullAccess === false;
    return { ...base, enforceEvenFullAccess: enforce };
  }
  return base;
}

function shouldRequireCommandConfirmation(policy, { fullAccess = false } = {}) {
  if (!policy || policy.level !== "confirm") return false;
  if (policy.enforceEvenFullAccess === true) return true;
  return fullAccess !== true;
}

module.exports = {
  evaluateAgentCommandPolicy,
  shouldRequireCommandConfirmation,
};
