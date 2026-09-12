"use strict";

/**
 * Adjunta stream de logs al child del preview y detecta errores de compile/runtime.
 * Emite eventos para UI y auto-heal del kernel (VERIFIER).
 */

const { detectDevLogIssue } = require("../editcore-chat-kernel/dev-log-detector");
const { attachProcessStreams, detectSevereIssue } = require("../editcore-chat-kernel/process-runner");

const DEFAULT_COOLDOWN_MS = 45_000;

/**
 * @param {object} opts
 * @param {import('child_process').ChildProcess} opts.child
 * @param {string} opts.projectRoot
 * @param {(payload: object) => void} opts.emit
 * @param {Map} [opts.stateByRoot]
 * @param {number} [opts.cooldownMs]
 */
function attachPreviewLogStream({
  child,
  projectRoot,
  emit,
  stateByRoot,
  cooldownMs = DEFAULT_COOLDOWN_MS,
}) {
  if (!child || !projectRoot || typeof emit !== "function") {
    return { detach: () => {} };
  }

  const stateMap = stateByRoot || new Map();
  let state = stateMap.get(projectRoot);
  if (!state) {
    state = { buffer: "", lastIssueAt: 0, lastSummary: "" };
    stateMap.set(projectRoot, state);
  }

  const attached = attachProcessStreams(child, {
    cooldownMs,
    onChunk: ({ stream, chunk, buffer }) => {
      state.buffer = buffer || state.buffer;
      emit({
        type: "preview-log",
        projectRoot,
        stream,
        chunk: String(chunk || "").slice(-2000),
        at: Date.now(),
      });
    },
    onSevereError: (issue) => {
      state.lastIssueAt = issue.at || Date.now();
      state.lastSummary = issue.summary || "";
      emit({
        type: "preview-issue",
        projectRoot,
        issue: {
          kind: issue.kind,
          summary: issue.summary,
          excerpt: issue.excerpt,
        },
        at: issue.at || Date.now(),
        autoHeal: true,
        wakeVerifier: true,
      });
    },
  });

  return {
    detach() {
      attached.detach();
    },
  };
}

module.exports = {
  attachPreviewLogStream,
  detectDevLogIssue,
  detectSevereIssue,
  DEFAULT_COOLDOWN_MS,
};
