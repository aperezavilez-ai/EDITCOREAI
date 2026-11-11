"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
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
const { capture_preview_screenshot, DEFAULT_PREVIEW_URL } = require("./vision-inspector");
const { fetchStockPhoto } = require("./stock-photos");
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
  const effectiveRoot = root || process.cwd() || path.resolve(__dirname, "..");
  const rawRel = String(rel || ".").trim();
  if (pathPolicy?.resolveAccessibleTarget) {
    try {
      const resolved = pathPolicy.resolveAccessibleTarget(effectiveRoot, rawRel, {
        allowSiblingRead: true,
        fullAccess: true,
        grantAbsoluteOnFull: true,
      });
      if (resolved?.absolute) return resolved.absolute;
    } catch { /* fallback */ }
  }
  const base = path.resolve(effectiveRoot);
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
  if (path.isAbsolute(rawRel) && (!pathPolicy?.isDeniedSystemPath || !pathPolicy.isDeniedSystemPath(rawRel))) {
    return target;
  }
  return target;
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

/**
 * Lock por archivo con identidad DE LA CORRIDA (threadId/rol que llegan
 * por helpers), no solo el global del proceso: con dos corridas en
 * paralelo sobre el mismo proyecto, el global __editcoreCoord lo pisa
 * la última corrida que arranca y los locks dejan de distinguir
 * dueños — los agentes se pisan. El global queda como respaldo para
 * las rutas viejas que no propagan contexto. Devuelve el resultado de
 * bloqueo si otro agente tiene el archivo, o null si se puede seguir.
 */
function acquireWriteLock(root, rel, op, coordCtx) {
  try {
    const { getCoordination } = require("../runtime/agent-coordination");
    const coord = getCoordination(root);
    const g = global.__editcoreCoord || {};
    const threadId = String(coordCtx?.threadId || g.threadId || "default");
    const agentRole = String(coordCtx?.agentRole || g.agentRole || "implementer");
    const lock = coord.acquireLock(threadId, agentRole, rel, op);
    if (!lock.ok) return { ok: false, error: lock.error, locked: true };
    return null;
  } catch { return null; /* coordinación no instalada → continuar */ }
}

