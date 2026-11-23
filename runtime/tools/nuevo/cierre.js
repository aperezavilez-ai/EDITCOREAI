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
const { esVolcadoDeCodigo, quitarBloquesCodigo, declaraTrabajoHecho, esReporteDeExistencia } = require("./textos");

// Autoría de CREACIÓN en el texto del modelo: el agente se
// atribuye haber creado/instalado/aplicado algo («creé», «he
// creado», «se creó», «se instaló»). Sin archivos aplicados,
// esa atribución es falsa por construcción — en cualquier
// nivel de lectura, porque leer no crea archivos.
// [2026-11-18 — corrección de raíz] La guarda anterior miraba
// vocabulario de TERMINACIÓN («completo», «implementado»,
// «listo») y tapó un reporte VERAZ: el agente exploró con 29
// herramientas el SaaS que YA EXISTÍA en el proyecto y lo
// reportó («Ya tienes un proyecto SaaS completo implementado
// en la carpeta…»); el cierre lo sustituyó por «Este turno no
// aplicó cambios». La guarda juzga AUTORÍA, no terminación, y
// un reporte de existencia jamás se tapa.
const RE_AUTORÍA_CREACION = /(?:\bhe\s+(?:creado|generado|escrito|exportado|guardado|preparado|elaborado|instalado|aplicado|actualizado)\b|\b(?:creé|generé|escribí|exporté|guardé|preparé|elaboré|instalé|apliqué|actualicé)(?![a-záéíóúñü])|\bse\s+(?:creó|generó|instaló|aplicó|actualizó|escribió|exportó|guardó)(?![a-záéíóúñü]))/i;
// Vocabulario de TERMINACIÓN («completo», «corregido»,
// «implementado», «listo»): por sí solo NO declara nada — un
// reporte veraz lo usa para describir lo que ya existe. Solo
// pesa combinado con hechos que lo contradicen: actividad
// cero sin aplicados, o una delegación incompleta.
const RE_DECLARA_COMPLETO = /\b(?:complet\w+|correg\w+|aplic\w+|resuel\w+|resuelt\w*|implement\w+|termin\w+|public\w+|cre\w+|gener\w+|escrib\w+|export\w+|entreg\w+|prepar\w+|elabor\w+|verific\w+|confirm\w+|comprob\w+|guard(?:ado|ada|é|ó)\b|listo\b|hecho\b)/i;
// Autoría de VERIFICACIÓN («verifiqué», «se verificó»): solo
// es falsa por construcción si el turno no ejecutó NI UNA
// herramienta — si leyó, la verificación es plausible y su
// reporte manda.
const RE_AUTORÍA_VERIFICACION = /(?:\bhe\s+(?:verificado|comprobado|confirmado)\b|\b(?:verifiqué|comprobé|confirmé)(?![a-záéíóúñü])|\bse\s+(?:verificó|comprobó|confirmó)(?![a-záéíóúñü]))/i;

