"use strict";

/**
 * AGENT PARALLEL — Fase 8
 * Fan-out / fan-in coordinado:
 *  - El Supervisor parte la tarea en jobs con scopes de path disjuntos
 *  - Cada job tiene rol (analyst | implementer | verifier | explorer)
 *  - Locks por path (reutiliza agent-coordination)
 *  - Ejecución: en esta versión los jobs se procesan de forma controlada
 *    (cola con paralelismo lógico por zonas; sin pisar el mismo archivo)
 *  - Fan-in: merge de resultados + informe al primario
 *
 * Persistencia: .editcore/parallel/
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PARALLEL_VERSION = 1;
const MAX_JOBS = 8;

function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, filePath);
}

function safeRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function jobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(2).toString("hex")}`;
}

function batchId() {
  return `batch_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

/**
 * Heurística: proponer jobs disjuntos según el texto de la tarea.
 * El LLM/Supervisor puede reemplazar este plan con uno explícito.
 */
function proposeJobsFromTask(taskText = "") {
  const t = String(taskText || "").toLowerCase();
  const jobs = [];

  const wantsUi =
    /(?:ui|ux|landing|dashboard|frontend|css|tailwind|página|pantalla|dise[nñ]o|visual)/i.test(t);
  const wantsApi =
    /(?:api|backend|server|endpoint|supabase|auth|database|db)/i.test(t);
  const wantsFull =
    /(?:app|saas|plataforma|producto|mvp|completa|desde cero)/i.test(t);

  if (wantsFull || (wantsUi && wantsApi)) {
    jobs.push({
      role: "explorer",
      title: "Mapear estructura y puntos de entrada",
      scopePaths: ["src", "app", "package.json"],
      goal: "Listar rutas clave sin editar",
    });
    jobs.push({
      role: "analyst",
      title: "Analizar dominio datos/API",
      scopePaths: ["src/server", "src/lib", "supabase", "api"],
      goal: "Hallazgos de datos/auth/API; no escribir aún",
    });
    jobs.push({
      role: "implementer",
      title: "Implementar UI prioritaria",
      scopePaths: ["src/components", "src/routes", "app", "src/pages", "public"],
      goal: "UI según elite policy; no tocar server",
    });
    jobs.push({
      role: "verifier",
      title: "Verificar consistencia y checklist",
      scopePaths: ["src", "package.json"],
      goal: "Revisar sin pisar writes ajenos; reportar gaps",
    });
  } else if (wantsUi) {
    jobs.push({
      role: "explorer",
      title: "Localizar componentes y estilos",
      scopePaths: ["src", "app", "components"],
      goal: "Mapa UI existente",
    });
    jobs.push({
      role: "implementer",
      title: "Construir/ajustar UI",
      scopePaths: ["src/components", "src/routes", "app", "src/styles"],
      goal: "Implementación visual premium",
    });
    jobs.push({
      role: "verifier",
      title: "QA visual y estructura",
      scopePaths: ["src/components", "src/routes", "app"],
      goal: "Checklist anti-genérico",
    });
  } else if (wantsApi) {
    jobs.push({
      role: "analyst",
      title: "Analizar capa server/API",
      scopePaths: ["src/server", "api", "supabase"],
      goal: "Diagnóstico",
    });
    jobs.push({
      role: "implementer",
      title: "Implementar cambios server",
      scopePaths: ["src/server", "api", "supabase"],
      goal: "Cambios acotados al scope",
    });
    jobs.push({
      role: "verifier",
      title: "Verificar tipos y contratos",
      scopePaths: ["src/server", "api"],
      goal: "Revisión",
    });
  } else {
    jobs.push({
      role: "explorer",
      title: "Explorar contexto relevante",
      scopePaths: ["."],
      goal: "Orientar el trabajo",
    });
    jobs.push({
      role: "implementer",
      title: "Ejecutar cambios pedidos",
      scopePaths: ["src", "app"],
      goal: "Implementar lo solicitado",
    });
    jobs.push({
      role: "verifier",
      title: "Verificar resultado",
      scopePaths: ["src", "app"],
      goal: "Comprobar archivos tocados",
    });
  }

  return jobs.slice(0, MAX_JOBS);
}

/**
 * Detecta solapes de scope entre jobs (aviso; el lock real es por archivo).
 */
function findScopeOverlaps(jobs) {
  const overlaps = [];
  for (let i = 0; i < jobs.length; i++) {
    for (let j = i + 1; j < jobs.length; j++) {
      const a = jobs[i].scopePaths || [];
      const b = jobs[j].scopePaths || [];
      for (const pa of a) {
        for (const pb of b) {
          if (pa === pb || pa.startsWith(pb + "/") || pb.startsWith(pa + "/")) {
            if (jobs[i].role === "implementer" && jobs[j].role === "implementer") {
              overlaps.push({ a: jobs[i].title, b: jobs[j].title, path: pa });
            }
          }
        }
      }
    }
  }
  return overlaps;
}