function writeFile(root, rel, content, coordCtx) {
  const file = safe(root, rel);
  const body = String(content ?? "");
  // COMPUERTA DE INTEGRIDAD (contrato de turno): un archivo de código que
  // llega en UNA sola línea con escapes literales \n entre sentencias está
  // corrupto de origen (así quedaron Footer.tsx y Navbar.tsx el 2026-11-10:
  // el parser de texto guardaba el contenido sin desescapar). Se RECHAZA
  // antes de tocar el disco: el paso falla en voz alta y el modelo reescribe
  // con saltos de línea reales. Solo código; JSON/minificados quedan fuera.
  if (/\.(?:js|jsx|ts|tsx|mjs|cjs|css|scss|html|vue|svelte|py|java|go|rs|php)$/i.test(String(rel || ""))
    && body.length > 120 && !body.includes("\n") && (body.match(/\\n/g) || []).length >= 2) {
    return {
      ok: false,
      escapedBlob: true,
      error: `Contenido rechazado en ${rel}: llegó en una sola línea con escapes literales \\n en vez de saltos de línea reales. No se escribió nada. Reescribe el archivo con saltos de línea de verdad.`,
    };
  }
  try {
    const { looksIncomplete } = require("../runtime/transactional-engine");
    if (typeof looksIncomplete === "function" && body.trim() && looksIncomplete(body)) {
      return {
        ok: false,
        error: `Contenido incompleto/truncado rechazado en ${rel}. No se permiten TODOs de implementación ni código a medias. Reescribe el archivo completo.`,
      };
    }
  } catch { /* stack no instalado → continuar */ }
  
  const lockBlock = acquireWriteLock(root, rel, "write_file", coordCtx);
  if (lockBlock) return lockBlock;
  
  let _beforeForReview = "";
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      _beforeForReview = fs.readFileSync(file, "utf8");
    }
  } catch { _beforeForReview = ""; }
  try {
    if (_beforeForReview === body) {
      return { ok: true, unchanged: true, path: rel, note: `${rel} ya tenía exactamente ese contenido: no hubo cambios.` };
    }
  } catch { /* si no se puede leer, se escribe normal */ }
  const snap = snapshotBeforeWrite(root, rel, "write_file");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
  invalidateReadCache(file);
  let syntaxCheck = null;
  try {
    const { validateSyntax } = require("../runtime/syntax-validator");
    syntaxCheck = validateSyntax(rel, body);
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
  
  try {
    if (typeof _coord !== "undefined" && _coord) {
      _coord.recordActivity(_coordThread, {
        type: "write",
        agent: _coordAgent,
        path: String(rel || "").replace(/\\/g, "/"),
        op: "write_file",
        note: "archivo escrito",
      });
    }
  } catch { /* no bloquear */ }
  
  try {
    const isFull = Boolean(
      global.__editcoreFullAccess ||
      (typeof global.__editcoreCoord !== "undefined" && global.__editcoreCoord?.fullAccess)
    );
    const unified = require("../runtime/unified-review");
    unified.enqueueFromWrite(root, {
      path: rel,
      before: typeof _beforeForReview !== "undefined" ? _beforeForReview : "",
      after: body,
      backupPath: snap && snap.ok ? (snap.backupPath || snap.path || null) : null,
      source: "agent",
      fullAccess: isFull,
      autoAccept: isFull,
    });
    out.reviewQueued = !isFull;
    if (isFull) out.accepted = true;
  } catch { /* no bloquear escritura */ }
  
  try {
    const { updateFileInIndex } = require("../runtime/codebase-indexer");
    updateFileInIndex(root, rel, body);
    out.indexUpdated = true;
  } catch { /* no bloquear */ }
  
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

function replaceInFile(root, rel, oldText, newText, coordCtx) {
  const file = safe(root, rel);
  if (!fs.existsSync(file)) return { ok: false, error: `No existe: ${rel}`, soft: true };
  // replace_in_file NO tenía lock (solo write_file): era la puerta
  // trasera por la que dos agentes en paralelo se pisaban el mismo
  // archivo. Mismo lock e identidad que write_file.
  const lockBlock = acquireWriteLock(root, rel, "replace_in_file", coordCtx);
  if (lockBlock) return lockBlock;
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
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const normNew = String(newText ?? "").replace(/\r\n|\n/g, eol);
  const next = current.replace(located.match, () => normNew);
  if (next === current) {
    return { ok: false, soft: true, unchanged: true, path: rel, error: `El reemplazo no cambia nada en ${rel} (oldText y newText son iguales). No se escribió nada.`, hint: "Escribe en newText el código corregido, distinto del actual." };
  }

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
  
  try {
    const isFull = Boolean(
      global.__editcoreFullAccess ||
      (typeof global.__editcoreCoord !== "undefined" && global.__editcoreCoord?.fullAccess)
    );
    const unified = require("../runtime/unified-review");
    unified.enqueueFromWrite(root, {
      path: rel,
      before: current,
      after: next,
      backupPath: snap && snap.ok ? (snap.backupPath || snap.path || null) : null,
      source: "agent",
      fullAccess: isFull,
      autoAccept: isFull,
    });
    out.reviewQueued = !isFull;
    if (isFull) out.accepted = true;
  } catch { /* no bloquear */ }
  
  try {
    const { updateFileInIndex } = require("../runtime/codebase-indexer");
    updateFileInIndex(root, rel, next);
    out.indexUpdated = true;
  } catch { /* no bloquear */ }
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

// REEMPLAZO DE PROCESS-RUNNER CON CHILD_PROCESS NATIVO
function runCommand(root, command, options = {}) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "/bin/sh";
    const args = isWin ? ["-Command", command] : ["-c", command];
    // TEMPORIZADOR OBLIGATORIO (contrato de turno): antes runCommand ignoraba
    // el timeoutMs de sus llamadores y un proceso continuo (un dev server)
    // nunca disparaba "close" — sus procesos hijos heredan las tuberías — y
    // la corrida quedaba colgada para siempre quemando saldo. Todo comando
    // tiene ahora un límite; al vencer, se mata el árbol y el paso HABLA.
    const timeoutMs = Math.min(600_000, Math.max(1_000, Number(options.timeoutMs) || 120_000));
    // DETENER de verdad (1/2): si la corrida ya fue detenida, el comando
    // ni siquiera arranca.
    if (options.signal && options.signal.aborted) {
      resolve({ ok: false, aborted: true, code: null, output: "", stderr: "", error: "Comando no ejecutado: la corrida ya estaba detenida por el usuario." });
      return;
    }
    const child = spawn(shell, args, { cwd: root, windowsHide: true });
    let output = "";
    let stderr = "";
    let settled = false;
    let onAbort = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onAbort && options.signal && typeof options.signal.removeEventListener === "function") {
        try { options.signal.removeEventListener("abort", onAbort); } catch { /* ignore */ }
      }
      resolve(result);
    };
    const killTree = () => {
      try {
        if (isWin && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        } else {
          child.kill("SIGKILL");
        }
      } catch { /* el proceso ya pudo morir */ }
    };
    const timer = setTimeout(() => {
      killTree();
      finish({
        ok: false,
        timeout: true,
        code: null,
        output: output.slice(0, 10000),
        stderr: stderr.slice(0, 10000),
        error: `El comando superó el límite de ${Math.round(timeoutMs / 1000)} s y fue terminado. Si es un servidor u otro proceso continuo, no lo dejes en primer plano: usa el preview del IDE o pide un comando que termine.`,
      });
    }, timeoutMs);
    // DETENER de verdad (2/2): execute() ya pasaba helpers.abortSignal en
    // las opciones, pero runCommand lo IGNORABA — el comando corría hasta
    // su timeout aunque el usuario hubiera pulsado Detener, y el bucle
    // del agente quedaba estacionado esperándolo (así se vivió la
    // corrida colgada de TALLE PRUEBA). Ahora la señal mata el árbol al
    // instante y el paso HABLA: la corrida se desenrolla en el acto.
    onAbort = () => {
      killTree();
      finish({
        ok: false,
        aborted: true,
        code: null,
        output: output.slice(0, 10000),
        stderr: stderr.slice(0, 10000),
        error: "Comando detenido por el usuario con el botón Detener.",
      });
    };
    if (options.signal && typeof options.signal.addEventListener === "function") {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (d) => {
      output += d.toString();
      if (options.onChunk) options.onChunk({ stream: "stdout", chunk: d.toString() });
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (options.onChunk) options.onChunk({ stream: "stderr", chunk: d.toString() });
    });

    child.on("close", (code) => {
      finish({ ok: code === 0, code, output: output.slice(0, 10000), stderr: stderr.slice(0, 10000) });
    });

    child.on("error", (err) => {
      finish({ ok: false, error: err.message });
    });
  });
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

