"use strict";

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const { scaffoldNextApp } = require("./scaffold");
const { scrapeWebPage } = require("./browser-tool");
const { saveToBrain, listBrainDocs, ingestPathToBrain } = require("./brain-ingest");
const extraTools = require("./extra-tools");
const {
  snapshotBeforeWrite,
  rollbackLastChange,
  listSnapshots,
} = require("./snapshot");
const { runProcess, isLongRunningCommand } = require("./process-runner");
const { capture_preview_screenshot, DEFAULT_PREVIEW_URL } = require("./vision-inspector");
const { detectCircularDependencies } = require("./circular-dependency-detector");

const TOOL_RESULT_CAP = 2000;
const READ_FILE_TOOL_CAP = 4000;
const READ_FILE_PAYLOAD_CAP = 6000;

let pathPolicy = null;
try {
  pathPolicy = require("../project-path-policy");
} catch {
  try { pathPolicy = require("./project-path-policy"); } catch { pathPolicy = null; }
}

let runReadCache = null;
try {
  const { RunReadCache } = require("../runtime/agent-token-harness");
  runReadCache = new RunReadCache();
} catch {
  runReadCache = null;
}

function safe(root, rel) {
  if (!root) throw new Error("Proyecto no especificado");
  const rawRel = String(rel || ".").trim();
  if (pathPolicy?.resolveAccessibleTarget) {
    try {
      const resolved = pathPolicy.resolveAccessibleTarget(root, rawRel, {
        allowSiblingRead: true,
        fullAccess: true,
        grantAbsoluteOnFull: true,
      });
      if (resolved?.absolute) return resolved.absolute;
    } catch { /* fallback */ }
  }
  const base = path.resolve(root);
  const target = path.resolve(base, rawRel || ".");
  const normBase = base.toLowerCase();
  const normTarget = target.toLowerCase();
  if (normTarget === normBase || normTarget.startsWith(normBase + path.sep) || normTarget.startsWith(normBase + "/")) {
    return target;
  }
  if (pathPolicy?.workspaceParentRoot) {
    const parent = pathPolicy.workspaceParentRoot(base);
    if (parent) {
      const normParent = path.resolve(parent).toLowerCase();
      if (
        normTarget === normParent
        || normTarget.startsWith(normParent + path.sep)
        || normTarget.startsWith(normParent + "/")
      ) {
        return target;
      }
    }
  }
  if (path.isAbsolute(rawRel) && fs.existsSync(target)) {
    return target;
  }
  throw new Error(`Ruta fuera del proyecto: ${rawRel}`);
}

function truncatePayload(value, max = TOOL_RESULT_CAP) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[respuesta de la herramienta recortada: ${text.length - max} caracteres más. Es un límite del chat, no un problema del archivo]`;
}

function listFiles(root, rel = ".", max = 80, opts = {}) {
  const requested = String(rel || ".").replace(/\\/g, "/").trim() || ".";
  const forceReal = opts.forceReal === true || opts.real === true
    || requested === ".." || requested.startsWith("../") || requested.startsWith("..\\");
  if (!forceReal && (requested === "." || requested === "/" || requested === "")) {
    try {
      const { readRoadmap, isStubRoadmap, formatRoadmapForPrompt } = require("../runtime/project-roadmap");
      const { formatSessionStateForPrompt, ensureSessionState, loadSessionState } = require("../runtime/session-state");
      const loaded = readRoadmap(root);
      if (loaded.exists && loaded.content && !isStubRoadmap(loaded.content)) {
        ensureSessionState(root);
        const state = loadSessionState(root);
        const treePaths = (state.fileTree || []).map((row) => String(row.path || "")).filter(Boolean);
        const dirs = treePaths.filter((p) => p.endsWith("/")).map((p) => p.replace(/\/$/, "")).slice(0, 40);
        const files = treePaths.filter((p) => !p.endsWith("/")).slice(0, 40);
        return {
          ok: true,
          path: ".",
          roadmapFirst: true,
          message: "ROADMAP + session-state ya cubren el mapa. NO reescanees el repo. Usa read_file solo en archivos a editar. Para hermanos: list_files('..').",
          hint: String(formatRoadmapForPrompt(root) || "").slice(0, 1800),
          session: String(formatSessionStateForPrompt(root, 900) || "").slice(0, 900),
          dirs: dirs.length ? dirs : undefined,
          files: files.length ? files : ["ROADMAP.md"],
        };
      }
    } catch { /* fallback a listado real */ }
  }
  const dir = safe(root, requested === "/" ? "." : requested);
  if (!fs.existsSync(dir)) return { ok: false, error: `No existe: ${rel}` };
  const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, max);
  return {
    ok: true,
    path: requested,
    dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name),
    files: entries.filter((e) => e.isFile()).map((e) => e.name),
  };
}

function invalidateReadCache(file) {
  if (!runReadCache?.map) return;
  const key = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  for (const cached of [...runReadCache.map.keys()]) {
    if (cached === key || cached.startsWith(`${key}#`)) runReadCache.map.delete(cached);
  }
}

