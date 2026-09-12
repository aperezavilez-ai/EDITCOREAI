"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

function projectId(rootPath) {
  return crypto
    .createHash("sha256")
    .update(path.resolve(String(rootPath || "")).toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

function projectStorageRoot(userDataPath, rootPath) {
  if (!userDataPath) throw new Error("Ruta de datos de usuario invalida.");
  if (!rootPath) throw new Error("Ruta de proyecto invalida.");
  return path.join(
    path.resolve(userDataPath),
    "editcore-brain",
    "projects",
    projectId(rootPath)
  );
}

function projectBackupRoot(userDataPath, rootPath) {
  return path.join(projectStorageRoot(userDataPath, rootPath), "backups");
}

module.exports = { projectBackupRoot, projectId, projectStorageRoot };
