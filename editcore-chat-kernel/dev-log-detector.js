"use strict";

/**
 * Detector de errores de compilación/runtime en logs de Vite/Next.
 * Usado por el daemon de preview (main) y por el kernel (auto-heal).
 */

const COMPILE_RE = /(?:Failed to compile|Build error|Module not found|SyntaxError|TypeError|ReferenceError|TypeScript error|error TS\d+|✘\s*\[ERROR\]|Build failed|Cannot find module|Unexpected token)/i;
const FATAL_RE = /(?:EADDRINUSE|ENOENT|ELIFECYCLE|\bFatal\b|panic)/i;
const NEXT_SERVER_ENOENT_RE = /ENOENT[\s\S]{0,180}?[\\/]\.next[\\/]server[\\/]|Cannot find module[\s\S]{0,120}?[\\/]\.next[\\/]server[\\/]|routes-manifest\.json/i;

// Ruido de la caché interna de Next/webpack (.next): el servidor de desarrollo la regenera solo.
// No es un error del código del proyecto, así que no se reporta ni dispara reparaciones.
const DEV_CACHE_NOISE_RE = /^<w>|\[webpack\.cache\.PackFileCacheStrategy\]|ENOENT[^\n]{0,200}?[\\/]\.next[\\/](?:cache|server|static|trace|types)\b|\.pack(?:\.gz)?_?['"]?\s*(?:->|\]|\{|$)/i;

function isDevCacheNoiseLine(line) {
  return DEV_CACHE_NOISE_RE.test(String(line || "").trim());
}

const ERROR_DUMP_FIELD_RE = /^(?:errno|code|syscall|path|dest|spawnargs|digest)\s*:|^\}\s*$/i;

/** Quita las líneas de ruido de caché y el bloque `{ errno, code, syscall, path }` que las acompaña. */
function stripDevCacheNoise(text) {
  const kept = [];
  let inNoiseDump = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (isDevCacheNoiseLine(trimmed)) {
      inNoiseDump = inNoiseDump || /\{\s*$/.test(trimmed);
      continue;
    }
    if (inNoiseDump) {
      if (ERROR_DUMP_FIELD_RE.test(trimmed) || !trimmed) {
        if (/^\}\s*$/.test(trimmed)) inNoiseDump = false;
        continue;
      }
      inNoiseDump = false;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function detectDevLogIssue(chunk) {
  const text = stripDevCacheNoise(chunk);
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

module.exports = {
  detectDevLogIssue,
  isDevCacheNoiseLine,
  stripDevCacheNoise,
  COMPILE_RE,
  FATAL_RE,
  NEXT_SERVER_ENOENT_RE,
  DEV_CACHE_NOISE_RE,
};