// El contenido se corta en límites de línea y la respuesta declara qué rango se leyó:
// un corte por presupuesto nunca debe parecer un archivo truncado.
function readFile(root, rel, maxChars = TOOL_RESULT_CAP, opts = {}) {
  const file = safe(root, rel);
  if (!fs.existsSync(file)) return { ok: false, error: `No existe: ${rel}` };
  const stat = fs.statSync(file);
  if (stat.isDirectory()) return { ok: false, error: `Es carpeta: ${rel}` };

  const startReq = Math.max(1, Math.floor(Number(opts.startLine) || 1));
  const endReq = Math.max(0, Math.floor(Number(opts.endLine) || 0));
  const cacheKey = `${file}#${startReq}-${endReq}#${maxChars}`;
  if (runReadCache) {
    const cached = runReadCache.get(cacheKey, stat.mtimeMs);
    if (cached) return cached;
  }

  const full = fs.readFileSync(file, "utf8");
  const lines = full === "" ? [] : full.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;
  if (totalLines && startReq > totalLines) {
    return { ok: false, path: rel, totalLines, error: `startLine ${startReq} fuera de rango: el archivo tiene ${totalLines} líneas.` };
  }
  const lastWanted = endReq >= startReq ? Math.min(endReq, totalLines) : totalLines;
  const out = [];
  let used = 0;
  let endLine = totalLines ? startReq - 1 : 0;
  let lineCut = false;
  for (let i = startReq; i <= lastWanted; i += 1) {
    const line = lines[i - 1];
    if (out.length && used + line.length + 1 > maxChars) break;
    if (line.length > maxChars) { out.push(line.slice(0, maxChars)); lineCut = true; endLine = i; break; }
    out.push(line);
    used += line.length + 1;
    endLine = i;
  }

  const startLine = totalLines ? startReq : 0;
  const partial = startLine > 1 || endLine < totalLines || lineCut;
  const result = { ok: true, path: rel, totalLines, startLine, endLine, bytes: stat.size, partial };
  if (partial) {
    const notes = [];
    if (endLine < totalLines) {
      notes.push(`Lectura parcial por límite de la herramienta: líneas ${startLine}-${endLine} de ${totalLines}. El archivo continúa; NO está truncado ni incompleto. Para seguir: read_file con startLine=${endLine + 1}.`);
    } else {
      notes.push(`Lectura de las líneas ${startLine}-${endLine} de ${totalLines}.`);
    }
    if (lineCut) notes.push(`La línea ${endLine} supera el límite y se muestra recortada (línea muy larga o archivo minificado).`);
    result.note = notes.join(" ");
  }
  result.content = out.join("\n");
  if (runReadCache) runReadCache.set(cacheKey, result, stat.mtimeMs);
  return result;
}

function writeFile(root, rel, content) {
  const snap = snapshotBeforeWrite(root, rel, "write_file");
  const file = safe(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(content ?? ""), "utf8");
  invalidateReadCache(file);
  let syntaxCheck = null;
  try {
    const { validateSyntax } = require("../runtime/syntax-validator");
    syntaxCheck = validateSyntax(rel, String(content ?? ""));
  } catch {}
  const out = {
    ok: true,
    path: rel,
    snapshotId: snap.ok ? snap.id : null,
    ...(syntaxCheck && !syntaxCheck.ok ? {
      syntaxWarning: syntaxCheck.message,
      selfHealHint: syntaxCheck.hint,
    } : {}),
  };
  try {
    const { noteSuccessfulPatch } = require("../runtime/session-state");
    noteSuccessfulPatch(root, {
      path: String(rel || "").replace(/\\/g, "/"),
      action: "write_file",
      summary: "archivo escrito (kernel)",
    });
  } catch { /* índice no debe bloquear escritura */ }
  return out;
}

function locateOldText(current, oldText) {
  const old = String(oldText ?? "");
  if (!old) return { ok: false, error: "oldText vacío" };
  if (current.includes(old)) return { ok: true, match: old, mode: "exact" };

  const normFile = current.replace(/\r\n/g, "\n");
  const normOld = old.replace(/\r\n/g, "\n");
  if (normFile.includes(normOld)) {
    const idx = current.replace(/\r\n/g, "\n").indexOf(normOld);
    if (idx >= 0) {
      let cursor = 0;
      let fileIdx = 0;
      while (cursor < idx && fileIdx < current.length) {
        if (current[fileIdx] === "\r" && current[fileIdx + 1] === "\n") {
          cursor += 1;
          fileIdx += 2;
        } else {
          cursor += 1;
          fileIdx += 1;
        }
      }
      let end = fileIdx;
      let consumed = 0;
      while (consumed < normOld.length && end < current.length) {
        if (current[end] === "\r" && current[end + 1] === "\n") {
          consumed += 1;
          end += 2;
        } else {
          consumed += 1;
          end += 1;
        }
      }
      return { ok: true, match: current.slice(fileIdx, end), mode: "crlf" };
    }
  }

  const softLines = (s) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd());
  const fileLines = softLines(current);
  const oldLines = softLines(old);
  if (oldLines.length && oldLines.every((l) => l.length || oldLines.length === 1)) {
    for (let i = 0; i <= fileLines.length - oldLines.length; i += 1) {
      let hit = true;
      for (let j = 0; j < oldLines.length; j += 1) {
        if (fileLines[i + j] !== oldLines[j]) {
          hit = false;
          break;
        }
      }
      if (hit) {
        const rawLines = current.split(/\r?\n/);
        const slice = rawLines.slice(i, i + oldLines.length).join(current.includes("\r\n") ? "\r\n" : "\n");
        return { ok: true, match: slice, mode: "trim-end" };
      }
    }
  }

  return {
    ok: false,
    error: "oldText no encontrado (debe ser exacto)",
    soft: true,
    hint: "Relee el archivo con read_file y reconstruye oldText EXACTO del contenido actual.",
  };
}

