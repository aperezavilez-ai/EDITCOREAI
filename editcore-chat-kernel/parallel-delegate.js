"use strict";

/**
 * Delegación en paralelo (lo que Luis admira de Cursor, 2026-11-10):
 * el agente principal puede lanzar 2–4 subagentes de SOLO LECTURA que
 * trabajan A LA VEZ — uno mapea una zona, otro revisa otra, otro audita
 * una tercera — y recibe un informe combinado, en vez de explorar todo
 * en serie dentro de su propio bucle.
 *
 * Solo lectura a propósito: analizar y revisar en paralelo es seguro
 * sin locks; construir en paralelo lo arbitran las corridas por chat
 * con los locks por archivo de agent-coordination. Los ejecutores se
 * inyectan (explorer/analyst reales desde tools.js) para poder probar
 * la concurrencia sin modelos.
 */

const MAX_DELEGATE_TASKS = 4;
const ROLES = new Set(["explorer", "analyst"]);

function validateDelegateTasks(tasks) {
  const notes = [];
  const valid = [];
  const list = Array.isArray(tasks) ? tasks : [];
  for (const raw of list) {
    const role = String(raw?.role || "").trim().toLowerCase();
    if (!ROLES.has(role)) {
      notes.push(`Tarea descartada: rol inválido "${raw?.role || ""}" (usa explorer|analyst).`);
      continue;
    }
    const target = String(raw?.target || "").trim();
    const question = String(raw?.question || "").trim();
    if (role === "explorer" && !target && !question) {
      notes.push("Tarea explorer descartada: falta target (zona a mapear).");
      continue;
    }
    if (role === "analyst" && !question) {
      notes.push("Tarea analyst descartada: falta question (qué debe responder).");
      continue;
    }
    valid.push({ role, target: target || ".", question });
    if (valid.length >= MAX_DELEGATE_TASKS) {
      if (list.length > MAX_DELEGATE_TASKS) notes.push(`Se delegan como máximo ${MAX_DELEGATE_TASKS} subagentes por llamada.`);
      break;
    }
  }
  return { tasks: valid, notes };
}

async function runDelegatedTasks({ projectRoot, tasks, runners, threadId = "default", signal = null, onProgress } = {}) {
  const { tasks: valid, notes } = validateDelegateTasks(tasks);
  if (!valid.length) {
    return { ok: false, error: "delegate_parallel necesita al menos una tarea válida: { role: 'explorer', target } o { role: 'analyst', question }.", notes };
  }
  onProgress?.({ phase: "subagent", name: "delegate_parallel", text: `Delegando ${valid.length} subagentes en paralelo…` });
  // Concurrencia REAL: todos los ejecutores arrancan en el mismo tick
  // (map síncrono) y se espera al conjunto; el fallo de uno no tumba a
  // los demás ni a la delegación.
  const results = await Promise.all(valid.map(async (task) => {
    const runner = runners?.[task.role];
    if (typeof runner !== "function") {
      return { ...task, ok: false, text: `Sin ejecutor disponible para el rol ${task.role}.` };
    }
    try {
      const out = await runner(task);
      const text = String(out?.summary || out?.report || out?.text || "").trim();
      return {
        ...task,
        ok: out?.ok !== false && Boolean(text),
        text: text ? text.slice(0, 4000) : String(out?.error || "El subagente no produjo informe.").slice(0, 400),
      };
    } catch (err) {
      return { ...task, ok: false, text: String(err?.message || err).slice(0, 400) };
    }
  }));
  const done = results.filter((r) => r.ok).length;
  const lines = results.map((r, i) => {
    const head = `### Subagente ${i + 1} — ${r.role}${r.role === "explorer" ? ` · ${r.target}` : ""}${r.question ? ` · ${r.question}` : ""}`;
    return r.ok ? `${head}\n\n${r.text}` : `${head}\n\n⚠️ Sin informe: ${r.text}`;
  });
  return {
    ok: done > 0,
    delegated: results.length,
    completed: done,
    threadId,
    ...(signal?.aborted ? { aborted: true } : {}),
    notes,
    results,
    text: [`Delegación en paralelo: ${done}/${results.length} subagentes entregaron informe.`, ...lines].join("\n\n"),
  };
}

module.exports = { validateDelegateTasks, runDelegatedTasks, MAX_DELEGATE_TASKS };
