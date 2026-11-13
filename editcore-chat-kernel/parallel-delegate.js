"use strict";

/**
 * Delegación en paralelo (lo que Luis admira de Cursor, 2026-11-10):
 * el agente principal lanza subagentes que trabajan A LA VEZ — uno
 * mapea una zona, otro revisa otra, otro audita una tercera — y
 * recibe un informe combinado, en vez de explorar todo en serie
 * dentro de su propio bucle.
 *
 * [EDITCORE-V510-B6] DIRECTOR GOBERNADO (directiva de Luis,
 * 2026-11-12: «para eso son los multiagentes, para que el agente
 * oficial detecte que necesita ayuda y pueda mandar subagentes, y no
 * solo 3, si no los que requiera»): el TOPE NUMÉRICO de tareas
 * desaparece. La gobernanza pasa a ser:
 *  1. PRESUPUESTO del harness de tokens: el perfil del harness
 *     (resolveHarnessProfile) fija el tamaño de OLEADA — cuántos
 *     corren a la vez — según el presupuesto restante del turno; el
 *     número total de tareas no se trunca.
 *  2. COLISIONES: nuevo rol WRITER (implementer acotado, con los
 *     locks por archivo de agent-coordination vía el runner). Cada
 *     writer declara su TARGET como ámbito EXCLUSIVO: dos writers
 *     cuyos ámbitos se pisan se rechazan con nota (el segundo), nunca
 *     corren a pisarse. Los roles de lectura no escriben y no
 *     colisionan.
 * Los topes de informe (4.000 caracteres por subagente) se mantienen
 * como higiene de contexto, no como gobernanza. Los ejecutores se
 * inyectan (explorer/analyst/writer reales desde tools.js) para
 * poder probar la concurrencia sin modelos.
 */

// Tamaño de oleada por defecto cuando no llega perfil del harness.
// (Antes era MAX_DELEGATE_TASKS, el tope de tareas: queda el nombre
// como alias histórico del tamaño de oleada, ya NO como tope.)
const DELEGATE_WAVE_SIZE = 4;
const MAX_DELEGATE_TASKS = DELEGATE_WAVE_SIZE;
const ROLES = new Set(["explorer", "analyst", "writer"]);

// Ámbito de un writer: su target normalizado como prefijo de rutas.
// La raíz (".", "" o "/") lo abarca TODO: pisa con cualquier otro.
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
    const role = String(raw?.role || "").trim().toLowerCase();
    if (!ROLES.has(role)) {
      notes.push(`Tarea descartada: rol inválido "${raw?.role || ""}" (usa explorer|analyst|writer).`);
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
    if (role === "writer") {
      if (!target) {
        notes.push("Tarea writer descartada: falta target (su ámbito exclusivo de escritura).");
        continue;
      }
      // Disyunción de ámbitos: un writer nuevo que pisa el ámbito de
      // otro ya aceptado se rechaza CON NOTA — jamás corren a pisarse.
      const clash = writerScopes.find((s) => scopesCollide(s, target));
      if (clash) {
        notes.push(`Tarea writer descartada: su ámbito "${target}" se pisa con el de otro writer ya aceptado ("${clash}"). Reparte los ámbitos para que sean disjuntos.`);
        continue;
      }
      writerScopes.push(target);
    }
    valid.push({ role, target: target || ".", question, patches: Array.isArray(raw?.patches) ? raw.patches : undefined });
  }
  return { tasks: valid, notes };
}

async function runDelegatedTasks({ projectRoot, tasks, runners, threadId = "default", signal = null, onProgress, harnessProfile = null } = {}) {
  const { tasks: valid, notes } = validateDelegateTasks(tasks);
  if (!valid.length) {
    return { ok: false, error: "delegate_parallel necesita al menos una tarea válida: { role: 'explorer', target }, { role: 'analyst', question } o { role: 'writer', target, patches }.", notes };
  }
  // Gobernanza del harness: la oleada la fija el perfil (presupuesto
  // restante del turno); sin perfil, la oleada por defecto.
  const waveSize = Math.max(1, Number(harnessProfile?.maxParallelReads) || DELEGATE_WAVE_SIZE);
  onProgress?.({ phase: "subagent", name: "delegate_parallel", text: `Delegando ${valid.length} subagentes (oleadas de ${waveSize} según el harness)…` });
  const results = [];
  // Oleadas: dentro de cada oleada la concurrencia es REAL (todos
  // arrancan en el mismo tick); entre oleadas manda el presupuesto.
  // El fallo de uno no tumba a los demás ni a la delegación.
  for (let at = 0; at < valid.length; at += waveSize) {
    const wave = valid.slice(at, at + waveSize);
    const waveResults = await Promise.all(wave.map(async (task) => {
      const runner = runners?.[task.role];
      if (typeof runner !== "function") {
        return { ...task, ok: false, text: task.role === "writer" && runners && "writer" in runners && !runners.writer
          ? "Rol writer sin ejecutor: este turno no está autorizado a escribir, así que ningún writer puede correr."
          : `Sin ejecutor disponible para el rol ${task.role}.` };
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
          text: text ? text.slice(0, 4000) : String(out?.error || "El subagente no produjo informe.").slice(0, 400),
          ...(applied.length ? { applied } : {}),
        };
      } catch (err) {
        return { ...task, ok: false, text: String(err?.message || err).slice(0, 400) };
      }
    }));
    results.push(...waveResults);
    if (signal?.aborted) break;
  }
  const done = results.filter((r) => r.ok).length;
  const appliedAll = results.flatMap((r) => (Array.isArray(r.applied) ? r.applied : []));
  const appliedCount = appliedAll.filter((p) => p?.ok === true && p?.planned !== true).length;
  const lines = results.map((r, i) => {
    const head = `### Subagente ${i + 1} — ${r.role}${r.role !== "analyst" ? ` · ${r.target}` : ""}${r.question ? ` · ${r.question}` : ""}`;
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
    ...(appliedAll.length ? { applied: appliedAll, appliedCount } : {}),
    text: [`Delegación en paralelo: ${done}/${results.length} subagentes entregaron informe.`, ...lines].join("\n\n"),
  };
}

module.exports = { validateDelegateTasks, runDelegatedTasks, MAX_DELEGATE_TASKS, DELEGATE_WAVE_SIZE, scopesCollide };