async function gitCommit(root, options = {}) {
  try {
    const gitMgr = require("../runtime/git-manager");
    const files = Array.isArray(options.files) && options.files.length ? options.files : ["."];
    const stage = gitMgr.stageFiles(files, root);
    if (!stage.ok && stage.message) return { ok: false, error: stage.message, stderr: stage.stderr };
    const msg = String(options.message || "update from editcoreai").trim();
    const res = gitMgr.commit(msg, root);
    return { ok: res.ok, output: res.stdout || res.message, error: res.stderr || res.message };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

async function gitPush(root, options = {}) {
  try {
    const gitMgr = require("../runtime/git-manager");
    const remote = String(options.remote || "origin").trim();
    const branch = String(options.branch || "").trim();
    const res = gitMgr.push(remote, branch, root);
    return { ok: res.ok, output: res.stdout || res.message, error: res.stderr || res.message };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

async function buildProject(root, options = {}) {
  const pkgPath = path.join(root, "package.json");
  let buildCmd = String(options.command || "").trim();
  if (!buildCmd && fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts || {};
      if (scripts["dist:win"]) buildCmd = "npm run dist:win";
      else if (scripts["build:exe"]) buildCmd = "npm run build:exe";
      else if (scripts["package"]) buildCmd = "npm run package";
      else if (scripts["electron:build"]) buildCmd = "npm run electron:build";
      else if (scripts["build"]) buildCmd = "npm run build";
      else if (scripts["release:win"]) buildCmd = "npm run release:win";
    } catch (_) {}
  }
  if (!buildCmd) {
    if (fs.existsSync(path.join(root, "scripts", "build-release.mjs"))) {
      buildCmd = "node scripts/build-release.mjs";
    } else if (fs.existsSync(path.join(root, "scripts", "build-release.js"))) {
      buildCmd = "node scripts/build-release.js";
    } else if (fs.existsSync(path.join(root, "scripts", "rebuild-root-exe.js"))) {
      buildCmd = "node scripts/rebuild-root-exe.js";
    } else if (fs.existsSync(path.join(root, "scripts", "build-windows.js"))) {
      buildCmd = "node scripts/build-windows.js";
    } else if (fs.existsSync(path.join(root, "src-tauri"))) {
      buildCmd = "cargo tauri build";
    } else {
      buildCmd = "npm run build";
    }
  }
  return await runCommand(root, buildCmd, { timeoutMs: 900000, signal: options.signal || null });
}

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
    const builtinList = local("builtin");
    return {
      ok: true,
      count,
      byScope,
      project: local("project"),
      global: local("global"),
      builtin: builtinList.slice(0, 30),
      builtinTotal: builtinList.length,
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

const DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "Lista los archivos y carpetas en una ruta específica. Úsalo para explorar el proyecto.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta relativa a listar. Usa '.' para la raíz." },
          forceReal: { type: "boolean", description: "Si es true, ignora la caché y lee el disco real." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Lee el contenido de un archivo. Si el archivo es muy largo, usa startLine y endLine.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta relativa del archivo a leer." },
          startLine: { type: "integer", description: "Línea de inicio (opcional)." },
          endLine: { type: "integer", description: "Línea de fin (opcional)." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Crea o sobrescribe un archivo completo. Úsalo solo para archivos nuevos o si necesitas reemplazar todo el contenido.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta del archivo a escribir." },
          content: { type: "string", description: "Contenido completo del archivo." }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description: "Edita un archivo reemplazando un bloque de texto exacto. Es la forma preferida de modificar código existente.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta del archivo a editar." },
          oldText: { type: "string", description: "El texto exacto a buscar. Debe coincidir byte por byte." },
          newText: { type: "string", description: "El nuevo texto que reemplazará al oldText." }
        },
        required: ["path", "oldText", "newText"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Busca una cadena de texto o código dentro de los archivos del proyecto.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto o expresión a buscar." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Ejecuta un comando en la terminal (PowerShell/CMD). Úsalo para compilar, instalar, o hacer git push. Todo comando tiene temporizador (defecto 120 s, máx. 600 s): al vencer, el proceso se termina y el resultado lo dice. No lo uses para servidores en primer plano.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "El comando a ejecutar (ej. 'npm run build')." },
          timeoutMs: { type: "number", description: "Límite en milisegundos (1000 a 600000). Defecto: 120000." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "build_project",
      description: "Compila el proyecto completo (build, dist, make). Usa esto en lugar de run_command si tu única intención es compilar.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Comando de compilación personalizado (opcional)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Muestra el estado actual de Git (archivos modificados, rama, etc.).",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "git_commit",
      description: "Hace un commit de los cambios actuales en Git.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Mensaje del commit." }
        },
        required: ["message"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_push",
      description: "Sube los commits al repositorio remoto.",
      parameters: {
        type: "object",
        properties: {
          remote: { type: "string", description: "Nombre del remoto (por defecto 'origin')." },
          branch: { type: "string", description: "Nombre de la rama (opcional)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Busca en internet (DuckDuckGo/Wikipedia). Úsalo para buscar documentación actualizada o resolver errores.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "La consulta de búsqueda." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "capture_preview_screenshot",
      description: "Captura el preview local del proyecto y devuelve diagnósticos mecánicos de maquetación (overflow horizontal, controles recortados, página vacía, jerarquía) junto con la ruta del PNG. Úsala tras construir o cambiar UI: captura en desktop y en mobile, corrige lo que los diagnósticos reporten y repite hasta que salga limpia. Solo acepta URLs locales (localhost/127.0.0.1).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL local donde corre el proyecto (preview del IDE o dev server). Si se omite, usa el preview por defecto del IDE." },
          viewport: { type: "string", enum: ["desktop", "mobile"], description: "Tamaño de captura. Llama dos veces: desktop y mobile." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_stock_photo",
      description: "Busca una fotografía REAL de stock (licencia abierta, vía Openverse) y la descarga a la carpeta assets/ del proyecto, devolviendo su ruta local y el crédito. Úsala para las imágenes de una web (hero, secciones, testimonios): una página profesional necesita fotografía real, no solo cajas CSS y texto. Llama una vez por imagen que necesites, con búsquedas concretas del negocio (p. ej. 'mechanic working car repair', 'barber shop interior'). Si devuelve ok:false, sigue sin esa foto y dilo en tu resumen.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Qué foto buscar, en inglés da mejores resultados (p. ej. 'auto mechanic changing tire')." },
          name: { type: "string", description: "Nombre base del archivo (p. ej. 'hero-taller'). Si se omite, se deriva de la búsqueda." },
          folder: { type: "string", description: "Carpeta del proyecto donde guardar la foto. Por defecto 'assets' (webs sueltas); en proyectos React/Vite usa 'public/assets' para que la foto se sirva como archivo público." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scaffold_project",
      description: "Sienta la BASE WEB PROFESIONAL de EditCoreAI en el proyecto actual: React + Vite + TypeScript + Tailwind + Framer Motion, con componentes UI (Button, Card, Dialog, Tabs...), layout (Navbar/Footer) y secciones (Hero, Showcase) ya animadas — la misma base del diálogo 'Nuevo proyecto → Web App profesional'. Úsala como PRIMER paso cuando el proyecto esté vacío y vayas a construir una web/app: construir sobre esta base, no sobre un HTML suelto. Se niega si el proyecto ya tiene contenido (no pisa una app existente) salvo force:true cuando el usuario pidió rehacer la base. Después de llamarla, ejecuta npm install con run_command y personaliza src/App.tsx y las secciones.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre de la app (p. ej. 'Taller Luis'). Si se omite, se usa el nombre de la carpeta del proyecto." },
          prompt: { type: "string", description: "El pedido original del usuario, para sembrar el contenido inicial de las secciones." },
          force: { type: "boolean", description: "Sobrescribir aunque el proyecto tenga contenido. Solo si el usuario pidió rehacer la base desde cero." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delegate_parallel",
      description: "Delega 2-4 subagentes de SOLO LECTURA que trabajan EN PARALELO (explorer: mapea una zona del proyecto; analyst: responde una pregunta de análisis o revisión sobre el código) y devuelve un informe combinado. Úsala cuando una tarea tenga frentes independientes que convenga investigar a la vez —p. ej. uno mapea el frontend, otro revisa el backend, otro audita la configuración— en vez de explorarlos en serie tú solo. No escribe archivos: con el informe, la construcción la ejecutas tú.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "Subtareas independientes (máximo 4).",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["explorer", "analyst"], description: "explorer mapea una zona; analyst responde una pregunta de análisis/revisión." },
                target: { type: "string", description: "Zona o ruta a mapear (rol explorer)." },
                question: { type: "string", description: "Pregunta que debe responder (rol analyst)." }
              },
              required: ["role"]
            }
          }
        },
        required: ["tasks"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "deploy_one_click",
      description: "Publica o despliega el proyecto actual (ej. Vercel o servidor configurado).",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Destino del deploy (ej. 'vercel', 'production')." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "invoke_subagent",
      description: "Despacha un subagente especializado para una tarea puntual.",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["explorer", "implementer", "analyst", "verifier", "security", "database", "ui_ux", "devops"], description: "Rol del subagente." },
          task: { type: "string", description: "Instrucción para el subagente." },
          target: { type: "string", description: "Archivo o ruta objetivo." }
        },
        required: ["role", "task"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "install_skill",
      description: "Instala una skill clonando un repositorio de GitHub.",
      parameters: {
        type: "object",
        properties: {
          repoUrl: { type: "string", description: "URL del repositorio." },
          skillName: { type: "string", description: "Nombre de la carpeta para la skill." }
        },
        required: ["repoUrl", "skillName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_skills",
      description: "Lista las skills disponibles en el sistema.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "read_skill",
      description: "Carga el contenido COMPLETO de cualquier skill del catálogo por su nombre (incluidas las instaladas desde el Cerebro). Úsala cuando una skill no inyectada en este turno sea relevante: primero mira la lista con list_skills o en el bloque SKILLS del sistema.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Nombre/id exacto de la skill (ej. 'as-debugging-and-error-recovery')." }
        },
        required: ["name"]
      }
    }
  }
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
  // Identidad de coordinación de ESTA corrida para los locks por
  // archivo (la propagan el orquestador y el implementer por helpers).
  const coordCtx = { threadId: helpers?.threadId || null, agentRole: helpers?.agentRole || null };
  try {
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
        if (!allowWrite) return { ok: false, error: "Escritura no permitida (Modo Solo Lectura)." };
        return writeFile(root, a.path, a.content, coordCtx);
      case "replace_in_file":
        if (!allowWrite) return { ok: false, error: "Escritura no permitida (Modo Solo Lectura)." };
        return replaceInFile(root, a.path, a.oldText, a.newText, coordCtx);
      case "delegate_parallel": {
        // Subagentes de solo lectura EN PARALELO (explorer/analyst
        // reales, requeridos aquí dentro para no crear un ciclo de
        // módulos: los subagentes a su vez requieren tools).
        const { runDelegatedTasks } = require("./parallel-delegate");
        const { runExplorer } = require("./subagents/explorer");
        const { runAnalyst } = require("./subagents/analyst");
        return await runDelegatedTasks({
          projectRoot: root,
          tasks: a.tasks,
          threadId: coordCtx.threadId || "default",
          signal: helpers?.abortSignal || null,
          runners: {
            explorer: (task) => runExplorer({ projectRoot: root, target: task.target || ".", signal: helpers?.abortSignal || null }),
            analyst: (task) => runAnalyst({ projectRoot: root, userMessage: task.question || "", signal: helpers?.abortSignal || null }),
          },
        });
      }
      case "run_command":
        if (!allowWrite) return { ok: false, error: "Comandos no permitidos en modo lectura." };
        return runCommand(root, a.command, {
          timeoutMs: a.timeoutMs,
          onChunk: typeof helpers.onProcessChunk === "function"
            ? (ev) => helpers.onProcessChunk({ command: a.command, ...ev })
            : null,
          onSevereError: typeof helpers.onProcessSevereError === "function"
            ? (issue) => helpers.onProcessSevereError({ command: a.command, projectRoot: root, ...issue })
            : null,
          signal: helpers.abortSignal || null,
        });
      case "build_project":
        if (!allowWrite) return { ok: false, error: "Compilar requiere modo escritura/ejecución." };
        return await buildProject(root, { ...a, signal: helpers.abortSignal || null });
      case "git_status":
        return await gitStatus(root);
      case "git_commit":
        if (!allowWrite) return { ok: false, error: "git_commit requiere modo escritura." };
        return await gitCommit(root, a);
      case "git_push":
        if (!allowWrite) return { ok: false, error: "git_push requiere modo escritura." };
        return await gitPush(root, a);
      case "web_search":
        return webSearch(a.query, { maxResults: a.maxResults });
      case "graphify_project": {
        // El runner existe (graphify-runner.js) pero el despachador no tenía
        // el case: caía en "Herramienta desconocida". Genera el grafo y sus
        // salidas en graphify-out/ del proyecto analizado.
        const { buildProjectGraph } = require("./graphify-runner");
        const target = a.path && a.path !== "." ? (path.isAbsolute(String(a.path)) ? String(a.path) : path.join(root, String(a.path))) : root;
        return await buildProjectGraph(target, {});
      }
      case "deploy_one_click":
        if (!allowWrite) return { ok: false, error: "Deploy requiere modo ejecución." };
        return await extraTools.runExternalAction("deploy_one_click", a, root, helpers);
      case "read_pdf": {
        const file = path.isAbsolute(String(a.path || "")) ? String(a.path) : path.join(root, String(a.path || ""));
        return await extraTools.readPdf(file, { maxChars: a.maxChars });
      }
      case "docker_ps":
        return await extraTools.dockerPs({ all: a.all === true });
      case "screenshot_page":
        return await extraTools.screenshotPage(a.url, { viewport: a.viewport, fullPage: a.fullPage === true, helpers });
      case "capture_preview_screenshot":
        return await capture_preview_screenshot({ url: a.url || helpers?.activePreviewUrl || undefined, viewport: a.viewport === "mobile" ? "mobile" : "desktop", projectRoot: root });
      case "fetch_stock_photo":
        return await fetchStockPhoto({ query: a.query || "", name: a.name || "", folder: a.folder || "", projectRoot: root });
      case "scaffold_project": {
        const { projectLooksEmpty } = require("./build-base-guard");
        if (a.force !== true && !projectLooksEmpty(root)) {
          return { ok: false, error: "El proyecto ya tiene contenido (package.json o estructura): scaffold_project no pisa una app existente. Si el usuario pidió rehacer la base desde cero, repite con force:true." };
        }
        const { scaffoldGreenfieldApp } = require("../runtime/greenfield-builder");
        const built = scaffoldGreenfieldApp(root, {
          prompt: String(a.prompt || ""),
          appName: String(a.name || "").trim() || path.basename(root),
        });
        return {
          ...built,
          nextSteps: "Base sentada. Ahora: (1) ejecuta npm install con run_command; (2) personaliza src/App.tsx, src/components/sections/Hero.tsx y Showcase.tsx con el contenido real del negocio; (3) fotos reales con fetch_stock_photo en public/assets; (4) verifica con capture_preview_screenshot.",
        };
      }
      case "search_brain":
        return await extraTools.searchBrain(root, a.query || "", helpers, a.limit);
      case "check_connections":
        return await extraTools.checkConnections(root, helpers);
      case "ingest_to_brain": {
        if (!allowWrite) return { ok: false, error: "ingest_to_brain requiere modo escritura." };
        const target = path.isAbsolute(String(a.path || "")) ? String(a.path) : path.join(root, String(a.path || ""));
        return await ingestPathToBrain(root, target);
      }
      case "connect_project":
        if (!allowWrite) return { ok: false, error: "connect_project requiere modo escritura." };
        return await extraTools.runExternalAction("connect_project", a, root, helpers);
      case "publish_project":
        if (!allowWrite) return { ok: false, error: "publish_project requiere modo escritura." };
        return await extraTools.runExternalAction("publish_project", a, root, helpers);
      case "invoke_subagent": {
        const { runSubagent } = require("../runtime/subagent-runner");
        const subRole = String(a.role || "explorer").toLowerCase();
        if ((subRole === "implementer" || subRole === "writer") && !allowWrite) {
          return { ok: false, error: "Subagente implementer requiere modo escritura." };
        }
        return await runSubagent(root, {
          role: subRole,
          task: a.task,
          target: a.target,
          query: a.task,
        }, helpers);
      }
      case "install_skill":
        if (!allowWrite) return { ok: false, error: "install_skill requiere modo escritura." };
        return installSkill(root, a.repoUrl, a.skillName);
      case "list_skills":
        return listSkills(root, helpers, a.query);
      case "read_skill": {
        const wanted = String(a.name || a.skill || a.id || "").trim();
        if (!wanted) return { ok: false, error: "read_skill requiere el nombre de la skill." };
        // Primero el Cerebro (incluye las skills instaladas desde su catálogo);
        // si no está o falla, el catálogo local del kernel.
        if (typeof helpers?.brainReadSkill === "function") {
          try {
            const s = await helpers.brainReadSkill(root, wanted);
            if (s && s.content) return { ok: true, name: s.name || wanted, source: s.source || "cerebro", content: String(s.content).slice(0, 30000) };
          } catch { /* cae al catálogo local */ }
        }
        try {
          const cat = require("./skills-catalog");
          const hit = cat.loadSkillBody(root, wanted);
          if (hit && hit.available) return { ok: true, name: wanted, source: "catalogo", content: String(hit.body || "").slice(0, 30000) };
        } catch { /* sin catálogo */ }
        return { ok: false, error: `Skill no encontrada: ${wanted}. Revisa los nombres disponibles con list_skills.` };
      }
      default:
        return { ok: false, error: `Herramienta desconocida: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: `Error interno ejecutando ${name}: ${err.message}` };
  }
}

// Las definiciones extra viven en extra-tools.js; se fusionan una sola vez y sin duplicar.
for (const def of extraTools.EXTRA_DEFINITIONS) {
  if (!DEFINITIONS.some((t) => t.function?.name === def.function?.name)) DEFINITIONS.push(def);
}

// La clasificación lectura/escritura vive en classify.js (única fuente):
// antes este módulo mantenía su propio Set de herramientas de escritura y
// derivaba del despachador real (p. ej. no conocía delete_file ni move_file).
const { WRITE_TOOLS } = require("./classify");
const WRITE_TOOL_SET = new Set(WRITE_TOOLS);

function getToolDefinitions({ allowWrite = true, isFullAccess = false, isAnalysis = false } = {}) {
  const canWrite = allowWrite === true || isFullAccess === true;
  return DEFINITIONS.filter((t) => {
    if (!canWrite && WRITE_TOOL_SET.has(t.function?.name)) return false;
    return true;
  });
}

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
  webSearch,
  gitStatus,
  gitLog,
  gitDiff,
  gitCommit,
  gitPush,
  buildProject,
  installSkill,
  listSkills,
  recordToolCall,
  getToolStats,
  resetToolStats,
};