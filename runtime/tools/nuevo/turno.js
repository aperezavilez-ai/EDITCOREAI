"use strict";
// ============================================================
// KERNEL NUEVO — BUCLE DE TURNO
// [Reconstrucción 2026-11-18] La CAPACIDAD del turno la decide
// la ESTRUCTURA, no la forma del texto: con proyecto abierto
// (conHerramientas, dato del llamador) el modelo recibe el set
// completo y el presupuesto de ORDEN en todo turno, y ÉL
// decide si responde o trabaja — como decide un agente de
// verdad. El clasificador de texto (despacho.js) conserva dos
// trabajos menores: sugerir el aviso de apertura y gobernar
// los turnos SIN proyecto. Su veto histórico — una orden larga
// y declarativa caía en «declarativo_sin_orden», sin
// herramientas, y el turno cerraba con una promesa (registro
// 2026-11-18T19:57Z) — ya no existe: la forma del mensaje
// nunca más le quita las herramientas a una orden.
// Sin proyecto, los carriles conservan su mecanismo:
// CONVERSACION/PROPUESTA sin herramientas, CONSULTA con
// lectura dirigida, ORDEN con el set completo.
// Todo turno lleva un libro de HECHOS (pasos reales) y el
// resumen del turno se genera DESDE los hechos: el relato del
// modelo es su texto, pero la contabilidad no la escribe él.
// Presupuesto: al agotarse los tokens del carril, no se ejecuta
// ni una herramienta más; se hace UNA llamada de cierre sin
// herramientas y el agotamiento queda escrito en el resumen.
// ============================================================
const { decidirTurno, contextoDesdeHistorial } = require("./despacho");
const { esVolcadoDeCodigo, declaraTrabajoHecho, esReporteDeExistencia, anunciaTrabajoSinEjecutar } = require("./textos");

const PRESUPUESTOS = {
  CONVERSACION: { maxLlamadas: 1, maxTokens: 12000, herramientas: [] },
  PROPUESTA: { maxLlamadas: 1, maxTokens: 16000, herramientas: [] },
  CONSULTA: { maxLlamadas: 4, maxTokens: 40000, herramientas: ["list_files", "read_file", "search_files", "read_pdf"] },
  ORDEN: { maxLlamadas: 30, maxTokens: 300000, herramientas: null }, // null = set completo del llamador
};

function resumenDeHechos({ carril, hechos, tokensUsados, llamadas, presupuestoAgotado, respuestaParcial, respuestaContinuada, trabajoSimuladoDetectado, tiempos }) {
  const lineas = [`Carril: ${carril} · llamadas: ${llamadas} · tokens: ${tokensUsados}`];
  // [v5.2.7 — tiempos medidos] El desglose del turno, medido en el
  // cable: cuánto costó la memoria local, cuándo llegó el primer
  // texto del modelo y cuánto tardó la respuesta completa. Sin esta
  // línea, una espera larga es una caja negra y cada diagnóstico es
  // una hipótesis; con ella, el propio turno dice dónde estuvo.
  if (tiempos && Number.isFinite(tiempos.proveedorMs)) {
    const seg = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
    const partesT = [`modelo: respuesta completa en ${seg(tiempos.proveedorMs)}`];
    if (Number.isFinite(tiempos.primerDeltaMs)) partesT.unshift(`primer texto a los ${seg(tiempos.primerDeltaMs)}`);
    if (Number.isFinite(tiempos.memoriaMs)) partesT.unshift(`memoria local: ${seg(tiempos.memoriaMs)}`);
    lineas.push(`Tiempos: ${partesT.join(" · ")}`);
  }
  if (hechos.aplicados.length) lineas.push(`Aplicado: ${hechos.aplicados.join(", ")}`);
  if (hechos.fallos.length) {
    lineas.push(`Fallos: ${hechos.fallos.map((f) => `${f.nombre} (${f.resumen || "sin detalle"})`).join("; ")}`);
  }
  if (hechos.denegadas.length) {
    lineas.push(`Denegadas por el carril: ${hechos.denegadas.map((d) => d.nombre).join(", ")}`);
  }
  for (const l of hechos.listados || []) {
    lineas.push(`Listado de ${l.path}: ${l.totalDirs} carpetas, ${l.totalFiles} archivos${l.truncated ? " (listado parcial: hay más elementos de los mostrados)" : ""}.`);
  }
  for (const a of hechos.archivos || []) {
    const nombre = String(a.path || "").split(/[\\/]/).filter(Boolean).pop() || String(a.path || "");
    lineas.push(`Entregado en el chat: ${nombre}${Number.isFinite(a.bytes) ? ` (${a.bytes} bytes)` : ""} — está en este mensaje, con botones para abrirlo o mostrarlo en su carpeta.`);
  }
  if (carril === "ORDEN" && hechos.aplicados.length === 0) {
    lineas.push("Sin cambios aplicados en este turno.");
  }
  if (presupuestoAgotado) {
    lineas.push("Presupuesto de tokens agotado: el turno se cerró con lo que había, sin ejecutar más pasos.");
  }
  if (respuestaParcial) {
    lineas.push("Respuesta parcial: el proveedor cortó la respuesta a mitad de stream; el texto final llegó incompleto.");
  }
  if (respuestaContinuada) {
    lineas.push("La respuesta llegó en dos partes: el proveedor la cortó por el tope de salida y el turno pidió la continuación.");
  }
  if (trabajoSimuladoDetectado) {
    lineas.push("El modelo describió trabajo como hecho sin ejecutar herramientas; el turno lo corrigió en el acto y lo ejecutó de verdad.");
  }
  return lineas.join("\n");
}

