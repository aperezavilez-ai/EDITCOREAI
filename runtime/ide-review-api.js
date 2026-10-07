"use strict";

/**
 * API única de review (Accept/Reject) — delega en unified-review.
 * No duplica @mentions ni el menú @ del chat.
 *
 * Uso:
 *   const api = require("./ide-review-api");
 *   api.list(projectRoot)
 *   api.accept(projectRoot, idOrPath)
 *   api.reject(projectRoot, idOrPath)
 *   api.acceptAll(projectRoot)
 *   api.rejectAll(projectRoot)
 */

const unified = require("./unified-review");

function refFrom(idOrPath) {
  if (!idOrPath) return {};
  if (typeof idOrPath === "object") return idOrPath;
  const s = String(idOrPath);
  if (s.startsWith("chg_") || s.startsWith("ckpt:")) return { id: s };
  if (s.includes("/") || s.includes("\\") || s.includes(".")) return { path: s };
  return { id: s };
}

module.exports = {
  list(projectRoot, status = "pending", options = {}) {
    const result = unified.list(projectRoot, options);
    if (status === "all") return result;
    return {
      ...result,
      items: (result.items || []).filter((it) => it.status === status),
      count: (result.items || []).filter((it) => it.status === status).length,
    };
  },
  accept(projectRoot, idOrPath, options = {}) {
    return unified.accept(projectRoot, refFrom(idOrPath), options);
  },
  reject(projectRoot, idOrPath, options = {}) {
    return unified.reject(projectRoot, refFrom(idOrPath), options);
  },
  acceptAll(projectRoot, options = {}) {
    return unified.acceptAll(projectRoot, options);
  },
  rejectAll(projectRoot, options = {}) {
    return unified.rejectAll(projectRoot, options);
  },
  getPendingPrompt(projectRoot) {
    return unified.getPendingPrompt(projectRoot);
  },
  enqueueFromWrite: unified.enqueueFromWrite,
};
