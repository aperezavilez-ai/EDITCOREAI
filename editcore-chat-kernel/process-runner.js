"use strict";

/**
 * Process runner EditCoreAI — spawn + streaming (reemplaza exec síncrono).
 * Evita timeouts en builds/dev servers capturando stdout/stderr en vivo.
 */

const { spawn } = require("child_process");
const path = require("path");
const { detectDevLogIssue } = require("./dev-log-detector");

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_CAPTURE = 12_000;
const LONG_RUNNING_RE = /(?:^|\s)(?:npm\s+run\s+(?:dev|start)|pnpm\s+(?:dev|start)|yarn\s+(?:dev|start)|npx\s+next\s+dev|next\s+dev|vite(?:\s|$)|webpack-dev-server)\b/i;

const SEVERE_RE = /(?:Build error|Failed to compile|ENOENT|TypeScript error|error TS\d+|ELIFECYCLE|Module not found|SyntaxError|EADDRINUSE)/i;
const NEXT_SERVER_ENOENT_RE = /ENOENT[\s\S]{0,180}?[\\/]\.next[\\/]server[\\/]|Cannot find module[\s\S]{0,120}?[\\/]\.next[\\/]server[\\/]|routes-manifest\.json/i;

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function isLongRunningCommand(command) {
  return LONG_RUNNING_RE.test(String(command || ""));
}

function detectSevereIssue(chunk, bufferTail) {
  const fromDetector = detectDevLogIssue(chunk) || detectDevLogIssue(bufferTail);
  const text = `${chunk || ""}\n${bufferTail || ""}`;
  if (fromDetector || SEVERE_RE.test(text)) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const hit = (fromDetector && fromDetector.summary)
      || lines.find((l) => SEVERE_RE.test(l))
      || lines.slice(-2).join(" | ");
    const nextServerEnoent = NEXT_SERVER_ENOENT_RE.test(text);
    return {
      kind: nextServerEnoent || /ENOENT|EADDRINUSE|ELIFECYCLE/i.test(text) ? "fatal" : "compile",
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

/**
 * Adjunta listeners de stream a un child ya spawnado.
 */
function attachProcessStreams(child, {
  onChunk,
  onSevereError,
  cooldownMs = 45_000,
  maxCapture = MAX_CAPTURE,
} = {}) {
  let buffer = "";
  let lastIssueAt = 0;
  let lastSummary = "";

  const handle = (raw, stream) => {
    const text = stripAnsi(raw);
    if (!text) return;
    buffer = (buffer + text).slice(-maxCapture);
    try { onChunk?.({ stream, chunk: text, buffer }); } catch { /* ignore */ }

    const issue = detectSevereIssue(text, buffer.slice(-2500));
    if (!issue) return;
    const now = Date.now();
    if (issue.summary === lastSummary && now - lastIssueAt < cooldownMs) return;
    lastIssueAt = now;
    lastSummary = issue.summary;
    try {
      onSevereError?.({
        ...issue,
        stream,
        at: now,
        autoHeal: true,
      });
    } catch { /* ignore */ }
  };

  const onOut = (c) => handle(c, "stdout");
  const onErr = (c) => handle(c, "stderr");
  child.stdout?.on("data", onOut);
  child.stderr?.on("data", onErr);

  return {
    getBuffer: () => buffer,
    detach() {
      child.stdout?.off?.("data", onOut);
      child.stderr?.off?.("data", onErr);
      child.stdout?.removeListener?.("data", onOut);
      child.stderr?.removeListener?.("data", onErr);
    },
  };
}

/**
 * Ejecuta un comando con spawn + captura streaming.
 * @param {object} opts
 * @param {string} opts.cwd
 * @param {string} opts.command
 * @param {number} [opts.timeoutMs]
 * @param {boolean} [opts.background] forzar modo background (dev servers)
 * @param {(ev: object) => void} [opts.onChunk]
 * @param {(issue: object) => void} [opts.onSevereError]
 * @param {AbortSignal} [opts.signal]
 */
function runProcess({
  cwd,
  command,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  background = false,
  onChunk,
  onSevereError,
  signal,
  env,
} = {}) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return Promise.resolve({ ok: false, command: "", error: "Comando vacío", stdout: "", stderr: "" });
  }

  const root = path.resolve(cwd || process.cwd());
  const longLived = background || isLongRunningCommand(cmd);

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(cmd, {
      cwd: root,
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0", ...(env || {}) },
    });

    const streams = attachProcessStreams(child, {
      onChunk: (ev) => {
        if (ev.stream === "stdout") stdout = (stdout + ev.chunk).slice(-MAX_CAPTURE);
        else stderr = (stderr + ev.chunk).slice(-MAX_CAPTURE);
        onChunk?.(ev);
      },
      onSevereError,
    });

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      const keepStreams = Boolean(payload.streaming && payload.ok !== false);
      if (!keepStreams) {
        try { streams.detach(); } catch { /* ignore */ }
      }
      if (timer) clearTimeout(timer);
      if (onAbort) {
        try { signal.removeEventListener("abort", onAbort); } catch { /* ignore */ }
      }
      resolve({
        ok: payload.ok !== false,
        command: cmd,
        pid: child.pid || null,
        streaming: Boolean(payload.streaming),
        timedOut,
        background: longLived && payload.streaming,
        error: payload.error,
        stdout: String(stdout || "").slice(-MAX_CAPTURE),
        stderr: String(stderr || "").slice(-MAX_CAPTURE),
        code: payload.code ?? null,
        detach: keepStreams ? () => streams.detach() : null,
      });
    };

    let timer = null;
    if (!longLived && timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch { /* ignore */ }
        finish({
          ok: false,
          error: `Timeout tras ${timeoutMs}ms (spawn streaming).`,
          code: null,
        });
      }, timeoutMs);
    }

    let onAbort = null;
    if (signal) {
      onAbort = () => {
        try { child.kill(); } catch { /* ignore */ }
        finish({ ok: false, error: "Abortado", code: null });
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("error", (err) => {
      finish({ ok: false, error: String(err.message || err).slice(0, 500), code: null });
    });

    if (longLived) {
      // Dev servers: no esperar exit; devolver cuando el proceso esté vivo o tras breve arranque.
      const bootMs = Math.min(4000, Math.max(1500, timeoutMs || 4000));
      setTimeout(() => {
        if (settled) return;
        if (child.killed || child.exitCode != null) {
          finish({
            ok: false,
            error: `Proceso de desarrollo terminó temprano (code=${child.exitCode})`,
            code: child.exitCode,
          });
          return;
        }
        // Mantener streams activos vía onSevereError; el caller gestiona el child si guarda pid.
        finish({
          ok: true,
          streaming: true,
          error: undefined,
          code: null,
        });
      }, bootMs);

      child.once("exit", (code) => {
        if (settled) return;
        finish({
          ok: code === 0,
          streaming: false,
          error: code === 0 ? undefined : `Exit code ${code}`,
          code,
        });
      });
      return;
    }

    child.on("close", (code) => {
      finish({
        ok: !timedOut && code === 0,
        error: timedOut
          ? `Timeout tras ${timeoutMs}ms (spawn streaming).`
          : (code === 0 ? undefined : `Exit code ${code}`),
        code,
      });
    });
  });
}

module.exports = {
  runProcess,
  attachProcessStreams,
  isLongRunningCommand,
  detectSevereIssue,
  SEVERE_RE,
  LONG_RUNNING_RE,
  DEFAULT_TIMEOUT_MS,
  MAX_CAPTURE,
};
