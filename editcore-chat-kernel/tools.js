"use strict";

const fs = require("fs");
const path = require("path");
// [EDITCORE-INTEGRAL-B4] `spawn` ya no se importa aquí: el único spawn
// del kernel vive en process-runner.js (run_command delega en él).
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
  // [EDITCORE-INTEGRAL-B4] Reversión de UN archivo desde su snapshot.
  rollbackFileChange,
  listSnapshots,
} = require("./snapshot");
// [EDITCORE-INTEGRAL-B4] run_command CONVERGE al runner único del kernel
// (process-runner.js): conservación de COLA, detección de errores
// severos y spawn en un solo sitio. El spawn propio duplicado que vivía
// en este archivo desaparece.
const { runProcess } = require("./process-runner");
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
// [EDITCORE-V500-A] Disciplina de escritura del harness de tokens
// (dueño único de las métricas cache read/write): tools registra aquí
// el resultado de cada write_file (no-op idéntico / diff pequeño /
// escritura completa) para medir el desperdicio de tokens de salida.
let tokenHarness = null;
try {
  tokenHarness = require("../runtime/agent-token-harness");
  runReadCache = new tokenHarness.RunReadCache();
} catch {
  runReadCache = null;
  tokenHarness = null;
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

// [EDITCORE-INTEGRAL-B4] POLÍTICA DE TRUNCAMIENTO POR HERRAMIENTA.
// Antes TODO resultado se cortaba a 2.000 caracteres POR LA CABEZA al
// insertarlo en el bucle: la evidencia crítica vive al FINAL de las
// salidas (el error final de npm/tsc/Vite, el stderr tras el output, la
// cola de read_skill, los diagnostics de la captura) y ese corte la
// eliminaba sistemáticamente. Ahora:
//  - Cada herramienta tiene su PROPIO tope declarado (abajo).
//  - El corte, cuando hace falta, es CABEZA+COLA con elipsis declarada
//    («[… N caracteres omitidos …]»): se conserva el principio Y el
//    final del payload.
//  - Para las herramientas con campos críticos, la serialización pone
//    esos campos PRIMERO (ver shapeToolPayload): run_command serializa
//    stderr ANTES que output (ambos llegan) y capture_preview_screenshot
//    serializa diagnostics/renderOk primero.
//  - publish_project / deploy_one_click / connect_project NO se
//    reordenan: su objeto de fallo trae un orden de claves DELIBERADO
//    (diseño del humo, INTOCABLE) y su tope amplio (12.000) deja pasar
//    íntegro el fallo típico (veredicto + smoke + firstLogError + logs
//    ≤4.000); si alguna vez lo supera, cabeza+cola conserva el
//    veredicto del principio y la cola de los logs del final.
const TOOL_PAYLOAD_CAPS = {
  default: 4000,
  read_file: READ_FILE_PAYLOAD_CAP,
  run_command: 12000,
  build_project: 12000,
  git_diff: 12000,
  git_log: 6000,
  git_status: 6000,
  // read_skill es el canal de cuerpo completo BAJO DEMANDA del Bloque 2:
  // su presupuesto propio (~30.000 de contenido) se respeta entero.
  read_skill: 32000,
  // delegate_parallel: hasta 4 informes de ≤4.000; el conjunto conserva
  // cada informe (ver shapeToolPayload: se descarta el `text` duplicado).
  delegate_parallel: 20000,
  capture_preview_screenshot: 10000,
  search_files: 8000,
  web_search: 8000,
  search_brain: 8000,
  publish_project: 12000,
  deploy_one_click: 12000,
  connect_project: 12000,
};

function headTailText(text, max) {
  const src = String(text ?? "");
  const cap = Math.max(200, Number(max) || TOOL_RESULT_CAP);
  if (src.length <= cap) return src;
  // Elipsis DECLARADA con el conteo exacto de caracteres omitidos; se
  // itera dos veces para que el conteo impreso sea el real tras contar
  // la propia elipsis dentro del tope.
  let omitted = src.length - cap;
  let marker = "";
  let headLen = 0;
  let tailLen = 0;
  for (let i = 0; i < 3; i += 1) {
    marker = `\n…[… ${omitted} caracteres omitidos …]\n[respuesta de la herramienta recortada: es un límite del chat, no un problema del archivo]\n`;
    const room = Math.max(0, cap - marker.length);
    headLen = Math.ceil(room * 0.55);
    tailLen = Math.max(0, room - headLen);
    const realOmitted = src.length - headLen - tailLen;
    if (realOmitted === omitted) break;
    omitted = realOmitted;
  }
  return `${src.slice(0, headLen)}${marker}${tailLen ? src.slice(-tailLen) : ""}`;
}

function reorderKeys(obj, priority) {
  const out = {};
  for (const key of priority) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key];
  }
  for (const key of Object.keys(obj)) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = obj[key];
  }
  return out;
}

// [EDITCORE-INTEGRAL-B4] Forma del payload SEGÚN la herramienta: qué
// campos van primero al serializar (los críticos), antes de cualquier
// corte cabeza+cola. Sin reorden para el resto (en particular, el
// fallo de deploy/publish conserva su orden deliberado intacto).
function shapeToolPayload(value, toolName = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  switch (String(toolName || "")) {
    case "run_command":
    case "build_project":
      // stderr ANTES que output: con el corte único por la cabeza,
      // output se comía el cupo y stderr NUNCA llegaba al modelo.
      return reorderKeys(value, ["ok", "code", "error", "severeError", "timeout", "aborted", "streaming", "stderr", "output", "stdout", "command"]);
    case "capture_preview_screenshot":
      // diagnostics y el veredicto (renderOk) PRIMERO: iban casi al
      // final del objeto y el corte por la cabeza los perdía siempre.
      return reorderKeys(value, ["diagnostics", "renderOk", "visionReview", "visionNote", "ok", "error", "url", "screenshotPath", "viewport", "engine", "multimodalHint"]);
    case "delegate_parallel": {
      // El resultado trae los informes DOS veces (results[].text y el
      // `text` combinado). En el payload al modelo se conserva results
      // íntegro (cada informe con su tope de 4.000) y del combinado
      // solo su línea resumen: nada de información se pierde y el
      // conjunto ya no se aplasta.
      if (!Array.isArray(value.results)) return reorderKeys(value, ["ok", "delegated", "completed", "error", "notes", "results"]);
      const shaped = reorderKeys(value, ["ok", "delegated", "completed", "error", "notes", "results"]);
      if (typeof value.text === "string") shaped.text = value.text.split(/\r?\n/)[0];
      return shaped;
    }
    case "read_skill":
      // content AL FINAL a propósito: el corte cabeza+cola conserva el
      // inicio de la skill y, sobre todo, su COLA (antes se perdía).
      return reorderKeys(value, ["ok", "error", "name", "source", "content"]);
    case "git_diff":
      return reorderKeys(value, ["ok", "error", "diff"]);
    default:
      return value;
  }
}

