"use strict";

/**
 * UNIFIED REVIEW — Un solo flujo Accept / Reject (Fase IDE-B)
 *
 * NO duplica @mentions.
 * Une:
 *   - ide-review-queue  (.editcore/review-queue/)  ← writes del agente vía tools.js
 *   - agent-run-checkpoint (si está disponible)   ← last run / hunks ya existentes en UI
 *
 * API única para UI / scripts:
 *   const review = require("./unified-review");
 *   review.list(projectRoot)
 *   review.accept(projectRoot, { id } | { path })
 *   review.reject(projectRoot, { id } | { path })
 *   review.acceptAll(projectRoot)
 *   review.rejectAll(projectRoot)
 *
 * La UI actual (renderer → editcoreAgent.reviewHunk / acceptAllReview) sigue válida.
 * Esta capa es la fuente de verdad adicional en el proyecto + helper único.
 */

const path = require("path");
const { getReviewQueue } = require("./ide-review-queue");

function normalizeRel(p = "") {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Lista pendientes de la cola del proyecto (siempre disponible sin userData).
 */
function listQueue(projectRoot) {
  try {
    const q = getReviewQueue(projectRoot);
    const { items } = q.list("pending");
    return items.map((it) => ({
      source: "queue",
      id: it.id,
      path: it.path,
      status: it.status,
      at: it.at,
      created: it.created,
      diffPreview: it.diffPreview,
      hasBackup: it.hasBackup,
    }));
  } catch {
    return [];
  }
}

/**
 * Intenta leer last-run del checkpoint si el módulo y userData existen.
 */
function listCheckpoint(projectRoot, userDataPath) {
  if (!userDataPath) return [];
  try {
    const cp = require("./agent-run-checkpoint");
    const manifest = cp.peekLastAgentRun(userDataPath, projectRoot);
    if (!manifest || manifest.restored) return [];
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    return files
      .filter((f) => f && f.status === "pending")
      .map((f) => ({
        source: "checkpoint",
        id: `ckpt:${normalizeRel(f.path)}`,
        path: normalizeRel(f.path),
        status: "pending",
        at: manifest.at,
        created: f.created === true,
        runId: manifest.runId || "",
        action: f.action || "write_file",
      }));
  } catch {
    return [];
  }
}

/**
 * Lista unificada (queue + checkpoint). Dedup por path (prioridad queue).
 */
function list(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || ".");
  const fromQueue = listQueue(root);
  const fromCkpt = listCheckpoint(root, options.userDataPath);
  const byPath = new Map();
  for (const it of fromCkpt) {
    if (it.path) byPath.set(it.path, it);
  }
  for (const it of fromQueue) {
    if (it.path) byPath.set(it.path, it); // queue gana
  }
  const items = [...byPath.values()].sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return {
    ok: true,
    count: items.length,
    items,
    sources: { queue: fromQueue.length, checkpoint: fromCkpt.length },
  };
}

function accept(projectRoot, ref = {}, options = {}) {
  const root = path.resolve(projectRoot || ".");
  const id = ref.id || "";
  const rel = normalizeRel(ref.path || "");

  // 1) Cola del proyecto
  try {
    const q = getReviewQueue(root);
    if (id && !String(id).startsWith("ckpt:")) {
      const r = q.accept(id);
      if (r.ok) return { ...r, source: "queue" };
    }
    if (rel) {
      const pending = q.list("pending").items || [];
      const hit = pending.find((it) => it.path === rel);
      if (hit) {
        const r = q.accept(hit.id);
        if (r.ok) return { ...r, source: "queue" };
      }
    }
  } catch (_) {}

  // 2) Checkpoint (UI histórica)
  if (options.userDataPath && options.resolveInside) {
    try {
      const cp = require("./agent-run-checkpoint");
      const p = rel || (String(id).startsWith("ckpt:") ? String(id).slice(5) : "");
      if (p) {
        const r = cp.reviewFileDecision(options.userDataPath, root, p, "accept", {
          resolveInside: options.resolveInside,
        });
        return { ok: true, path: p, status: "accepted", source: "checkpoint", detail: r };
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  return { ok: false, error: "No se encontró el cambio pendiente (id/path)." };
}

function reject(projectRoot, ref = {}, options = {}) {
  const root = path.resolve(projectRoot || ".");
  const id = ref.id || "";
  const rel = normalizeRel(ref.path || "");

  try {
    const q = getReviewQueue(root);
    if (id && !String(id).startsWith("ckpt:")) {
      const r = q.reject(id);
      if (r.ok) return { ...r, source: "queue" };
    }
    if (rel) {
      const pending = q.list("pending").items || [];
      const hit = pending.find((it) => it.path === rel);
      if (hit) {
        const r = q.reject(hit.id);
        if (r.ok) return { ...r, source: "queue" };
      }
    }
  } catch (_) {}

  if (options.userDataPath && options.resolveInside) {
    try {
      const cp = require("./agent-run-checkpoint");
      const p = rel || (String(id).startsWith("ckpt:") ? String(id).slice(5) : "");
      if (p) {
        const r = cp.reviewFileDecision(options.userDataPath, root, p, "reject", {
          resolveInside: options.resolveInside,
        });
        return { ok: true, path: p, status: "rejected", source: "checkpoint", detail: r };
      }
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  return { ok: false, error: "No se encontró el cambio pendiente (id/path)." };
}

function acceptAll(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || ".");
  let accepted = 0;
  try {
    const r = getReviewQueue(root).acceptAll();
    accepted += r.accepted || 0;
  } catch (_) {}
  if (options.userDataPath) {
    try {
      const cp = require("./agent-run-checkpoint");
      const r = cp.acceptAllPending(options.userDataPath, root);
      accepted += r.accepted || 0;
    } catch (_) {}
  }
  return { ok: true, accepted };
}

function rejectAll(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || ".");
  let rejected = 0;
  const errors = [];
  try {
    const r = getReviewQueue(root).rejectAll();
    rejected += r.rejected || 0;
    if (r.errors) errors.push(...r.errors);
  } catch (e) {
    errors.push(e.message);
  }
  // Checkpoint: reject file by file
  if (options.userDataPath && options.resolveInside) {
    try {
      const listed = listCheckpoint(root, options.userDataPath);
      for (const it of listed) {
        const r = reject(root, { path: it.path }, options);
        if (r.ok) rejected += 1;
        else if (r.error) errors.push(r.error);
      }
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { ok: errors.length === 0, rejected, errors };
}

/**
 * Registrar cambio tras write (tools.js). Solo cola de proyecto — no toca @mentions.
 */
function enqueueFromWrite(projectRoot, payload = {}) {
  try {
    return getReviewQueue(projectRoot).enqueue({
      path: payload.path,
      before: payload.before,
      after: payload.after,
      backupPath: payload.backupPath,
      source: payload.source || "agent",
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getPendingPrompt(projectRoot) {
  try {
    return getReviewQueue(projectRoot).getPendingPrompt();
  } catch {
    return "";
  }
}

module.exports = {
  list,
  accept,
  reject,
  acceptAll,
  rejectAll,
  enqueueFromWrite,
  getPendingPrompt,
  listQueue,
  listCheckpoint,
};
