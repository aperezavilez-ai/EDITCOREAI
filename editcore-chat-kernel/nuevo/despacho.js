"use strict";
// ============================================================
// KERNEL NUEVO — DESPACHO POR CARRILES
// La decisión se toma por la FORMA del mensaje (qué pide el
// usuario que haga el agente), nunca por sustantivos sueltos:
// el clasificador viejo convertía cualquier mensaje que
// contuviera «analisis» en una tarea de análisis, incluida la
// pregunta «¿realizaste el analisis o leiste uno ajeno?».
//
// Carriles (especificación de conducta del producto):
//   CONVERSACION  pregunta o duda      -> responder, sin herramientas
//   PROPUESTA     propuesta solicitada -> proponer, sin ejecutar
//   CONSULTA      dato puntual de código -> lectura dirigida, sin escribir
//   ORDEN         orden de trabajo     -> proceder, set completo
// Ante la duda entre conversar y ejecutar, manda conversar:
// ejecutar por error cuesta tokens y toca archivos; responder
// por error solo cuesta una frase, y la respuesta misma puede
// proponer la acción.
// ============================================================

// Propuesta pedida explícitamente.
const RE_PROPUESTA = /(?:qu[eé]\s+(?:me\s+)?propones|tu\s+(?:mejor\s+)?propuesta|dame\s+(?:una\s+)?propuesta|prop[oó]n(?:me|e)\b|qu[eé]\s+sugieres|cu[aá]l\s+ser[ií]a\s+tu\s+plan)/i;

// Aprobación corta para continuar lo ya planteado.
const RE_APROBACION = /^\s*(?:s[ií][,.]?\s*)?(?:procede|adelante|hazlo|dale|va)\b/i;

// Orden amable: «¿puedes corregir…?», «necesito que agregues…».
const RE_PEDIDO_AMABLE = /\b(?:puedes|podr[ií]as|necesito\s+que|quiero\s+que|te\s+pido\s+que)\s+(?:corr\w*|arregl\w*|repar\w*|solucion\w*|implement\w*|aplic\w*|cre\w*|gener\w*|escrib\w*|modific\w*|actualiz\w*|agreg\w*|a[ñn]ad\w*|elimin\w*|borr\w*|public\w*|ejecut\w*|reemplaz\w*|instal\w*|configur\w*)/i;

// Verbo de trabajo al inicio del mensaje (imperativo directo).
const RE_ORDEN_INICIO = /^\s*(?:por\s+favor\s+)?(?:corr[ií]j\w*|corrig\w*|arregl\w*|repar\w*|solucion\w*|implement\w*|aplic\w*|crea(?:r|me|lo|la)?\b|cre[aá]\b|genera(?:r)?\b|gener[aá]\b|escrib\w*|modific\w*|actualiz\w*|agreg\w*|a[ñn]ad\w*|elimin\w*|borr\w*|public\w*|despleg\w*|ejecut\w*|reemplaz\w*|haz(?:me|lo|la)?\b|constru\w*|instal\w*|configur\w*|sigue\b|contin[uú]a\b)/i;

// Pedido de un producto de trabajo: «hazme/quiero/dame … análisis/informe/…».
// [v5.2.7 — corrección] «dame el resumen en pdf» caía fuera: ni
// «resumen» ni los formatos de documento estaban en la lista, el
// turno bajaba a CONVERSACION sin herramientas y el modelo
// «creaba» el PDF de palabra. Un entregable pedido ES una orden.
const RE_PEDIDO_TRABAJO = /\b(?:hazme|dame|quiero|necesito|elab[oó]rame|prep[aá]rame)\b[^.?!]*\b(?:an[aá]lisis|informe|reporte|auditor[ií]a|diagn[oó]stico|documento|lista|resumen|archivo|pdf|word|excel|csv|presentaci[oó]n|tabla)\b/i;

// Pregunta sobre lo que el propio agente hizo o dijo (meta-conversación):
// «realizaste X o leiste Y», «no es lo que te pedí», «por qué no respondes».
const RE_PREGUNTA_META = /\b(?:realizaste|le[ií]ste|hiciste|dijiste|escribiste|generaste|aplicaste)\b[^.?!]*\b(?:o|u)\b/i;
const RE_RECLAMO = /no\s+es\s+lo\s+que\s+te\s+ped[ií]|no\s+te\s+ped[ií]\s+eso|por\s*qu[eé]\s+no\s+(?:me\s+)?respond\w*/i;

// Forma interrogativa.
const RE_INTERROGATIVA = /(?:^|[¿\s])(?:qu[eé]|cu[aá]l(?:es)?|c[oó]mo|d[oó]nde|por\s*qu[eé]|qui[eé]n(?:es)?|cu[aá]ndo|cu[aá]nto)\b/i;

