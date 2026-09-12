"use strict";

/**
 * Detector de errores de compilación/runtime en logs de Vite/Next.
 * Usado por el daemon de preview (main) y por el kernel (auto-heal).
 */

const COMPILE_RE = /(?:Failed to compile|Build error|Module not found|SyntaxError|TypeError|ReferenceError|TypeScript error|error TS\d+|✘\s*\[ERROR\]|Build failed|Cannot find module|Unexpected token)/i;
const FATAL_RE = /(?:EADDRINUSE|ENOENT|ELIFECYCLE|Fatal|panic)/i;
const NEXT_SERVER_ENOENT_RE = /ENOENT[\s\S]{0,180}?[\\/]\.next[\\/]server[\\/]|Cannot find module[\s\S]{0,120}?[\\/]\.next[\\/]server[\\/]|routes-manifest\.json/i;

function detectDevLogIssue(chunk) {
  const text = String(chunk || "");
  if (!text.trim()) return null;
  if (COMPILE_RE.test(text) || FATAL_RE.test(text)) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hit = lines.find((l) => COMPILE_RE.test(l) || FATAL_RE.test(l)) || lines.slice(-3).join(" | ");
    const nextServerEnoent = NEXT_SERVER_ENOENT_RE.test(text);
    return {
      kind: nextServerEnoent || (FATAL_RE.test(text) && !COMPILE_RE.test(text)) ? "fatal" : "compile",
      summary: String(hit).slice(0, 400),
      excerpt: text.slice(-1500),
      nextServerEnoent,
      skipRetryRead: nextServerEnoent,
      autoHeal: true,
      healStrategy: nextServerEnoent ? "next-cache-rebuild" : "generic",
    };
  }
  return null;
}

module.exports = { detectDevLogIssue, COMPILE_RE, FATAL_RE, NEXT_SERVER_ENOENT_RE };
