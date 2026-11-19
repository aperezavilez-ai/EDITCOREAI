"use strict";
// ============================================================
// KERNEL NUEVO — TEXTOS E IDENTIDAD
// El agente es EditCoreAI. Sus reglas son las reglas de
// EditCoreAI: las enuncia como suyas, en primera persona, y
// ningún texto del producto nombra a una persona como autora
// de esas reglas. (El kernel viejo cerraba sus rendiciones
// atribuyendo la regla de avance al dueño por su nombre: una
// persona cableada en la superficie de un producto.)
// ============================================================

const SISTEMA_NUCLEO = [
  "Eres el agente y asistente de EditCoreAI, un IDE integrado. Trabajas dentro del proyecto abierto del usuario y conversas en su idioma con tono natural, ágil y profesional.",
  "Mis reglas de conducta fundamentales son:",
  "- Si el usuario hace una PREGUNTA, CONSULTA CONCEPTUAL O DUDA: Respondo directamente en lenguaje natural desde mi conocimiento y el contexto del chat. CERO herramientas de archivo o terminal. Si ayuda ilustrar la explicación, muestro código de ejemplo en bloques markdown dentro del chat.",
  "- Si el usuario envía un REQUERIMIENTO NUEVO, PROMPT COMPLETO O SOLICITUD DE DESARROLLO (y aún no ha dicho «procede»):",
  "  1. Explico con claridad qué entendí del requerimiento.",
  "  2. Presento mi PROPUESTA ESTRUCTURADA de acciones concretas: qué archivos crearé o modificaré en la raíz del proyecto y qué pasos seguiré.",
  "  3. Pregunto claramente: «¿Deseas que proceda con estos cambios?» y me DETENGO por completo. NO ejecuto herramientas de escritura hasta recibir la confirmación de procede.",
  "- Si el usuario envía una APROBACIÓN EXPLÍCITA («procede», «adelante», «hazlo», «dale»): Procedo de inmediato y ejecuto con las herramientas sobre la raíz del proyecto abierto, verifico lo aplicado y cierro con los hechos reales del turno.",
  "- Nunca me quedo mudo: si algo no se puede, lo digo con la causa y la alternativa.",
  "- La memoria del proyecto (Mapa y Cerebro) es material de referencia: nunca atribuyo al usuario frases que no escribió en este chat.",
  "- Los archivos los creo con las herramientas, en la raíz del proyecto abierto (una subcarpeta solo si el usuario la pide): nunca pego el contenido de un archivo en el chat ni le pido al usuario que lo copie a mano.",
  "- Mi cierre sale de los hechos: lo aplicado, lo que falló y lo que quedó sin hacer, sin adornar.",
  "- Nunca describo como hecho un trabajo que no ejecuté con herramientas en este turno: narrar pasos no es ejecutarlos.",
  "- Tengo terminal (run_command): puedo instalar dependencias y ejecutar comandos en el turno de ejecución.",
  "- Si una herramienta o un comando falla, leo el error y cambio el curso.",
  "- Antes de cerrar un trabajo como hecho, lo verifico: afirmar sin verificar no es cerrar.",
].join("\n");

function textoRendicion({ pasosSinAplicar = 0, tokensEnVueltas = 0, pasosAplicados = 0, tokensAplicados = 0 } = {}) {
  return [
    "Detengo este turno por mi regla de avance de EditCoreAI: ningún turno consume tokens sin convertirlos en algo aplicado. La cuenta del turno:",
    `- Pasos sin aplicar nada: ${pasosSinAplicar} (${tokensEnVueltas} tokens en vueltas).`,
    `- Pasos que sí aplicaron: ${pasosAplicados} (${tokensAplicados} tokens).`,
    "El siguiente turno arranca limpio desde esta misma orden, sin repetir lo ya explorado.",
  ].join("\n");
}


// Volcado de código: el modelo pega el contenido de un archivo
// en el chat (un bloque cercado grande) en vez de crearlo con
// las herramientas. Un ejemplo corto (una orden, dos líneas) es
// conversación legítima; un archivo entero no. Caso real:
// «sistemas contino» — el package.json llegó pegado en el chat
// y el proyecto nunca se escribió. Vive aquí, en la hoja sin
// dependencias, porque turno.js y cierre.js lo comparten y
// cierre participa en un ciclo de requires con turno.
function bloquesCodigo(texto) {
  const bloques = [];
  const re = /```[^\n]*\n([\s\S]*?)(?:```|$)/g;
  let m;
  while ((m = re.exec(String(texto || "")))) bloques.push(m[1]);
  return bloques;
}

function esVolcadoDeCodigo(texto) {
  const bloques = bloquesCodigo(texto);
  if (!bloques.length) return false;
  let chars = 0;
  let lineas = 0;
  for (const b of bloques) {
    chars += b.length;
    lineas += b.split("\n").length;
    // Un JSON completo y válido (un package.json compacto son
    // ~8 líneas y 400 caracteres) ES un archivo volcado aunque
    // no llegue a los topes de tamaño: nadie conversa pegando
    // la configuración entera; eso se escribe con write_file.
    const limpio = b.trim();
    if (limpio.length >= 120 && limpio.startsWith("{") && limpio.endsWith("}")) {
      try {
        const obj = JSON.parse(limpio);
        if (obj && typeof obj === "object" && Object.keys(obj).length >= 3) return true;
      } catch { /* no es JSON completo: manda el tamaño */ }
    }
  }
  return chars >= 1000 || lineas >= 20;
}

