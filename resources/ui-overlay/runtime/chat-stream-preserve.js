"use strict";

/**
 * Evita que el chat de EditCore "comprima" o borre un informe largo
 * al llegar un fragmento corto (permiso, stop, grounded hueco, etc.).
 *
 * Regla de raíz: los "### Avance" son progreso de herramientas, NUNCA el
 * reporte final. El informe de analisis (hallazgos + plan) siempre gana.
 */

(function exposeChatStreamPreserve(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreChatStreamPreserve = api;
})(typeof window !== "undefined" ? window : globalThis, function createChatStreamPreserve() {
  function isGroundedAnalysisReportText(text = "") {
    const raw = String(text || "");
    return /##\s*(?:Qué|Que)\s+sí\s+funcionó/i.test(raw)
      && /##\s*(?:Qué|Que)\s+fall[oó]/i.test(raw)
      && /##\s*Evidencia/i.test(raw);
  }

  function looksLikeAnalysisStreamChunk(text = "") {
    const raw = String(text || "");
    if (raw.length < 120) return false;
    return /##\s*(?:Qué|Que)\s+sí\s+funcionó|##\s*(?:Qué|Que)\s+fall[oó]|##\s*Evidencia|##\s*C[oó]mo\s+lo\s+corregir|Cuando autorices procedo|REPORTE\s+DE\s+AN[AÁ]LISIS|##\s*An[aá]lisis\s+del\s+proyecto/i.test(raw);
  }

  /** Progreso incremental de tools (### Avance), no el informe final. */
  function isAvanceProgressOnly(text = "") {
    const raw = String(text || "").trim();
    if (!raw) return false;
    if (isGroundedAnalysisReportText(raw) || looksLikeAnalysisStreamChunk(raw)) return false;
    const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    if (!blocks.length) return false;
    const avanceBlocks = blocks.filter((b) => /^#{1,6}\s*Avance\b/i.test(b));
    if (!avanceBlocks.length) return false;
    return avanceBlocks.length >= Math.ceil(blocks.length * 0.55);
  }

  function isThinFinalFragment(text = "") {
    const raw = String(text || "").trim();
    if (!raw) return true;
    if (isAvanceProgressOnly(raw)) return true;
    if (raw.length < 140) return true;
    if (/Se descart[oó] la narraci[oó]n/i.test(raw)) return true;
    if (/^##\s*(?:Resultado|Permiso|Escritura)\b/i.test(raw) && raw.length < 700) return true;
    if (/no se modific[oó] ning[uú]n archivo/i.test(raw) && raw.length < 900 && !isGroundedAnalysisReportText(raw)) {
      return true;
    }
    if (/escritura no disponible|write_file ni replace_in_file|unicamente est[aá] disponible read_file/i.test(raw)
      && raw.length < 1200
      && !isGroundedAnalysisReportText(raw)) {
      return true;
    }
    return false;
  }

  function isGarbledAgentNarration(text = "") {
    const raw = String(text || "");
    if (!raw.trim()) return false;
    if (/\*\*[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]{2,24}\s*$/m.test(raw.trim()) && raw.length < 2500) return true;
    if (/Bas[aá]ndome en los \d+ archivos/i.test(raw) && !/##\s*(?:Qué|Que)\s+sí\s+funcionó/i.test(raw)) return true;
    if (/[a-záéíóúñ]{2,}(?:pa|de|con|el|la|un|en|del|pac)[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}/.test(raw)) return true;
    if (/\bEntendido\b/i.test(raw) && /\b(?:Ya (?:entregu[eé]|complet)|He presentado)\b/i.test(raw) && raw.length < 4000) return true;
    if ((raw.match(/\bEntendido\b/gi) || []).length >= 2) return true;
    if (raw.length < 400) return false;
    const entendidos = (raw.match(/\bEntendido\b/gi) || []).length;
    const tienes = (raw.match(/\bTienes raz[oó]n\b/gi) || []).length;
    const reconozco = (raw.match(/\bReconozco\b/gi) || []).length;
    if (entendidos + tienes + reconozco >= 5) return true;
    if (raw.length > 6000 && (entendidos + tienes) >= 3) return true;
    return false;
  }

  /**
   * Elige el texto final del chat: informe de hallazgos/plan siempre sobre Avances.
   */
  function pickBestFinalChatText(serverText = "", streamed = "", narrativeFallback = "") {
    const server = String(serverText || "").trim();
    const stream = String(streamed || "").trim();
    const narrative = String(narrativeFallback || "").trim();

    // Deber ser del agente: el reporte del orquestador (hallazgos + correcciones) gana.
    if (server && !isAvanceProgressOnly(server)) {
      if (isGroundedAnalysisReportText(server) || looksLikeAnalysisStreamChunk(server) || server.length >= 200) {
        return server;
      }
    }

    const candidates = [server, stream, narrative]
      .map((item) => String(item || "").trim())
      .filter((item) => item && !isAvanceProgressOnly(item));
    if (!candidates.length) {
      // Solo habia Avances: no inventar cierre; el caller debe usar result.text / fallback.
      return server && !isAvanceProgressOnly(server) ? server : "";
    }

    const grounded = candidates.filter(isGroundedAnalysisReportText);
    if (grounded.length) {
      return grounded.sort((a, b) => b.length - a.length)[0];
    }

    const awaiting = candidates.filter((item) => (
      /Cuando autorices procedo/i.test(item) && item.length >= 200
    ));
    if (awaiting.length) {
      return awaiting.sort((a, b) => b.length - a.length)[0];
    }

    const substantial = candidates.filter((item) => !isThinFinalFragment(item));
    if (substantial.length) {
      return substantial.sort((a, b) => b.length - a.length)[0];
    }

    return candidates.sort((a, b) => b.length - a.length)[0];
  }

  /**
   * true = conservar prev; false = aceptar incoming.
   */
  function shouldKeepExistingStream(prev = "", incoming = "") {
    const before = String(prev || "");
    const next = String(incoming || "");
    if (!before || !next) return false;
    if (next.length >= before.length) return false;
    if (before.length < 220) return false;

    // Informe completo esperando auth: no lo pises con un fragmento.
    if (/Cuando autorices procedo/i.test(before) && before.length >= 400 && looksLikeAnalysisStreamChunk(before)) {
      if (!(next.includes(before.slice(0, Math.min(96, before.length))) && next.length >= before.length * 0.95)) {
        return true;
      }
    }

    // Incoming mucho más corto → conservar lo ya escrito (salvo limpieza clara de basura).
    if (next.length < before.length * 0.7) {
      if (isGarbledAgentNarration(before) && !isGarbledAgentNarration(next) && looksLikeAnalysisStreamChunk(next) && next.length >= 300) {
        return false;
      }
      if (isThinFinalFragment(next)) return true;
      return true;
    }
    return false;
  }

  return {
    isGroundedAnalysisReportText,
    looksLikeAnalysisStreamChunk,
    isAvanceProgressOnly,
    isThinFinalFragment,
    isGarbledAgentNarration,
    pickBestFinalChatText,
    shouldKeepExistingStream,
  };
});
