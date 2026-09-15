"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Snapshots / Checkpoints de EditCoreAI.
 * Respaldo antes de write_file / replace_in_file / Implementer.
 */

const META_NAME = "manifest.json";
const LATEST_NAME = "latest.json";
const MAX_SNAPSHOTS = 30;

function snapshotsRoot(projectRoot) {
  return path.join(path.resolve(projectRoot), ".editcore", "snapshots");
}

function latestPath(projectRoot) {
  return path.join(snapshotsRoot(projectRoot), LATEST_NAME);
}

function stampId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "-",
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
    "-",
    String(d.getMilliseconds()).padStart(3, "0"),
  ].join("");
}

function safeRel(projectRoot, rel) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, rel || ".");
  const rootL = root.toLowerCase();
  const tgtL = target.toLowerCase();
  if (tgtL !== rootL && !tgtL.startsWith(rootL + path.sep) && !tgtL.startsWith(`${rootL}/`)) {
    throw new Error("Ruta fuera del proyecto");
  }
  return {
    abs: target,
    rel: path.relative(root, target).replace(/\\/g, "/") || ".",
  };
}

function pruneOldSnapshots(projectRoot) {
  const root = snapshotsRoot(projectRoot);
  if (!fs.existsSync(root)) return;
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return;
  }
  while (dirs.length > MAX_SNAPSHOTS) {
    const oldest = dirs.shift();
    try {
      fs.rmSync(path.join(root, oldest), { recursive: true, force: true });
    } catch { /* ignore */ }
  }
}

/**
 * Crea un snapshot de uno o más archivos relativos antes de mutarlos.
 */
function createSnapshot(projectRoot, filePaths, reason = "pre-write") {
  const root = path.resolve(projectRoot || "");
  if (!root || !fs.existsSync(root)) {
    return { ok: false, error: "projectRoot inválido" };
  }

  const list = [...new Set((Array.isArray(filePaths) ? filePaths : [filePaths])
    .map((p) => String(p || "").trim())
    .filter(Boolean))];

  if (!list.length) return { ok: false, error: "Sin archivos para snapshot" };

  const id = stampId();
  const dir = path.join(snapshotsRoot(root), id);
  fs.mkdirSync(dir, { recursive: true });

  const files = [];
  for (const item of list) {
    let resolved;
    try {
      resolved = safeRel(root, item);
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
    const entry = {
      path: resolved.rel,
      existed: false,
      backup: null,
      bytes: 0,
    };
    if (fs.existsSync(resolved.abs) && fs.statSync(resolved.abs).isFile()) {
      const content = fs.readFileSync(resolved.abs);
      const backupName = `${resolved.rel.replace(/[\\/]/g, "__")}.bak`;
      const backupAbs = path.join(dir, backupName);
      fs.writeFileSync(backupAbs, content);
      entry.existed = true;
      entry.backup = backupName;
      entry.bytes = content.length;
    }
    files.push(entry);
  }

  const manifest = {
    id,
    reason: String(reason || "pre-write"),
    createdAt: new Date().toISOString(),
    projectRoot: root,
    files,
  };
  fs.writeFileSync(path.join(dir, META_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestPath(root), `${JSON.stringify({ id, createdAt: manifest.createdAt, reason: manifest.reason }, null, 2)}\n`, "utf8");
  pruneOldSnapshots(root);

  return {
    ok: true,
    id,
    dir: path.relative(root, dir).replace(/\\/g, "/"),
    files: files.map((f) => f.path),
    createdAt: manifest.createdAt,
  };
}

function readManifest(projectRoot, snapshotId) {
  const dir = path.join(snapshotsRoot(projectRoot), snapshotId);
  const meta = path.join(dir, META_NAME);
  if (!fs.existsSync(meta)) return null;
  try {
    return { dir, manifest: JSON.parse(fs.readFileSync(meta, "utf8")) };
  } catch {
    return null;
  }
}

function getLatestSnapshotId(projectRoot) {
  const p = latestPath(projectRoot);
  if (fs.existsSync(p)) {
    try {
      const latest = JSON.parse(fs.readFileSync(p, "utf8"));
      if (latest?.id && fs.existsSync(path.join(snapshotsRoot(projectRoot), latest.id, META_NAME))) {
        return latest.id;
      }
    } catch { /* ignore */ }
  }
  const root = snapshotsRoot(projectRoot);
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

/**
 * Restaura el último snapshot (o uno concreto por id).
 */
function rollbackLastChange(projectRoot, snapshotId = null) {
  const root = path.resolve(projectRoot || "");
  if (!root) return { ok: false, error: "Falta projectRoot" };

  const id = String(snapshotId || "").trim() || getLatestSnapshotId(root);
  if (!id) return { ok: false, error: "No hay snapshots para revertir" };

  const packed = readManifest(root, id);
  if (!packed?.manifest) return { ok: false, error: `Snapshot no encontrado: ${id}` };

  const restored = [];
  const deleted = [];
  for (const file of packed.manifest.files || []) {
    const rel = String(file.path || "").replace(/\\/g, "/");
    if (!rel || rel === ".") continue;
    let resolved;
    try {
      resolved = safeRel(root, rel);
    } catch {
      continue;
    }
    if (file.existed && file.backup) {
      const backupAbs = path.join(packed.dir, file.backup);
      if (!fs.existsSync(backupAbs)) continue;
      fs.mkdirSync(path.dirname(resolved.abs), { recursive: true });
      fs.copyFileSync(backupAbs, resolved.abs);
      restored.push(rel);
    } else if (!file.existed && fs.existsSync(resolved.abs)) {
      // Archivo creado en la mutación: eliminarlo al revertir
      try {
        fs.unlinkSync(resolved.abs);
        deleted.push(rel);
      } catch { /* ignore */ }
    }
  }

  return {
    ok: true,
    snapshotId: id,
    restored,
    deleted,
    reason: packed.manifest.reason || "",
    createdAt: packed.manifest.createdAt || "",
  };
}

function listSnapshots(projectRoot, limit = 20) {
  const root = snapshotsRoot(projectRoot);
  if (!fs.existsSync(root)) return { ok: true, snapshots: [] };
  const dirs = fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse()
    .slice(0, limit);

  const snapshots = dirs.map((id) => {
    const packed = readManifest(projectRoot, id);
    return {
      id,
      createdAt: packed?.manifest?.createdAt || null,
      reason: packed?.manifest?.reason || "",
      files: (packed?.manifest?.files || []).map((f) => f.path),
    };
  });
  return { ok: true, snapshots, latest: getLatestSnapshotId(projectRoot) };
}

/**
 * Atajo: snapshot de un solo path antes de escribir.
 */
function snapshotBeforeWrite(projectRoot, relPath, reason = "pre-write") {
  return createSnapshot(projectRoot, [relPath], reason);
}

module.exports = {
  createSnapshot,
  snapshotBeforeWrite,
  rollbackLastChange,
  listSnapshots,
  getLatestSnapshotId,
  snapshotsRoot,
  resolveSnapshotBackupAbs,
};

/** Ruta absoluta del .bak de un snapshot (si existe). */
function resolveSnapshotBackupAbs(projectRoot, snapshotId, relPath) {
  const root = path.resolve(String(projectRoot || ""));
  const id = String(snapshotId || "").trim();
  const rel = String(relPath || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!root || !id || !rel) return "";
  const backupName = `${rel.replace(/[\\/]/g, "__")}.bak`;
  const abs = path.join(snapshotsRoot(root), id, backupName);
  try {
    return fs.existsSync(abs) ? abs : "";
  } catch {
    return "";
  }
}