async function ejecutarTurno({ texto, llamarModelo, ejecutarHerramienta, herramientasCompletas = [], memoria = "", historial = [], memoriaMs = null, carrilForzado = null, conHerramientas = false, steeringQueue = [] }) {
  // Carril forzado por DATO estructurado: una ejecución
  // autorizada (planAuthorizedExecution) ES una orden, aunque
  // el texto que la transporta — el «AUTORIZACION DE EJECUCION»
  // enlatado del flujo de análisis — clasifique como charla por
  // su forma. Sin este forzado, ese texto caía en CONVERSACION
  // (sin herramientas) y el modelo narraba la construcción en
  // prosa: el defecto raíz probado con el registro de turnos.
  const decision = carrilForzado
    ? { carril: carrilForzado, herramientas: carrilForzado === "ORDEN" ? "completa" : "ninguna", puedeEscribir: carrilForzado === "ORDEN", motivo: "ejecucion_autorizada" }
    : decidirTurno(texto, contextoDesdeHistorial(historial));
  const carril = decision.carril;
  // Capacidad estructural: con proyecto abierto, el turno
  // ofrece el set completo y el presupuesto de ORDEN sea cual
  // sea la etiqueta textual; el carril REPORTADO se promueve
  // a ORDEN solo si el turno actuó (ejecutó herramientas o
  // anunció trabajo y hubo que corregirlo) — una pregunta
  // respondida sin herramientas sigue reportando CONVERSACION.
  const conCapacidad = conHerramientas === true && !carrilForzado;
  const presupuesto = conCapacidad ? PRESUPUESTOS.ORDEN : PRESUPUESTOS[carril];
  const herramientasDelCarril = conCapacidad || presupuesto.herramientas === null
    ? herramientasCompletas.slice()
    : presupuesto.herramientas.slice();
  const permitidas = new Set(herramientasDelCarril);

  const mensajes = [];
  if (memoria) mensajes.push({ role: "system", content: memoria });
  for (const m of historial || []) mensajes.push(m);
  mensajes.push({ role: "user", content: String(texto || "") });

  const hechos = { pasos: [], aplicados: [], fallos: [], denegadas: [], listados: [], archivos: [] };
  let llamadas = 0;
  let tokensUsados = 0;
  let presupuestoAgotado = false;
  let respuestaParcial = false;
  let textoFinal = "";
  let volcadoCorregido = false;
  let respuestaContinuada = false;
  let trabajoSimuladoCorregido = false;
  let anuncioCorregido = 0;
  let herramientasEjecutadas = 0;
  // Tiempos medidos por llamada (los reporta el adaptador): la suma
  // es el tiempo de modelo del turno y el primer texto es el de la
  // PRIMERA llamada que lo produjo.
  let proveedorMs = 0;
  let primerDeltaMs = null;
  const anotarTiempos = (resp) => {
    const t = resp?.tiempos;
    if (!t) return;
    if (Number.isFinite(t.duracionMs)) proveedorMs += t.duracionMs;
    if (primerDeltaMs === null && Number.isFinite(t.primerDeltaMs)) primerDeltaMs = t.primerDeltaMs;
  };

  const llamadaCierre = async () => {
    // Si terminamos tras una racha de herramientas, inyectamos una petición clara de cierre
    // para que el modelo NUNCA devuelva texto vacío ni caiga en el piso de fallos:
    const mensajesCierre = [...mensajes];
    mensajesCierre.push({
      role: "user",
      content: "Has terminado de ejecutar las herramientas de este turno. Presenta ahora al usuario un informe completo, claro y directo con los hallazgos encontrados, las acciones realizadas y el estado actual del proyecto.",
    });
    const resp = await llamarModelo({ mensajes: mensajesCierre, herramientas: [] });
    llamadas += 1;
    tokensUsados += Number(resp?.uso?.total || 0);
    anotarTiempos(resp);
    if (resp?.parcial) respuestaParcial = true;
    return String(resp?.texto || "");
  };

  let correcciones = 0;
  while (llamadas < presupuesto.maxLlamadas + correcciones) {
    if (Array.isArray(steeringQueue) && steeringQueue.length > 0) {
      while (steeringQueue.length > 0) {
        const item = steeringQueue.shift();
        const textoDir = typeof item === "string" ? item : item?.instruction;
        if (textoDir) {
          mensajes.push({
            role: "user",
            content: `[Instrucción prioritaria del usuario recibida en vuelo]: ${textoDir}`,
          });
        }
      }
    }
    const resp = await llamarModelo({ mensajes, herramientas: herramientasDelCarril });
    llamadas += 1;
    tokensUsados += Number(resp?.uso?.total || 0);
    anotarTiempos(resp);

    if (tokensUsados > presupuesto.maxTokens) {
      presupuestoAgotado = true;
      if (resp?.parcial) respuestaParcial = true;
      textoFinal = String(resp?.texto || "") || (await llamadaCierre());
      break;
    }

    const pedidos = Array.isArray(resp?.toolCalls) ? resp.toolCalls : [];
    if (!pedidos.length || !herramientasDelCarril.length) {
      // Sin pedidos, o carril sin herramientas (los pedidos de un
      // carril sin herramientas se ignoran: nunca se ofrecieron).
      if (resp?.parcial) respuestaParcial = true;
      textoFinal = String(resp?.texto || "");
      // Construcción: si en un turno ORDEN el modelo pega el
      // contenido de un archivo en el chat en vez de crearlo con
      // las herramientas, el turno se corrige UNA vez en el acto:
      // el volcado vuelve como contexto y la orden es escribirlo
      // con write_file en la raíz. Si insiste, el cierre (cierre.js)
      // impide que el código llegue al chat y declara la verdad.
      if (!pedidos.length && herramientasDelCarril.length && carril === "ORDEN"
        && !volcadoCorregido && esVolcadoDeCodigo(textoFinal)) {
        volcadoCorregido = true;
        correcciones += 1;
        mensajes.push({ role: "assistant", content: textoFinal });
        mensajes.push({
          role: "user",
          content: "Eso pega el contenido en el chat en vez de crearlo. Usa las herramientas (write_file y las demás) para escribir cada archivo en la raíz del proyecto abierto y sigue con la construcción; en el chat solo va el resumen de lo aplicado.",
        });
        textoFinal = "";
        continue;
      }
      // Trabajo SIMULADO: el texto declara trabajo como hecho
      // (archivos creados o verificados) y el turno no ejecutó
      // ni una herramienta: nada de eso ocurrió. Se corrige en
      // el acto, como el volcado de código: ejecutar de verdad
      // o decir que no se pudo, sin inventar resultados. Si la
      // corrección también simula, la guarda de cierre retiene
      // la voz (cierre.js, con la actividad real del turno).
      // [2026-11-18] La corrección ya no es solo de ORDEN: en
      // PROPUESTA el modelo «ya creó» el SaaS y el turno moría
      // tapado sin entregar la propuesta pedida. Cada carril
      // recibe SU corrección — ejecutar, proponer, verificar o
      // conversar — y un reporte de que el trabajo YA EXISTE no
      // es simulación: no se corrige.
      if (!pedidos.length && herramientasEjecutadas === 0 && !trabajoSimuladoCorregido
        && declaraTrabajoHecho(textoFinal) && !esReporteDeExistencia(textoFinal)) {
        trabajoSimuladoCorregido = true;
        correcciones += 1;
        const correccionPorCarril = {
          ORDEN: "Corrección del sistema: tu texto describe trabajo como ya hecho (archivos creados o verificados), pero en este turno no ejecutaste ninguna herramienta, así que nada de eso ocurrió. Ejecuta ahora la orden de verdad con las herramientas, paso a paso. Si algo no se puede hacer, dilo sin inventar resultados.",
          PROPUESTA: "Corrección del sistema: tu texto afirma trabajo ya hecho (archivos creados o verificados), pero en este turno no ejecutaste ninguna herramienta, así que nada de eso ocurrió. Lo que se te pidió es una PROPUESTA: entrégala ahora — qué construirías, en qué orden y con qué archivos — sin afirmar que ya está hecho.",
          CONSULTA: "Corrección del sistema: tu texto afirma haber verificado o creado sin ejecutar ninguna herramienta en este turno. Usa tus herramientas de lectura para verificar de verdad y responde desde lo verificado; si algo no puedes verificarlo, dilo sin inventar resultados.",
          CONVERSACION: "Corrección del sistema: tu texto te atribuye trabajo (archivos creados o verificados) que no ejecutaste en este turno. Responde a la conversación sin atribuirte trabajo que no hiciste; si el usuario pide un archivo, dilo con claridad y se crea con las herramientas en el turno de acción.",
        };
        mensajes.push({ role: "assistant", content: textoFinal });
        mensajes.push({
          role: "user",
          content: carril === "ORDEN" ? correccionPorCarril.ORDEN : (correccionPorCarril[carril] || correccionPorCarril.ORDEN),
        });
        textoFinal = "";
        continue;
      }
      // Trabajo ANUNCIADO: el texto promete el trabajo en
      // futuro («voy a revisar», «déjame explorar») y el turno,
      // con herramientas disponibles, no ejecutó ni una: la
      // promesa quedó como resultado (registro 19:57Z). Se
      // corrige UNA vez en el acto: ejecutar la primera acción
      // real, o responder sin anunciar. En PROPUESTA no
      // aplica: describir el trabajo futuro ES la entrega.
      // OJO: aquí NO se exime el «reporte de existencia» — el
      // anuncio del registro decía «…para ver qué ya existe»
      // y esa mención no lo convierte en reporte: un reporte
      // presenta lo hallado, no promete ir a verlo. Las frases
      // de anuncio (primera persona, futuro) no casan con la
      // forma de un reporte, así que el detector basta.
      if (!pedidos.length && herramientasDelCarril.length && herramientasEjecutadas === 0
        && anuncioCorregido < 2 && carril !== "PROPUESTA"
        && anunciaTrabajoSinEjecutar(textoFinal)) {
        anuncioCorregido += 1;
        correcciones += 1;
        mensajes.push({ role: "assistant", content: textoFinal });
        mensajes.push({
          role: "user",
          content: `[SISTEMA — intento ${anuncioCorregido}/2] Anunciaste trabajo en futuro pero no llamaste ninguna herramienta. ` +
            `El anuncio no cuenta como trabajo. AHORA MISMO debes llamar la herramienta correspondiente ` +
            `(replace_in_file, write_file, run_command, delegate_parallel o invoke_subagent) ` +
            `con la acción real de mayor prioridad. No expliques qué harás: hazlo directamente.`,
        });
        textoFinal = "";
        continue;
      }
      // Corte por tope de salida sin herramientas de por medio:
      // la respuesta quedó a mitad de frase. Se pide UNA
      // continuación sin herramientas y se cose al texto; si la
      // continuación también se corta, el turno lo declara
      // parcial en vez de presentar el muñón como respuesta.
      if (!pedidos.length && resp?.cortadaPorTope && !respuestaContinuada) {
        respuestaContinuada = true;
        mensajes.push({ role: "assistant", content: textoFinal });
        mensajes.push({
          role: "user",
          content: "Tu respuesta anterior se cortó por el tope de salida. Continúa exactamente donde quedó, sin repetir nada de lo ya dicho y sin preámbulos.",
        });
        const cont = await llamarModelo({ mensajes, herramientas: [] });
        llamadas += 1;
        tokensUsados += Number(cont?.uso?.total || 0);
        anotarTiempos(cont);
        textoFinal += String(cont?.texto || "");
        if (cont?.cortadaPorTope || cont?.parcial) respuestaParcial = true;
      }
      break;
    }

    mensajes.push({ role: "assistant", toolCalls: pedidos });
    for (const pedido of pedidos) {
      herramientasEjecutadas += 1;
      const nombre = String(pedido?.nombre || "");
      if (!permitidas.has(nombre)) {
        hechos.denegadas.push({ nombre });
        hechos.pasos.push({ nombre, ok: false, denegada: true });
        mensajes.push({ role: "tool", nombre, content: "Herramienta no disponible en este carril." });
        continue;
      }
      let resultado;
      try {
        resultado = await ejecutarHerramienta(nombre, pedido?.args || {});
      } catch (err) {
        resultado = { ok: false, resumen: String(err?.message || err).slice(0, 300) };
      }
      const paso = { nombre, ok: resultado?.ok !== false, resumen: String(resultado?.resumen || "") };
      hechos.pasos.push(paso);
      if (paso.ok && resultado?.archivoAplicado) {
        const rutaArchivo = String(resultado.archivoAplicado);
        hechos.aplicados.push(rutaArchivo);
        // El archivo como ENTREGABLE del turno (con su tamaño
        // cuando la herramienta lo declara): la superficie lo
        // ofrece en el chat, no solo como ruta en el texto.
        const entregable = { path: rutaArchivo };
        if (Number.isFinite(resultado?.archivoBytes)) entregable.bytes = resultado.archivoBytes;
        hechos.archivos.push(entregable);
      }
      if (paso.ok && resultado?.listado) hechos.listados.push(resultado.listado);
      if (!paso.ok) hechos.fallos.push(paso);
      let contenidoPaso = paso.resumen || (paso.ok ? "ok" : "fallo");
      // Dirección tras fallo repetido: si la MISMA herramienta
      // acaba de fallar dos veces seguidas, el resultado lleva la
      // orden de cambiar de curso con el error a la vista. Sin
      // esto, el modelo reintentaba variaciones a ciegas hasta
      // agotar el turno (registro 2026-11-18: run_command ×3 con
      // el modelo sin ver un solo stderr — ver adaptador.js).
      if (!paso.ok) {
        const ultimosDos = hechos.pasos.slice(-2);
        if (ultimosDos.length === 2 && ultimosDos.every((p) => !p.ok && p.nombre === nombre)) {
          contenidoPaso += `\n\nCorrección del sistema: ${nombre} ya falló dos veces seguidas. No repitas el mismo comando ni una variación menor: lee el error de arriba, corrige la causa (ruta, dependencias, sintaxis) o cambia de enfoque para lograr el mismo objetivo.`;
        }
      }
      mensajes.push({ role: "tool", nombre, content: contenidoPaso });
    }
  }

  // Cierre con voz: si el bucle terminó justo tras ejecutar
  // herramientas (la última respuesta traía llamadas y ninguna
  // palabra), el modelo aún no ha cerrado el turno: se le pide
  // UNA respuesta final sin herramientas, desde los resultados.
  // Sin esto, un turno de 51 pasos quedó mudo y el cierre habló
  // por él con la línea de fallos, borrando lo que el turno sí
  // había averiguado (registro 2026-11-18, 20:10:25Z).
  if (!textoFinal && herramientasEjecutadas > 0 && !presupuestoAgotado) {
    textoFinal = await llamadaCierre();
  }

  const tiempos = {
    memoriaMs: Number.isFinite(memoriaMs) ? memoriaMs : null,
    primerDeltaMs,
    proveedorMs: llamadas > 0 ? proveedorMs : null,
  };
  // El carril reportado dice lo que el turno HIZO: con
  // capacidad estructural, ejecutar una ACCIÓN (escribir,
  // ejecutar un comando, cualquier herramienta que no sea de
  // lectura) — o anunciar trabajo hasta que el turno lo
  // corrigió — ES un turno de acción, aunque su texto
  // pareciera conversación. Leer para responder sigue
  // siendo consulta: no promueve.
  const SOLO_LECTURA = new Set(["list_files", "read_file", "search_files", "read_pdf", "read_url", "search_web"]);
  const ejecutoAccion = hechos.aplicados.length > 0
    || hechos.pasos.some((paso) => !paso.denegada && !SOLO_LECTURA.has(paso.nombre));
  const carrilReportado = conCapacidad && (ejecutoAccion || anuncioCorregido)
    ? "ORDEN"
    : carril;
  const resumen = resumenDeHechos({ carril: carrilReportado, hechos, tokensUsados, llamadas, presupuestoAgotado, respuestaParcial, respuestaContinuada, trabajoSimuladoDetectado: trabajoSimuladoCorregido, tiempos });
  return { carril: carrilReportado, textoFinal, llamadas, tokensUsados, presupuestoAgotado, respuestaParcial, herramientasEjecutadas, hechos, resumen, tiempos };
}

module.exports = { ejecutarTurno, resumenDeHechos, PRESUPUESTOS };