// Consulta puntual de código: pide localizar algo concreto.
const RE_CONSULTA_LOCALIZA = /\b(?:d[oó]nde\s+est[aá]|en\s+qu[eé]\s+archivo|busca(?:r)?\b|encuentra\b|localiza\b)/i;
const RE_ENTIDAD_CODIGO = /(?:`[^`]+`|\b[\w/\\-]+\.(?:js|jsx|ts|tsx|mjs|json)\b|\b(?:funci[oó]n|m[eé]todo|variable|constante|clase)\s+[\w$.]+)/i;
const RE_LISTADO = /^\s*(?:lista|listar|mu[eé]strame|muestra|enumera)\b/i;

// Continuación corta tras una oferta de ejecución: el turno
// anterior del asistente cerró ofreciendo ejecutar (una
// propuesta «¿te parece bien?», unas opciones numeradas, un
// «dime reintenta») y el usuario responde la selección o el
// asentimiento pelado («1», «sí», «ok», «reintenta»). Sin esta
// regla la respuesta cae a CONVERSACION — sin herramientas — y
// el trabajo ofrecido jamás se ejecuta: el agente «contesta»
// en vez de construir (visto en vivo tras un fallo de motor:
// «1» y «ok» no construyeron nada).
const RE_OFERTA_EJECUCION = /(?:¿te parece bien|tu aprobaci[oó]n|¿procedo\b|opci[oó]n\s*\d|¿cu[aá]l prefieres|dime\s*["'«]?reintenta|si es la opci[oó]n\s*\d|quieres que (?:lo )?(?:reintent|proced|constru|cree))/i;
const RE_CONTINUACION_CORTA = /^\s*(?:\d{1,2}|s[ií]|ok|va|dale|procede|adelante|hazlo|sigue|contin[uú]a|reintenta(?:lo)?|de acuerdo|perfecto|claro|sale|bueno)[.!… ]*$/i;

// El turno anterior quedó EN EJECUCIÓN: su texto narra pasos de
// trabajo (revisando, creando, «antes de crear…») — típicamente
// porque el turno se cortó a mitad de la narración y el usuario
// pregunta «?» o dice «sigue». Sin contexto de oferta, esa
// continuación corta también es ORDEN: caer en un carril sin
// herramientas dejaba al modelo narrando la construcción en
// prosa, sin ejecutar nada (juicio 2026-11-17).
const RE_NARRACION_EJECUCION = /(?:revisando|verificando|creando|instalando|aplicando|listando|comprobando|explorando|antes de (?:crear|verificar|revisar)|voy a (?:crear|verificar|revisar|instalar|aplicar))/i;

function contextoDesdeHistorial(historial) {
  const lista = Array.isArray(historial) ? historial : [];
  for (let i = lista.length - 1; i >= 0; i--) {
    const m = lista[i];
    if (!m || m.role !== "assistant") continue;
    const contenido = typeof m.content === "string" ? m.content : "";
    return { respuestaAOferta: RE_OFERTA_EJECUCION.test(contenido), enEjecucion: RE_NARRACION_EJECUCION.test(contenido) };
  }
  return { respuestaAOferta: false, enEjecucion: false };
}

function decidirTurno(texto, contexto = {}) {
  const t = String(texto || "").trim();
  if (!t) {
    return { carril: "CONVERSACION", herramientas: "ninguna", puedeEscribir: false, motivo: "mensaje_vacio" };
  }
  if (contexto && contexto.respuestaAOferta && t.length <= 24 && RE_CONTINUACION_CORTA.test(t)) {
    return { carril: "ORDEN", herramientas: "completa", puedeEscribir: true, motivo: "continuacion_aprobada" };
  }
  if (contexto && contexto.enEjecucion && t.length <= 24 && (RE_CONTINUACION_CORTA.test(t) || /^[?¿]+$/.test(t))) {
    return { carril: "ORDEN", herramientas: "completa", puedeEscribir: true, motivo: "continuacion_tras_corte" };
  }
  // La orden manda sobre la mención de «propuesta»: un encargo de
  // trabajo puede pedir la propuesta COMO ENTREGABLE («hazme un
  // análisis… y dame un reporte con tu propuesta») y sigue siendo
  // una orden. PROPUESTA es solo cuando proponer es lo único pedido.
  if (RE_APROBACION.test(t) || RE_PEDIDO_AMABLE.test(t) || RE_ORDEN_INICIO.test(t) || RE_PEDIDO_TRABAJO.test(t)) {
    return { carril: "ORDEN", herramientas: "completa", puedeEscribir: true, motivo: "orden_de_trabajo" };
  }
  if (RE_PROPUESTA.test(t)) {
    return { carril: "PROPUESTA", herramientas: "ninguna", puedeEscribir: false, motivo: "propuesta_solicitada" };
  }
  if (RE_LISTADO.test(t) || (RE_CONSULTA_LOCALIZA.test(t) && RE_ENTIDAD_CODIGO.test(t))) {
    return { carril: "CONSULTA", herramientas: "lectura-dirigida", puedeEscribir: false, motivo: "consulta_de_codigo" };
  }
  const esPregunta = /[¿?]/.test(t) || RE_INTERROGATIVA.test(t) || RE_PREGUNTA_META.test(t) || RE_RECLAMO.test(t);
  if (esPregunta) {
    return { carril: "CONVERSACION", herramientas: "ninguna", puedeEscribir: false, motivo: "pregunta" };
  }
  // Declarativo sin orden (un reporte, un dato, un agradecimiento):
  // se conversa; la respuesta puede proponer la acción que siga.
  return { carril: "CONVERSACION", herramientas: "ninguna", puedeEscribir: false, motivo: "declarativo_sin_orden" };
}

module.exports = { decidirTurno, contextoDesdeHistorial };