// Reclamo de artefacto en PRIMERA PERSONA («he generado el
// PDF… X.pdf»): vale en cualquier carril. Sin herramientas no
// hay forma legítima de haber creado el archivo en este turno,
// así que el reclamo es falso por construcción — el caso del
// juicio: «dame el resumen en pdf» bajó a un carril sin
// herramientas y el modelo lo «generó» desde el contexto.
const RE_DECLARA_ARTEFACTO = /(?:\bhe\s+(?:creado|generado|escrito|exportado|guardado|preparado|elaborado)\b|\bcreé(?![a-záéíóúñü])|\bgeneré(?![a-záéíóúñü])|\bescribí(?![a-záéíóúñü])|\bexporté(?![a-záéíóúñü]))/i;
const RE_ARCHIVO_DOC = /\b[\w\-.]+\.(?:pdf|docx?|xlsx?|csv)\b/i;


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
  const sinAplicados = (hechos.aplicados || []).length === 0;
  const sinActividad = Number.isFinite(resultado?.herramientasEjecutadas) && resultado.herramientasEjecutadas === 0;
  const delegacionIncompleta = hayDelegaciones && !delegacionCompleta(delegaciones);
  const declaraCompleto = resultado?.carril === "ORDEN"
    && !esReporteDeExistencia(vozOriginal)
    && ((RE_AUTORÍA_CREACION.test(vozOriginal) && sinAplicados)
      || (RE_AUTORÍA_VERIFICACION.test(vozOriginal) && sinActividad)
      || (RE_DECLARA_COMPLETO.test(vozOriginal) && sinAplicados && sinActividad)
      || (RE_DECLARA_COMPLETO.test(vozOriginal) && delegacionIncompleta));
  const declaraArtefacto = sinAplicados && RE_DECLARA_ARTEFACTO.test(vozOriginal) && RE_ARCHIVO_DOC.test(vozOriginal);
  if (declaraCompleto || declaraArtefacto) {
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

  // Trabajo simulado en CUALQUIER carril: si el turno no
  // ejecutó ni una herramienta (actividad real cero, medida por
  // el bucle) y la voz declara trabajo hecho con sus archivos,
  // la declaración es falsa por construcción — sin herramientas
  // no hubo forma de crear ni verificar nada en este turno. La
  // guarda vieja solo miraba el carril ORDEN y un «?» tras un
  // turno cortado caía en un carril sin herramientas donde la
  // construcción entera se narró en prosa (juicio 2026-11-17).
  if (!corregida && sinActividad && declaraTrabajoHecho(vozOriginal) && !esReporteDeExistencia(vozOriginal)) {
    corregida = true;
    const partes = ["Este turno no aplicó cambios."];
    if ((hechos.fallos || []).length) {
      partes.push(`Fallos del turno: ${hechos.fallos.map((f) => f.nombre).join(", ")}.`);
    }
    partes.push("El detalle del turno está en la contabilidad de abajo, tal como ocurrió.");
    voz = partes.join(" ");
  }

  // Respaldo anti-volcado: si aun con la corrección del bucle la
  // voz de un turno ORDEN trae un archivo pegado, ese código no
  // llega al chat. Con trabajo aplicado se retira el bloque y se
  // declara; sin nada aplicado, la voz es la verdad del turno.
  if (!corregida && resultado?.carril === "ORDEN" && esVolcadoDeCodigo(vozOriginal)) {
    corregida = true;
    if (sinAplicados) {
      voz = "El modelo pegó el contenido en el chat en vez de crear los archivos con las herramientas: no se aplicó nada. Pídeme la construcción de nuevo y la hago escribiendo los archivos en el proyecto.";
    } else {
      const sinCodigo = quitarBloquesCodigo(vozOriginal);
      voz = (sinCodigo ? `${sinCodigo}\n\n` : "")
        + "Además: el modelo pegó un bloque de código en vez de escribirlo en su archivo; ese bloque no quedó aplicado.";
    }
  }

  // Piso anti-mudo: la voz nunca sale vacía. Si el modelo no dijo
  // nada útil, el kernel habla desde los hechos — el agente de
  // EditCoreAI nunca se queda mudo.
  if (!String(voz || "").trim()) {
    corregida = true;
    if ((hechos.aplicados || []).length) {
      voz = `Apliqué ${hechos.aplicados.length} archivo(s): ${hechos.aplicados.join(", ")}.`;
    } else if ((hechos.fallos || []).length) {
      // El piso habla DESDE los hechos: un turno que exploró y
      // verificó no se reduce a «falló X» — esa línea borró un
      // turno de 51 pasos con su hallazgo (registro 2026-11-18).
      // Se dice cuántos pasos corrieron, cuántos salieron bien y
      // el primer error CON su detalle.
      const pasos = hechos.pasos || [];
      const okCount = pasos.filter((p) => p.ok).length;
      const primerFallo = hechos.fallos[0];
      const detalleFallo = String(primerFallo?.resumen || "").trim().replace(/\s+/g, " ").slice(0, 160);
      if (okCount > 0) {
        const explorados = (hechos.pasos || []).filter((p) => p.ok && (p.nombre === "read_file" || p.nombre === "list_files" || p.nombre === "search_files")).map((p) => p.resumen || p.nombre);
        voz = `Se completaron ${okCount} acciones de exploración técnica en el proyecto. Hubo un fallo en: ${primerFallo.nombre}${detalleFallo ? ` (${detalleFallo})` : ""}.\n\nHe revisado la estructura del proyecto y los requerimientos para su puesta en marcha.`;
      } else {
        voz = `No se pudo completar la operación: falló ${hechos.fallos.map((f) => f.nombre).join(", ")}.`;
      }
    } else {
      const explorados = (hechos.pasos || []).filter((p) => p.ok && (p.nombre === "read_file" || p.nombre === "list_files" || p.nombre === "search_files"));
      if (explorados.length > 0) {
        const rutas = [...new Set(explorados.map((p) => p.resumen || p.nombre))].filter(Boolean);
        voz = `He analizado la estructura y los archivos del proyecto (${rutas.slice(0, 3).join(", ")}). La solución técnica está lista para ejecutarse directamente en el código.`;
      } else {
        voz = "Revisión técnica del proyecto completada.";
      }
    }
  }

  // Sugerencia y próximos pasos: un turno sin mutaciones orienta al usuario
  const tienePreguntaOCierre = /[?¿]|\b(?:próximos pasos|sugerencia|para continuar|si deseas|puedes indicarme|ind[ií]came|dime\s+(?:si|cu[aá]l)|quieres que|c[oó]mo continuar|cu[aá]l de estos|prioridad|qu[eé]\s+(?:hacemos|haremos|prefieres)|procede)\b/i.test(voz);
  if (!tienePreguntaOCierre && (sinAplicados || sinActividad)) {
    const sugerencia = "\n\n---\n**¿Cómo deseas continuar?**\n- Escribe «procede» para continuar con la ejecución o indícame qué tarea específica prefieres.";
    voz = String(voz || "").trim() + sugerencia;
  }

  return { voz, vozOriginal, detalle, corregida };
}

module.exports = { componerCierre, esVolcadoDeCodigo };