function replaceInFile(root, rel, oldText, newText) {
  const file = safe(root, rel);
  if (!fs.existsSync(file)) return { ok: false, error: `No existe: ${rel}`, soft: true };
  const current = fs.readFileSync(file, "utf8");
  const located = locateOldText(current, oldText);
  if (!located.ok) {
    return {
      ok: false,
      error: located.error,
      soft: true,
      path: rel,
      hint: located.hint || "Relee el archivo y reintenta replace_in_file.",
      preview: current.slice(0, 1200),
    };
  }
  const next = current.replace(located.match, () => String(newText ?? ""));

  let syntaxCheck = null;
  let syntaxBefore = null;
  try {
    const { validateSyntax } = require("../runtime/syntax-validator");
    syntaxCheck = validateSyntax(rel, next);
    if (syntaxCheck && !syntaxCheck.ok) syntaxBefore = validateSyntax(rel, current);
  } catch {}
  if (syntaxCheck && !syntaxCheck.ok && syntaxBefore?.ok) {
    return {
      ok: false,
      soft: true,
      path: rel,
      error: `El reemplazo rompería la sintaxis de ${rel}: ${syntaxCheck.message}. No se escribió nada.`,
      hint: "Relee el archivo con read_file e incluye en oldText/newText el bloque completo (llaves de apertura y cierre).",
    };
  }

  const snap = snapshotBeforeWrite(root, rel, "replace_in_file");
  fs.writeFileSync(file, next, "utf8");
  invalidateReadCache(file);
  const out = {
    ok: true,
    path: rel,
    replaced: true,
    softMatch: located.mode !== "exact" ? located.mode : undefined,
    snapshotId: snap.ok ? snap.id : null,
    ...(syntaxCheck && !syntaxCheck.ok ? {
      syntaxWarning: syntaxCheck.message,
      selfHealHint: syntaxCheck.hint,
    } : {}),
  };
  try {
    const { noteSuccessfulPatch } = require("../runtime/session-state");
    noteSuccessfulPatch(root, {
      path: String(rel || "").replace(/\\/g, "/"),
      action: "replace_in_file",
      summary: "parche aplicado (kernel)",
    });
  } catch { /* ignore */ }
  return out;
}

function isSoftToolFailure(name, result, args = {}) {
  if (!result || result.ok !== false) return false;
  if (result.soft === true) return true;
  const err = String(result.error || result.stderr || result.message || "");
  if (name === "replace_in_file" && /oldText|no existe|No existe/i.test(err)) return true;
  if (name === "list_files" && /No existe|ENOENT/i.test(err)) return true;
  if (name === "run_command") {
    const cmd = String(args.command || "");
    if (/^\s*git\s+(status|diff|log|remote|branch|rev-parse)\b/i.test(cmd)) return true;
    if (/not a git repository|git:\s*command not found|is not recognized/i.test(err)) return true;
  }
  return false;
}

function searchFiles(root, query, maxHits = 30) {
  const hits = [];
  const skip = new Set(["node_modules", ".git", "dist", ".next", ".editcore", "out", "build"]);
  function walk(dir, depth) {
    if (hits.length >= maxHits || depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(js|ts|tsx|jsx|json|md|css|sql)$/i.test(e.name)) {
        try {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes(query)) hits.push(path.relative(root, full).replace(/\\/g, "/"));
        } catch { /* ignore */ }
      }
    }
  }
  walk(path.resolve(root), 0);
  return { ok: true, query, hits };
}

function runCommand(root, command, {
  timeoutMs = 180000,
  onChunk = null,
  onSevereError = null,
  signal = null,
  background = null,
} = {}) {
  const cmd = String(command || "").trim();
  const longLived = background === true || (background !== false && isLongRunningCommand(cmd));
  return runProcess({
    cwd: root,
    command: cmd,
    timeoutMs: longLived ? Math.max(timeoutMs, 8000) : timeoutMs,
    background: longLived,
    onChunk,
    onSevereError,
    signal,
  }).then((result) => ({
    ...result,
    ok: result.ok !== false,
    note: result.streaming
      ? "Proceso de desarrollo en streaming (sin esperar exit). Errores graves disparan auto-heal."
      : undefined,
  }));
}

function auditEnv(root) {
  const examplePath = path.join(root, ".env.example");
  const localCandidates = [".env.local", ".env"];
  if (!fs.existsSync(examplePath)) {
    return { ok: true, missing: [], note: "No hay .env.example" };
  }
  const exampleKeys = fs.readFileSync(examplePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
    .filter(Boolean);

  let localText = "";
  let localFile = "";
  for (const name of localCandidates) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      localText = fs.readFileSync(p, "utf8");
      localFile = name;
      break;
    }
  }
  const present = new Set(
    localText.split(/\r?\n/).map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]).filter(Boolean),
  );
  const missing = exampleKeys.filter((k) => !present.has(k));
  const empty = exampleKeys.filter((k) => {
    const m = localText.match(new RegExp(`^\\s*${k}\\s*=\\s*(.*)$`, "m"));
    return m && !String(m[1] || "").trim();
  });
  return {
    ok: true,
    localFile: localFile || null,
    required: exampleKeys,
    missing,
    empty,
    message: missing.length
      ? `Faltan claves en ${localFile || ".env.local"}: ${missing.join(", ")}. Pégalas o créalas desde .env.example.`
      : "Variables de entorno alineadas con .env.example.",
  };
}

function readEnvFileKeys(root) {
  const out = {};
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = String(m[2] || "").trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  }
  return out;
}

