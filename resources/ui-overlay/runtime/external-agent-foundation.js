"use strict";

// Adaptacion nativa de las capacidades revisadas en OmniRoute, claude-mem,
// Headroom y task-observer. No arranca sus servidores ni ejecuta codigo remoto.
const FOUNDATION_SOURCES = Object.freeze([
  "OmniRoute: routing, fallback y resiliencia de proveedores",
  "claude-mem: memoria progresiva y recuperacion por relevancia",
  "Headroom: compactacion reversible de contexto y resultados",
  "task-observer: observar evidencia y mejorar el procedimiento sin inventar resultados",
]);

function buildExternalFoundationContext({ analysisMode = false, allowWrite = false } = {}) {
  const mode = analysisMode
    ? "El trabajo es de solo lectura: inspecciona, verifica y reporta; no escribas."
    : allowWrite
      ? "El trabajo permite escritura: despues de reunir evidencia aplica cambios reales y verificalos."
      : "El trabajo no tiene permiso de escritura: no simules modificaciones.";

  return [
    "FUNDACION OPERATIVA EDITCORE (integraciones revisadas y adaptadas nativamente):",
    `Fuentes activas: ${FOUNDATION_SOURCES.join("; ")}.`,
    mode,
    "1. Routing: conserva el modelo/proveedor seleccionado; ante un error temporal reintenta o usa el fallback configurado, pero nunca declares exito sin respuesta valida.",
    "2. Memoria progresiva: reutiliza archivos, decisiones y resultados ya confirmados; busca en brain_search antes de repetir exploracion amplia.",
    "3. Contexto: compacta resultados grandes sin perder rutas, errores, cambios ni evidencia de verificacion. No repitas bloques completos ya revisados.",
    "4. Ejecucion: para una correccion usa el ciclo leer o buscar -> escribir o reemplazar -> verificar con lectura o comando. Si falta una escritura, la tarea no esta terminada.",
    "5. Observabilidad: cada accion debe dejar evidencia; si una accion falla, informa el error y corrige el curso. El mensaje final debe resumir acciones, archivos, pruebas y pendientes reales.",
  ].join("\n");
}

module.exports = { FOUNDATION_SOURCES, buildExternalFoundationContext };