function truncatePayload(value, max, toolName = "") {
  // [EDITCORE-INTEGRAL-B4] Firma compatible: truncatePayload(valor) y
  // truncatePayload(valor, tope) siguen valiendo; con nombre de
  // herramienta y sin tope explícito manda la política por herramienta.
  const hasExplicitMax = Number(max) > 0;
  const cap = hasExplicitMax ? Number(max) : (TOOL_PAYLOAD_CAPS[String(toolName || "")] || TOOL_PAYLOAD_CAPS.default);
  const shaped = shapeToolPayload(value, toolName);
  const text = typeof shaped === "string" ? shaped : JSON.stringify(shaped ?? {});
  if (text.length <= cap) return text;
  return headTailText(text, cap);
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

// [EDITCORE-INTEGRAL-B9] Ciclo de vida REAL del lock por archivo:
// (i) write_file/replace_in_file LIBERAN su lock al terminar CADA
// escritura (el releaseAllForThread del cierre del turno queda solo
// como red de seguridad para locks de operaciones compuestas);
// (ii) la identidad ya es la corrida (agent-coordination), así que
// liberar con cualquier rol de la misma corrida funciona.
function releaseWriteLock(root, rel, coordCtx) {
  try {
    const { getCoordination } = require("../runtime/agent-coordination");
    const coord = getCoordination(root);
    const g = global.__editcoreCoord || {};
    const threadId = String(coordCtx?.threadId || g.threadId || "default");
    const agentRole = String(coordCtx?.agentRole || g.agentRole || "implementer");
    coord.releaseLock(threadId, agentRole, rel);
  } catch { /* liberar nunca tumba la escritura ya hecha */ }
}

// [EDITCORE-INTEGRAL-B9] Lock de CONJUNTO para operaciones que
// escriben muchos archivos de una vez (scaffold_project): se toman
// los locks de las rutas destino ANTES de escribir la primera; si
// alguna está tomada por OTRA corrida, no se escribe nada y la
// herramienta falla explicando el lock. Devuelve { release } o
// { blocked }.
function acquireWriteLockSet(root, rels, op, coordCtx) {
  const acquired = [];
  for (const rel of rels) {
    const blocked = acquireWriteLock(root, rel, op, coordCtx);
    if (blocked) {
      for (const done of acquired) releaseWriteLock(root, done, coordCtx);
      return { blocked };
    }
    acquired.push(rel);
  }
  return {
    release() {
      for (const rel of acquired) releaseWriteLock(root, rel, coordCtx);
    },
  };
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
  // [EDITCORE-INTEGRAL-B9] Toda salida posterior a adquirir libera
  // el lock de ESTA escritura (ver releaseWriteLock).
  const finish = (r) => { releaseWriteLock(root, rel, coordCtx); return r; };

  let _beforeForReview = "";
  let _fileExisted = false;
  try {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      _fileExisted = true;
      _beforeForReview = fs.readFileSync(file, "utf8");
    }
  } catch { _beforeForReview = ""; }
  try {
    if (_fileExisted && _beforeForReview === body) {
      // [EDITCORE-V500-A] NO-OP IDÉNTICO DECLARADO (precisión de
      // Luis: «escribir solo lo justo»): el contenido ya es el que
      // está en disco — no se escribe, no se crea snapshot, no se
      // invalida ninguna caché y no cuenta como escritura. Queda
      // registrado en las métricas del harness de tokens.
      try { tokenHarness?.noteWriteOutcome?.("identical-noop"); } catch { /* métricas no bloquean */ }
      return finish({ ok: true, unchanged: true, identicalNoop: true, path: rel, note: `${rel} ya tenía exactamente ese contenido: no se escribió nada (no-op idéntico, comprobante de escritura justa).` });
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
  // [EDITCORE-V500-A] ESCRITURA JUSTA sobre archivo existente: si la
  // reescritura completa tocó solo una MINORÍA de las líneas, se
  // aplica igual pero el resultado trae la nota de dirección hacia
  // replace_in_file y el caso se cuenta en el harness (desperdicio de
  // tokens de salida medible por turno). Un cambio grande no lleva
  // nota: reescribir era lo correcto.
  let _writeDiscipline = null;
  if (_fileExisted && tokenHarness && typeof tokenHarness.lineDiffStats === "function") {
    try {
      const diff = tokenHarness.lineDiffStats(_beforeForReview, body);
      if (diff.touchedLines > 0 && diff.ratio < tokenHarness.SMALL_DIFF_RATIO) {
        tokenHarness.noteWriteOutcome("small-diff-full-write", diff);
        _writeDiscipline = {
          diffStats: { touchedLines: diff.touchedLines, totalLines: diff.totalLines },
          directionNote: `Nota de dirección (escritura justa): este write_file reescribió ${rel} entero tocando solo ${diff.touchedLines} de ${diff.totalLines} líneas. Para cambios parciales como este corresponde replace_in_file: misma precisión sin pagar los tokens de salida del archivo completo.`,
        };
      } else if (diff.touchedLines > 0) {
        tokenHarness.noteWriteOutcome("full-write", diff);
      }
    } catch { /* la disciplina nunca bloquea la escritura */ }
  }
  const out = {
    ok: true,
    path: rel,
    snapshotId: snap.ok ? snap.id : null,
    ...(_writeDiscipline || {}),
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

  return finish(out); // [EDITCORE-INTEGRAL-B9] libera el lock de esta escritura
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
  // [EDITCORE-INTEGRAL-B9] Toda salida posterior libera el lock.
  const finish = (r) => { releaseWriteLock(root, rel, coordCtx); return r; };
  const current = fs.readFileSync(file, "utf8");
  const located = locateOldText(current, oldText);
  if (!located.ok) {
    return finish({
      ok: false,
      error: located.error,
      soft: true,
      path: rel,
      hint: located.hint || "Relee el archivo y reintenta replace_in_file.",
      preview: current.slice(0, 1200),
    });
  }
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const normNew = String(newText ?? "").replace(/\r\n|\n/g, eol);
  const next = current.replace(located.match, () => normNew);
  if (next === current) {
    return finish({ ok: false, soft: true, unchanged: true, path: rel, error: `El reemplazo no cambia nada en ${rel} (oldText y newText son iguales). No se escribió nada.`, hint: "Escribe en newText el código corregido, distinto del actual." });
  }

  let syntaxCheck = null;
  let syntaxBefore = null;
  try {
    const { validateSyntax } = require("../runtime/syntax-validator");
    syntaxCheck = validateSyntax(rel, next);
    if (syntaxCheck && !syntaxCheck.ok) syntaxBefore = validateSyntax(rel, current);
  } catch {}
  if (syntaxCheck && !syntaxCheck.ok && syntaxBefore?.ok) {
    return finish({
      ok: false,
      soft: true,
      path: rel,
      error: `El reemplazo rompería la sintaxis de ${rel}: ${syntaxCheck.message}. No se escribió nada.`,
      hint: "Relee el archivo con read_file e incluye en oldText/newText el bloque completo (llaves de apertura y cierre).",
    });
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
  return finish(out); // [EDITCORE-INTEGRAL-B9] libera el lock de esta escritura
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

// [EDITCORE-INTEGRAL-B4] search_files: dos modos DECLARADOS, búsqueda
// también por NOMBRE/RUTA, extensiones del proyecto, evidencia
// localizable y truncamiento declarado.
//  - mode "literal" (defecto): coincidencia literal de contenido o de
//    nombre/ruta. ".env" cuenta como patrón de nombre cuando la query
//    parece nombre de archivo (sin espacios y con punto o *), así un
//    asset se encuentra por su nombre («hero-taller.jpg»).
//  - mode "regex": la query se compila como expresión regular (sin
//    flags añadidas: el patrón manda) y se aplica a contenido y a
//    nombre/ruta. Un patrón inválido devuelve ok:false con el error
//    de compilación, nunca 0 hits mudos.
// Los archivos de texto se buscan por contenido Y por nombre; los
// binarios (imágenes, fuentes, etc.) NO se abren como texto pero su
// NOMBRE/RUTA sí se busca — antes un asset era invisible salvo que un
// archivo de la whitelist lo referenciara.
const SEARCH_TEXT_EXTS = new Set([
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "md", "mdx", "css", "scss", "less",
  "sql", "html", "htm", "vue", "svelte", "py", "env", "txt", "xml", "yml", "yaml",
  "toml", "ini", "sh", "bash", "php", "rb", "go", "rs", "java", "c", "h", "cpp",
]);
function searchFileExt(name) {
  const base = String(name || "");
  if (/^\.env(?:\..+)?$/i.test(base)) return "env";
  const m = base.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

function searchFiles(root, query, maxHits = 30, opts = {}) {
  const q = String(query || "");
  const limit = Math.max(1, Number(opts.maxHits || maxHits) || 30);
  const mode = String(opts.mode || "literal").toLowerCase() === "regex" ? "regex" : "literal";
  let regex = null;
  if (mode === "regex") {
    try {
      regex = new RegExp(q);
    } catch (err) {
      return { ok: false, query: q, mode, error: `Expresión regular inválida: ${String(err?.message || err)}`, hits: [], total: 0, truncated: false };
    }
  }
  const matchesName = (relPath, baseName) => {
    if (regex) return regex.test(relPath) || regex.test(baseName);
    // Literal por nombre: coincidencia parcial insensible a mayúsculas
    // sobre la ruta completa («public/assets/hero» encuentra el asset).
    const needle = q.toLowerCase();
    return relPath.toLowerCase().includes(needle) || baseName.toLowerCase().includes(needle);
  };
  const hits = [];
  let total = 0;
  const skip = new Set(["node_modules", ".git", "dist", ".next", ".editcore", "out", "build"]);
  function record(hit) {
    total += 1;
    if (hits.length < limit) hits.push(hit);
  }
  function walk(dir, depth) {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (e.isDirectory()) { walk(full, depth + 1); continue; }
      if (!e.isFile()) continue;
      // 1) Por NOMBRE/RUTA (cualquier archivo, binarios incluidos).
      if (q && matchesName(rel, e.name)) {
        record({ path: rel, match: "name", line: null, snippet: e.name });
        continue;
      }
      // 2) Por CONTENIDO (solo extensiones de texto del proyecto). La
      // coincidencia es sobre el contenido COMPLETO (como siempre):
      // una query literal multilínea — la que la vía texto desescapa
      // con unescapeTextBlob — casa entre líneas, y una query con \n
      // literales casa con un archivo-blob, que es una sola línea con
      // esas secuencias. La línea del hit se calcula desde el índice.
      if (!q || !SEARCH_TEXT_EXTS.has(searchFileExt(e.name))) continue;
      let text = "";
      try { text = fs.readFileSync(full, "utf8"); } catch { continue; }
      let idx = -1;
      if (regex) {
        const m = regex.exec(text);
        idx = m ? m.index : -1;
      } else {
        idx = text.indexOf(q);
      }
      if (idx >= 0) {
        const lineNo = text.slice(0, idx).split(/\r?\n/).length;
        const lineText = text.split(/\r?\n/)[lineNo - 1] || "";
        record({ path: rel, match: "content", line: lineNo, snippet: lineText.trim().slice(0, 160) });
      }
    }
  }
  walk(path.resolve(root), 0);
  // `hits` conserva la forma histórica (lista de rutas) por compatibilidad
  // con consumidores viejos; la evidencia localizable va en `results`.
  return {
    ok: true,
    query: q,
    mode,
    hits: hits.map((h) => h.path),
    results: hits,
    total,
    truncated: total > hits.length,
  };
}

// [EDITCORE-INTEGRAL-B4] run_command SOBRE EL RUNNER ÚNICO: esta
// función ya NO spawnea por su cuenta — delega en process-runner.js
// (runProcess), que es la ÚNICA implementación de spawn del kernel:
// conserva la COLA de stdout/stderr (slice(-12000), no la cabeza),
// detecta errores severos en vivo y entiende procesos largos. Aquí
// solo se adapta su resultado a la forma histórica de run_command
// ({ ok, code, output, stderr }) que consumen el verificador, la
// verificación real y el bucle. Se conservan intactos los contratos
// previos: temporizador obligatorio (defecto 120 s, máx. 600 s), no
// arrancar abortado, y matar el ÁRBOL al abortar/expirar (eso último
// vive ahora en killProcessTree de process-runner).
async function runCommand(root, command, options = {}) {
  const timeoutMs = Math.min(600_000, Math.max(1_000, Number(options.timeoutMs) || 120_000));
  // DETENER de verdad (1/2): si la corrida ya fue detenida, el comando
  // ni siquiera arranca (no se delega al runner: ni un spawn breve).
  if (options.signal && options.signal.aborted) {
    return { ok: false, aborted: true, code: null, output: "", stderr: "", error: "Comando no ejecutado: la corrida ya estaba detenida por el usuario." };
  }
  // [EDITCORE-INTEGRAL-B4] El onSevereError que execute() ya pasaba se
  // LEE y se ACTÚA: antes runCommand ni lo miraba y el error severo
  // detectado en vivo se perdía. Ahora el primer issue queda en el
  // resultado (severeError) además de notificarse al llamador.
  let severeError = null;
  const result = await runProcess({
    cwd: root,
    command: String(command || ""),
    timeoutMs,
    signal: options.signal || undefined,
    usePowerShellOnWindows: true,
    onChunk: typeof options.onChunk === "function" ? options.onChunk : undefined,
    onSevereError: (issue) => {
      if (!severeError) severeError = issue;
      if (typeof options.onSevereError === "function") {
        try { options.onSevereError(issue); } catch { /* el aviso nunca tumba el comando */ }
      }
    },
  });
  const output = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const base = {
    ok: result.ok === true,
    code: result.code ?? null,
    output,
    stderr,
    ...(severeError ? { severeError } : {}),
    ...(result.streaming ? { streaming: true, detach: result.detach || null } : {}),
  };
  if (result.timedOut) {
    // [EDITCORE-INTEGRAL-B4] El texto de timeout remite a start_preview
    // (la herramienta de preview del kernel, que SÍ puede llamar el
    // agente), no a «el preview del IDE» inalcanzable de antes.
    return {
      ...base,
      ok: false,
      timeout: true,
      error: `El comando superó el límite de ${Math.round(timeoutMs / 1000)} s y fue terminado. Si es un servidor u otro proceso continuo, no lo dejes en primer plano con run_command: arranca el preview con la herramienta start_preview o pide un comando que termine.`,
    };
  }
  if (options.signal && options.signal.aborted) {
    return { ...base, ok: false, aborted: true, error: "Comando detenido por el usuario con el botón Detener." };
  }
  if (!result.ok && result.error && !/^Exit code\b/.test(String(result.error))) {
    return { ...base, error: String(result.error) };
  }
  return base;
}

// [EDITCORE-INTEGRAL-B4] rollback_last_change REAL (por archivo): la
// herramienta existía en la clasificación y en el autoconocimiento
// pero no tenía definición ni case («Herramienta desconocida»). Restaura
// el snapshot previo de UN archivo (snapshot.js#rollbackFileChange):
// revierte solo la última escritura DE ESE archivo, sin tocar otros
// archivos modificados después. Como escritura que es, pasa por la
// compuerta única y por la segunda capa (allowWrite en execute).
function rollbackFileTool(root, rel) {
  const target = String(rel || "").trim();
  if (!target) return { ok: false, error: "rollback_last_change requiere path: el archivo cuya última escritura quieres revertir." };
  const result = rollbackFileChange(root, target);
  if (result?.ok) invalidateReadCache(safe(root, target));
  return result;
}

// [EDITCORE-INTEGRAL-B4] start_preview: el kernel no tenía NINGUNA
// herramienta para arrancar el preview/dev server (manage_process vive
// en el dispatcher que el chat no usa y startProjectPreview es IPC de
// main para la UI), así que el modelo improvisaba Start-Process porque
// era la única vía. Esta herramienta envuelve, vía el helper inyectado
// por el llamador (helpers.startPreview — main lo conecta a su
// startProjectPreview; el bridge lo expone también como startPreview),
// el arranque REAL del preview del IDE y devuelve su URL/estado
// reales. Sin helper, responde HONESTAMENTE que el preview no está
// disponible en esta ruta: nada de éxito falso.
async function startPreviewTool(root, helpers = {}) {
  const starter = typeof helpers?.startPreview === "function"
    ? helpers.startPreview
    : (typeof helpers?.startProjectPreview === "function" ? helpers.startProjectPreview : null);
  if (!starter) {
    // Sin arranque posible, una URL ya activa en el contexto del turno
    // sigue siendo información real y útil para capturar.
    const activeUrl = String(helpers?.activePreviewUrl || helpers?.previewUrl || "").trim();
    if (activeUrl) {
      return { ok: true, alreadyRunning: true, url: activeUrl, previewUrl: activeUrl, note: "Ya hay un preview activo en esta sesión; no hizo falta arrancarlo. Captúralo con capture_preview_screenshot." };
    }
    return { ok: false, previewUnavailable: true, error: "El preview no está disponible en esta ruta: el llamador no proporcionó el arranque del preview del IDE (helpers.startPreview). No inventes una URL ni uses Start-Process: dilo y sigue con la verificación por build (build_project / run_command)." };
  }
  try {
    const started = await starter(root);
    const url = String(started?.url || started?.previewUrl || "").trim();
    if (started?.ok === false || started?.available === false || !url) {
      return { ok: false, error: String(started?.message || started?.error || "El preview del IDE no pudo arrancar para este proyecto."), ...(url ? { url } : {}) };
    }
    return {
      ok: true,
      url,
      previewUrl: url,
      started: started?.started !== false,
      ...(started?.message ? { message: String(started.message) } : {}),
      note: "Preview arrancado. Ya puedes verificar con capture_preview_screenshot sobre esta URL.",
    };
  } catch (err) {
    return { ok: false, error: `El preview del IDE no pudo arrancar: ${String(err?.message || err).slice(0, 300)}` };
  }
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

async function cloneRepo(root, repoUrl, destRel, coordCtx) {
  const url = String(repoUrl || "").trim();
  if (!/^https?:\/\/|^git@/i.test(url)) {
    return { ok: false, error: "URL de repositorio inválida (usa https://github.com/...)" };
  }
  const dest = String(destRel || "").trim()
    || path.join(".editcore", "repos", path.basename(url.replace(/\.git$/i, ""), path.sep));
  // [EDITCORE-INTEGRAL-B9] clone_repo escribe en el proyecto: lock
  // sobre la carpeta destino ANTES de clonar, liberado al terminar.
  const lockRel = dest.replace(/\\/g, "/");
  const lockBlock = acquireWriteLock(root, lockRel, "clone_repo", coordCtx);
  if (lockBlock) return lockBlock;
  try {
    return await cloneRepoLocked(root, url, dest);
  } finally {
    releaseWriteLock(root, lockRel, coordCtx);
  }
}

async function cloneRepoLocked(root, url, dest) {
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
    // [EDITCORE-INTEGRAL-B8] git-manager es ahora async y seguro
    // (array + shell:false, -F, filtro de secretos compartido y
    // retry de lock): el commit del kernel usa la MISMA pila que
    // agent-git/publish-pipeline. Los secretos bloqueados al stagear
    // se declaran en el resultado, nunca se commitean en silencio.
    const gitMgr = require("../runtime/git-manager");
    const files = Array.isArray(options.files) && options.files.length ? options.files : ["."];
    const stage = await gitMgr.stageFiles(files, root);
    // [EDITCORE-V491-E] El resultado SIEMPRE declara blockedSecrets y
    // staged en lenguaje accionable: si el stage falló porque TODO lo
    // pedido era sensible, el error trae la instrucción de reintentar
    // con el conjunto completo (mensaje de git-manager), no un callejón.
    if (!stage.ok) return { ok: false, error: stage.message || stage.stderr, blockedSecrets: stage.blockedSecrets || [], staged: stage.staged || [] };
    const msg = String(options.message || "update from editcoreai").trim();
    const res = await gitMgr.commit(msg, root);
    const blockedSecrets = stage.blockedSecrets || [];
    const staged = stage.staged || [];
    return {
      ok: res.ok,
      output: res.stdout || res.message,
      error: res.ok ? "" : (res.message || res.stderr),
      blockedSecrets,
      staged,
      note: res.ok
        ? (blockedSecrets.length
          ? `Commit creado con ${staged.length} archivo(s): ${staged.slice(0, 8).join(", ")}. Excluidos por sensibles (nunca se commitean): ${blockedSecrets.join(", ")}.`
          : `Commit creado con ${staged.length} archivo(s): ${staged.slice(0, 8).join(", ")}. Sin rutas sensibles en el conjunto.`)
        : undefined,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 400) };
  }
}

async function gitPush(root, options = {}) {
  try {
    const gitMgr = require("../runtime/git-manager");
    const remote = String(options.remote || "origin").trim();
    const branch = String(options.branch || "").trim();
    const res = await gitMgr.push(remote, branch, root);
    return { ok: res.ok, output: res.stdout || res.message, error: res.ok ? "" : (res.message || res.stderr) };
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

async function installSkill(root, repoUrl, skillName, coordCtx) {
  const url = String(repoUrl || "").trim();
  const name = String(skillName || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!url || !name) return { ok: false, error: "install_skill requiere repoUrl y skillName" };
  // [EDITCORE-INTEGRAL-B9] install_skill escribe en el proyecto:
  // toma el lock de su carpeta destino ANTES de clonar y lo libera
  // al terminar (éxito o fracaso). Antes escribía sin lock.
  const lockRel = `.editcore/skills/${name}`;
  const lockBlock = acquireWriteLock(root, lockRel, "install_skill", coordCtx);
  if (lockBlock) return lockBlock;
  try {
    return await installSkillLocked(root, url, name);
  } finally {
    releaseWriteLock(root, lockRel, coordCtx);
  }
}

async function installSkillLocked(root, url, name) {
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
      description: "Lee el contenido de un archivo. Si el archivo es muy largo, usa startLine y endLine. Si ya leíste el archivo EN ESTE TURNO, la relectura devuelve un comprobante corto (su contenido ya está en tu contexto); usa force:true solo si necesitas releerlo de disco porque pudo cambiar.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta relativa del archivo a leer." },
          startLine: { type: "integer", description: "Línea de inicio (opcional)." },
          endLine: { type: "integer", description: "Línea de fin (opcional)." },
          force: { type: "boolean", description: "Lectura forzada: relee de disco aunque el archivo ya se haya leído en este turno (opcional)." }
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
      // [EDITCORE-INTEGRAL-B4] Definición honesta de los DOS modos: la
      // anterior prometía «texto o expresión» pero la implementación
      // era solo literal.
      description: "Busca dentro de los archivos del proyecto, por CONTENIDO y también por NOMBRE/RUTA (un asset se encuentra por su nombre de archivo, p. ej. 'hero-taller.jpg', aunque sea binario). Dos modos: mode='literal' (defecto, coincidencia exacta de texto) y mode='regex' (la query se interpreta como expresión regular). Devuelve resultados con archivo, línea y fragmento, conteo total y truncated:true si superan el límite.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Texto literal a buscar, o la expresión regular si mode='regex'." },
          mode: { type: "string", enum: ["literal", "regex"], description: "Modo de búsqueda declarado: 'literal' (defecto) o 'regex'." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "rollback_last_change",
      // [EDITCORE-INTEGRAL-B4] Definición REAL de la herramienta que
      // classify.js ya clasificaba como escritura y self-knowledge ya
      // anunciaba: antes no existía aquí y el despacho la rechazaba.
      description: "Revierte la ÚLTIMA escritura de UN archivo concreto restaurando su snapshot previo (cada write_file/replace_in_file guarda un snapshot antes de tocar el disco). Solo afecta a ese archivo: no deshace cambios posteriores en otros archivos. Úsala cuando el usuario pida deshacer el último cambio de un archivo en vez de reescribirlo entero.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Ruta del archivo cuya última escritura se revierte." }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "start_preview",
      // [EDITCORE-INTEGRAL-B4] Herramienta de preview del kernel:
      // envuelve el arranque del preview del IDE (startProjectPreview
      // de main, vía helpers.startPreview inyectado por el llamador).
      description: "Arranca el preview/dev server del proyecto en el IDE y devuelve su URL real. Úsala cuando necesites verificar en el preview y no haya uno activo, ANTES de capture_preview_screenshot. No uses run_command ni Start-Process para servidores: run_command tiene temporizador y mata el árbol. Si el preview no está disponible en esta ruta, la herramienta lo dice honestamente (ok:false).",
      parameters: { type: "object", properties: {} }
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
      // [EDITCORE-INTEGRAL-B4] git_log/git_diff tenían función y
      // clasificación de lectura pero ni definición ni case: fantasmas.
      // Se exponen de verdad (solo lectura).
      name: "git_log",
      description: "Muestra el historial reciente de commits de Git.",
      parameters: {
        type: "object",
        properties: {
          maxCount: { type: "integer", description: "Número máximo de commits (defecto 15)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Muestra el diff de Git de los cambios sin commitear (o el staged con staged:true). La evidencia llega cabeza+cola: el principio y el FINAL del diff.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Si es true, muestra el diff de lo staged." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "git_commit",
      description: "Hace un commit de los cambios actuales en Git. Los archivos sensibles (.env, .pem, credentials.json…) se excluyen SIEMPRE al stagear, también con files omitido. Ante un pedido de «commit de todos los cambios», llama con el conjunto completo (files omitido o [\".\"]): el filtro excluye los sensibles y commitea el resto. Nunca acotes el commit SOLO al archivo sensible ni reviertas su creación porque el stage lo bloquee: ese bloqueo es parcial y el resultado declara blockedSecrets y staged para que reportes qué entró y qué quedó fuera.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Mensaje del commit." },
          // [EDITCORE-INTEGRAL-B8] files real: antes la definición solo
          // exponía message y todo caía a ["."] sin que el modelo
          // pudiera acotar el commit.
          files: { type: "array", items: { type: "string" }, description: "Archivos a incluir (opcional; por defecto, todos los cambios). Los sensibles se excluyen siempre." }
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
      description: "Captura el preview local del proyecto y devuelve diagnósticos mecánicos de maquetación (overflow horizontal, controles recortados, página vacía, jerarquía) junto con la ruta del PNG. Úsala tras construir o cambiar UI: captura UNA vista (desktop) por verificación y corrige lo que los diagnósticos reporten; la vista mobile solo cuando el cambio sea de layout/responsive o el usuario la pida. Solo acepta URLs locales (localhost/127.0.0.1).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL local donde corre el proyecto (preview del IDE o dev server). Si se omite, usa el preview por defecto del IDE." },
          viewport: { type: "string", enum: ["desktop", "mobile"], description: "Tamaño de captura. Por defecto «desktop»: una sola captura por verificación. Usa «mobile» solo para cambios de layout/responsive o si el usuario lo pide." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_stock_photo",
      description: "Busca una fotografía REAL de stock en varios bancos con licencia clara (Openverse y Wikimedia Commons, más Pexels/Pixabay si el usuario configuró sus llaves) con caída en cascada: si una fuente no tiene resultados, prueba la siguiente. Descarga la elegida a la carpeta assets/ del proyecto y devuelve su ruta local, el crédito Y la lista de candidatas (con licencia y autor) en la MISMA llamada. Úsala para las imágenes de una web (hero, secciones, testimonios): una página profesional necesita fotografía real, no solo cajas CSS y texto. Llama una vez por imagen que necesites, con búsquedas concretas del negocio (puedes pedir en español: la búsqueda se traduce al inglés para los índices). Si devuelve ok:false, sigue sin esa foto y dilo en tu resumen.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Qué foto buscar (p. ej. 'barbero trabajando' o 'barber working')." },
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
      description: "Delega subagentes que trabajan EN PARALELO y devuelve un informe combinado. SIN tope numérico de tareas: la gobernanza es el presupuesto del harness (oleadas) y que los ámbitos no se pisen. Roles: explorer (mapea una zona, solo lectura), analyst (responde una pregunta de análisis/revisión, solo lectura) y writer (implementer acotado que ESCRIBE con parches explícitos dentro de su target, declarado ámbito EXCLUSIVO: dos writers con ámbitos que se pisan se rechazan). Úsala cuando una tarea tenga frentes independientes —p. ej. uno mapea el frontend, otro revisa el backend, otro escribe en una zona disjunta— en vez de hacerlo todo en serie tú solo. Los subagentes reciben la memoria compartida del proyecto y sus informes vuelven destilados al expediente.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "Subtareas independientes (sin tope numérico; corren en oleadas según el presupuesto del harness).",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["explorer", "analyst", "writer"], description: "explorer mapea; analyst analiza; writer escribe parches en su target exclusivo." },
                target: { type: "string", description: "Zona o ruta (explorer: a mapear; writer: su ámbito exclusivo de escritura)." },
                question: { type: "string", description: "Pregunta que debe responder (analyst) o instrucción de la tarea (writer)." },
                patches: { type: "array", description: "Parches explícitos del writer: [{ path, content } para crear/reescribir o { path, oldText, newText } para reemplazar].", items: { type: "object" } }
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
      // [EDITCORE-INTEGRAL-B8] Esquema alineado con extra-tools.js:
      // deployOneClick lee provider/production, no `target`. El viejo
      // {target:"vercel"} sigue funcionando: deploy-one-click lo
      // traduce (compatibilidad declarada allí).
      description: "Publica o despliega el proyecto actual (Vercel o Netlify, con los tokens de Conexiones).",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["vercel", "netlify"], description: "Proveedor del deploy (opcional; por defecto se detecta del proyecto)." },
          production: { type: "boolean", description: "true = producción; false = preview." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "invoke_subagent",
      // [EDITCORE-INTEGRAL-B1] Solo se ofrecen los roles que EXISTEN de
      // verdad: explorer (exploración de solo lectura) e implementer
      // (parches acotados que escriben vía applyWrite/applyReplace con
      // lock). Los antiguos security/database/ui_ux/devops/analyst/
      // verifier degradaban en silencio a exploración: retirados de la
      // oferta; si se piden igual, execute() lo ANUNCIA en el resultado.
      description: "Despacha un subagente para una tarea puntual. Roles reales: explorer (solo lectura) e implementer (parches acotados con patches en el task). NO existen subagentes especialistas de seguridad, base de datos, UI/UX, DevOps, análisis ni verificación: pedirlos devuelve exploración de solo lectura, anunciado como tal.",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["explorer", "implementer"], description: "Rol del subagente (solo existen explorer e implementer)." },
          patches: { type: "array", description: "Solo rol implementer: parches acotados [{path, content}] o [{path, oldText, newText}] (máx. 5). Sin patches, el implementer no puede aplicar nada.", items: { type: "object" } },
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
  // [EDITCORE-INTEGRAL-B9] Latido de locks SIN temporizadores: cada
  // despacho de herramienta de esta corrida renueva los locks que
  // la corrida aún retiene (operaciones compuestas), para que no
  // venzan a los 120 s con el dueño trabajando en su turno.
  try {
    if (coordCtx.threadId) {
      const { getCoordination } = require("../runtime/agent-coordination");
      getCoordination(root).renewThreadLocks(String(coordCtx.threadId));
    }
  } catch { /* coordinación opcional */ }
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
      // [EDITCORE-INTEGRAL-B4] search_files recibe su modo declarado.
      case "search_files": return searchFiles(root, a.query || "", 30, { mode: a.mode || "literal", maxHits: a.maxHits });
      // [EDITCORE-INTEGRAL-B4] rollback_last_change REAL: segunda capa
      // de la compuerta en el despachador, como toda escritura.
      case "rollback_last_change":
        if (!allowWrite) return { ok: false, error: "Escritura no permitida (Modo Solo Lectura)." };
        return rollbackFileTool(root, a.path);
      // [EDITCORE-INTEGRAL-B4] start_preview: envuelve helpers.startPreview.
      case "start_preview":
        return await startPreviewTool(root, helpers);
      case "write_file":
        if (!allowWrite) return { ok: false, error: "Escritura no permitida (Modo Solo Lectura)." };
        return writeFile(root, a.path, a.content, coordCtx);
      case "replace_in_file":
        if (!allowWrite) return { ok: false, error: "Escritura no permitida (Modo Solo Lectura)." };
        return replaceInFile(root, a.path, a.oldText, a.newText, coordCtx);
      case "delegate_parallel": {
        // Subagentes EN PARALELO (explorer/analyst de lectura y, desde
        // la v5.1.0, writer con ámbito exclusivo), requeridos aquí
        // dentro para no crear un ciclo de módulos: los subagentes a
        // su vez requieren tools.
        const { runDelegatedTasks } = require("./parallel-delegate");
        const { runExplorer } = require("./subagents/explorer");
        const { runAnalyst } = require("./subagents/analyst");
        // [EDITCORE-V510-B5] MEMORIA COMPARTIDA (ida): cada subagente
        // recibe el bloque del expediente + Cerebro + Mapa acotado,
        // construido con los temas de ESTA delegación.
        let memoryContext = "";
        try {
          const { buildSharedMemoryBlock } = require("./concierge");
          const topics = (Array.isArray(a.tasks) ? a.tasks : []).map((t) => `${t?.target || ""} ${t?.question || ""}`).join(" · ").slice(0, 300);
          memoryContext = await buildSharedMemoryBlock(root, coordCtx.threadId || "default", topics, helpers);
        } catch { memoryContext = ""; }
        // [EDITCORE-V510-B6] Gobernanza del harness: su perfil fija
        // el tamaño de oleada según el presupuesto del turno.
        let harnessProfile = null;
        try { harnessProfile = tokenHarness?.resolveHarnessProfile?.(helpers?.depthProfile || {}, helpers?.turnBudget || null, {}) || null; } catch { harnessProfile = null; }
        const delegated = await runDelegatedTasks({
          projectRoot: root,
          tasks: a.tasks,
          threadId: coordCtx.threadId || "default",
          signal: helpers?.abortSignal || null,
          harnessProfile,
          runners: {
            explorer: (task) => runExplorer({ projectRoot: root, target: task.target || ".", signal: helpers?.abortSignal || null, memoryContext }),
            analyst: (task) => runAnalyst({ projectRoot: root, userMessage: task.question || "", signal: helpers?.abortSignal || null, memoryContext }),
            // [EDITCORE-V510-B6] Writer: el implementer acotado de
            // siempre, con los locks de coordinación de ESTA corrida
            // (los helpers traen applyWrite/applyReplace del turno).
            // Sin autorización de escritura no hay ejecutor: la
            // tarea se reporta como no corrida, nunca se disfraza.
            writer: allowWrite ? (task) => {
              const { runSubagent } = require("../runtime/subagent-runner");
              return runSubagent(root, {
                role: "writer",
                task: task.question || `Aplicar los parches acotados a la zona ${task.target}.`,
                target: task.target,
                query: task.question || "",
                patches: Array.isArray(task.patches) ? task.patches : undefined,
                memoryContext,
              }, helpers);
            } : null,
          },
        });
        // [EDITCORE-V510-B5] MEMORIA COMPARTIDA (vuelta): el
        // destilado de los informes entra en el expediente con
        // procedencia «subagente <rol> · <target>» — el próximo turno
        // (y el conserje, y otros subagentes) lo leen de ahí.
        try {
          const { recordSubagentDistillates } = require("./subagent-distill");
          const recorded = recordSubagentDistillates(root, delegated?.results || []);
          if (recorded) delegated.memoryRecorded = recorded;
        } catch { /* la memoria nunca tumba el despacho */ }
        return delegated;
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
      // [EDITCORE-INTEGRAL-B4] Cases reales para git_log/git_diff.
      case "git_log":
        return await gitLog(root, a);
      case "git_diff":
        return await gitDiff(root, a);
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
        // [EDITCORE-INTEGRAL-B6] La señal del turno llega a la foto:
        // sin ella, la descarga escribía el archivo caiga el turno o no.
        // [EDITCORE-INTEGRAL-B9] Y el lock del archivo destino: la
        // foto toma el lock de la ruta exacta que va a escribir
        // (carpeta/nombre.ext, conocida tras la descarga) ANTES de
        // tocar disco; si otra corrida lo retiene, no escribe.
        // [EDITCORE-V492-4] Llaves de Pexels/Pixabay desde el mecanismo
        // de conexiones existente (helpers.readConnections, la bóveda
        // de main): si el usuario las configuró, esas fuentes entran en
        // la cascada; sin llave se saltan en silencio. El entorno
        // (PEXELS_API_KEY/PIXABAY_API_KEY) lo resuelve stock-photos.
        let stockApiKeys = {};
        try {
          const conns = typeof helpers?.readConnections === "function" ? (helpers.readConnections() || {}) : {};
          stockApiKeys = {
            pexels: String(conns.pexelsApiKey || conns.pexelsKey || "").trim(),
            pixabay: String(conns.pixabayApiKey || conns.pixabayKey || "").trim(),
          };
        } catch { /* sin conexiones legibles, la cascada va sin llaves */ }
        return await fetchStockPhoto({
          query: a.query || "", name: a.name || "", folder: a.folder || "", projectRoot: root,
          apiKeys: stockApiKeys,
          signal: helpers?.abortSignal || helpers?.signal || null,
          acquireLock: (relPath) => {
            const blocked = acquireWriteLock(root, relPath, "fetch_stock_photo", coordCtx);
            if (blocked) return { ok: false, error: blocked.error };
            return { ok: true, release: () => releaseWriteLock(root, relPath, coordCtx) };
          },
        });
      case "scaffold_project": {
        const { projectLooksEmpty } = require("./build-base-guard");
        if (a.force !== true && !projectLooksEmpty(root)) {
          return { ok: false, error: "El proyecto ya tiene contenido (package.json o estructura): scaffold_project no pisa una app existente. Si el usuario pidió rehacer la base desde cero, repite con force:true." };
        }
        // [EDITCORE-INTEGRAL-B9] scaffold escribe ~25 archivos de una
        // vez con writeFileSync directo en greenfield-builder: toma
        // ANTES los locks de las rutas núcleo que va a sentar; si
        // otra corrida retiene alguna, falla explicando el lock y no
        // escribe nada a medias. Los locks se liberan al terminar.
        const scaffoldLocks = acquireWriteLockSet(root,
          ["package.json", "index.html", "vite.config.ts", "src/App.tsx", "src/main.tsx", "src/index.css"],
          "scaffold_project", coordCtx);
        if (scaffoldLocks.blocked) return scaffoldLocks.blocked;
        try {
          const { scaffoldGreenfieldApp } = require("../runtime/greenfield-builder");
          const built = scaffoldGreenfieldApp(root, {
            prompt: String(a.prompt || ""),
            appName: String(a.name || "").trim() || path.basename(root),
          });
          return {
            ...built,
            nextSteps: "Base sentada. Ahora: (1) ejecuta npm install con run_command; (2) personaliza src/App.tsx, src/components/sections/Hero.tsx y Showcase.tsx con el contenido real del negocio; (3) fotos reales con fetch_stock_photo en public/assets; (4) verifica con capture_preview_screenshot.",
          };
        } finally {
          scaffoldLocks.release();
        }
      }
      case "search_brain": {
        const brainOut = await extraTools.searchBrain(root, a.query || "", helpers, a.limit);
        // [EDITCORE-V510-B5-MAPA] El Mapa es CONSULTABLE por la misma
        // vía: si la pregunta es de ORIENTACIÓN («¿qué decidimos
        // de…?», «¿en qué está el proyecto…?»), sus entradas van
        // PRIMERO en el resultado — son la fuente vigente, antes que
        // documentos y recuerdos sueltos.
        try {
          const om = require("./orientation-map");
          if (brainOut && typeof brainOut === "object" && om.isOrientationQuery(a.query || "")) {
            const hits = om.searchMap(root, a.query || "");
            if (hits.length) {
              return {
                ...brainOut,
                mapFirst: true,
                map: hits.map((h) => ({ layer: h.layer, kind: h.kind, text: h.text })),
                note: "Las entradas del MAPA de orientación van primero: son el destilado vigente (decisiones con procedencia, estado, frentes). Respóndelas desde ahí; los documentos/recuerdos de abajo son el respaldo.",
              };
            }
          }
        } catch { /* el Mapa nunca tumba la búsqueda */ }
        return brainOut;
      }
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
        // [EDITCORE-INTEGRAL-B5] Mapa ÚNICO de clasificación: la
        // compuerta del orquestador clasifica invoke_subagent como
        // ESCRITURA en classify.js (WRITE_TOOLS) y la corta entera en
        // solo lectura / step sin autorizar — por la ruta del kernel
        // este case ni se alcanza sin autorización. Esta segunda capa
        // del despachador deriva del MISMO classify.js (WRITE_TOOL_SET
        // se construye de WRITE_TOOLS, sin lista propia divergente) y
        // aquí solo distingue el rol para los llamadores directos del
        // despachador: el implementer exige escritura; el explorer es
        // lectura y delegate_parallel (LECTURA en classify) ni pasa
        // por una guarda de escritura.
        if ((subRole === "implementer" || subRole === "writer") && !allowWrite) {
          return { ok: false, error: "Subagente implementer requiere modo escritura." };
        }
        // [EDITCORE-INTEGRAL-B1] Rol especialista NO implementado: no se
        // disfraza — el resultado ANUNCIA que ese rol no existe y que lo
        // que sigue es exploración de solo lectura (el cierre del
        // orquestador además lo audita y lo declara en el resumen).
        const degradedRoles = new Set(["security", "database", "ui_ux", "devops", "analyst", "verifier"]);
        const degraded = degradedRoles.has(subRole);
        // [EDITCORE-V510-B5] MEMORIA COMPARTIDA (ida): el subagente
        // recibe el bloque del expediente + Cerebro + Mapa acotado.
        let memoryContext = "";
        try {
          const { buildSharedMemoryBlock } = require("./concierge");
          memoryContext = await buildSharedMemoryBlock(root, coordCtx.threadId || "default", String(a.task || a.target || ""), helpers);
        } catch { memoryContext = ""; }
        const subResult = await runSubagent(root, {
          role: subRole,
          task: a.task,
          target: a.target,
          query: a.task,
          patches: Array.isArray(a.patches) ? a.patches : undefined,
          memoryContext,
        }, helpers);
        // [EDITCORE-V510-B5] MEMORIA COMPARTIDA (vuelta): el
        // destilado de su informe entra en el expediente con
        // procedencia, igual que en delegate_parallel.
        let memoryRecorded = 0;
        try {
          const { recordSubagentDistillates } = require("./subagent-distill");
          const exploredFiles = Array.isArray(subResult?.mergedFiles) ? subResult.mergedFiles.map((f) => String(f?.path || f?.title || "")).filter(Boolean) : [];
          memoryRecorded = recordSubagentDistillates(root, [{
            role: degraded ? "explorer" : subRole,
            target: a.target || "",
            question: a.task || "",
            text: String(subResult?.summary || subResult?.report || subResult?.text || exploredFiles.join("\n") || ""),
            ok: subResult?.ok !== false,
          }]);
        } catch { /* la memoria nunca tumba el despacho */ }
        if (degraded) {
          return {
            ...subResult,
            ok: subResult?.ok !== false,
            requestedRole: subRole,
            effectiveRole: "explorer",
            degradedRole: true,
            ...(memoryRecorded ? { memoryRecorded } : {}),
            roleNotice: `El rol «${subRole}» no existe como subagente especialista en EditCoreAI: lo ejecutado fue exploración de solo lectura, NO una tarea de ${subRole}. Repórtalo así, no como una auditoría ni un trabajo especializado.`,
          };
        }
        return { ...subResult, requestedRole: subRole, effectiveRole: subRole === "writer" ? "implementer" : subRole, ...(memoryRecorded ? { memoryRecorded } : {}) };
      }
      case "install_skill":
        if (!allowWrite) return { ok: false, error: "install_skill requiere modo escritura." };
        // [EDITCORE-INTEGRAL-B9] La identidad de la corrida viaja a
        // installSkill para su lock de destino.
        return installSkill(root, a.repoUrl, a.skillName, coordCtx);
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
  // [EDITCORE-INTEGRAL-B4] Política de truncamiento por herramienta.
  TOOL_PAYLOAD_CAPS,
  truncatePayload,
  headTailText,
  shapeToolPayload,
  listFiles,
  readFile,
  writeFile,
  replaceInFile,
  searchFiles,
  runCommand,
  // [EDITCORE-INTEGRAL-B4] Herramientas nuevas/reales del Bloque 4.
  rollbackFileTool,
  startPreviewTool,
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