async function runSupabaseSql(root, sqlPath) {
  const rel = String(sqlPath || "").trim() || "supabase/migrations";
  const full = safe(root, rel);
  if (!fs.existsSync(full)) return { ok: false, error: `No existe ${rel}` };

  const env = readEnvFileKeys(root);
  const hasCliCreds = Boolean(env.SUPABASE_DB_URL || env.DATABASE_URL || env.SUPABASE_ACCESS_TOKEN);
  const nextGenTypes = "npx supabase gen types typescript --linked -o types/supabase.ts";

  if (fs.statSync(full).isDirectory()) {
    const files = fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort();
    const bodies = files.slice(0, 10).map((f) => ({
      path: path.join(rel, f).replace(/\\/g, "/"),
      preview: fs.readFileSync(path.join(full, f), "utf8").slice(0, 800),
    }));
    if (hasCliCreds) {
      const push = await runCommand(root, "npx supabase db push", { timeoutMs: 25000 });
      const types = push.ok
        ? await runCommand(root, nextGenTypes, { timeoutMs: 25000 })
        : null;
      return {
        ok: push.ok,
        mode: "executed",
        files: bodies,
        push,
        types,
        next: push.ok ? ["Revisa types/supabase.ts", "Reinicia el preview"] : ["Corrige el SQL", "supabase db push"],
      };
    }
    return {
      ok: true,
      mode: "prepared",
      files: bodies,
      missingEnv: ["SUPABASE_DB_URL o SUPABASE_ACCESS_TOKEN"],
      next: [
        "Configura SUPABASE_DB_URL / login CLI",
        "supabase db push",
        nextGenTypes,
      ],
    };
  }

  const sql = fs.readFileSync(full, "utf8");
  if (hasCliCreds) {
    const push = await runCommand(root, "npx supabase db push", { timeoutMs: 25000 });
    return {
      ok: push.ok,
      mode: "executed",
      path: rel,
      sqlPreview: sql.slice(0, TOOL_RESULT_CAP),
      push,
      next: [nextGenTypes],
    };
  }
  return {
    ok: true,
    mode: "prepared",
    path: rel,
    sqlPreview: sql.slice(0, TOOL_RESULT_CAP),
    missingEnv: ["SUPABASE_DB_URL o SUPABASE_ACCESS_TOKEN"],
    next: ["Revisa el SQL", "Aplica con supabase db push / SQL editor", nextGenTypes],
  };
}