class ParallelBatch {
  constructor(projectRoot, options = {}) {
    this.projectRoot = path.resolve(projectRoot || ".");
    this.dir = path.join(this.projectRoot, ".editcore", "parallel");
    this.coord = null;
    try {
      const { getCoordination } = require("./agent-coordination");
      this.coord = getCoordination(this.projectRoot);
    } catch {
      this.coord = null;
    }
    this.threadId = options.threadId || "default";
    this.batch = null;
  }

  /**
   * Crea un batch fan-out a partir de la tarea (o jobs explícitos).
   */
  createBatch(task, jobsInput = null) {
    const jobsSrc = Array.isArray(jobsInput) && jobsInput.length
      ? jobsInput
      : proposeJobsFromTask(task);

    const jobs = jobsSrc.map((j, i) => ({
      id: jobId(),
      index: i,
      role: j.role || "implementer",
      title: String(j.title || `Job ${i + 1}`).slice(0, 200),
      goal: String(j.goal || "").slice(0, 500),
      scopePaths: Array.isArray(j.scopePaths) ? j.scopePaths.map(String) : ["src"],
      status: "pending", // pending | running | done | failed | skipped
      result: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    }));

    const overlaps = findScopeOverlaps(jobs);

    this.batch = {
      version: PARALLEL_VERSION,
      id: batchId(),
      task: String(task || "").slice(0, 2000),
      threadId: this.threadId,
      createdAt: new Date().toISOString(),
      status: "open", // open | merging | closed
      jobs,
      overlaps,
      fanIn: null,
    };

    this._persist();
    return this.batch;
  }

  _persist() {
    if (!this.batch) return;
    fs.mkdirSync(this.dir, { recursive: true });
    atomicWrite(
      path.join(this.dir, `${this.batch.id}.json`),
      JSON.stringify(this.batch, null, 2)
    );
    atomicWrite(
      path.join(this.dir, "LATEST.json"),
      JSON.stringify(
        { id: this.batch.id, status: this.batch.status, updatedAt: new Date().toISOString() },
        null,
        2
      )
    );
  }

  loadLatest() {
    const pointer = safeRead(path.join(this.dir, "LATEST.json"), null);
    if (!pointer?.id) return null;
    this.batch = safeRead(path.join(this.dir, `${pointer.id}.json`), null);
    return this.batch;
  }

  /**
   * Marca job en ejecución y registra agente activo + scopes.
   */
  beginJob(jobId) {
    const job = this.batch?.jobs?.find((j) => j.id === jobId);
    if (!job) throw new Error(`Job no encontrado: ${jobId}`);
    job.status = "running";
    job.startedAt = new Date().toISOString();
    if (this.coord) {
      try {
        this.coord.setActiveAgent(this.threadId, job.role, {
          task: job.title,
          phase: "parallel_job",
          note: job.goal,
        });
        global.__editcoreCoord = {
          threadId: this.threadId,
          agentRole: job.role,
          projectRoot: this.projectRoot,
          jobId: job.id,
          scopePaths: job.scopePaths,
        };
      } catch (_) {}
    }
    this._persist();
    return job;
  }

  completeJob(jobId, result = {}) {
    const job = this.batch?.jobs?.find((j) => j.id === jobId);
    if (!job) throw new Error(`Job no encontrado: ${jobId}`);
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    job.result = {
      summary: String(result.summary || "ok").slice(0, 2000),
      artifacts: result.artifacts || [],
      findings: result.findings || [],
      confidence: result.confidence ?? 0.7,
    };
    this._persist();
    return job;
  }

  failJob(jobId, error) {
    const job = this.batch?.jobs?.find((j) => j.id === jobId);
    if (!job) throw new Error(`Job no encontrado: ${jobId}`);
    job.status = "failed";
    job.finishedAt = new Date().toISOString();
    job.error = String(error && error.message ? error.message : error).slice(0, 1500);
    this._persist();
    return job;
  }

  nextPendingJob() {
    return this.batch?.jobs?.find((j) => j.status === "pending") || null;
  }

