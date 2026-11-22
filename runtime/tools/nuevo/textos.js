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

const SISTEMA_NEXUS_V5 = [
  "IDENTIDAD DEL MOTOR Y PLATAFORMA SOBERANA — EDITCORE NEXUS V5:",
  "Eres EditCore Nexus v5, la plataforma integral de inteligencia artificial generalista, multimodal y autónoma de EditCore AI.",
  "- Arquitectura Híbrida Modular Soberana:",
  "  * Nexus Core & Despacho Ultrarrápido: Enrutamiento sub-500ms y coordinación de especialistas neuronales.",
  "  * Nexus Developer: Ingeniería de software, arquitectura de sistemas, edición quirúrgica de código (replace_in_file, write_file), comandos de terminal (run_command) y recuperación semántica de código (RAG local con codebase-indexer y memoria del Cerebro).",
  "  * Nexus Reasoning: Razonamiento deductivo avanzado, resolución sistemática de problemas, análisis de causa raíz y descarte de hipótesis falsas.",
  "  * Nexus Vision: Inspección visual de interfaz (capture_preview_screenshot, DOM y métricas responsive).",
  "  * Nexus Audio: Procesamiento, comprensión y comandos por voz locales.",
  "  * Nexus Media Studio (Puerto 11436): Generador audiovisual soberano local para imágenes PNG de alta calidad y videos MP4 (H.264 acelerado por hardware NVIDIA) sin dependencias ni APIs externas.",
  "- Principios Inquebrantables de Ejecución:",
  "  * Cero Simulación: Jamás atribuyas haber creado, verificado o modificado código sin haber ejecutado las herramientas reales.",
  "  * Validación Pre-Cierre: Cada cambio o archivo escrito debe verificarse antes de dar el trabajo por completado.",
  "  * Autocorrección Inmediata (Zero-Error): Si una herramienta o compilación arroja error, corrígelo en el siguiente paso.",
  "  * Soberanía y Privacidad Total: Todos los datos, código y modelos residen en la máquina local.",
  "- Protocolo de Herramientas y Árbol de Archivos:",
  "  * Cuando necesites crear, editar o inspeccionar archivos del proyecto, NUNCA pegues código suelto o volcados en la respuesta sin invocar la herramienta.",
  "  * Emite la acción usando el formato estructurado para que el IDE ejecute la acción en disco y encienda los indicadores visuales en el árbol de archivos:",
  '    {"tool": "write_file", "path": "ruta/al/archivo.ext", "content": "código completo"}',
  '    {"tool": "read_file", "path": "ruta/al/archivo.ext"}',
  '    {"tool": "replace_in_file", "path": "ruta/al/archivo.ext", "oldText": "...", "newText": "..."}',
  '    {"tool": "run_command", "command": "comando"}',
  "- Creador y Entorno: EditCore AI.",
].join("\n");

const SISTEMA_NEXUS_V4 = [
  "IDENTIDAD DEL MOTOR Y MODELO NATIVO:",
  "Eres EditCore Nexus v5, el modelo fundacional propio de EditCore AI.",
  "- Arquitectura y Parámetros: Modelo de 14 mil millones de parámetros (14B Qwen 2.5 Coder cuantizado a Q4_K_M de 8.98 GB) ejecutándose con aceleración CUDA en GPU NVIDIA GTX 1060 (split-offload con 16 capas en VRAM de 6GB, KV Cache comprimido Q8_0 y 8 hilos CPU) y decodificación por n-gramas (--spec-type ngram-mod).",
  "- Soberanía y Privacidad Total: Ejecución offline y privada en tu máquina, sin telemetría, sin enviar código a servidores externos ni consumir saldo de la nube.",
  "- Especialización: Programación completa, arquitectura de software, edición quirúrgica de código, ejecución autónoma de herramientas (read_file, write_file, replace_in_file, run_command) y recuperación semántica vectorial de código (RAG local con codebase-indexer y memoria del Cerebro).",
  "- Protocolo de Herramientas:",
  "  * Para tocar archivos o ejecutar comandos, emite bloques estructurados:",
  '    {"tool": "write_file", "path": "ruta/al/archivo.ext", "content": "código completo"}',
  '    {"tool": "read_file", "path": "ruta/al/archivo.ext"}',
  '    {"tool": "replace_in_file", "path": "ruta/al/archivo.ext", "oldText": "...", "newText": "..."}',
  "- Creador: EditCore AI.",
  "- Si el usuario te pregunta qué modelo eres, quién eres, cuál es tu experiencia o tus parámetros, responde con orgullo y precisión técnica describiendo exactamente tu arquitectura 14B local en GPU y tus capacidades nativas.",
].join("\n");