function quitarBloquesCodigo(texto) {
  return String(texto || "")
    .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Trabajo declarado como HECHO sin ejecutarlo: el texto afirma
// en pasado que algo se creó/verificó/instaló y nombra los
// archivos «resultantes». Es el detector del trabajo simulado
// (juicio 2026-11-17: una construcción entera narrada en prosa
// con cero herramientas ejecutadas). Dos candados contra falsos
// positivos: el verbo va en pasado consumado (el futuro «voy a
// crear» y el condicional de una propuesta no cuentan) y hacen
// falta al menos dos menciones de archivo (una pregunta como
// «¿tienes un proyecto base ya creado?» no declara nada).
const RE_TRABAJO_HECHO = /(?:\bse\s+(?:creó|generó|verificó|confirmó|comprobó|instaló|aplicó|actualizó|escribió)|\b(?:creé|generé|verifiqué|confirmé|comprobé|instalé|apliqué|actualicé|escribí)(?![a-záéíóúñü])|\bhe\s+(?:creado|generado|verificado|confirmado|comprobado|instalado|aplicado|actualizado|escrito)\b|\b(?:archivo|archivos|estructura|configuración|cambios|módulo|módulos|componente|componentes|página|páginas|ruta|rutas)\s+(?:creados?|creadas?|generados?|generadas?|verificados?|verificadas?|instalados?|instaladas?|aplicados?|aplicadas?|actualizados?|actualizadas?)\b)/i;
const RE_MENCION_ARCHIVO = /(?:[\w.-]+\/)*[\w.-]+\.(?:json|ts|tsx|js|jsx|mjs|cjs|css|html|md|prisma)\b|\.env(?:\.[\w]+)?\b/g;
function declaraTrabajoHecho(texto) {
  const t = String(texto || "");
  if (!RE_TRABAJO_HECHO.test(t)) return false;
  return (t.match(RE_MENCION_ARCHIVO) || []).length >= 2;
}

// Reporte de EXISTENCIA: el texto presenta el trabajo como algo
// que YA está en el proyecto («ya tienes un proyecto… completo
// implementado en la carpeta X», «ya existe», «ya cuenta con»).
// Eso es un hallazgo que se reporta, no una autoría que se
// reclama: las guardas contra trabajo simulado no deben
// taparlo (registro en vivo 2026-11-18: el agente exploró el
// SaaS ya existente y su reporte veraz fue sustituido por
// «Este turno no aplicó cambios»).
const RE_YA_EXISTE = /\bya\s+(?:tienes|existe|está|hay|se encuentra|cuenta(?:s)? con|tenías|estaba|estaban)\b|\bproyecto\s+ya\s+(?:creado|implementado|construido)\b/i;
function esReporteDeExistencia(texto) {
  return RE_YA_EXISTE.test(String(texto || ""));
}

// Trabajo ANUNCIADO: el texto promete en primera persona y en
// futuro inmediato el trabajo que el turno debía ejecutar
// («Voy a revisar primero…», «Déjame explorar la estructura»,
// registro 2026-11-18T19:57Z: la orden del SaaS cerró con la
// promesa y 0 ejecuciones). Se juzga frase a frase: una frase
// que PREGUNTA («¿quieres que revise…?») es una consulta al
// usuario, no una promesa; y describir trabajo futuro dentro
// de una PROPUESTA es la entrega misma — esa distinción la
// hace el llamador (en PROPUESTA no se corrige el anuncio).
const RE_ANUNCIO_VERBO = "(?:revisar|explorar|crear|construir|generar|implementar|armar|montar|escribir|leer|buscar|verificar|corregir|arreglar|instalar|configurar|analizar|empezar|comenzar)";
const RE_ANUNCIO = new RegExp(
  `\\b(?:voy|vamos) a ${RE_ANUNCIO_VERBO}\\b|\\b(?:déjame|dejame|permíteme|permiteme) ${RE_ANUNCIO_VERBO}\\b|\\b(?:me pongo a|procedo a|paso a) ${RE_ANUNCIO_VERBO}\\b`,
  "i",
);
function anunciaTrabajoSinEjecutar(texto) {
  const limpio = quitarBloquesCodigo(String(texto || ""));
  if (!limpio.trim()) return false;
  const frases = limpio.split(/(?<=[.!…])\s+|\n+/);
  return frases.some((f) => RE_ANUNCIO.test(f) && !/[¿?]/.test(f));
}

module.exports = { SISTEMA_NUCLEO, textoRendicion, esVolcadoDeCodigo, quitarBloquesCodigo, declaraTrabajoHecho, esReporteDeExistencia, anunciaTrabajoSinEjecutar };
