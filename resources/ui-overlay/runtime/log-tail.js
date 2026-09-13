"use strict";

/**
 * Lectura de logs de preview/dev server en tiempo real (tail).
 */

const fs = require("node:fs");
const path = require("node:path");

function resolveLogCandidates(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  return [
    path.join(root, ".editcore", "preview.log"),
    path.join(root, ".editcore", "dev-server.log"),
    path.join(root, ".editcore", "logs", "app.log"),
    path.join(root, "logs", "dev.log"),
  ];
}

function findLogFile(projectRoot, preferred = "") {
  if (preferred) {
    const abs = path.isAbsolute(preferred)
      ? preferred
      : path.join(projectRoot, ...String(preferred).split(/[/\\]+/));
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  for (const candidate of resolveLogCandidates(projectRoot)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function tailLog(projectRoot, { path: preferred = "", maxBytes = 32_000, maxLines = 200 } = {}) {
  const file = findLogFile(projectRoot, preferred);
  if (!file) {
    return {
      ok: false,
      message: "No hay log de preview/dev. Arranca preview o escribe en .editcore/preview.log",
      candidates: resolveLogCandidates(projectRoot).map((p) => path.relative(projectRoot, p).replace(/\\/g, "/")),
    };
  }
  const stat = fs.statSync(file);
  const size = stat.size;
  const start = Math.max(0, size - Math.max(1024, Number(maxBytes) || 32_000));
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/);
    const sliced = lines.slice(-Math.max(20, Number(maxLines) || 200));
    return {
      ok: true,
      path: path.relative(projectRoot, file).replace(/\\/g, "/") || file,
      bytes: size,
      lines: sliced.length,
      content: sliced.join("\n"),
    };
  } finally {
    fs.closeSync(fd);
  }
}

function appendPreviewLog(projectRoot, chunk = "") {
  const file = path.join(path.resolve(String(projectRoot || "")), ".editcore", "preview.log");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, String(chunk || ""), "utf8");
  return { ok: true, path: ".editcore/preview.log" };
}

module.exports = {
  resolveLogCandidates,
  findLogFile,
  tailLog,
  appendPreviewLog,
};
