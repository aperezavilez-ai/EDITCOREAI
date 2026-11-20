"use strict";
// ============================================================
// REGISTRO DE DIAGNÓSTICO DE TURNOS — .editcore/turnos.jsonl
// Cada respuesta del proveedor queda anotada TAL COMO LLEGÓ
// (texto crudo, llamadas estructurales, llamadas rescatadas
// del texto, finish_reason), más el inicio y el fin del turno
// con la actividad real. Existe porque tres correcciones a
// ciegas no pudieron con el defecto en vivo «el agente narra
// y no ejecuta»: sin ver la salida cruda del modelo en la
// máquina del usuario, cada arreglo era una apuesta. El
// registro nunca tumba un turno: todo va en try/catch y si el
// archivo crece más de ~3 MB deja de escribir.
// ============================================================
const fs = require("node:fs");
const path = require("node:path");

const TOPE_BYTES = 3_000_000;

function crearRegistro(projectRoot) {
  const raiz = typeof projectRoot === "string" && projectRoot ? projectRoot : "";
  const archivo = raiz ? path.join(raiz, ".editcore", "turnos.jsonl") : "";
  const anotar = (evento) => {
    if (!archivo) return;
    try {
      try {
        if (fs.statSync(archivo).size > TOPE_BYTES) return;
      } catch { /* aún no existe: se crea abajo */ }
      fs.mkdirSync(path.dirname(archivo), { recursive: true });
      fs.appendFileSync(archivo, `${JSON.stringify({ ts: new Date().toISOString(), ...evento })}\n`, "utf8");
    } catch { /* diagnosticar nunca tumba el turno */ }
  };
  return { anotar, archivo };
}

module.exports = { crearRegistro };
