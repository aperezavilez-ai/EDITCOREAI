"use strict";

/**
 * Motor de Delegación en Paralelo de EditCoreAI (v5.3.3)
 * Permite al agente principal lanzar múltiples subagentes concurrentes:
 * - explorer: mapeo estructural de carpetas y configs
 * - analyst: análisis profundo de código, lógica y arquitectura
 * - security: auditoría de seguridad y escaneo de credenciales
 * - database: análisis de esquemas, migraciones y Supabase
 * - ui_ux: componentes, estilos CSS y accesibilidad
 * - devops: scripts, CI/CD y despliegue
 * - verifier: sintaxis, pruebas y verificación
 * - writer: implementer acotado con ámbito exclusivo
 */

const DELEGATE_WAVE_SIZE = 4;
const MAX_DELEGATE_TASKS = DELEGATE_WAVE_SIZE;
const ROLES = new Set(["explorer", "analyst", "writer", "security", "database", "ui_ux", "devops", "verifier"]);

function normalizeScope(target = "") {
  return String(target || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function scopesCollide(a, b) {
  const x = normalizeScope(a);
  const y = normalizeScope(b);
  if (!x || !y || x === "." || y === ".") return true;
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}

function validateDelegateTasks(tasks) {
  const notes = [];
  const valid = [];
  const list = Array.isArray(tasks) ? tasks : [];
  const writerScopes = [];

  for (const raw of list) {
    const role = String(raw?.role || "explorer").trim().toLowerCase();
    if (!ROLES.has(role)) {
      notes.push(`Tarea descartada: rol no reconocido "${raw?.role || ""}". Roles soportados: ${[...ROLES].join(", ")}.`);
      continue;
    }
    const target = String(raw?.target || raw?.path || ".").trim();
    const question = String(raw?.question || raw?.task || raw?.query || "").trim();

    if (role === "writer") {
      if (!target) {
        notes.push("Tarea writer descartada: falta target (ámbito exclusivo de escritura).");
        continue;
      }
      const clash = writerScopes.find((s) => scopesCollide(s, target));
      if (clash) {
        notes.push(`Tarea writer descartada: su ámbito "${target}" colisiona con el del writer "${clash}".`);
        continue;
      }
      writerScopes.push(target);
    }

    valid.push({
      role,
      target: target || ".",
      question: question || (role === "explorer" ? "Mapear zona" : "Analizar alcance"),
      patches: Array.isArray(raw?.patches) ? raw.patches : undefined,
    });
  }

  return { tasks: valid, notes };
}

async function runDelegatedTasks({
  projectRoot,
  tasks,
  runners,
  threadId = "default",
  signal = null,
  onProgress = null,
  harnessProfile = null,
} = {}) {
  const { tasks: valid, notes } = validateDelegateTasks(tasks);
  if (!valid.length) {
    return {
      ok: false,
      error: `delegate_parallel requiere al menos una tarea válida. Roles disponibles: ${[...ROLES].join(", ")}.`,
      notes,
    };
  }

  const waveSize = Math.max(1, Number(harnessProfile?.maxParallelReads) || DELEGATE_WAVE_SIZE);
  if (typeof onProgress === "function") {
    try {
      onProgress({
        phase: "subagent",
        name: "delegate_parallel",
        text: `Ejecutando ${valid.length} subagentes en paralelo (oleadas de ${waveSize})…`,
      });
    } catch { /* ignore */ }
  }

  const results = [];

  for (let at = 0; at < valid.length; at += waveSize) {
    const wave = valid.slice(at, at + waveSize);
    const waveResults = await Promise.all(
      wave.map(async (task) => {
        const runner = runners?.[task.role];
        if (typeof runner !== "function") {
          return {
            ...task,
            ok: false,
            text: task.role === "writer" && runners && "writer" in runners && !runners.writer
              ? "Rol writer sin ejecutor: este turno no cuenta con autorización de escritura."
              : `Sin ejecutor configurado para el rol especialista '${task.role}'.`,
          };
        }

        try {
          const out = await runner(task);
          const applied = Array.isArray(out?.applied) ? out.applied : [];
          let text = String(out?.summary || out?.report || out?.text || "").trim();

          if (!text && applied.length) {
            const okPatches = applied.filter((p) => p?.ok === true && p?.planned !== true);
            text = `Writer aplicó ${okPatches.length}/${applied.length} parche(s): ${applied.map((p) => `${p?.path || "?"}${p?.ok === true && p?.planned !== true ? " ✅" : " (no aplicado)"}`).join(", ")}`;
          }

          return {
            ...task,
            ok: out?.ok !== false && Boolean(text || applied.length),
            // [CORRECCIÓN 2 — auditoría 2026-11-24] Sin informe
            // se dice sin informe: la frase anterior («completó
            // la inspección sin hallazgos negativos») convertía
            // una NO entrega en un pase limpio que nadie ganó.
            text: text ? text.slice(0, 4000) : String(out?.error || "El subagente no entregó informe: no hay evidencia de que haya inspeccionado nada.").slice(0, 500),
            ...(applied.length ? { applied } : {}),
          };
        } catch (err) {
          return { ...task, ok: false, text: String(err?.message || err).slice(0, 400) };
        }
      })
    );

    results.push(...waveResults);
    if (signal?.aborted) break;
  }

  const done = results.filter((r) => r.ok).length;
  const appliedAll = results.flatMap((r) => (Array.isArray(r.applied) ? r.applied : []));
  const appliedCount = appliedAll.filter((p) => p?.ok === true && p?.planned !== true).length;

  const lines = results.map((r, i) => {
    const head = `### [Subagente ${i + 1}] Rol: ${r.role.toUpperCase()} · Zona: ${r.target}${r.question ? ` · Encargo: ${r.question}` : ""}`;
    return r.ok ? `${head}\n\n${r.text}` : `${head}\n\n⚠️ ${r.text}`;
  });

  return {
    // [CORRECCIÓN 2] La delegación solo es ok si TODOS
    // entregaron: con 1 de 4 el resultado parcial se reporta
    // como lo que es (completa:false), no como éxito.
    ok: results.length > 0 && done === results.length,
    completa: results.length > 0 && done === results.length,
    delegated: results.length,
    completed: done,
    threadId,
    ...(signal?.aborted ? { aborted: true } : {}),
    notes,
    results,
    ...(appliedAll.length ? { applied: appliedAll, appliedCount } : {}),
    text: [`Delegación en paralelo: ${done}/${results.length} subagente(s) entregaron informe.`, ...lines].join("\n\n"),
  };
}

module.exports = {
  validateDelegateTasks,
  runDelegatedTasks,
  MAX_DELEGATE_TASKS,
  DELEGATE_WAVE_SIZE,
  scopesCollide,
  ROLES,
};