  /**
   * Fan-in: consolida resultados cuando no quedan pending/running.
   */
  fanIn() {
    if (!this.batch) return null;
    const pending = this.batch.jobs.filter((j) => j.status === "pending" || j.status === "running");
    if (pending.length) {
      return {
        ok: false,
        error: `Aún hay ${pending.length} job(s) sin cerrar`,
        pending: pending.map((j) => j.id),
      };
    }

    this.batch.status = "merging";
    const done = this.batch.jobs.filter((j) => j.status === "done");
    const failed = this.batch.jobs.filter((j) => j.status === "failed");
    const artifacts = [];
    const findings = [];
    for (const j of done) {
      if (j.result?.artifacts) artifacts.push(...j.result.artifacts);
      if (j.result?.findings) findings.push(...j.result.findings);
      if (j.result?.summary) findings.push(`[${j.role}] ${j.result.summary}`);
    }

    this.batch.fanIn = {
      at: new Date().toISOString(),
      done: done.length,
      failed: failed.length,
      artifacts: [...new Set(artifacts)],
      findings,
      report: this._buildReport(done, failed, findings, artifacts),
    };
    this.batch.status = "closed";
    this._persist();

    if (this.coord) {
      try {
        this.coord.releaseAllForThread(this.threadId);
      } catch (_) {}
    }

    return { ok: true, fanIn: this.batch.fanIn };
  }

  _buildReport(done, failed, findings, artifacts) {
    const lines = [
      `[FAN-IN] batch cerrado — ${done.length} ok, ${failed.length} fallidos`,
      "Resúmenes por job:",
    ];
    for (const j of [...done, ...failed]) {
      lines.push(
        `• [${j.role}] ${j.title}: ${j.status}${j.result?.summary ? " — " + j.result.summary : ""}${j.error ? " — ERR: " + j.error : ""}`
      );
    }
    if (artifacts.length) {
      lines.push("Artefactos: " + artifacts.slice(0, 30).join(", "));
    }
    return lines.join("\n");
  }

  /**
   * Prompt para el Supervisor / agentes: plan paralelo + reglas.
   */
  getParallelPrompt() {
    if (!this.batch) return "";
    const lines = [
      `[PARALLEL FAN-OUT v${PARALLEL_VERSION}] batch=${this.batch.id} status=${this.batch.status}`,
      `Tarea: ${this.batch.task}`,
      "Jobs (ejecutar respetando scopes; no escribir fuera de tu scope):",
    ];
    for (const j of this.batch.jobs) {
      lines.push(
        `  ${j.index + 1}. [${j.status}] ${j.role} — ${j.title} | scope: ${(j.scopePaths || []).join(", ")} | ${j.goal}`
      );
    }
    if (this.batch.overlaps?.length) {
      lines.push("AVISO solapes de scope entre implementers:");
      for (const o of this.batch.overlaps.slice(0, 5)) {
        lines.push(`  • ${o.a} ↔ ${o.b} @ ${o.path}`);
      }
    }
    lines.push("REGLA: Un job implementer no edita paths del scope de otro implementer.");
    lines.push("REGLA: Verifier no reescribe; solo reporta o pide correcciones.");
    lines.push("REGLA: Al terminar todos los jobs, consolidar (fan-in) antes de declarar listo.");
    return lines.join("\n");
  }

  /**
   * Guía de ejecución para el turno actual: qué job toca y su prompt de rol.
   */
  getCurrentJobPrompt() {
    const job = this.batch?.jobs?.find((j) => j.status === "running") || this.nextPendingJob();
    if (!job) {
      if (this.batch?.status === "closed" && this.batch.fanIn) {
        return this.batch.fanIn.report;
      }
      return this.getParallelPrompt() + "\n\nTodos los jobs pendientes deben iniciarse o hacer fan-in.";
    }
    return [
      this.getParallelPrompt(),
      "",
      `[JOB ACTIVO] ${job.id}`,
      `Rol: ${job.role}`,
      `Título: ${job.title}`,
      `Goal: ${job.goal}`,
      `Scope SOLO: ${(job.scopePaths || []).join(", ")}`,
      "No modifiques archivos fuera de este scope.",
    ].join("\n");
  }
}

function createParallelBatch(projectRoot, options) {
  return new ParallelBatch(projectRoot, options);
}

/**
 * ¿La tarea se beneficia de fan-out?
 */
function shouldUseParallel(taskText = "") {
  const t = String(taskText || "");
  if (t.length < 40) return false;
  return /(?:app|saas|plataforma|landing|dashboard|frontend.+backend|completa|desde cero|mvp|y\s+(?:además|también)|api.+ui|ui.+api)/i.test(
    t
  );
}

module.exports = {
  ParallelBatch,
  createParallelBatch,
  proposeJobsFromTask,
  findScopeOverlaps,
  shouldUseParallel,
  PARALLEL_VERSION,
  MAX_JOBS,
};
