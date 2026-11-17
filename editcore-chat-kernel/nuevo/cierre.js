"use strict";
// ============================================================
// KERNEL NUEVO — CIERRE Y PRESENTACIÓN DESDE HECHOS
// La superficie muestra DOS cosas separadas que no se mezclan:
//   voz     — el texto del agente, primero, como en un chat.
//   detalle — la contabilidad del turno, construida SOLO desde
//             los hechos del kernel (resumen del bucle + línea
//             de auditoría de subagentes). La prosa del modelo
//             jamás entra al detalle: ahí nacieron los
//             descuadres de cifras del chat forense.
// Y la guarda que el kernel viejo no tenía (su
// groundUngroundedClaims nunca contrastaba lo delegado): en un
// turno de ORDEN, si la voz declara trabajo completado que los
// hechos no registran — sin aplicados, o con subagentes sin
// entregar — esa voz no se publica. El cierre lo genera el
// kernel desde los hechos y el texto original queda en
// vozOriginal, a la vista para auditoría.
// ============================================================
const { lineaAuditoria, delegacionCompleta } = require("./subagentes");

// Declaración de trabajo terminado (no una mención histórica:
// esto solo se evalúa en el carril ORDEN, donde el texto del
// modelo ES el cierre del trabajo del turno).
const RE_DECLARA_COMPLETO = /\b(?:complet\w+|correg\w+|aplic\w+|resuel\w+|resuelt\w*|implement\w+|termin\w+|public\w+|listo\b|hecho\b)/i;

function componerCierre({ resultado, delegaciones = null }) {
  const hechos = resultado?.hechos || { aplicados: [], fallos: [], denegadas: [] };
  const vozOriginal = String(resultado?.textoFinal || "");

  let detalle = String(resultado?.resumen || "");
  const hayDelegaciones = Array.isArray(delegaciones) && delegaciones.length > 0;
  if (hayDelegaciones) {
    detalle = detalle ? `${detalle}\n${lineaAuditoria(delegaciones)}` : lineaAuditoria(delegaciones);
  }

  let corregida = false;
  let voz = vozOriginal;
  if (resultado?.carril === "ORDEN" && RE_DECLARA_COMPLETO.test(vozOriginal)) {
    const sinAplicados = (hechos.aplicados || []).length === 0;
    const delegacionIncompleta = hayDelegaciones && !delegacionCompleta(delegaciones);
    if (sinAplicados || delegacionIncompleta) {
      corregida = true;
      const partes = [];
      if (sinAplicados) partes.push("Este turno no aplicó cambios.");
      if (delegacionIncompleta) {
        const faltantes = delegaciones.filter((d) => !d.entrego).map((d) => d.id);
        partes.push(`Quedó trabajo delegado sin entregar: ${faltantes.join(", ")}. Esa parte no está hecha.`);
      }
      if ((hechos.fallos || []).length) {
        partes.push(`Fallos del turno: ${hechos.fallos.map((f) => f.nombre).join(", ")}.`);
      }
      partes.push("El detalle del turno está en la contabilidad de abajo, tal como ocurrió.");
      voz = partes.join(" ");
    }
  }

  return { voz, vozOriginal, detalle, corregida };
}

module.exports = { componerCierre };
