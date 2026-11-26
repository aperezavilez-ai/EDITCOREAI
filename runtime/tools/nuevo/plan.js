"use strict";
// ============================================================
// KERNEL NUEVO — PLAN DEL TURNO (apertura)
// [CORRECCIÓN 9 — 2026-11-26] El turno de agente abre diciendo
// qué va a hacer, en primera persona, compuesto SOLO desde el
// encargo: un paso por frente en las revisiones enumeradas, un
// paso por viñeta cuando el usuario las trae, pasos por
// intención (corregir / crear / modificar / revisar) cuando no
// hay enumeración, y siempre el cierre del contrato como
// último paso — reportar lo hecho y proponer el siguiente
// paso, que es lo que el cierre (C7/C8) garantiza al final.
// Sin proyecto abierto no hay turno de agente y no hay plan;
// sin intención detectable NO se fabrica un plan genérico: un
// plan que no dice nada es otra línea enlatada. Sustituye al
// eco «Requerimientos analizados / Iniciando ejecución técnica
// agéntica» que repetía el texto del usuario sin decir nada.
// El panel lateral de plan está apagado a propósito en el
// renderer («el progreso se escribe en el chat»): el plan vive
// aquí, como apertura del turno en el chat.
// ============================================================

const RE_REVISION = /revis|analiz|verific|checa|examina|audit/i;
const RE_CREAR = /crea|crear|constru|haz|hacer|genera|generar|implementa|desarrolla/i;
const RE_CORREGIR = /correg|corrige|arregl|repara|solucion/i;
const RE_MODIFICAR = /modific|cambia|añad|agrega|actualiza|quita|elimina/i;

function limpiarPaso(s) {
  return String(s || "").replace(/\s+/g, " ").trim().replace(/[.:;]+$/, "");
}

function capitalizar(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// «encabezado: frente uno, frente dos y frente tres. resto» →
// los frentes, o null si tras los dos puntos no hay una
// enumeración de al menos dos.
function frentesEnumerados(texto) {
  const m = String(texto).match(/:\s*([^.\n]+)/);
  if (!m) return null;
  const partes = m[1].split(/,|\s+y\s+/).map(limpiarPaso).filter((p) => p.length >= 3 && p.length <= 60);
  return partes.length >= 2 ? partes.slice(0, 5) : null;
}

function componerPlanTurno({ texto, conProyecto } = {}) {
  if (!conProyecto) return "";
  const t = String(texto || "").trim();
  if (!t) return "";
  let pasos = null;

  // 1) Las viñetas o líneas numeradas del propio encargo.
  const lineas = t.split("\n").map((l) => l.trim()).filter((l) => /^[-*•]/.test(l) || /^\d+[.)]/.test(l));
  if (lineas.length >= 2) {
    pasos = lineas
      .map((l) => capitalizar(limpiarPaso(l.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, ""))))
      .filter(Boolean)
      .slice(0, 5);
  }

  // 2) Frentes enumerados tras dos puntos: un paso por frente,
  // con el verbo que gobierna el encargo.
  if (!pasos) {
    const frentes = frentesEnumerados(t);
    if (frentes) {
      const verbo = RE_REVISION.test(t) ? "Revisar" : (RE_CREAR.test(t) ? "Construir" : "Trabajar en");
      pasos = frentes.map((f) => `${verbo} ${f}`);
    }
  }

  // 3) Intención sin enumeración: los pasos honestos de esa
  // clase de trabajo.
  if (!pasos) {
    if (RE_CORREGIR.test(t)) {
      pasos = ["Localizar el problema en el código", "Aplicar la corrección", "Verificar que quedó resuelto"];
    } else if (RE_CREAR.test(t)) {
      pasos = ["Explorar el proyecto para ubicar dónde va", "Construir lo pedido", "Verificar el resultado"];
    } else if (RE_MODIFICAR.test(t)) {
      pasos = ["Revisar el estado actual", "Aplicar el cambio", "Verificar el resultado"];
    } else if (RE_REVISION.test(t)) {
      pasos = ["Explorar el proyecto", "Analizar lo encontrado", "Reportar el diagnóstico"];
    }
  }

  if (!pasos || !pasos.length) return "";
  pasos.push("Reportar lo hecho y proponer el siguiente paso");
  return "Voy a trabajar así:\n" + pasos.map((p, i) => `${i + 1}. ${p}`).join("\n");
}

module.exports = { componerPlanTurno };
