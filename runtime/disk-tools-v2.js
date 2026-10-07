"use strict";

/**
 * DISK TOOLS V2 — Motor unificado de lectura/escritura atómica + comandos
 * EditCoreAI Fase 4
 *
 * Garantías:
 *  - Paths siempre dentro de projectRoot (anti path-traversal)
 *  - Escritura atómica (tmp + rename)
 *  - Backup antes de mutar
 *  - Rechazo de contenido incompleto/truncado (integra transactional-engine)
 *  - Diff unificado simple
 *  - run_command con timeout, cwd seguro y captura de salida
 *  - list / search / tree
 *  - API estable para el agente (y compatible con harness + A2A)
 *
 * Sin dependencias nuevas obligatorias.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

let looksIncomplete = null;
try {
  ({ looksIncomplete } = require("./transactional-engine"));
} catch {
  looksIncomplete = (content) => {
    const s = String(content || "");
    if (/\/\/\s*TODO[:\s].*(rest|implement|continuar|complete|finish|aquí|here)/i.test(s)) return true;
    if (/\.\.\.\s*$|…\s*$|\[truncated\]/i.test(s.slice(-60))) return true;
    const o = (s.match(/\{/g) || []).length;
    const c = (s.match(/\}/g) || []).length;
    return o > c + 1;
  };
}

const TOOLS_VERSION = 2;
const BACKUP_DIR = ".editcore/disk-backups";
const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_SEARCH_RESULTS = 80;
const DEFAULT_CMD_TIMEOUT_MS = 120_000;

function generateId(prefix = "op") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function atomicWriteFile(absPath, content) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${absPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, absPath);
}

// ─────────────────────────────────────────────
// Path safety
// ─────────────────────────────────────────────

class DiskToolsV2 {
  /**
   * @param {string} projectRoot
   * @param {object} [options]
   * @param {object} [options.harness] - TokenHarnessV2 (opcional, para cache)
   * @param {function} [options.onMutation] - callback tras write/delete
   */
  constructor(projectRoot, options = {}) {
    if (!projectRoot) throw new Error("DiskToolsV2 requiere projectRoot");
    this.projectRoot = path.resolve(projectRoot);
    this.harness = options.harness || null;
    this.onMutation = options.onMutation || (() => {});
    this.backupRoot = path.join(this.projectRoot, BACKUP_DIR);
    this.stats = { reads: 0, writes: 0, deletes: 0, commands: 0, backups: 0, rejected: 0 };
  }

  /**
   * Resuelve una ruta relativa/absoluta y garantiza que queda DENTRO del proyecto.
   */
  resolveInside(relOrAbs) {
    const raw = String(relOrAbs || "").trim();
    if (!raw) throw new Error("Ruta vacía");
    if (raw.includes("\0")) throw new Error("Ruta inválida (null byte)");

    let abs;
    if (path.isAbsolute(raw)) {
      abs = path.normalize(raw);
    } else {
      abs = path.normalize(path.join(this.projectRoot, raw));
    }

    const root = this.projectRoot.endsWith(path.sep)
      ? this.projectRoot
      : this.projectRoot + path.sep;
    const absCheck = abs.endsWith(path.sep) ? abs : abs + path.sep;

    // Permitir exactamente projectRoot o hijos
    if (abs !== this.projectRoot && !abs.startsWith(root) && !absCheck.startsWith(root)) {
      // Windows case-insensitive
      const rootL = root.toLowerCase();
      const absL = abs.toLowerCase();
      if (absL !== this.projectRoot.toLowerCase() && !absL.startsWith(rootL)) {
        throw new Error(`Path fuera del proyecto: ${raw}`);
      }
    }
    return abs;
  }

  toRelative(absPath) {
    return path.relative(this.projectRoot, absPath).replace(/\\/g, "/");
  }

  // ─────────────────────────────────────────────
  // Backups
  // ─────────────────────────────────────────────

  _backupPath(relPath) {
    const safe = relPath.replace(/[\\/]/g, "__");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return path.join(this.backupRoot, `${safe}.${stamp}.${generateId("bak")}.bak`);
  }

  backupFile(relOrAbs) {
    const abs = this.resolveInside(relOrAbs);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    const rel = this.toRelative(abs);
    const dest = this._backupPath(rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
    this.stats.backups += 1;
    return { backupPath: dest, relative: rel };
  }

  listBackups(limit = 30) {
    try {
      if (!fs.existsSync(this.backupRoot)) return [];
      return fs
        .readdirSync(this.backupRoot)
        .filter((f) => f.endsWith(".bak"))
        .map((f) => {
          const full = path.join(this.backupRoot, f);
          const st = fs.statSync(full);
          return { name: f, path: full, size: st.size, mtime: st.mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // Read / List / Tree / Search
  // ─────────────────────────────────────────────

  readFile(relOrAbs, options = {}) {
    const abs = this.resolveInside(relOrAbs);
    const rel = this.toRelative(abs);

    // Cache via harness
    if (this.harness && options.useCache !== false) {
      const cached = this.harness.cacheGet("read_file", { path: rel });
      if (cached != null) {
        this.stats.reads += 1;
        return { ok: true, path: rel, content: cached, cached: true };
      }
    }

    if (!fs.existsSync(abs)) {
      return { ok: false, path: rel, error: "Archivo no existe" };
    }
    const st = fs.statSync(abs);
    if (!st.isFile()) return { ok: false, path: rel, error: "No es un archivo" };
    if (st.size > (options.maxBytes || MAX_READ_BYTES)) {
      return {
        ok: false,
        path: rel,
        error: `Archivo demasiado grande (${st.size} bytes). Usa maxBytes o lee por secciones.`,
        size: st.size,
      };
    }

    const content = fs.readFileSync(abs, "utf8");
    this.stats.reads += 1;

    if (this.harness && options.useCache !== false) {
      this.harness.cacheSet("read_file", { path: rel }, content);
    }

    return {
      ok: true,
      path: rel,
      content,
      size: st.size,
      mtime: st.mtime.toISOString(),
      cached: false,
    };
  }

  listDir(relOrAbs = ".", options = {}) {
    const abs = this.resolveInside(relOrAbs);
    const rel = this.toRelative(abs) || ".";
    if (!fs.existsSync(abs)) return { ok: false, path: rel, error: "No existe" };
    const st = fs.statSync(abs);
    if (!st.isDirectory()) return { ok: false, path: rel, error: "No es directorio" };

    const max = options.max || 200;
    const entries = fs.readdirSync(abs, { withFileTypes: true }).slice(0, max);
    const items = entries.map((e) => {
      const name = e.name;
      let size = 0;
      let type = e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";
      try {
        if (e.isFile()) size = fs.statSync(path.join(abs, name)).size;
      } catch (_) {}
      return { name, type, size };
    });

    return { ok: true, path: rel, count: items.length, items };
  }

  tree(relOrAbs = ".", options = {}) {
    const maxDepth = options.maxDepth || 3;
    const maxNodes = options.maxNodes || 150;
    const ignore = new Set(
      options.ignore || ["node_modules", ".git", ".editcore", "dist", "build", ".next", "coverage"]
    );
    const abs = this.resolveInside(relOrAbs);
    const lines = [];
    let nodes = 0;

    const walk = (dir, depth, prefix) => {
      if (depth > maxDepth || nodes >= maxNodes) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      for (const e of entries) {
        if (ignore.has(e.name) || e.name.startsWith(".editcore")) continue;
        if (nodes >= maxNodes) {
          lines.push(`${prefix}…`);
          return;
        }
        nodes += 1;
        const mark = e.isDirectory() ? "📁" : "📄";
        lines.push(`${prefix}${mark} ${e.name}`);
        if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1, prefix + "  ");
      }
    };

    walk(abs, 0, "");
    return { ok: true, path: this.toRelative(abs) || ".", nodes, tree: lines.join("\n") };
  }

  /**
   * Búsqueda por substring o regex en archivos de texto.
   */
  searchFiles(query, options = {}) {
    const maxResults = options.maxResults || MAX_SEARCH_RESULTS;
    const maxFileSize = options.maxFileSize || 512 * 1024;
    const extensions = options.extensions || [
      ".js", ".ts", ".tsx", ".jsx", ".json", ".md", ".css", ".html", ".py", ".go", ".rs", ".java", ".yml", ".yaml",
    ];
    const rootRel = options.root || ".";
    const absRoot = this.resolveInside(rootRel);
    const useRegex = options.regex === true;
    let matcher;
    try {
      matcher = useRegex ? new RegExp(query, options.flags || "i") : null;
    } catch (err) {
      return { ok: false, error: `Regex inválida: ${err.message}` };
    }

    const results = [];
    const ignore = new Set(["node_modules", ".git", ".editcore", "dist", "build", ".next", "coverage"]);

    const walk = (dir) => {
      if (results.length >= maxResults) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (results.length >= maxResults) return;
        if (ignore.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
          continue;
        }
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (extensions.length && !extensions.includes(ext)) continue;
        let st;
        try {
          st = fs.statSync(full);
        } catch {
          continue;
        }
        if (st.size > maxFileSize) continue;
        let content;
        try {
          content = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          const line = lines[i];
          const hit = matcher ? matcher.test(line) : line.toLowerCase().includes(String(query).toLowerCase());
          if (hit) {
            results.push({
              path: this.toRelative(full),
              line: i + 1,
              text: line.slice(0, 300),
            });
          }
        }
      }
    };

    walk(absRoot);
    return { ok: true, query, count: results.length, matches: results };
  }

  // ─────────────────────────────────────────────
  // Write / Replace / Delete (atómicos)
  // ─────────────────────────────────────────────

  /**
   * Escritura atómica con backup + rechazo de incompletos.
   */
  writeFile(relOrAbs, content, options = {}) {
    const abs = this.resolveInside(relOrAbs);
    const rel = this.toRelative(abs);
    const text = String(content ?? "");

    if (options.allowIncomplete !== true && looksIncomplete(text)) {
      this.stats.rejected += 1;
      throw new Error(
        `Contenido incompleto/truncado rechazado en ${rel}. ` +
          `No se permiten TODOs de implementación ni código a medias.`
      );
    }

    const existed = fs.existsSync(abs);
    let backup = null;
    if (existed && options.backup !== false) {
      backup = this.backupFile(rel);
    }

    atomicWriteFile(abs, text);
    this.stats.writes += 1;

    // Invalidar cache de lectura
    if (this.harness) {
      try {
        this.harness.cacheSet("read_file", { path: rel }, text, 1000); // overwrite corto o dejar
      } catch (_) {}
    }

    const result = {
      ok: true,
      path: rel,
      bytes: Buffer.byteLength(text, "utf8"),
      created: !existed,
      backupPath: backup ? backup.backupPath : null,
    };
    this.onMutation({ action: "write", ...result });
    return result;
  }

  /**
   * Reemplazo seguro: search debe aparecer exactamente `expectedCount` veces (default 1).
   */
  replaceInFile(relOrAbs, search, replacement, options = {}) {
    const read = this.readFile(relOrAbs, { useCache: false });
    if (!read.ok) throw new Error(read.error || "No se pudo leer");
    const expected = options.expectedCount != null ? Number(options.expectedCount) : 1;
    const content = read.content;
    const normContent = content.replace(/\r\n/g, "\n");
    const normSearch = String(search).replace(/\r\n/g, "\n");

    if (!normSearch) throw new Error("search vacío");

    let count = 0;
    let pos = 0;
    while ((pos = normContent.indexOf(normSearch, pos)) !== -1) {
      count += 1;
      pos += normSearch.length;
    }
    if (count === 0) {
      return { ok: false, path: read.path, error: "search no encontrado", count: 0 };
    }
    if (expected > 0 && count !== expected) {
      return {
        ok: false,
        path: read.path,
        error: `Se esperaban ${expected} ocurrencias, hay ${count}. Abortado para evitar corrupción.`,
        count,
      };
    }

    const next = normContent.split(normSearch).join(String(replacement));
    return this.writeFile(read.path, next, options);
  }

  deleteFile(relOrAbs, options = {}) {
    const abs = this.resolveInside(relOrAbs);
    const rel = this.toRelative(abs);
    if (!fs.existsSync(abs)) return { ok: true, path: rel, action: "already_absent" };
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new Error(`No es archivo: ${rel}`);

    let backup = null;
    if (options.backup !== false) backup = this.backupFile(rel);
    fs.unlinkSync(abs);
    this.stats.deletes += 1;
    const result = { ok: true, path: rel, action: "deleted", backupPath: backup ? backup.backupPath : null };
    this.onMutation({ action: "delete", ...result });
    return result;
  }

  mkdir(relOrAbs) {
    const abs = this.resolveInside(relOrAbs);
    fs.mkdirSync(abs, { recursive: true });
    return { ok: true, path: this.toRelative(abs) };
  }

  // ─────────────────────────────────────────────
  // Diff
  // ─────────────────────────────────────────────

  /**
   * Diff unificado simple entre contenido actual en disco y `newContent`.
   */
  diff(relOrAbs, newContent) {
    const read = this.readFile(relOrAbs, { useCache: false });
    const oldLines = (read.ok ? read.content : "").split(/\r?\n/);
    const newLines = String(newContent ?? "").split(/\r?\n/);
    const rel = read.path || String(relOrAbs);

    // LCS simplificado para archivos no enormes
    const max = 4000;
    if (oldLines.length + newLines.length > max) {
      return {
        ok: true,
        path: rel,
        truncated: true,
        summary: `Archivo grande (old=${oldLines.length} new=${newLines.length} líneas). Diff completo omitido.`,
        patch: null,
      };
    }

    const lines = [`--- a/${rel}`, `+++ b/${rel}`];
    // Diff línea a línea naive (suficiente para agente)
    const maxLen = Math.max(oldLines.length, newLines.length);
    let hunk = [];
    let hunkStart = 0;
    const flush = () => {
      if (!hunk.length) return;
      lines.push(`@@ -${hunkStart},… +${hunkStart},… @@`);
      lines.push(...hunk);
      hunk = [];
    };

    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i];
      const n = newLines[i];
      if (o === n) {
        if (hunk.length) flush();
        continue;
      }
      if (!hunk.length) hunkStart = i + 1;
      if (o !== undefined && n === undefined) hunk.push(`-${o}`);
      else if (o === undefined && n !== undefined) hunk.push(`+${n}`);
      else {
        hunk.push(`-${o}`);
        hunk.push(`+${n}`);
      }
    }
    flush();

    return {
      ok: true,
      path: rel,
      truncated: false,
      changed: lines.length > 2,
      patch: lines.join("\n"),
    };
  }

  // ─────────────────────────────────────────────
  // run_command
  // ─────────────────────────────────────────────

  /**
   * Ejecuta un comando en el proyecto con timeout y captura.
   * @param {string|string[]} command - string shell o array [cmd, ...args]
   * @param {object} [options] - { timeoutMs, env, cwd (rel), shell }
   */
  runCommand(command, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_CMD_TIMEOUT_MS;
    let cwd = this.projectRoot;
    if (options.cwd) {
      cwd = this.resolveInside(options.cwd);
    }

    const useShell = options.shell !== false && typeof command === "string";
    let cmd, args;
    if (Array.isArray(command)) {
      cmd = command[0];
      args = command.slice(1);
    } else {
      cmd = String(command);
      args = [];
    }

    this.stats.commands += 1;

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...(options.env || {}), FORCE_COLOR: "0" },
        shell: useShell,
        windowsHide: true,
      });

      const timer = setTimeout(() => {
        if (settled) return;
        try {
          child.kill("SIGTERM");
          setTimeout(() => {
            try { child.kill("SIGKILL"); } catch (_) {}
          }, 2000);
        } catch (_) {}
        settled = true;
        resolve({
          ok: false,
          code: null,
          signal: "TIMEOUT",
          stdout: stdout.slice(-50_000),
          stderr: (stderr + `\n[timeout after ${timeoutMs}ms]`).slice(-20_000),
          timedOut: true,
        });
      }, timeoutMs);

      child.stdout?.on("data", (d) => {
        stdout += d.toString("utf8");
        if (stdout.length > 200_000) stdout = stdout.slice(-150_000);
      });
      child.stderr?.on("data", (d) => {
        stderr += d.toString("utf8");
        if (stderr.length > 100_000) stderr = stderr.slice(-80_000);
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          code: null,
          error: err.message,
          stdout,
          stderr,
        });
      });

      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: code === 0,
          code,
          signal: signal || null,
          stdout: stdout.slice(-80_000),
          stderr: stderr.slice(-40_000),
          timedOut: false,
        });
      });
    });
  }

  // ─────────────────────────────────────────────
  // Linter / tests / AST helpers (thin wrappers)
  // ─────────────────────────────────────────────

  /**
   * Detecta y ejecuta el linter del proyecto (eslint, tsc --noEmit, etc.).
   */
  async runLinter(options = {}) {
    const pkgPath = path.join(this.projectRoot, "package.json");
    let scripts = {};
    try {
      if (fs.existsSync(pkgPath)) {
        scripts = JSON.parse(fs.readFileSync(pkgPath, "utf8")).scripts || {};
      }
    } catch (_) {}

    if (scripts.lint) {
      return this.runCommand("npm run lint", { timeoutMs: options.timeoutMs || 180_000 });
    }
    if (fs.existsSync(path.join(this.projectRoot, "node_modules", "eslint"))) {
      return this.runCommand("npx eslint . --max-warnings=0", { timeoutMs: options.timeoutMs || 180_000 });
    }
    if (fs.existsSync(path.join(this.projectRoot, "tsconfig.json"))) {
      return this.runCommand("npx tsc --noEmit", { timeoutMs: options.timeoutMs || 180_000 });
    }
    return { ok: true, skipped: true, reason: "No se detectó linter configurado" };
  }

  /**
   * Ejecuta tests del proyecto.
   */
  async runTests(options = {}) {
    const pkgPath = path.join(this.projectRoot, "package.json");
    let scripts = {};
    try {
      if (fs.existsSync(pkgPath)) {
        scripts = JSON.parse(fs.readFileSync(pkgPath, "utf8")).scripts || {};
      }
    } catch (_) {}

    if (scripts.test) {
      return this.runCommand("npm test", { timeoutMs: options.timeoutMs || 300_000 });
    }
    // EditCoreAI usa node --test
    if (fs.existsSync(path.join(this.projectRoot, "test"))) {
      return this.runCommand("node --test test/*.test.js", { timeoutMs: options.timeoutMs || 300_000 });
    }
    return { ok: true, skipped: true, reason: "No se detectó script de test" };
  }

  /**
   * Análisis AST ligero sin dependencias: extrae funciones/clases/exports de un .js/.ts
   * (heurístico; para análisis profundo usar runtime/ast-graph.js existente).
   */
  analyzeStructure(relOrAbs) {
    const read = this.readFile(relOrAbs);
    if (!read.ok) return read;
    const content = read.content;
    const functions = [];
    const classes = [];
    const exports = [];
    const imports = [];

    const fnRe = /(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    let m;
    while ((m = fnRe.exec(content))) {
      functions.push(m[1] || m[2]);
    }
    const classRe = /class\s+(\w+)/g;
    while ((m = classRe.exec(content))) classes.push(m[1]);
    const expRe = /(?:module\.exports|exports\.(\w+)|export\s+(?:default\s+)?(?:function|class|const|let|var)?\s*(\w)?)/g;
    while ((m = expRe.exec(content))) {
      if (m[1] || m[2]) exports.push(m[1] || m[2]);
    }
    const impRe = /(?:require\(['"]([^'"]+)['"]\)|import\s+.+?\s+from\s+['"]([^'"]+)['"])/g;
    while ((m = impRe.exec(content))) imports.push(m[1] || m[2]);

    return {
      ok: true,
      path: read.path,
      functions: [...new Set(functions)].slice(0, 80),
      classes: [...new Set(classes)].slice(0, 40),
      exports: [...new Set(exports)].slice(0, 40),
      imports: [...new Set(imports)].slice(0, 60),
      lines: content.split(/\r?\n/).length,
      bytes: read.size,
    };
  }

  // ─────────────────────────────────────────────
  // Batch write (atómico por archivo)
  // ─────────────────────────────────────────────

  writeFileBatch(files = [], options = {}) {
    if (!Array.isArray(files) || !files.length) {
      throw new Error("writeFileBatch requiere un array no vacío");
    }
    if (files.length > 50) throw new Error("Máximo 50 archivos por batch");
    const results = [];
    for (const item of files) {
      const rel = String(item.path || item.filename || "").trim();
      if (!rel) continue;
      results.push(this.writeFile(rel, item.content ?? "", options));
    }
    return { ok: true, count: results.length, files: results };
  }

  snapshot() {
    return {
      version: TOOLS_VERSION,
      projectRoot: this.projectRoot,
      stats: { ...this.stats },
      backups: this.listBackups(5).length,
    };
  }
}

function createDiskTools(projectRoot, options) {
  return new DiskToolsV2(projectRoot, options);
}

module.exports = {
  DiskToolsV2,
  createDiskTools,
  atomicWriteFile,
  TOOLS_VERSION,
};