async function cloneRepo(root, repoUrl, destRel) {
  const url = String(repoUrl || "").trim();
  if (!/^https?:\/\/|^git@/i.test(url)) {
    return { ok: false, error: "URL de repositorio inválida (usa https://github.com/...)" };
  }
  const dest = String(destRel || "").trim()
    || path.join(".editcore", "repos", path.basename(url.replace(/\.git$/i, ""), path.sep));
  const abs = safe(root, dest);
  if (fs.existsSync(abs) && fs.readdirSync(abs).length) {
    return { ok: true, path: dest.replace(/\\/g, "/"), note: "El destino ya existe; no se clonó de nuevo." };
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const quoted = url.includes(" ") ? `"${url}"` : url;
  const result = await runCommand(root, `git clone --depth 1 ${quoted} "${abs}"`, { timeoutMs: 120000 });
  if (!result.ok) {
    return { ok: false, error: result.stderr || result.error || "git clone falló", path: dest.replace(/\\/g, "/") };
  }

  const readme = ["README.md", "readme.md", "README"].map((n) => path.join(abs, n)).find((p) => fs.existsSync(p));
  let ingested = null;
  if (readme) {
    const body = fs.readFileSync(readme, "utf8").slice(0, 12000);
    ingested = saveToBrain(root, `repo_${path.basename(abs)}`, body, { source: url, tags: ["git-clone", "readme"] });
  }

  return {
    ok: true,
    path: dest.replace(/\\/g, "/"),
    url,
    ingested,
    next: ["Usa list_files/read_file sobre el clon", "ingest_to_brain para memorias adicionales"],
  };
}

// ============================================================
// NEW: INTERNET — búsqueda web multi-fuente
// ============================================================
function stripHtml(html = "") {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function webSearch(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "query vacía" };
  const maxResults = Math.max(1, Math.min(10, Number(options.maxResults) || 5));

  // Fuente 1: DuckDuckGo HTML (resultados generales)
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    const results = [];
    const blockRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|<\/div>\s*<\/div>|$)/g;
    let m;
    while ((m = blockRegex.exec(html)) !== null && results.length < maxResults) {
      let link = m[1] || "";
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      if (link.startsWith("//")) link = "https:" + link;
      const title = stripHtml(m[2]);
      const snippetMatch = (m[3] || "").match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";
      if (link && title && !link.includes("duckduckgo.com/y.js")) {
        results.push({ title, url: link, snippet });
      }
    }
    if (results.length) {
      return { ok: true, query: q, source: "duckduckgo-html", count: results.length, results };
    }
  } catch { /* fallback */ }

  // Fuente 2: DuckDuckGo Instant Answer API
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const results = [];
    if (data.AbstractText) {
      results.push({ title: data.Heading || "Resultado", url: data.AbstractURL || "", snippet: data.AbstractText });
    }
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics) {
        if (results.length >= maxResults) break;
        if (t.Text && t.FirstURL) {
          results.push({ title: t.Text.slice(0, 120), url: t.FirstURL, snippet: t.Text });
        }
      }
    }
    if (results.length) return { ok: true, query: q, source: "duckduckgo-instant", count: results.length, results };
  } catch { /* fallback */ }

  // Fuente 3: Wikipedia ES
  try {
    const url = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=${maxResults}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const data = await res.json();
    const hits = data?.query?.search || [];
    const results = hits.slice(0, maxResults).map(h => ({
      title: h.title,
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(h.title)}`,
      snippet: stripHtml(h.snippet || ""),
    }));
    if (results.length) return { ok: true, query: q, source: "wikipedia", count: results.length, results };
  } catch { /* no more */ }

  return { ok: false, error: "No se encontraron resultados en ninguna fuente", query: q };
}

// ============================================================
// NEW: GIT — introspección del repositorio
// ============================================================
async function gitStatus(root) {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--short", "--branch"], { cwd: root, timeout: 10000 });
    return { ok: true, output: stdout.trim() };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

async function gitLog(root, options = {}) {
  try {
    const maxCount = Math.max(1, Math.min(50, Number(options.maxCount) || 15));
    const { stdout } = await execFileAsync(
      "git",
      ["log", `-${maxCount}`, "--pretty=format:%h|%an|%ad|%s", "--date=short"],
      { cwd: root, timeout: 10000 },
    );
    const commits = stdout.trim().split("\n").filter(Boolean).map(line => {
      const parts = line.split("|");
      const [hash, author, date, ...rest] = parts;
      return { hash, author, date, message: rest.join("|") };
    });
    return { ok: true, count: commits.length, commits };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

async function gitDiff(root, options = {}) {
  try {
    const args = ["diff"];
    if (options.staged === true) args.push("--staged");
    const { stdout } = await execFileAsync("git", args, { cwd: root, timeout: 15000, maxBuffer: 5 * 1024 * 1024 });
    return { ok: true, diff: stdout.slice(0, 20000) };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

// ============================================================
// NEW: SKILLS — instalar / listar skills desde GitHub
// ============================================================
async function installSkill(root, repoUrl, skillName) {
  const url = String(repoUrl || "").trim();
  const name = String(skillName || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!url || !name) return { ok: false, error: "install_skill requiere repoUrl y skillName" };
  if (!/^https?:\/\/|^git@/i.test(url)) return { ok: false, error: "URL inválida (usa https://...)" };
  const skillsRoot = path.join(root, ".editcore", "skills");
  const target = path.join(skillsRoot, name);
  const relTarget = path.relative(root, target).replace(/\\/g, "/");
  const detected = () => {
    try {
      const { scanSkillDir } = require("../runtime/skills-engine");
      const prefix = path.resolve(target).toLowerCase() + path.sep;
      return scanSkillDir(skillsRoot, "project")
        .filter((s) => path.resolve(s.filePath).toLowerCase().startsWith(prefix))
        .map((s) => s.name);
    } catch { return []; }
  };
  const summary = (extra) => {
    const skills = detected();
    return {
      ok: true,
      path: relTarget,
      skillName: name,
      url,
      skillsDetected: skills.length,
      skills: skills.slice(0, 40),
      note: skills.length
        ? `${extra} Se detectaron ${skills.length} skill(s); ya están disponibles para el agente.`
        : `${extra} No se encontró ningún SKILL.md (ni en la raíz ni en subcarpetas): el repo no parece contener skills.`,
    };
  };
  if (fs.existsSync(target) && fs.readdirSync(target).length) return summary("Ya existía; no se clonó de nuevo.");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    await execFileAsync("git", ["clone", "--depth", "1", url, target], { cwd: root, timeout: 120000 });
    return summary("Repositorio clonado.");
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

function skillsUserDataPath(helpers = {}) {
  const explicit = String(helpers?.userDataPath || process.env.EDITCORE_USER_DATA_PATH || "").trim();
  if (explicit) return explicit;
  try { return require("electron").app?.getPath?.("userData") || ""; } catch { return ""; }
}

// El resultado de una tool se recorta a ~2000 caracteres: con cientos de skills se resume por origen.
function listSkills(root, helpers = {}, query = "") {
  try {
    const engine = require("../runtime/skills-engine");
    const all = engine.listAllSkills({ projectRoot: root, userDataPath: skillsUserDataPath(helpers) });
    const count = all.length;
    const byScope = {};
    for (const s of all) byScope[s.scope] = (byScope[s.scope] || 0) + 1;

    const q = String(query || "").trim().toLowerCase();
    if (q) {
      const matches = all
        .filter((s) => [s.name, s.description, s.category].some((v) => String(v || "").toLowerCase().includes(q)))
        .slice(0, 15)
        .map((s) => `${s.name} [${s.scope === "brain" ? s.repo : s.scope}]: ${String(s.description || "").slice(0, 70)}`);
      return { ok: true, count, query: q, matches };
    }

    const local = (scope) => all.filter((s) => s.scope === scope).map((s) => s.name);
    const repos = {};
    for (const s of all) if (s.scope === "brain") repos[s.repo] = (repos[s.repo] || 0) + 1;
    return {
      ok: true,
      count,
      byScope,
      project: local("project"),
      global: local("global"),
      builtin: local("builtin"),
      brainRepos: Object.entries(repos).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([repo, n]) => `${repo} (${n})`),
      hint: "Usa list_skills con query para buscar una skill concreta.",
    };
  } catch { /* fallback: solo skills del proyecto */ }
  const skillsRoot = path.join(root, ".editcore", "skills");
  if (!fs.existsSync(skillsRoot)) return { ok: true, count: 0, skills: [] };
  try {
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(e => e.isDirectory());
    const skills = entries.map(e => {
      const skillPath = path.join(skillsRoot, e.name);
      let description = "";
      let version = "";
      const manifestPath = path.join(skillPath, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const mf = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          description = mf.description || "";
          version = mf.version || "";
        } catch { /* ignore */ }
      }
      return { name: e.name, path: `.editcore/skills/${e.name}`, description, version };
    });
    return { ok: true, count: skills.length, skills };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

// ============================================================
// TOOL DEFINITIONS
// ============================================================
const DEFINITIONS = [
  { type: "function", function: { name: "list_files", description: "Lista carpetas/archivos reales en disco. Usá path='..' para ver proyectos hermanos bajo el padre. forceReal=true fuerza listado real de '.' (ignora cache ROADMAP).", parameters: { type: "object", properties: { path: { type: "string" }, forceReal: { type: "boolean" } } } } },
  { type: "function", function: { name: "read_file", description: "Lee un archivo por rango de líneas. Devuelve totalLines, startLine y endLine; si partial=true el archivo CONTINÚA (no está truncado): pedí el resto con startLine. Acepta rutas absolutas (D:\\...) o relativas al proyecto.", parameters: { type: "object", properties: { path: { type: "string" }, startLine: { type: "integer", description: "Primera línea a leer (1 = inicio)." }, endLine: { type: "integer", description: "Última línea a leer (opcional)." } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Crea/sobrescribe archivo REAL en disco. Para proyecto hermano: '../NombreProyecto/archivo.ext'.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "replace_in_file", description: "Parche quirúrgico: reemplaza oldText exacto por newText.", parameters: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"] } } },
  { type: "function", function: { name: "search_files", description: "Busca texto en el repo.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "run_command", description: "Comando shell (timeout 25s).", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "audit_env", description: "Compara .env.example vs .env.local y lista claves faltantes.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "supabase_migrate", description: "Prepara/lista migraciones SQL de supabase/migrations.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "scaffold_project", description: "Inicializa Next.js+Tailwind+TS (+Supabase stubs) 0→100.", parameters: { type: "object", properties: { withSupabase: { type: "boolean" } } } } },
  { type: "function", function: { name: "capture_preview", description: "Captura visual del preview local (Electron o Puppeteer).", parameters: { type: "object", properties: { url: { type: "string" }, viewport: { type: "string" } } } } },
  {
    type: "function",
    function: {
      name: "capture_preview_screenshot",
      description: "Captura el preview activo (por defecto http://127.0.0.1:4568/) con Puppeteer/Playwright y diagnostica maquetación para evaluación multimodal UI/UX.",
      parameters: { type: "object", properties: { url: { type: "string" }, viewport: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "web_scrape",
      description: "Navega a una URL, extrae su contenido de texto y lo devuelve para análisis.",
      parameters: { type: "object", properties: { url: { type: "string" }, ingest: { type: "boolean" }, title: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Busca en internet con DuckDuckGo + Wikipedia. Devuelve los mejores resultados con título, URL y snippet. Usala para documentación actualizada, APIs, librerías, errores de código.",
      parameters: { type: "object", properties: { query: { type: "string" }, maxResults: { type: "number" } }, required: ["query"] },
    },
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Estado actual del repo git (rama, modificados, staged, untracked).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Historial de commits del repo git.",
      parameters: { type: "object", properties: { maxCount: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Diff de cambios sin commitear (staged=true para staged).",
      parameters: { type: "object", properties: { staged: { type: "boolean" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "install_skill",
      description: "Instala skills clonando un repo GitHub en .editcore/skills/<name>/. Detecta SKILL.md en la raíz o en subcarpetas (skills/<x>/SKILL.md) y devuelve las skills encontradas.",
      parameters: { type: "object", properties: { repoUrl: { type: "string" }, skillName: { type: "string" } }, required: ["repoUrl", "skillName"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "Skills disponibles: integradas, globales, del proyecto y de los repos del Cerebro. Sin query devuelve un resumen por origen; con query busca por nombre/descripción.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "ingest_to_brain",
      description: "Guarda conocimiento en el Cerebro RAG (.editcore/rag/). Con title+content guarda un texto; con path ingesta un archivo o una carpeta de documentación (md, txt, pdf, docx, xlsx; hasta 40 archivos).",
      parameters: { type: "object", properties: { title: { type: "string" }, content: { type: "string" }, source: { type: "string" }, path: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "list_brain",
      description: "Lista documentos indexados en el Cerebro RAG del proyecto.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "clone_repo",
      description: "Clona un repositorio Git dentro del proyecto (.editcore/repos/) e ingesta el README al cerebro si existe.",
      parameters: { type: "object", properties: { url: { type: "string" }, path: { type: "string" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "clone_web_page",
      description: "Clona una URL: render DOM (Puppeteer/Playwright), capturas, visión→React/Tailwind y merge en golden template.",
      parameters: { type: "object", properties: { url: { type: "string" }, title: { type: "string" }, folder: { type: "string" }, viewport: { type: "string" }, replacements: { type: "object" }, skipVision: { type: "boolean" }, mergeApp: { type: "boolean" }, dryRun: { type: "boolean" } }, required: ["url"] },
    },
  },
  {
    type: "function",
    function: {
      name: "images_to_code",
      description: "Genera UI desde brief/imagen (scaffold o visión).",
      parameters: { type: "object", properties: { title: { type: "string" }, description: { type: "string" }, folder: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "run_e2e_pipeline",
      description: "Verificación end-to-end 1→100 del cableado EditCore.",
      parameters: { type: "object", properties: { writeReport: { type: "boolean" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "rollback_last_change",
      description: "Restaura el último snapshot (.editcore/snapshots/) tras un fallo de compilación.",
      parameters: { type: "object", properties: { snapshotId: { type: "string" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "list_snapshots",
      description: "Lista checkpoints recientes del proyecto.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_circular_dependencies",
      description: "Analiza el árbol de dependencias e imports/requires en el proyecto o carpeta y detecta ciclos circulares recursivos.",
      parameters: { type: "object", properties: { path: { type: "string" }, maxDepth: { type: "number" } } },
    },
  },
];

function resolveListPath(root, requested) {
  try {
    const mapApi = require("../runtime/project-map");
    mapApi.ensureProjectMap?.(root, { maxAgeMs: 5 * 60_000 });
    const resolved = mapApi.resolveExistingTarget(root, requested || ".");
    return resolved;
  } catch {
    return { target: requested || ".", source: "passthrough" };
  }
}

async function execute(name, args, root, allowWrite, helpers = {}) {
  const a = args || {};
  switch (name) {
    case "list_files": {
      const rawPath = String(a.path || "").trim();
      if (rawPath && path.isAbsolute(rawPath)) {
        const absolute = path.resolve(rawPath);
        let isDir = false;
        try { isDir = fs.statSync(absolute).isDirectory(); } catch { isDir = false; }
        if (!isDir) return { ok: false, error: `No existe la carpeta: ${rawPath}` };
        const listed = listFiles(root, absolute, 200, { forceReal: true });
        return listed.ok ? { ...listed, path: absolute } : listed;
      }
      const resolved = resolveListPath(root, a.path || ".");
      const listed = listFiles(root, resolved.target || ".", 80, {
        forceReal: a.forceReal === true || a.real === true,
      });
      if (resolved.missing) {
        return {
          ...listed,
          requested: a.path || ".",
          resolved: resolved.target,
          note: `Ruta '${resolved.missing}' no está en el mapa cognitivo; listando '${resolved.target}'.`,
          soft: !listed.ok,
        };
      }
      return listed;
    }
    case "read_file": return readFile(root, a.path, READ_FILE_TOOL_CAP, { startLine: a.startLine, endLine: a.endLine });
    case "search_files": return searchFiles(root, a.query || "");
    case "write_file":
      if (!allowWrite) return { ok: false, error: "Escritura no permitida" };
      return writeFile(root, a.path, a.content);
    case "replace_in_file":
      if (!allowWrite) return { ok: false, error: "Escritura no permitida" };
      return replaceInFile(root, a.path, a.oldText, a.newText);
    case "run_command":
      if (!allowWrite) return { ok: false, error: "Comandos no permitidos en modo lectura" };
      return runCommand(root, a.command, {
        onChunk: typeof helpers.onProcessChunk === "function"
          ? (ev) => helpers.onProcessChunk({ command: a.command, ...ev })
          : null,
        onSevereError: typeof helpers.onProcessSevereError === "function"
          ? (issue) => helpers.onProcessSevereError({ command: a.command, projectRoot: root, ...issue })
          : null,
        signal: helpers.abortSignal || null,
      });
    case "audit_env":
      return auditEnv(root);
    case "supabase_migrate":
      if (!allowWrite) return { ok: false, error: "Migraciones requieren modo escritura/ejecución" };
      return runSupabaseSql(root, a.path);
    case "scaffold_project":
      if (!allowWrite) return { ok: false, error: "Scaffold requiere escritura" };
      return scaffoldNextApp({ projectRoot: root, withSupabase: a.withSupabase !== false });
    case "capture_preview":
    case "capture_preview_screenshot": {
      const url = a.url || helpers.previewUrl || DEFAULT_PREVIEW_URL;
      const viewport = a.viewport || "desktop";
      try {
        const shot = await capture_preview_screenshot({
          url,
          viewport,
          projectRoot: root,
          electronCapture: typeof helpers.capturePreview === "function"
            ? (opts) => helpers.capturePreview(opts)
            : null,
        });
        const { screenshotAbs: _abs, imageDataUrl: _img, ...safeShot } = shot;
        return safeShot;
      } catch (error) {
        return { ok: false, error: String(error?.message || error).slice(0, 400) };
      }
    }
    case "web_scrape": {
      const scraped = await scrapeWebPage(a.url);
      if (!scraped.ok) return scraped;
      let ingested = null;
      if (a.ingest === true) {
        if (!allowWrite) {
          return { ...scraped, ingested: { ok: false, error: "Ingesta requiere modo escritura" } };
        }
        ingested = saveToBrain(
          root,
          a.title || scraped.title || scraped.url || "web_doc",
          scraped.content,
          { source: scraped.url, tags: ["web_scrape"] },
        );
      }
      return {
        ok: true,
        url: scraped.url,
        title: scraped.title || "",
        engine: scraped.engine,
        content: scraped.content,
        bytes: scraped.bytes,
        note: scraped.note,
        ingested,
      };
    }
    case "web_search":
      return webSearch(a.query, { maxResults: a.maxResults });
    case "git_status":
      return gitStatus(root);
    case "git_log":
      return gitLog(root, { maxCount: a.maxCount });
    case "git_diff":
      return gitDiff(root, { staged: a.staged === true });
    case "install_skill":
      if (!allowWrite) return { ok: false, error: "install_skill requiere modo escritura" };
      return installSkill(root, a.repoUrl, a.skillName);
    case "list_skills":
      return listSkills(root, helpers, a.query);
    case "ingest_to_brain":
      if (!allowWrite) return { ok: false, error: "Ingesta al cerebro requiere modo escritura" };
      if (a.path && !a.content) {
        try { return await ingestPathToBrain(root, safe(root, a.path)); } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 300) }; }
      }
      return saveToBrain(root, a.title, a.content, { source: a.source || "" });
    case "search_brain":
      return extraTools.searchBrain(root, a.query, helpers);
    case "read_pdf":
      try { return await extraTools.readPdf(safe(root, a.path), { maxChars: a.maxChars }); } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 300) }; }
    case "screenshot_page":
      try { return await extraTools.screenshotPage(a.url, { viewport: a.viewport, fullPage: a.fullPage, helpers }); } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 300) }; }
    case "docker_ps":
      return extraTools.dockerPs({ all: a.all === true });
    case "publish_project":
    case "deploy_one_click":
      if (!allowWrite) return { ok: false, error: `${name} requiere modo ejecución` };
      try { return await extraTools.runExternalAction(name, a, root, helpers); } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 400) }; }
    case "list_brain":
      return listBrainDocs(root);
    case "clone_repo":
      if (!allowWrite) return { ok: false, error: "Clonar requiere modo escritura" };
      return cloneRepo(root, a.url, a.path);
    case "clone_web_page": {
      if (!allowWrite) return { ok: false, error: "clone_web_page requiere modo escritura" };
      if (!a.url || !/^https?:\/\//i.test(String(a.url).trim())) {
        return { ok: false, error: "clone_web_page requiere una URL externa http(s) válida en el argumento 'url'. No uses clone_web_page para modificar archivos locales existentes del proyecto." };
      }
      const { cloneWebPage } = require("../runtime/clone-web-page");
      return cloneWebPage(root, {
        url: a.url,
        title: a.title,
        folder: a.folder,
        viewport: a.viewport,
        replacements: a.replacements || a.data || {},
        skipVision: a.skipVision === true,
        mergeApp: a.mergeApp === true,
        dryRun: a.dryRun === true,
      }, { model: a.model || "" });
    }
    case "images_to_code": {
      if (!allowWrite) return { ok: false, error: "images_to_code requiere modo escritura" };
      const { imagesToCode } = require("../runtime/images-to-code");
      return imagesToCode(root, a);
    }
    case "run_e2e_pipeline": {
      const { runEditcoreE2ePipeline } = require("../runtime/e2e-pipeline-report");
      return runEditcoreE2ePipeline(root, { writeReport: a.writeReport !== false });
    }
    case "search_codebase_semantic": {
      const { querySemanticCodebase } = require("../runtime/codebase-indexer");
      const results = querySemanticCodebase(root, a.query || "", a.topK || 6);
      return { ok: true, results, count: results.length };
    }
    case "rollback_last_change":
      if (!allowWrite) return { ok: false, error: "Rollback requiere modo escritura" };
      return rollbackLastChange(root, a.snapshotId || null);
    case "list_snapshots":
      return listSnapshots(root);
    case "analyze_circular_dependencies":
      return detectCircularDependencies(root, a);
    default:
      return { ok: false, error: `Herramienta desconocida: ${name}` };
  }
}

function getToolDefinitions({ allowWrite = true, isFullAccess = false, isAnalysis = false } = {}) {
  const writeTools = new Set([
    "write_file", "replace_in_file", "run_command", "scaffold_project",
    "supabase_migrate", "ingest_to_brain", "clone_repo", "rollback_last_change",
    "images_to_code", "clone_web_page", "install_skill",
    ...extraTools.EXTERNAL_ACTION_TOOLS,
  ]);
  const canWrite = allowWrite === true || isFullAccess === true;
  return [...DEFINITIONS, ...extraTools.EXTRA_DEFINITIONS].filter((t) => {
    if (!canWrite && writeTools.has(t.function?.name)) return false;
    return true;
  });
}

// =====================================================================
// [EDITCORE-ADD] Métricas de uso por tool + rate limiter. Puro add-on.
// No modifica ni reemplaza nada. Si no se usa, no-op.
// =====================================================================
const _ecToolStats = new Map();
const _ecToolRateBuckets = new Map();

function _ecToolKey(name) { return String(name || "unknown"); }

function _ecRateAcquire(name, capacity = 60, refillPerSec = 4) {
  const key = _ecToolKey(name);
  const now = Date.now();
  let b = _ecToolRateBuckets.get(key);
  if (!b) { b = { tokens: capacity, last: now, capacity, refillPerSec }; _ecToolRateBuckets.set(key, b); }
  const elapsed = (now - b.last) / 1000;
  if (elapsed > 0) { b.tokens = Math.min(b.capacity, b.tokens + elapsed * b.refillPerSec); b.last = now; }
  if (b.tokens >= 1) { b.tokens -= 1; return { ok: true, remaining: b.tokens }; }
  return { ok: false, remaining: b.tokens, waitMs: Math.ceil((1 - b.tokens) / b.refillPerSec * 1000) };
}

function recordToolCall(name, { ok, durationMs } = {}) {
  const key = _ecToolKey(name);
  const s = _ecToolStats.get(key) || { calls: 0, ok: 0, fail: 0, totalMs: 0 };
  s.calls++;
  if (ok) s.ok++; else s.fail++;
  s.totalMs += Number(durationMs) || 0;
  _ecToolStats.set(key, s);
}

function getToolStats() {
  const out = {};
  for (const [k, v] of _ecToolStats) {
    out[k] = {
      calls: v.calls,
      ok: v.ok,
      fail: v.fail,
      successRate: v.calls > 0 ? v.ok / v.calls : null,
      avgMs: v.calls > 0 ? Math.round(v.totalMs / v.calls) : null,
    };
  }
  return out;
}

function resetToolStats() { _ecToolStats.clear(); _ecToolRateBuckets.clear(); }
// [/EDITCORE-ADD]

module.exports = {
  TOOL_RESULT_CAP,
  READ_FILE_PAYLOAD_CAP,
  truncatePayload,
  listFiles,
  readFile,
  writeFile,
  replaceInFile,
  searchFiles,
  runCommand,
  auditEnv,
  runSupabaseSql,
  cloneRepo,
  rollbackLastChange,
  listSnapshots,
  capture_preview_screenshot,
  detectCircularDependencies,
  isSoftToolFailure,
  locateOldText,
  execute,
  DEFINITIONS,
  getToolDefinitions,
  // NUEVAS EXPORTS (por si otros módulos las necesitan)
  webSearch,
  gitStatus,
  gitLog,
  gitDiff,
  installSkill,
  listSkills,
  // [EDITCORE-ADD]
  recordToolCall,
  getToolStats,
  resetToolStats,
};