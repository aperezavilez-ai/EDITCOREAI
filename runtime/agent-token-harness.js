"use strict";

/**
 * Harness de tokens + cache local de lecturas (por corrida).
 * Reduce reenvío de archivos al modelo y recorta tool results.
 */

function resolveHarnessProfile(depthProfile = {}, budget = null, options = {}) {
  const analysisMode = options.analysisMode === true;
  const remaining = budget && typeof budget.remainingRatio === "function"
    ? budget.remainingRatio()
    : 1;
  let strategy = "full";
  if (remaining < 0.18) strategy = "minimal";
  else if (remaining < 0.4) strategy = "moderate";
  else if (analysisMode) strategy = "moderate";

  return {
    strategy,
    forceReport: remaining < 0.12,
    maxToolResultChars: strategy === "minimal" ? 2500 : strategy === "moderate" ? 6000 : 12000,
    maxParallelReads: analysisMode ? 1 : (strategy === "full" ? 6 : strategy === "moderate" ? 4 : 2),
    preferCache: strategy !== "full",
  };
}

function clipToolResultForHarness(result, maxChars = 8_000) {
  const limit = Math.max(800, Number(maxChars) || 8_000);
  if (result == null) return result;
  if (typeof result === "string") {
    return result.length > limit ? `${result.slice(0, limit)}\n…[recortado por harness de tokens]` : result;
  }
  if (typeof result !== "object") return result;
  try {
    const clone = JSON.parse(JSON.stringify(result));
    const clipString = (value) => {
      if (typeof value !== "string") return value;
      return value.length > limit ? `${value.slice(0, limit)}\n…[recortado por harness de tokens]` : value;
    };
    if (typeof clone.content === "string") clone.content = clipString(clone.content);
    if (typeof clone.text === "string") clone.text = clipString(clone.text);
    if (typeof clone.snippet === "string") clone.snippet = clipString(clone.snippet);
    if (Array.isArray(clone.entries) && clone.entries.length > 80) {
      clone.entries = clone.entries.slice(0, 80);
      clone._truncated = true;
    }
    if (Array.isArray(clone.matches) && clone.matches.length > 40) {
      clone.matches = clone.matches.slice(0, 40);
      clone._truncated = true;
    }
    const encoded = JSON.stringify(clone);
    if (encoded.length <= limit * 2) return clone;
    return {
      ok: clone.ok !== false,
      path: clone.path || null,
      truncated: true,
      preview: encoded.slice(0, limit),
      note: "Resultado compactado por harness de tokens para preservar presupuesto.",
    };
  } catch {
    return { truncated: true, note: "No se pudo serializar el resultado; harness omitio el cuerpo." };
  }
}

function buildHarnessSystemNudge(harness = {}) {
  if (!harness || harness.strategy === "full") return "";
  if (harness.forceReport) {
    return "HARNESS TOKENS (CRITICO): presupuesto casi agotado. NO abras mas carpetas. Escribe YA el reporte final con la evidencia acumulada.";
  }
  if (harness.strategy === "minimal") {
    return "HARNESS TOKENS: modo minimal. Solo read_file de paths criticos ya listados. Preferir resultados en cache. Prepara el reporte pronto.";
  }
  if (harness.strategy === "moderate") {
    return "HARNESS TOKENS: modo moderate. Evita releer archivos. Usa cache. Busquedas acotadas. No pegues codigo largo.";
  }
  return "";
}

/**
 * Cache de lecturas por path dentro de una corrida de agente.
 * Key: path normalizado + mtime si se conoce.
 */
