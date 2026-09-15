"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { projectStorageRoot } = require("../project-storage");
const { buildUnifiedDiff } = require("./diff-preview");
const { parseUnifiedHunks, applyHunkDecisions } = require("./hunk-review");

function lastRunPath(userDataPath, projectRoot) {
  return path.join(projectStorageRoot(userDataPath, projectRoot), "agent-last-run.json");
}

function normalizeRel(p = "") {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function writeManifest(userDataPath, projectRoot, manifest) {
  const dir = projectStorageRoot(userDataPath, projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(lastRunPath(userDataPath, projectRoot), JSON.stringify(manifest, null, 2), "utf8");
}

function normalizeSteps(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .slice(0, 80)
    .map((step, index) => ({
      index,
      tool: String(step?.tool || step?.name || step?.phase || `step_${index}`),
      ok: step?.ok !== false && step?.error == null,
      path: normalizeRel(step?.path || step?.input?.path || ""),
      summary: String(step?.summary || step?.text || step?.result?.message || "").slice(0, 240),
      at: String(step?.at || ""),
    }));
}

function saveLastAgentRun(userDataPath, projectRoot, payload = {}) {
  const files = (Array.isArray(payload.files) ? payload.files : [])
    .map((item) => ({
      path: normalizeRel(item.path || item.relativePath || ""),
      action: String(item.action || item.tool || "write_file"),
      backupPath: String(item.backupPath || ""),
      created: item.created === true,
      status: "pending",
    }))
    .filter((item) => item.path);
  if (!files.length) return null;

  const steps = normalizeSteps(payload.steps);
  const manifest = {
    version: 2,
    runId: String(payload.runId || ""),
    at: String(payload.at || new Date().toISOString()),
    restored: false,
    task: String(payload.task || "").slice(0, 500),
    files,
    steps,
    stepCount: steps.length,
    checkpointNote: steps.length
      ? `Corrida con ${steps.length} paso(s) y ${files.length} archivo(s).`
      : `Corrida con ${files.length} archivo(s).`,
  };
  writeManifest(userDataPath, projectRoot, manifest);
  return manifest;
}

function peekLastAgentRun(userDataPath, projectRoot) {
  const file = lastRunPath(userDataPath, projectRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length) return null;
    return manifest;
  } catch {
    return null;
  }
}

function restoreOneFile(item, projectRoot, resolveInside) {
  const rel = normalizeRel(item.path);
  const target = resolveInside(projectRoot, rel);
  const hadBackup = item.backupPath && fs.existsSync(item.backupPath);
  if (item.created === true || (!hadBackup && item.action === "write_file")) {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      fs.unlinkSync(target);
      return { path: rel, action: "deleted" };
    }
    return { path: rel, action: "already_absent" };
  }
  if (!hadBackup) throw new Error(`Sin backup previo para ${rel}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(item.backupPath, target);
  return { path: rel, action: "restored" };
}

function restoreLastAgentRun(userDataPath, projectRoot, { resolveInside } = {}) {
  if (typeof resolveInside !== "function") {
    throw new Error("restoreLastAgentRun requiere resolveInside.");
  }
  const manifest = peekLastAgentRun(userDataPath, projectRoot);
  if (!manifest) throw new Error("No hay una corrida reciente del agente para deshacer.");
  if (manifest.restored === true) throw new Error("La ultima corrida ya fue deshecha.");

  const restored = [];
  const errors = [];
  for (const item of [...manifest.files].reverse()) {
    if (item.status === "rejected") continue;
    try {
      restored.push(restoreOneFile(item, projectRoot, resolveInside));
    } catch (error) {
      errors.push({ path: normalizeRel(item.path), error: String(error?.message || error) });
    }
  }

  manifest.restored = true;
  manifest.restoredAt = new Date().toISOString();
  for (const item of manifest.files) {
    if ((item.status || "pending") === "pending") item.status = "rejected";
  }
  writeManifest(userDataPath, projectRoot, manifest);

  return {
    runId: manifest.runId || "",
    at: manifest.at,
    restored: restored.length,
    files: restored,
    errors,
  };
}

function buildLastRunReview(userDataPath, projectRoot, { resolveInside } = {}) {
  if (typeof resolveInside !== "function") {
    throw new Error("buildLastRunReview requiere resolveInside.");
  }
  const manifest = peekLastAgentRun(userDataPath, projectRoot);
  if (!manifest || manifest.restored) return { runId: "", files: [] };

  const files = [];
  for (const item of manifest.files) {
    const rel = normalizeRel(item.path);
    let before = "";
    let after = "";
    try {
      if (item.backupPath && fs.existsSync(item.backupPath)) {
        before = fs.readFileSync(item.backupPath, "utf8");
      }
      const target = resolveInside(projectRoot, rel);
      if (fs.existsSync(target) && fs.statSync(target).isFile()) {
        after = fs.readFileSync(target, "utf8");
      }
    } catch {
      /* ignore */
    }
    const diff = item.created && !before
      ? buildUnifiedDiff(rel, "", after)
      : buildUnifiedDiff(rel, before, after);
    const hunks = parseUnifiedHunks(diff).map((h) => ({
      id: h.id,
      summary: h.summary,
      text: String(h.text || "").slice(0, 4000),
      status: (item.hunkStatus && item.hunkStatus[h.id]) || "pending",
    }));
    files.push({
      path: rel,
      action: item.action,
      created: item.created === true,
      status: item.status || "pending",
      diff: String(diff || "").slice(0, 8000),
      hunks,
    });
  }
  return { runId: manifest.runId || "", at: manifest.at, files };
}

function reviewHunkDecision(userDataPath, projectRoot, relativePath, hunkId, decision, { resolveInside } = {}) {
  if (typeof resolveInside !== "function") {
    throw new Error("reviewHunkDecision requiere resolveInside.");
  }
  const manifest = peekLastAgentRun(userDataPath, projectRoot);
  if (!manifest || manifest.restored) throw new Error("No hay revision pendiente.");
  const rel = normalizeRel(relativePath);
  const item = manifest.files.find((f) => normalizeRel(f.path) === rel);
  if (!item) throw new Error(`Archivo no esta en la ultima corrida: ${rel}`);
  if (item.status && item.status !== "pending") {
    return { path: rel, status: item.status, alreadyDecided: true };
  }

  let before = "";
  let after = "";
  try {
    if (item.backupPath && fs.existsSync(item.backupPath)) {
      before = fs.readFileSync(item.backupPath, "utf8");
    }
    const target = resolveInside(projectRoot, rel);
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      after = fs.readFileSync(target, "utf8");
    }
  } catch {
    /* ignore */
  }

  const diff = item.created && !before
    ? buildUnifiedDiff(rel, "", after)
    : buildUnifiedDiff(rel, before, after);
  const hunks = parseUnifiedHunks(diff);
  if (!hunks.length) {
    // Sin hunks parseables: caer a decision de archivo completo.
    return reviewFileDecision(userDataPath, projectRoot, relativePath, decision, { resolveInside });
  }

  item.hunkStatus = item.hunkStatus && typeof item.hunkStatus === "object" ? item.hunkStatus : {};
  const hid = String(hunkId || "").trim();
  if (!hunks.some((h) => h.id === hid)) throw new Error(`Hunk desconocido: ${hid}`);
  item.hunkStatus[hid] = decision === "reject" ? "rejected" : "accepted";

  const decisions = {};
  for (const h of hunks) {
    decisions[h.id] = item.hunkStatus[h.id] || "pending";
  }
  const allDecided = hunks.every((h) => decisions[h.id] === "accepted" || decisions[h.id] === "rejected");

  if (allDecided) {
    const finalText = applyHunkDecisions(before, hunks, decisions);
    const target = resolveInside(projectRoot, rel);
    const allRejected = hunks.every((h) => decisions[h.id] === "rejected");
    if (allRejected && (item.created === true || !before)) {
      if (fs.existsSync(target) && fs.statSync(target).isFile()) fs.unlinkSync(target);
      item.status = "rejected";
    } else if (allRejected) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, before, "utf8");
      item.status = "rejected";
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, finalText, "utf8");
      item.status = hunks.some((h) => decisions[h.id] === "rejected") ? "accepted_partial" : "accepted";
    }
    const pendingLeft = manifest.files.some((f) => f !== item && (f.status || "pending") === "pending");
    if (!pendingLeft) {
      const anyPendingHunk = manifest.files.some((f) => (f.status || "") === "pending");
      if (!anyPendingHunk) {
        /* keep restored false so undo still works until full reject-all */
      }
    }
  }

  writeManifest(userDataPath, projectRoot, manifest);
  return {
    path: rel,
    hunkId: hid,
    hunkStatus: item.hunkStatus[hid],
    fileStatus: item.status || "pending",
    allHunksDecided: allDecided,
  };
}

function reviewFileDecision(userDataPath, projectRoot, relativePath, decision, { resolveInside } = {}) {
  if (typeof resolveInside !== "function") {
    throw new Error("reviewFileDecision requiere resolveInside.");
  }
  const manifest = peekLastAgentRun(userDataPath, projectRoot);
  if (!manifest || manifest.restored) throw new Error("No hay revision pendiente.");
  const rel = normalizeRel(relativePath);
  const item = manifest.files.find((f) => normalizeRel(f.path) === rel);
  if (!item) throw new Error(`Archivo no esta en la ultima corrida: ${rel}`);
  if (item.status && item.status !== "pending") {
    return { path: rel, status: item.status, alreadyDecided: true };
  }

  if (decision === "reject") {
    const result = restoreOneFile(item, projectRoot, resolveInside);
    item.status = "rejected";
    const pendingLeft = manifest.files.some((f) => f !== item && (f.status || "pending") === "pending");
    if (!pendingLeft) {
      manifest.restored = true;
      manifest.restoredAt = new Date().toISOString();
    }
    writeManifest(userDataPath, projectRoot, manifest);
    return { path: rel, status: "rejected", result };
  }

  item.status = "accepted";
  writeManifest(userDataPath, projectRoot, manifest);
  return { path: rel, status: "accepted" };
}

function acceptAllPending(userDataPath, projectRoot) {
  const manifest = peekLastAgentRun(userDataPath, projectRoot);
  if (!manifest || manifest.restored) return { accepted: 0, runId: "", error: "No hay revision pendiente." };
  let count = 0;
  for (const item of manifest.files) {
    if ((item.status || "pending") === "pending") {
      item.status = "accepted";
      count += 1;
    }
  }
  writeManifest(userDataPath, projectRoot, manifest);
  return { accepted: count, runId: manifest.runId || "" };
}

module.exports = {
  saveLastAgentRun,
  peekLastAgentRun,
  restoreLastAgentRun,
  buildLastRunReview,
  reviewFileDecision,
  reviewHunkDecision,
  acceptAllPending,
  lastRunPath,
  normalizeSteps,
};