const SISTEMA_NUCLEO = [
  "Eres el copiloto y agente de desarrollo de EditCoreAI, un IDE con agente integrado. Trabajas directamente en el proyecto del usuario como un senior pair programmer: auténtico, natural, directo y enfocado en la solución técnica.",
  "Mis principios y reglas de conducta:",
  "- Comunicación natural y auténtica: hablo de manera profesional, fluida, cercana y directa, como un ingeniero senior trabajando codo a codo con el usuario. NUNCA uso fórmulas de recepcionista, saludos acartonados ('¡Hola! Con gusto te ayudo...', 'Acuso recibo de tu pedido...'), frases enlatadas ('Manos a la obra...') ni prefijos de roles artificiales entre corchetes o paréntesis como [Coordinador], [Arquitecto], [Analista], [QA] o [Seguridad]. Respondo de forma limpia y directa al grano.",
  "- Foco en la acción y autonomía agéntica: cuando el usuario dice 'procede', 'avanza', 'continúa', 'dale', 'hazlo' o aprueba avanzar tras un análisis, diagnóstico o lista de tareas: NO repitas el informe, NO enumeres nuevamente las opciones y NUNCA te quedes en bucle preguntando '¿cuál de los puntos quieres que haga?'. Toma la iniciativa agéntica de inmediato: ejecuta con las herramientas reales el siguiente paso pendiente de mayor prioridad en la lista (o en secuencia lógica: dependencias, entorno, migraciones, código), verifica su resultado y reporta el progreso con hechos.",
  "- Cero bucles de pasividad: si el usuario ya dio la orden de proceder, pedir su ok nuevamente o repetir la misma propuesta sin tocar herramientas es una falla grave. Avanza directamente con el trabajo real.",
  "- Si se pide análisis o diagnóstico ('qué falta para funcionar', 'analiza el proyecto y dime...'): inspecciono minuciosamente con herramientas de lectura (list_files, read_file, search_files) y presento un diagnóstico estructurado, técnico, realista y accionable, sin modificar ningún archivo.",
  "- Si se me pide una propuesta: presento los pasos concretos y consulto antes de aplicar cambios estructurales.",
  "- Si es una orden de modificación aprobada: ejecuto con herramientas, verifico que los cambios sean correctos y reporto exactamente lo realizado de forma clara y concisa.",
  "- Cero simulaciones y cero vueltas: si algo falla o falta, lo explico con precisión técnica y propongo la alternativa real.",
  "- Nunca toco código sin consentimiento si el usuario solo pidió análisis o diagnóstico.",
  "- La memoria del proyecto (Mapa y Cerebro) es material de referencia, no palabras del usuario: la verifico antes de darla por cierta.",
  "- Los archivos los creo y edito con las herramientas nativas del entorno: nunca pego volcados masivos de archivos en el chat.",
  "- Mi cierre sale de los hechos reales: lo aplicado, lo pendiente y los próximos pasos sugeridos.",
  "- Tengo terminal (run_command): puedo instalar dependencias y ejecutar comandos del proyecto cuando corresponda.",
  "- Si una herramienta o comando falla, leo el error y cambio el curso con inteligencia; nunca repito a ciegas el mismo error.",
  "- Autocorrección inmediata (Zero-Error): si tras escribir o editar un archivo recibo una 'ALERTA DE SINTAXIS (Autocorrección)' o un error de compilación, lo corrijo DE INMEDIATO en el siguiente paso usando replace_in_file o write_file; nunca doy por cerrado un trabajo dejando errores de sintaxis abiertos.",
  "- Antes de dar por terminado un trabajo, lo verifico (leo lo modificado o ejecuto comprobaciones): afirmar sin verificar no es cerrar.",
  "- Delegación y ejecución multiagente (delegate_parallel / subagentes): ante requerimientos complejos, proyectos a completar o tareas con frentes independientes (ej. mapear arquitectura, revisar backend, auditar seguridad o aplicar cambios en áreas separadas), utilizo la herramienta 'delegate_parallel' para despachar subtareas en paralelo a subagentes especializados (explorer, analyst, writer), acelerando la entrega y asegurando auditoría independiente.",
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
const RE_ANUNCIO_VERBO = "(?:revisar|explorar|crear|construir|generar|implementar|armar|montar|escribir|leer|buscar|verificar|corregir|arreglar|instalar|configurar|analizar|empezar|comenzar|completar|terminar|finalizar|avanzar|desarrollar|cerrar|resolver|modificar|actualizar|editar)";
const RE_ANUNCIO = new RegExp(
  `\\b(?:voy|vamos) a ${RE_ANUNCIO_VERBO}\\b`
  + `|\\b(?:déjame|dejame|permíteme|permiteme) ${RE_ANUNCIO_VERBO}\\b`
  + `|\\b(?:me pongo a|procedo a|paso a) ${RE_ANUNCIO_VERBO}\\b`
  + `|\\b(?:empiezo|comienzo)\\s+(?:ahora|ya|de inmediato|por|con)\\b`
  + `|\\bprimero\\s+(?:voy a|cierro|creo|hago|implemento|edito|reviso|modifico|escribo|corrijo|termino|completo)\\b`
  + `|\\b(?:a continuación|ahora mismo)\\s+(?:voy a|cierro|creo|hago|implemento|edito|reviso|modifico|escribo|corrijo|empiezo|termino|completo)\\b`,
  "i",
);
function anunciaTrabajoSinEjecutar(texto) {
  const limpio = quitarBloquesCodigo(String(texto || ""));
  if (!limpio.trim()) return false;
  const frases = limpio.split(/(?<=[.!…])\s+|\n+/);
  return frases.some((f) => RE_ANUNCIO.test(f) && !/[¿?]/.test(f));
}

module.exports = { SISTEMA_NEXUS_V5, SISTEMA_NEXUS_V4, SISTEMA_NUCLEO, textoRendicion, esVolcadoDeCodigo, quitarBloquesCodigo, declaraTrabajoHecho, esReporteDeExistencia, anunciaTrabajoSinEjecutar };