class RunReadCache {
  constructor() {
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  normalize(pathValue) {
    return String(pathValue || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  }

  get(pathValue, mtimeMs = null) {
    const key = this.normalize(pathValue);
    const entry = this.map.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    if (mtimeMs != null && entry.mtimeMs != null && Number(mtimeMs) !== Number(entry.mtimeMs)) {
      this.misses += 1;
      this.map.delete(key);
      return null;
    }
    this.hits += 1;
    return entry.result;
  }

  set(pathValue, result, mtimeMs = null) {
    const key = this.normalize(pathValue);
    this.map.set(key, {
      result,
      mtimeMs: mtimeMs == null ? null : Number(mtimeMs),
      at: Date.now(),
    });
  }

  stats() {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }
}

// =====================================================================
// [EDITCORE-V500-A] DISCIPLINA DE CACHÉ DE TOKENS — DUEÑO ÚNICO.
// Precisión de Luis (2026-11-12): el harness de tokens es el dueño de
// la disciplina cache read / cache write. El comprobante de lectura
// ENTRE turnos (cambio 3) y el dedupe de respuestas vía ResponseCache
// (cambio 5) se consultan y se registran AQUÍ, no como lógica suelta
// en el orquestador: el orquestador pide y registra; el harness
// decide. La persistencia de los comprobantes vive en el expediente
// (thread-memory: mtime+tamaño junto al hecho «leído»); la validación
// contra disco y el formato del comprobante son del harness, igual
// que el RunReadCache de arriba valida por mtime dentro de la corrida.
// =====================================================================

function threadMemoryStore() {
  try { return require("../editcore-chat-kernel/thread-memory"); } catch { return null; }
}

function normalizeReceiptPath(relPath) {
  return String(relPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

// --- Cache read: comprobante de lectura entre turnos -----------------
// Devuelve el resultado-comprobante si el archivo+rango ya se leyó en
// esta conversación y NO cambió desde entonces (mtime Y tamaño
// idénticos a los de la lectura registrada); null en cualquier otro
// caso (sin registro, force:true, archivo cambiado o desaparecido):
// el llamador lee de verdad y registra la lectura nueva.
function readReceiptStub(projectRoot, relPath, opts = {}) {
  if (!projectRoot || opts.force === true) return null;
  const store = threadMemoryStore();
  if (!store) return null;
  const rel = normalizeReceiptPath(relPath);
  if (!rel) return null;
  let receipt = null;
  try { receipt = store.findReadReceipt(projectRoot, rel, opts.startLine, opts.endLine); } catch { receipt = null; }
  if (!receipt) return null;
  let stat = null;
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    stat = fs.statSync(path.resolve(String(projectRoot), rel));
  } catch { stat = null; }
  if (!stat || !stat.isFile()) {
    try { store.invalidateReadReceipts(projectRoot, rel); } catch { /* ignore */ }
    return null;
  }
  if (Number(stat.mtimeMs) !== Number(receipt.mtimeMs) || Number(stat.size) !== Number(receipt.size)) {
    return null; // cambió: lectura real, y al registrarla la huella se refresca
  }
  return {
    ok: true,
    path: relPath,
    cached: true,
    alreadyReadInConversation: true,
    totalLines: receipt.totalLines || undefined,
    bytes: stat.size,
    note: `Ya leíste «${relPath}» en un turno anterior de esta conversación y el archivo NO cambió desde entonces (mismo tamaño y misma fecha de modificación): su contenido no se repite. Apóyate en lo que ya sabes de él (el expediente y los turnos anteriores de este hilo); si necesitas el contenido exacto otra vez, repite read_file con force:true.`,
  };
}

// Registra la huella de una lectura REAL recién hecha (la pide el
// orquestador tras despachar read_file con éxito). `requested` es el
// rango PEDIDO (la clave del comprobante); readResult aporta las
// líneas totales. La huella (mtime+tamaño) se toma de disco aquí.
function noteReadReceipt(projectRoot, relPath, requested = {}, readResult = {}) {
  if (!projectRoot) return;
  const store = threadMemoryStore();
  if (!store) return;
  const rel = normalizeReceiptPath(relPath);
  if (!rel) return;
  let stat = null;
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    stat = fs.statSync(path.resolve(String(projectRoot), rel));
  } catch { stat = null; }
  if (!stat || !stat.isFile()) return;
  try {
    store.noteReadReceipt(projectRoot, {
      file: rel,
      startLine: Number(requested.startLine) || 1,
      endLine: Number(requested.endLine) || 0,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      totalLines: Number(readResult.totalLines) || 0,
    });
  } catch { /* el comprobante nunca tumba una lectura */ }
}

// Una escritura sobre el archivo invalida sus comprobantes (pasarela
// al expediente; el orquestador la llama tras escrituras con éxito).
function invalidateReadReceipts(projectRoot, relPath) {
  if (!projectRoot) return;
  const store = threadMemoryStore();
  if (!store) return;
  try { store.invalidateReadReceipts(projectRoot, normalizeReceiptPath(relPath)); } catch { /* ignore */ }
}

// --- Cache write: dedupe de respuestas del modelo (ResponseCache) ---
// La instancia llega por helpers.responseCache (main pasa la suya, la
// misma del panel de métricas); sin esa costura, el harness crea una
// perezosa sobre el MISMO archivo de userData que usa main.
let _responseCacheSingleton = null;
let _responseCacheDir = "";
function resolveResponseCache(helpers) {
  try {
    if (helpers && helpers.responseCache
      && typeof helpers.responseCache.get === "function"
      && typeof helpers.responseCache.set === "function") {
      return helpers.responseCache;
    }
    const dir = String((helpers && (helpers.userDataPath || helpers.appUserData)) || "");
    if (!dir) return null;
    if (_responseCacheSingleton && _responseCacheDir === dir) return _responseCacheSingleton;
    const path = require("node:path");
    const { ResponseCache } = require("../response-cache");
    _responseCacheSingleton = new ResponseCache({
      filePath: path.join(dir, "response-cache.json"),
      ttlMs: 7 * 24 * 60 * 60 * 1000,
      maxEntries: 900,
      maxBytes: 40 * 1024 * 1024,
    });
    _responseCacheDir = dir;
    return _responseCacheSingleton;
  } catch { return null; }
}

// La clave de dedupe se calcula sobre el payload YA ESTABLE (system
// inmutable + historial append-only), con UNA normalización
// declarada: la línea de hora del mensaje del usuario en curso
// («[Hora actual: … · ISO …]») cambia en cada turno y haría imposible
// cualquier acierto entre reintentos idénticos; se retira SOLO de la
// copia que alimenta la clave — el payload real no se toca. Los
// turnos que preguntan por la hora/fecha quedan FUERA de la caché por
// completo: una respuesta sobre la hora jamás se sirve de caché. Y
// ningún payload con imágenes se deduplica (la captura se juzga en su
// paso; su «respuesta» no es reutilizable).
const STEP_CACHE_TIME_LINE_RE = /^\[Hora actual:[^\]]*\]\s*\n?/;
const TIME_SENSITIVE_TURN_RE = /(qu[eé] hora|hora actual|qu[eé] fecha|qu[eé] d[ií]a|fecha de hoy|d[ií]a de hoy)/i;

function stepCacheContext({ apiBaseUrl, model, projectRoot, messages, tools, userText } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return null;
  const hasImages = list.some((m) => Array.isArray(m?.content)
    && m.content.some((part) => part && (part.type === "image_url" || part.type === "image")));
  if (hasImages) return null;
  if (TIME_SENSITIVE_TURN_RE.test(String(userText || ""))) return null;
  const keyMessages = list.slice();
  for (let i = keyMessages.length - 1; i >= 0; i -= 1) {
    const m = keyMessages[i];
    if (m && m.role === "user" && typeof m.content === "string" && STEP_CACHE_TIME_LINE_RE.test(m.content)) {
      keyMessages[i] = { ...m, content: m.content.replace(STEP_CACHE_TIME_LINE_RE, "") };
      break;
    }
  }
  return {
    namespace: "kernel-step",
    provider: String(apiBaseUrl || ""),
    model: String(model || ""),
    projectRoot: String(projectRoot || ""),
    temperature: 0.1,
    messages: keyMessages,
    extra: { tools: Array.isArray(tools) ? tools : [] },
  };
}

// Consulta el dedupe: devuelve un «turno» servido de la caché local
// (sin llamar al proveedor) o null. Solo se sirven respuestas de
// TEXTO: un paso con tool_calls jamás se reproduce — reproducir una
// llamada con efectos (escribir, publicar) desde caché sería
// inseguro; el ahorro de esos pasos lo da el prefijo cacheable.
function lookupStepResponse(cache, context) {
  if (!cache || !context) return null;
  let hit = null;
  try { hit = cache.get(context); } catch { hit = null; }
  if (!hit || !hit.text) return null;
  return {
    text: hit.text,
    toolCalls: [],
    usage: null,
    partial: false,
    sawContent: true,
    fromResponseCache: true,
    cacheSavedInputTokens: Number(hit.inputTokens) || 0,
    cacheSavedOutputTokens: Number(hit.outputTokens) || 0,
    cacheSavedUsage: hit.usage || {},
  };
}

// Registra la respuesta de un paso en el dedupe, con las guardas de
// arriba: solo texto final (sin tool_calls), nunca parciales ni
// respuestas vacías.
function storeStepResponse(cache, context, turnLike = {}) {
  if (!cache || !context) return false;
  try {
    const toolCalls = Array.isArray(turnLike.toolCalls) ? turnLike.toolCalls : [];
    if (toolCalls.length) return false;
    if (turnLike.partial === true) return false;
    const text = String(turnLike.text || "");
    if (!text.trim()) return false;
    return cache.set(context, { text, usage: turnLike.usage || {} }) === true;
  } catch { return false; }
}

// --- Escribir solo lo justo: métricas de disciplina de escritura ----
// (Precisión de Luis, 2026-11-12: «no debería escribir de más,
// simplemente lo justo».) tools.writeFile registra aquí cada
// resultado: no-op idéntico, reescritura completa con diff pequeño
// (desperdicio medible de tokens de salida) y escritura completa
// ordinaria. El orquestador lee el DELTA del turno y lo suma a las
// métricas del turno (usage), para poder medir el desperdicio.
const writeDiscipline = {
  identicalNoops: 0,
  smallDiffFullWrites: 0,
  fullWrites: 0,
  smallDiffLinesTouched: 0,
  smallDiffLinesTotal: 0,
};

function noteWriteOutcome(kind, detail = {}) {
  if (kind === "identical-noop") writeDiscipline.identicalNoops += 1;
  else if (kind === "small-diff-full-write") {
    writeDiscipline.smallDiffFullWrites += 1;
    writeDiscipline.smallDiffLinesTouched += Math.max(0, Number(detail.touchedLines) || 0);
    writeDiscipline.smallDiffLinesTotal += Math.max(0, Number(detail.totalLines) || 0);
  } else if (kind === "full-write") writeDiscipline.fullWrites += 1;
}

function writeDisciplineStats() {
  return { ...writeDiscipline };
}

function resetWriteDisciplineStats() {
  writeDiscipline.identicalNoops = 0;
  writeDiscipline.smallDiffFullWrites = 0;
  writeDiscipline.fullWrites = 0;
  writeDiscipline.smallDiffLinesTouched = 0;
  writeDiscipline.smallDiffLinesTotal = 0;
}

// Diff de líneas barato (intersección multiconjunto): cuántas líneas
// se tocan entre la versión vieja y la nueva. «Diff pequeño» = las
// líneas tocadas son una MINORÍA del total (ratio < SMALL_DIFF_RATIO).
const SMALL_DIFF_RATIO = 0.5;
function lineDiffStats(oldText, newText) {
  const oldLines = String(oldText || "").split(/\r?\n/);
  const newLines = String(newText || "").split(/\r?\n/);
  const counts = new Map();
  for (const line of oldLines) counts.set(line, (counts.get(line) || 0) + 1);
  let common = 0;
  for (const line of newLines) {
    const c = counts.get(line) || 0;
    if (c > 0) { common += 1; counts.set(line, c - 1); }
  }
  const totalLines = oldLines.length + newLines.length;
  const touchedLines = totalLines - 2 * common;
  return {
    touchedLines,
    totalLines,
    ratio: totalLines > 0 ? touchedLines / totalLines : 0,
  };
}

module.exports = {
  resolveHarnessProfile,
  clipToolResultForHarness,
  buildHarnessSystemNudge,
  RunReadCache,
  // [EDITCORE-V500-A] Disciplina de caché (dueño único) + escritura justa.
  readReceiptStub,
  noteReadReceipt,
  invalidateReadReceipts,
  resolveResponseCache,
  stepCacheContext,
  lookupStepResponse,
  storeStepResponse,
  TIME_SENSITIVE_TURN_RE,
  noteWriteOutcome,
  writeDisciplineStats,
  resetWriteDisciplineStats,
  lineDiffStats,
  SMALL_DIFF_RATIO,
};
