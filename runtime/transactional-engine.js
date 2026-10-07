"use strict";

/**
 * TRANSACTIONAL EXECUTION ENGINE — Motor de ejecución por lotes + checkpoints
 *
 * Objetivos:
 *  - Eliminar truncamientos y tareas incompletas
 *  - Guardar checkpoint en disco tras cada paso exitoso
 *  - Reanudar automáticamente desde el último punto de control
 *  - Prohibir dejar código con // TODO de implementación o funciones a medias
 *  - Compatible con el runtime de agentes de EditCoreAI (IDE + Web)
 *
 * Flujo:
 *  1. plan(task) → lista de steps
 *  2. execute / resume → ejecuta step a step, checkpoint tras cada uno
 *  3. Si falla o se corta → el siguiente arranque llama resume()
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENGINE_VERSION = 1;
const CHECKPOINT_DIR = ".editcore/checkpoints";

function generateRunId() {
  return `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function safeReadJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * Detecta si un contenido parece truncado o incompleto.
 * Heurísticas simples pero efectivas.
 */
function looksIncomplete(content = "") {
  const s = String(content);
  if (!s.trim()) return true;
  // TODOs de implementación prohibidos
  if (/\/\/\s*TODO[:\s].*(rest|implement|continuar|complete|finish|aquí|here)/i.test(s)) return true;
  if (/\/\*\s*TODO[:\s].*(rest|implement)/i.test(s)) return true;
  // Funciones abiertas sin cierre razonable
  const openBraces = (s.match(/\{/g) || []).length;
  const closeBraces = (s.match(/\}/g) || []).length;
  if (openBraces > closeBraces + 1) return true;
  // Truncamiento típico de modelos
  if (/\.\.\.\s*$|…\s*$|\[truncated\]|\[cut\]|\/\/\s*\.\.\./i.test(s.slice(-80))) return true;
  // Export/module incompleto al final del archivo (no en cualquier línea: `module.exports = {` multilínea es válido)
  const tail = s.trimEnd();
  if (/module\.exports\s*=\s*\{?$/.test(tail) || /export\s+(default\s+)?\{?$/.test(tail)) return true;
  return false;
}

class TransactionalEngine {
  /**
   * @param {string} projectRoot
   * @param {object} [options]
   * @param {function} [options.resolveInside] - (root, rel) => absPath seguro
   * @param {function} [options.onStep] - callback(step, result)
   * @param {function} [options.onCheckpoint] - callback(checkpoint)
   */
  constructor(projectRoot, options = {}) {
    if (!projectRoot) throw new Error("TransactionalEngine requiere projectRoot");
    this.projectRoot = path.resolve(projectRoot);
    this.checkpointRoot = path.join(this.projectRoot, CHECKPOINT_DIR);
    this.resolveInside =
      options.resolveInside ||
      ((root, rel) => {
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root)) throw new Error(`Path fuera del proyecto: ${rel}`);
        return abs;
      });
    this.onStep = options.onStep || (() => {});
    this.onCheckpoint = options.onCheckpoint || (() => {});
    this.current = null; // checkpoint activo en memoria
  }

  _checkpointPath(runId) {
    return path.join(this.checkpointRoot, `${runId}.json`);
  }

  _latestPointer() {
    return path.join(this.checkpointRoot, "LATEST.json");
  }

  /**
   * Crea un nuevo plan de ejecución.
   * @param {string} task - descripción de la tarea
   * @param {Array<{id?:string, name:string, type:string, payload?:object}>} steps
   * @param {object} [meta]
   */
  createRun(task, steps = [], meta = {}) {
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("createRun requiere al menos un step");
    }
    const runId = generateRunId();
    const normalized = steps.map((s, i) => ({
      id: s.id || `step_${i + 1}`,
      index: i,
      name: String(s.name || `Step ${i + 1}`),
      type: String(s.type || "generic"), // write_file | patch | command | analyze | custom
      payload: s.payload || {},
      status: "pending", // pending | running | done | failed | skipped
      startedAt: null,
      finishedAt: null,
      error: null,
      resultSummary: null,
      artifacts: [], // paths escritos en este step
    }));

    const checkpoint = {
      version: ENGINE_VERSION,
      runId,
      task: String(task || "").slice(0, 2000),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running", // running | completed | failed | aborted
      currentStepIndex: 0,
      steps: normalized,
      meta: {
        ...meta,
        source: meta.source || "agent",
      },
      history: [],
    };

    this._persist(checkpoint);
    this.current = checkpoint;
    return checkpoint;
  }

  _persist(checkpoint) {
    checkpoint.updatedAt = new Date().toISOString();
    const file = this._checkpointPath(checkpoint.runId);
    atomicWrite(file, JSON.stringify(checkpoint, null, 2));
    atomicWrite(
      this._latestPointer(),
      JSON.stringify({ runId: checkpoint.runId, updatedAt: checkpoint.updatedAt, status: checkpoint.status }, null, 2)
    );
    this.onCheckpoint(checkpoint);
  }

  /**
   * Carga el último run incompleto (si existe).
   */
  loadLatest() {
    const pointer = safeReadJson(this._latestPointer(), null);
    if (!pointer || !pointer.runId) return null;
    const cp = safeReadJson(this._checkpointPath(pointer.runId), null);
    if (!cp || cp.status === "completed") return null;
    this.current = cp;
    return cp;
  }

  loadRun(runId) {
    const cp = safeReadJson(this._checkpointPath(runId), null);
    if (cp) this.current = cp;
    return cp;
  }

  /**
   * Marca un step como en ejecución.
   */
  beginStep(stepId) {
    const cp = this.current;
    if (!cp) throw new Error("No hay run activo");
    const step = cp.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step no encontrado: ${stepId}`);
    step.status = "running";
    step.startedAt = new Date().toISOString();
    step.error = null;
    cp.currentStepIndex = step.index;
    cp.status = "running";
    this._persist(cp);
    return step;
  }

  /**
   * Completa un step con éxito. Guarda checkpoint inmediato.
   * @param {string} stepId
   * @param {object} [result] - { summary, artifacts: string[] }
   */
  completeStep(stepId, result = {}) {
    const cp = this.current;
    if (!cp) throw new Error("No hay run activo");
    const step = cp.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step no encontrado: ${stepId}`);

    // Validación anti-truncamiento en artifacts de tipo archivo
    const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
    for (const rel of artifacts) {
      try {
        const abs = this.resolveInside(this.projectRoot, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          const content = fs.readFileSync(abs, "utf8");
          if (looksIncomplete(content)) {
            throw new Error(
              `Contenido incompleto/truncado detectado en ${rel}. ` +
                `El motor rechaza el step. Reescribe el archivo completo.`
            );
          }
        }
      } catch (err) {
        if (err.message.includes("incompleto") || err.message.includes("truncado")) throw err;
        // path resolution u otros → no bloquear por eso
      }
    }

    step.status = "done";
    step.finishedAt = new Date().toISOString();
    step.resultSummary = String(result.summary || "ok").slice(0, 1000);
    step.artifacts = artifacts;
    step.error = null;

    cp.history.push({
      at: step.finishedAt,
      stepId,
      event: "completed",
      summary: step.resultSummary,
    });

    // Avanzar índice
    const nextPending = cp.steps.find((s) => s.status === "pending");
    if (!nextPending) {
      cp.status = "completed";
      cp.currentStepIndex = cp.steps.length;
    } else {
      cp.currentStepIndex = nextPending.index;
    }

    this._persist(cp);
    this.onStep(step, result);
    return cp;
  }

  /**
   * Marca un step como fallido. El run queda en estado failed (reanudable).
   */
  failStep(stepId, error) {
    const cp = this.current;
    if (!cp) throw new Error("No hay run activo");
    const step = cp.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step no encontrado: ${stepId}`);

    step.status = "failed";
    step.finishedAt = new Date().toISOString();
    step.error = String(error && error.message ? error.message : error).slice(0, 2000);

    cp.status = "failed";
    cp.history.push({
      at: step.finishedAt,
      stepId,
      event: "failed",
      error: step.error,
    });
    this._persist(cp);
    return cp;
  }

  /**
   * Devuelve el siguiente step pendiente (para el agente o el loop).
   */
  nextPendingStep() {
    const cp = this.current || this.loadLatest();
    if (!cp || cp.status === "completed") return null;
    return cp.steps.find((s) => s.status === "pending" || s.status === "failed") || null;
  }

  /**
   * ¿Hay un run incompleto que se pueda reanudar?
   */
  canResume() {
    const cp = this.loadLatest();
    return Boolean(cp && (cp.status === "running" || cp.status === "failed"));
  }

  /**
   * Resumen legible para el prompt del agente.
   */
  getResumePrompt() {
    const cp = this.current || this.loadLatest();
    if (!cp) return "";
    const done = cp.steps.filter((s) => s.status === "done").length;
    const total = cp.steps.length;
    const next = this.nextPendingStep();
    const lines = [
      `[CHECKPOINT ACTIVO] runId=${cp.runId} status=${cp.status}`,
      `Tarea: ${cp.task}`,
      `Progreso: ${done}/${total} steps completados`,
    ];
    if (next) {
      lines.push(`Siguiente step: [${next.id}] ${next.name} (type=${next.type})`);
      if (next.error) lines.push(`Error previo: ${next.error}`);
    }
    const recent = cp.history.slice(-5);
    if (recent.length) {
      lines.push("Historial reciente:");
      for (const h of recent) {
        lines.push(`  - ${h.event} ${h.stepId}: ${h.summary || h.error || ""}`);
      }
    }
    lines.push("REGLA: Continúa EXACTAMENTE desde el siguiente step. No reinicies la tarea. No dejes código incompleto.");
    return lines.join("\n");
  }

  /**
   * Lista checkpoints recientes (para UI / debugging).
   */
  listCheckpoints(limit = 10) {
    try {
      if (!fs.existsSync(this.checkpointRoot)) return [];
      return fs
        .readdirSync(this.checkpointRoot)
        .filter((f) => f.endsWith(".json") && f !== "LATEST.json")
        .map((f) => {
          const data = safeReadJson(path.join(this.checkpointRoot, f), null);
          if (!data) return null;
          return {
            runId: data.runId,
            task: data.task,
            status: data.status,
            updatedAt: data.updatedAt,
            progress: `${data.steps.filter((s) => s.status === "done").length}/${data.steps.length}`,
          };
        })
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  /**
   * Abortar el run actual.
   */
  abort(reason = "aborted by user") {
    const cp = this.current;
    if (!cp) return null;
    cp.status = "aborted";
    cp.history.push({ at: new Date().toISOString(), event: "aborted", error: reason });
    this._persist(cp);
    return cp;
  }

  /**
   * Utilidad estática: validar que un archivo no esté incompleto.
   */
  static validateComplete(content) {
    return !looksIncomplete(content);
  }

  static looksIncomplete = looksIncomplete;
}

module.exports = {
  TransactionalEngine,
  looksIncomplete,
  createTransactionalEngine: (projectRoot, options) => new TransactionalEngine(projectRoot, options),
};
