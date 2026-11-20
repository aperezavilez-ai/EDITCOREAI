"use strict";
// ============================================================
// KERNEL NUEVO — ADAPTADOR A LOS CONTRATOS REALES
// El kernel nuevo no reimplementa proveedor ni herramientas:
// se conecta a lo que ya está probado en vivo —
//   callChat            (../provider.js)
//   tools.execute       (../tools.js)
//   tools.getToolDefinitions
// traduciendo formatos en los dos sentidos:
//  - Las definiciones que viajan al proveedor se filtran por
//    el carril (en CONVERSACION viajan CERO: el mecanismo, no
//    una instrucción).
//  - callChat devuelve toolCalls en forma OpenAI
//    ({function:{name, arguments:JSON}}) y usage normalizado
//    ({input_tokens, output_tokens}); el bucle trabaja con su
//    formato propio ({nombre, args} y uso.total).
//  - La salida lleva la forma que el bridge ya consume
//    (text / steps / kind / usage / mutations / incomplete),
//    más el detalle de hechos y la marca de cierre corregida.
// Las dependencias se inyectan (deps) para poder probar el
// adaptador sin proveedor ni disco; el bridge inyecta las
// reales.
// ============================================================
const path = require("path");
const { ejecutarTurno } = require("./turno");
const { decidirTurno, contextoDesdeHistorial } = require("./despacho");
const { componerCierre } = require("./cierre");
const { SISTEMA_NUCLEO } = require("./textos");
const { parseTextToolCalls, stripTextToolMarkup } = require("../parse-text-tools");

function totalDeUso(usage) {
  if (!usage || typeof usage !== "object") return 0;
  return Number(
    usage.total
    || usage.total_tokens
    || (Number(usage.input_tokens || usage.prompt_tokens || 0) + Number(usage.output_tokens || usage.completion_tokens || 0)),
  ) || 0;
}

function normalizarToolCalls(toolCalls) {
  return (Array.isArray(toolCalls) ? toolCalls : []).map((tc) => {
    if (tc && typeof tc === "object" && tc.function) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
      return { nombre: String(tc.function.name || ""), args: args && typeof args === "object" ? args : {} };
    }
    let args = tc?.args && typeof tc.args === "object" ? tc.args : {};
    if (!Object.keys(args).length && tc?.arguments) {
      // Dialecto suelto { name, arguments }: la cadena se parsea,
      // el objeto se usa tal cual.
      if (typeof tc.arguments === "object") args = tc.arguments;
      else { try { args = JSON.parse(tc.arguments); } catch { args = {}; } }
    }
    return {
      nombre: String(tc?.nombre || tc?.name || ""),
      args: args && typeof args === "object" ? args : {},
    };
  });
}

// Formato del bucle -> mensajes OpenAI (con tool_call_id en
// orden: cada bloque de herramienta consume los ids del bloque
// assistant que lo pidió). Las imágenes del turno (data: o
// http, ya filtradas) viajan como partes image_url del ÚLTIMO
// mensaje de usuario, el formato que el proveedor ya acepta.
function aMensajesProveedor(mensajes, imagenes = []) {
  const salida = [];
  let pendientes = [];
  let contador = 0;
  const lista = mensajes || [];
  let ultimoUsuario = -1;
  lista.forEach((m, i) => { if (m.role === "user") ultimoUsuario = i; });
  for (let idx = 0; idx < lista.length; idx++) {
    const m = lista[idx];
    if (m.role === "assistant" && Array.isArray(m.toolCalls)) {
      const ids = m.toolCalls.map(() => `call_${contador++}`);
      pendientes = ids.slice();
      salida.push({
        role: "assistant",
        content: "",
        tool_calls: m.toolCalls.map((tc, i) => ({
          id: ids[i],
          type: "function",
          function: { name: tc.nombre, arguments: JSON.stringify(tc.args || {}) },
        })),
      });
      continue;
    }
    if (m.role === "tool") {
      salida.push({
        role: "tool",
        tool_call_id: pendientes.shift() || `call_${contador++}`,
        name: m.nombre,
        content: String(m.content || ""),
      });
      continue;
    }
    if (m.role === "user" && idx === ultimoUsuario && imagenes.length) {
      salida.push({
        role: "user",
        content: [
          { type: "text", text: String(m.content || "") },
          ...imagenes.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      });
      continue;
    }
    salida.push({ role: m.role, content: String(m.content || "") });
  }
  return salida;
}

// [v5.2.7 — tiempos] Tope de SALIDA por carril, en el cable: los
// carriles sin herramientas responden y proponen — no ejecutan — y
// su respuesta útil cabe en estos topes. Sin tope, una pregunta de
// estado hacía recitar al modelo el expediente entero (la tabla
// forense completa) y la generación se comía el turno. ORDEN queda
// sin tope: su presupuesto duro ya vive en el bucle (300k tokens).
// Topes de salida por carril: CONVERSACION es breve por diseño
// (la enfermedad original era recitar expedientes enteros); pero
// PROPUESTA y CONSULTA entregan textos que el usuario lee
// ENTEROS — con 2500, una propuesta MVP se cortaba a mitad de
// frase (finish_reason "length") y el muñón se presentaba como
// respuesta plena. La continuación por corte (turno.js) repara
// el resto de casos.
const TOPE_SALIDA_POR_CARRIL = { CONVERSACION: 1500, PROPUESTA: 8000, CONSULTA: 4000, ORDEN: 0 };

// [v5.2.7 — corrección] Tope de inactividad por intento: si el
// proveedor no entrega ni un byte en 90 s, el intento muere y el
// reintento (avisado) decide. El histórico era 300 s: una espera
// muda de hasta 5 minutos por intento.
const TIMEOUT_INTENTO_MS = 90_000;

function crearLlamarModelo({ callChat, perfil, definiciones, projectRoot, onTextDelta, maxTokens = 0, onAviso = null, latidoMs = 15000, onRespuestaCruda = null }) {
  const porNombre = new Map();
  for (const d of definiciones || []) {
    const nombre = d?.function?.name;
    if (nombre) porNombre.set(nombre, d);
  }
  // Frontera del prefijo cacheable del turno: el mensaje del
  // usuario que abrió el turno. Todo lo anterior (sistema +
  // historial + ese mensaje) es idéntico entre las llamadas
  // del turno; lo que crece (llamadas y resultados) va detrás.
  // withCacheControl la espera del kernel — sin ella el
  // proveedor marcaba solo system + primer user y el grueso
  // del historial se reenviaba sin caché en cada paso.
  let fronteraCache = -1;
  return async function llamarModelo({ mensajes, herramientas }) {
    const tools = (herramientas || []).map((n) => porNombre.get(n)).filter(Boolean);
    // Streaming en vivo: los deltas de CONTENIDO del proveedor (el
    // razonamiento nunca) se reenvían a la superficie agrupados —
    // cada ~120 ms o al juntar un tramo — para no inundar el IPC.
    // El texto que vale es el de la respuesta completa; los deltas
    // solo pintan el avance (la fase narration_delta del renderer,
    // la misma que pintaba el kernel viejo). Sin callback, el turno
    // corre igual, solo que sin pintado en vivo.
    // [v5.2.7 — corrección] El pintado pasa por un filtro de
    // protocolo: cuando el modelo emite una llamada como TEXTO
    // (p. ej. <|tool_call|>…), el bloque se retiene y se descarta
    // — jamás se pinta. Sin filtro, el marcado crudo se veía en
    // el chat en vivo aunque el texto final ya viniera limpio.
    const APERTURAS_DELTA = [
      { re: /<\|tool_call\|>/, cierre: /<\|tool_call\|>/ },
      { re: /<tool_code>/, cierre: /<\/tool_code>/ },
      { re: /<tool_call>/, cierre: /<\/tool_call>/ },
      { re: /<tool_use>/, cierre: /<\/tool_use>/ },
      { re: /<dots_function_call>/, cierre: /<\/dots_function_call>/ },
      { re: /<function\s*=/, cierre: /<\/function>/ },
      // Dialecto JSON: la apertura es el inicio del objeto y el
      // «cierre» es su llave balanceada (centinela JSON_BALANCE).
      { re: /\{\s*"(?:tool|function)"\s*:/, cierre: "JSON_BALANCE" },
    ];
    let pendienteDelta = "";
    let cierreBloqueDelta = null;
    let temporizadorDelta = null;
    const emitirDelta = (s) => { if (s) { try { onTextDelta(s); } catch { /* pintar nunca tumba el turno */ } } };
    const vaciarDelta = (forzar = false) => {
      if (temporizadorDelta) { clearTimeout(temporizadorDelta); temporizadorDelta = null; }
      if (typeof onTextDelta !== "function") { pendienteDelta = ""; cierreBloqueDelta = null; return; }
      for (;;) {
        if (cierreBloqueDelta) {
          if (cierreBloqueDelta === "JSON_BALANCE") {
            // La apertura ya se consumió con la profundidad en 1:
            // se busca la llave que la balancea, respetando las
            // cadenas. Si aún no llega, se espera más stream.
            let profundidad = 1;
            let enCadena = false;
            let escape = false;
            let finJson = -1;
            for (let j = 0; j < pendienteDelta.length; j++) {
              const ch = pendienteDelta[j];
              if (enCadena) {
                if (escape) escape = false;
                else if (ch === "\\") escape = true;
                else if (ch === '"') enCadena = false;
                continue;
              }
              if (ch === '"') enCadena = true;
              else if (ch === "{") profundidad++;
              else if (ch === "}") {
                profundidad--;
                if (profundidad === 0) { finJson = j; break; }
              }
            }
            if (finJson < 0) {
              if (forzar) { pendienteDelta = ""; cierreBloqueDelta = null; continue; }
              return;
            }
            pendienteDelta = pendienteDelta.slice(finJson + 1);
            cierreBloqueDelta = null;
            continue;
          }
          const fin = pendienteDelta.search(cierreBloqueDelta);
          if (fin < 0) {
            if (forzar) { pendienteDelta = ""; cierreBloqueDelta = null; }
            return;
          }
          const corte = pendienteDelta.slice(fin).match(cierreBloqueDelta)[0].length;
          pendienteDelta = pendienteDelta.slice(fin + corte);
          cierreBloqueDelta = null;
          continue;
        }
        let apertura = null;
        let idxApertura = -1;
        for (const a of APERTURAS_DELTA) {
          const i = pendienteDelta.search(a.re);
          if (i >= 0 && (idxApertura < 0 || i < idxApertura)) { idxApertura = i; apertura = a; }
        }
        if (apertura) {
          emitirDelta(pendienteDelta.slice(0, idxApertura));
          // La apertura se consume ANTES de buscar el cierre: en
          // el formato Gemma apertura y cierre son el MISMO
          // marcador, y sin consumirla el propio abridor se
          // confundía con el cierre y el bloque se pintaba.
          const largoApertura = pendienteDelta.slice(idxApertura).match(apertura.re)[0].length;
          pendienteDelta = pendienteDelta.slice(idxApertura + largoApertura);
          cierreBloqueDelta = apertura.cierre;
          continue;
        }
        // Sin apertura a la vista: se emite todo menos una cola
        // corta (un marcador puede venir partido entre deltas);
        // al forzar, la cola pasa por el limpiador completo.
        if (forzar) {
          emitirDelta(stripTextToolMarkup(pendienteDelta));
          pendienteDelta = "";
        } else if (pendienteDelta.length > 16) {
          emitirDelta(pendienteDelta.slice(0, -16));
          pendienteDelta = pendienteDelta.slice(-16);
        }
        return;
      }
    };
    // UN intento contra el proveedor, con sus tiempos medidos en
    // el cable: cuándo llegó el primer delta de CONTENIDO (el
    // razonamiento no pinta ni cuenta) y cuánto duró. El desglose
    // separa «el modelo tardó en empezar» de «tardó generando».
    let avisoDado = false;
    const intentar = async () => {
      const t0 = Date.now();
      let primerMs = null;
      // Latido de espera: mientras no llega el primer delta de
      // CONTENIDO (el razonamiento no cuenta ni se pinta), el
      // turno dice que sigue en ello cada latidoMs. Un minuto de
      // silencio total ante un «Trabajando…» se siente roto
      // aunque la espera sea del proveedor (juicio en vivo,
      // 2026-11-17). Sin onAviso no hay latido.
      let latido = null;
      let contadorLatidos = 0;
      if (typeof onAviso === "function" && Number(latidoMs) > 0) {
        latido = setInterval(() => {
          if (primerMs !== null) return;
          contadorLatidos += 1;
          const segs = contadorLatidos * Math.round(Number(latidoMs) / 1000);
          try { onAviso(`Pensando… (${segs}s)`); } catch { /* avisar nunca tumba el turno */ }
        }, Number(latidoMs));
        latido.unref?.();
      }
      const onDelta = (d, meta) => {
        if (!d || meta?.reasoning) return;
        if (primerMs === null) primerMs = Date.now() - t0;
        if (typeof onTextDelta !== "function") return;
        pendienteDelta += d;
        if (pendienteDelta.length >= 240) { vaciarDelta(); return; }
        if (!temporizadorDelta) temporizadorDelta = setTimeout(vaciarDelta, 120);
      };
      try {
        const mensajesProveedor = aMensajesProveedor(mensajes, perfil.imagenes || []);
        if (fronteraCache < 0) fronteraCache = mensajesProveedor.length - 1;
        const r = await callChat({
          apiBaseUrl: perfil.apiBaseUrl,
          apiKey: perfil.apiKey,
          model: perfil.model,
          messages: mensajesProveedor,
          cachePrefixEndIndex: fronteraCache,
          tools,
          signal: perfil.signal || undefined,
          fallbackProfiles: perfil.fallbackProfiles || [],
          refreshApiKey: perfil.refreshAccessToken || null,
          maxTokens: Number(maxTokens) > 0 ? Number(maxTokens) : 0,
          timeoutMs: TIMEOUT_INTENTO_MS,
          onTextDelta: onDelta,
          ...(typeof onAviso === "function" ? {
            onRetry: () => {
              if (avisoDado) return;
              avisoDado = true;
              try { onAviso("El modelo no respondió a tiempo; lo intento de nuevo…"); } catch { /* avisar nunca tumba el turno */ }
            },
          } : {}),
        });
        return { resp: r, primerMs, durMs: Date.now() - t0 };
      } finally {
        if (latido) { clearInterval(latido); latido = null; }
        vaciarDelta(true);
      }
    };
    const interpretar = (resp) => {
      const textoCrudo = String(resp?.content ?? resp?.text ?? "");
      let toolCalls = normalizarToolCalls(resp?.toolCalls || resp?.tool_calls);
      // Protocolo de texto: algunos modelos emiten la llamada como
      // marcado en el texto (p. ej. <tool_code>) en vez de toolCalls
      // nativas. Sin rescate, la llamada jamás se ejecuta y el
      // marcado crudo termina pintado en el chat como respuesta.
      if (!toolCalls.length && textoCrudo) {
        const deTexto = parseTextToolCalls(textoCrudo, { projectRoot });
        if (deTexto.length) toolCalls = normalizarToolCalls(deTexto);
      }
      // Registro de diagnóstico: la respuesta TAL COMO LLEGÓ,
      // antes de cualquier limpieza — qué emitió el modelo en
      // realidad cuando un turno «narra y no ejecuta».
      if (typeof onRespuestaCruda === "function") {
        try {
          onRespuestaCruda({
            textoCrudo: textoCrudo.slice(0, 30000),
            nEstructurales: (resp?.toolCalls || resp?.tool_calls || []).length,
            nFinales: toolCalls.length,
            finishReason: resp?.finishReason || resp?.finish_reason || null,
            parcial: resp?.partial === true || !!resp?.streamError,
          });
        } catch { /* registrar nunca tumba el turno */ }
      }
      return {
        // El texto que sigue SIEMPRE va limpio de marcado de
        // protocolo: ni al bucle ni a la vista llega XML de tools.
        texto: stripTextToolMarkup(textoCrudo),
        toolCalls,
        uso: { total: totalDeUso(resp?.usage) },
        // Parcial propagado: si el stream se cortó, la respuesta
        // es parcial y el turno debe declararlo, no presentarla
        // como completa (el adaptador viejo descartaba estas
        // banderas y un stream cortado pasaba por respuesta plena).
        parcial: resp?.partial === true || !!resp?.streamError,
        // Corte por tope de salida (finish_reason "length"): la
        // respuesta quedó a mitad de frase sin error de stream.
        // El bucle lo repara pidiendo la continuación una vez.
        cortadaPorTope: resp?.finishReason === "length" || resp?.finish_reason === "length",
      };
    };

    const primero = await intentar();
    let salida = interpretar(primero.resp);
    let tiempos = { primerDeltaMs: primero.primerMs, duracionMs: primero.durMs };
    // [v5.2.7 — corrección] Respuesta CORTADA y casi vacía en una
    // llamada SIN herramientas: no hay llamadas a medio escribir
    // que proteger (el riesgo que la guarda interna del proveedor
    // evita al no reintentar tras contenido) y 50 caracteres no son
    // una respuesta. Se pide UNA vez más, aquí, y se conserva la
    // mejor de las dos; el uso suma ambas, sin maquillar el costo.
    if (salida.parcial && !tools.length && salida.texto.trim().length < 200) {
      try {
        const segundo = await intentar();
        const salida2 = interpretar(segundo.resp);
        const usoTotal = { total: salida.uso.total + salida2.uso.total };
        tiempos = {
          primerDeltaMs: primero.primerMs !== null
            ? primero.primerMs
            : (segundo.primerMs !== null ? primero.durMs + segundo.primerMs : null),
          duracionMs: primero.durMs + segundo.durMs,
        };
        salida = (!salida2.parcial || salida2.texto.trim().length > salida.texto.trim().length)
          ? { ...salida2, uso: usoTotal }
          : { ...salida, uso: usoTotal };
      } catch { /* si el segundo intento cae, vale la parcial ya declarada */ }
    }
    // Tiempos medidos de la llamada (primer texto / duración):
    // el bucle los suma al desglose del turno.
    return { ...salida, tiempos };
  };
}

function crearEjecutarHerramienta({ execute, root, helpers, onActividad = null, onToolProgress = null }) {
  const readCache = new Map();
  // Narración en vivo del turno: cada herramienta ejecutada deja
  // UNA línea en la superficie por el canal de narración — la
  // espera deja de ser un «Trabajando…» mudo (reproche en vivo,
  // 2026-11-18: con un turno de más de un minuto la superficie
  // no explicaba qué se estaba haciendo). Narrar jamás tumba
  // una herramienta.
  const narrar = (nombreN, argsN, okN, resumenN) => {
    if (typeof onActividad !== "function") return;
    try {
      let destino = "";
      if (nombreN === "run_command" || nombreN === "build_project") destino = String(argsN?.command || "").trim().replace(/\s+/g, " ").slice(0, 70);
      else if (argsN?.path) destino = String(argsN.path).slice(0, 70);
      const lineasRes = String(resumenN || "").split("\n").map((l) => l.trim()).filter(Boolean);
      let detalle = lineasRes.find((l) => l.startsWith("Resultado:")) || lineasRes[0] || "";
      // Sanitizar si el detalle es JSON crudo o volcado de depuración interna
      if (detalle.startsWith("{") && (detalle.includes('"ok"') || detalle.includes('"snapshotId"') || detalle.includes('"path"'))) {
        detalle = okN ? "completado exitosamente" : "falló la operación";
      }
      onActividad(`${okN ? "✓" : "✗"} ${nombreN}${destino ? ` · ${destino}` : ""}${detalle ? ` — ${detalle.slice(0, 110)}` : ""}`);
    } catch { /* narrar nunca tumba el turno */ }
  };
  return async function ejecutarHerramienta(nombre, args) {
    // [FASE2-RUTA-UNICA] Detener también corta ENTRE el proveedor y
    // la herramienta: si la señal del turno ya abortó cuando el
    // modelo devuelve una llamada, la herramienta NO se ejecuta
    // (antes la señal solo llegaba a callChat y una escritura
    // devuelta tras el Detener se aplicaba igual). El resultado es
    // un rechazo declarado, no un silencio.
    if (helpers?.abortSignal?.aborted) {
      return { ok: false, resumen: "Turno detenido: la herramienta no se ejecutó." };
    }
    const normPath = String(args?.path || "").trim().replace(/\\/g, "/").toLowerCase();
    if (typeof onToolProgress === "function") {
      try {
        onToolProgress({
          phase: "tool",
          name: nombre,
          input: args || {},
          stage: "running",
          path: args?.path || args?.filePath || args?.command || "",
        });
      } catch { /* ignore */ }
    }
    if (nombre === "read_file" && normPath && readCache.has(normPath)) {
      const cached = readCache.get(normPath);
      narrar(nombre, args, true, `${cached.resumen} (desde caché de lectura)`);
      if (typeof onToolProgress === "function") {
        try {
          onToolProgress({
            phase: "tool",
            name: nombre,
            input: args || {},
            ok: true,
            stage: "done",
            path: args?.path || "",
            result: { ok: true, resumen: cached.resumen },
          });
        } catch { /* ignore */ }
      }
      return { ok: true, resumen: cached.resumen, cacheHit: true };
    }
    if (normPath && (nombre === "write_file" || nombre === "replace_in_file")) {
      readCache.delete(normPath);
    }
    let r;
    try {
      r = await execute(nombre, args || {}, root, true, helpers || {});
    } catch (err) {
      const resumenErr = String(err?.message || err).slice(0, 300);
      narrar(nombre, args, false, resumenErr);
      if (typeof onToolProgress === "function") {
        try {
          onToolProgress({
            phase: "tool",
            name: nombre,
            input: args || {},
            ok: false,
            stage: "done",
            path: args?.path || args?.filePath || args?.command || "",
            error: resumenErr,
          });
        } catch { /* ignore */ }
      }
      return { ok: false, resumen: resumenErr };
    }
    const ok = r?.ok !== false;
    if (typeof onToolProgress === "function") {
      try {
        onToolProgress({
          phase: "tool",
          name: nombre,
          input: args || {},
          ok,
          stage: "done",
          path: args?.path || args?.filePath || args?.command || "",
          result: r,
        });
      } catch { /* ignore */ }
    }
    // Listados: el modelo recibe un texto determinista con los
    // conteos PRIMERO (no un JSON cortado a 2.000 caracteres del
    // que tenga que adivinar el total), y el dato estructurado
    // viaja aparte para que el bucle lo anote en los hechos.
    if (nombre === "list_files" && ok && r && typeof r === "object" && (Array.isArray(r.dirs) || Array.isArray(r.files))) {
      const dirs = Array.isArray(r.dirs) ? r.dirs : [];
      const files = Array.isArray(r.files) ? r.files : [];
      const totalDirs = Number.isFinite(r.totalDirs) ? r.totalDirs : dirs.length;
      const totalFiles = Number.isFinite(r.totalFiles) ? r.totalFiles : files.length;
      const truncado = r.truncated === true || totalDirs > dirs.length || totalFiles > files.length;
      const carpeta = String(r.path || args?.path || ".");
      const lineas = [`Carpeta ${carpeta}: ${totalDirs} carpetas, ${totalFiles} archivos.`];
      if (dirs.length) lineas.push(`Carpetas: ${dirs.join(", ")}`);
      if (files.length) lineas.push(`Archivos: ${files.join(", ")}`);
      if (truncado) {
        lineas.push(`Listado parcial: se muestran ${dirs.length + files.length} de ${totalDirs + totalFiles} elementos; hay más elementos de los mostrados.`);
      }
      if (typeof r.message === "string" && r.message) lineas.push(r.message);
      const resumenListado = lineas.join("\n").slice(0, 2000);
      narrar(nombre, args, ok, resumenListado);
      return {
        ok,
        resumen: resumenListado,
        listado: { path: carpeta, totalDirs, totalFiles, truncated: truncado },
      };
    }
    let resumen = "";
    // [2026-11-18 — LA causa raíz del «falló run_command»] El
    // resumen genérico de abajo tomaba r.output (stdout) y NADA
    // más: el código de salida y stderr jamás llegaban al modelo,
    // y un comando fallido sin stdout le llegaba como la palabra
    // «fallo», sin causa. El modelo volaba ciego: no podía leer
    // el error ni cambiar de curso, reintentaba variaciones y el
    // turno moría (registro 2026-11-17: run_command ×2; registro
    // 2026-11-18: ×3 tras 51 pasos). Los comandos se resumen
    // aquí de forma determinista: resultado y código primero, el
    // error declarado, la COLA de stderr y la cola de stdout —
    // el mismo criterio que shapeToolPayload ya aplicaba en la
    // ruta vieja (stderr antes que output) y que esta costura
    // había perdido.
    if ((nombre === "run_command" || nombre === "build_project") && r && typeof r === "object" && !Array.isArray(r)) {
      const cola = (s, n) => { const t = String(s || "").trim(); return t.length > n ? `…${t.slice(-n)}` : t; };
      const lineasCmd = [];
      const cmdTxt = String(args?.command || r.command || "").trim().replace(/\s+/g, " ").slice(0, 160);
      if (cmdTxt) lineasCmd.push(`Comando: ${cmdTxt}`);
      if (r.timeout) lineasCmd.push("Resultado: superó el límite de tiempo y fue terminado.");
      else if (r.aborted) lineasCmd.push("Resultado: detenido por el usuario.");
      else if (ok) lineasCmd.push(`Resultado: OK (código ${r.code ?? 0}).`);
      else lineasCmd.push(`Resultado: FALLÓ (código de salida ${r.code ?? "desconocido"}).`);
      if (r.error && !/^Exit code\b/.test(String(r.error))) lineasCmd.push(`Error: ${String(r.error).slice(0, 300)}`);
      const errTxt = cola(r.stderr, 1100);
      if (errTxt) lineasCmd.push(`stderr:\n${errTxt}`);
      const outTxt = cola(r.output ?? r.stdout, 500);
      if (outTxt) lineasCmd.push(`stdout:\n${outTxt}`);
      resumen = lineasCmd.join("\n").slice(0, 2000);
    }
    if (!resumen) {
      if (nombre === "write_file") {
        resumen = ok
          ? (r?.bytes ? `Archivo escrito correctamente (${r.bytes} bytes).` : "Archivo escrito correctamente.")
          : `Error al escribir archivo: ${r?.error || "fallo"}`;
      } else if (nombre === "replace_in_file") {
        resumen = ok
          ? (r?.replacements ? `Cambios aplicados correctamente (${r.replacements} reemplazos).` : "Cambios aplicados correctamente.")
          : `Error al editar archivo: ${r?.error || "fallo"}`;
      } else if (typeof r === "string") resumen = r;
      else if (typeof r?.content === "string") resumen = r.content;
      else if (typeof r?.output === "string") resumen = r.output;
      else if (r?.error) resumen = String(r.error);
      else if (Array.isArray(r?.files)) resumen = r.files.map((f) => (typeof f === "string" ? f : f?.path || f?.name || "")).filter(Boolean).join("\n");
      else if (r && typeof r === "object") {
        if (r.ok !== false && (r.path || r.snapshotId || r.reviewQueued)) {
          let baseMsg = `Operación completada en ${r.path || args?.path || "archivo"}.`;
          if (r.syntaxWarning || r.selfHealHint) {
            baseMsg += `\n⚠️ ALERTA DE SINTAXIS (Autocorrección): ${r.syntaxWarning || ""}. ${r.selfHealHint || ""}`;
          }
          if (r.directionNote) {
            baseMsg += `\n${r.directionNote}`;
          }
          resumen = baseMsg;
        } else {
          try { resumen = JSON.stringify(r).slice(0, 2000); } catch { resumen = ok ? "ok" : "fallo"; }
        }
      }
    }
    if (!resumen) resumen = ok ? "ok" : "fallo";
    const creaArchivo = /^(write_file|replace_in_file|create_pdf|create_word|create_excel|create_csv)$/.test(nombre);
    let archivoAplicado = ok && creaArchivo && (r?.path || args?.path)
      ? String(r?.path || args.path)
      : undefined;
    // La ruta del entregable viaja RELATIVA al proyecto cuando
    // la herramienta devolvió la absoluta: es la forma que la
    // superficie usa para abrirlo (project:open-path la resuelve
    // contra la raíz) y la que el cierre debe nombrar.
    if (archivoAplicado && path.isAbsolute(archivoAplicado)) {
      const rel = path.relative(path.resolve(root || "."), path.resolve(archivoAplicado));
      if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
        archivoAplicado = rel.replace(/\\/g, "/");
      }
    }
    const archivoBytes = archivoAplicado && Number.isFinite(Number(r?.bytes)) ? Number(r.bytes) : undefined;
    const resumenFinal = String(resumen).slice(0, 2000);
    if (nombre === "read_file" && ok && normPath) {
      readCache.set(normPath, { resumen: resumenFinal });
    }
    narrar(nombre, args, ok, resumenFinal);
    return { ok, resumen: resumenFinal, archivoAplicado, archivoBytes };
  };
}

// [Rendimiento — juicio en vivo v5.2.7] El historial se acota por
// MENSAJES y por CARACTERES: el tope de 20 mensajes sin tope de
// tamaño dejaba pasar respuestas gigantes (una tabla forense de
// cientos de líneas) en CADA turno, y el proveedor tardaba minutos
// en generar sobre esa petición. Se conservan los mensajes más
// recientes hasta el tope de caracteres; un mensaje único que por
// sí solo lo supera entra recortado por la cola, con marca — el
// hilo no se pierde, el peso sí.
const HISTORIAL_MAX_MENSAJES = 20;
const HISTORIAL_MAX_CARACTERES = 32_000;

function seleccionarHistorial(crudo) {
  const limpios = (Array.isArray(crudo) ? crudo : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-HISTORIAL_MAX_MENSAJES);
  const elegidos = [];
  let total = 0;
  for (let i = limpios.length - 1; i >= 0; i--) {
    const m = limpios[i];
    if (total + m.content.length <= HISTORIAL_MAX_CARACTERES) {
      elegidos.unshift({ role: m.role, content: m.content });
      total += m.content.length;
      continue;
    }
    if (!elegidos.length) {
      const cola = m.content.slice(-HISTORIAL_MAX_CARACTERES);
      elegidos.unshift({ role: m.role, content: `[…recortado: el mensaje original era más largo]\n${cola}` });
    }
    break;
  }
  return elegidos;
}

async function manejarChatNuevo(input, deps = {}) {
  const callChat = deps.callChat || require("../provider").callChat;
  const toolsMod = deps.toolsMod || require("../tools");
  const execute = deps.execute || toolsMod.execute;
  const getToolDefinitions = deps.getToolDefinitions || toolsMod.getToolDefinitions;

  const definicionesCrudas = getToolDefinitions({ allowWrite: true, isFullAccess: true }) || [];
  // La dieta de descripciones (K1 de la v5.1.9) va EN EL CABLE:
  // mismo set y mismos esquemas, descripciones a primera frase.
  // El payload completo sin dietar medía 30.794 caracteres con las
  // 65 herramientas; dietado, 23.386. Era maquinaria del
  // orquestador viejo y el kernel nuevo la hereda aquí, en su
  // único punto de construcción de definiciones.
  const definiciones = typeof toolsMod.slimToolDefinitions === "function"
    ? toolsMod.slimToolDefinitions(definicionesCrudas)
    : definicionesCrudas;
  const herramientasCompletas = definiciones.map((d) => d?.function?.name).filter(Boolean);

  const perfil = {
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    model: input.model,
    fallbackProfiles: input.fallbackProfiles || [],
    signal: input.helpers?.abortSignal || null,
    refreshAccessToken: input.helpers?.refreshAccessToken || null,
    // Solo data:/http(s): una ruta local no es una imagen válida
    // para el proveedor y no se disfraza como tal.
    imagenes: (Array.isArray(input.images) ? input.images : [])
      .filter((u) => typeof u === "string" && /^(data:|https?:\/\/)/.test(u)),
  };
  // El carril se decide dos veces con la MISMA función pura (aquí
  // para el tope de salida, dentro del bucle para el mecanismo):
  // decidirTurno es determinista, así que ambas decisiones coinciden
  // siempre.
  const textoCrudo = String(input.message || "");
  // El texto enlatado del flujo de análisis («AUTORIZACION DE
  // EJECUCION (PROCEDE): …») SOLO lo produce la ruta autorizada
  // del renderer: su sola presencia ya es la autorización como
  // dato, aunque la bandera no hubiera llegado.
  const esEnlatado = /^\s*AUTORIZACION DE EJECUCION \(PROCEDE\)/.test(textoCrudo);
  const ejecucionAutorizada = input.planAuthorizedExecution === true || esEnlatado;
  // Mensaje efectivo: el enlatado NO llega al modelo. Trae un
  // plan guardado fuera de la conversación que secuestraba el
  // turno (en «sistemas contino» mandaba al agente a construir
  // sobre rental-equipment-saas cuando lo aprobado en el hilo
  // era otro SaaS en la raíz). La conversación manda: el modelo
  // recibe la orden de ejecutar lo acordado en el hilo, con la
  // petición original del usuario — la única parte del enlatado
  // que es suya — como referencia.
  let mensajeEfectivo = textoCrudo;
  const esAprobacionCorta = !esEnlatado && Boolean(input.projectRoot) && (
    /^\s*(?:s[ií][,.]?\s*)?(?:procede|adelante|hazlo|dale|va|contin[uú]a|sigue|avanza|ejecuta)\b/i.test(textoCrudo)
    || /^\s*(?:s[ií]|ok|de acuerdo|perfecto|dale|va)[.!… ]*$/i.test(textoCrudo)
  );
  if (esEnlatado) {
    const seccion = (re) => {
      const m = textoCrudo.match(re);
      return m ? m[1].trim() : "";
    };
    const tarea = seccion(/TAREA CONCRETA:\s*\n([\s\S]*?)(?:\n\n|$)/)
      || seccion(/SOLICITUD ORIGINAL \(sanitizada\):\s*\n([\s\S]*?)(?:\n\n|$)/);
    mensajeEfectivo = [
      "El usuario autorizó con «procede» lo acordado en esta conversación. Ejecuta AHORA con herramientas, en la raíz del proyecto abierto, lo propuesto y aprobado en los mensajes anteriores de este hilo; la conversación manda sobre cualquier plan guardado fuera de ella.",
      tarea ? `La petición original del usuario fue:\n${tarea}` : "",
    ].filter(Boolean).join("\n\n");
  } else if (esAprobacionCorta) {
    mensajeEfectivo = [
      textoCrudo,
      "[Instrucción de ejecución agéntica]: El usuario ha dado luz verde para proceder ('procede'). No repitas el informe anterior, no vuelvas a preguntar qué opción prefiere y no te quedes en bucle de pasividad. Ejecuta de inmediato con las herramientas reales el siguiente paso pendiente de mayor prioridad en la lista acordada (o en secuencia lógica: dependencias con run_command, archivos, configuración). Actúa ahora.",
    ].join("\n\n");
  }
  // La autorización fuerza ORDEN solo sobre lo que no es una
  // pregunta: si el clasificador dice CONVERSACION (pregunta o
  // conversación), el turno se responde como conversación
  // aunque el flag venga puesto — una pregunta no se
  // «ejecuta». El enlatado queda fuera de esta guarda: ÉL es
  // la autorización y su mensaje efectivo ya es la orden.
  const clasificacion = decidirTurno(
    mensajeEfectivo,
    contextoDesdeHistorial(input.history || input.messages || []),
  );
  const fuerzaOrden = (ejecucionAutorizada || esAprobacionCorta)
    && (esEnlatado || esAprobacionCorta || clasificacion.carril !== "CONVERSACION");
  const carrilPrevisto = fuerzaOrden ? "ORDEN" : clasificacion.carril;
  const llamarModelo = crearLlamarModelo({
    callChat,
    perfil,
    definiciones,
    projectRoot: input.projectRoot || process.cwd(),
    onTextDelta: typeof deps.onTextDelta === "function" ? deps.onTextDelta : null,
    // Con proyecto abierto el tope de salida es el de ORDEN
    // (sin tope): el turno puede emitir llamadas a herramientas
    // grandes y un tope de «conversación» las truncaría a mitad
    // de JSON — la capacidad estructural manda también aquí.
    maxTokens: input.projectRoot ? 0 : (TOPE_SALIDA_POR_CARRIL[carrilPrevisto] || 0),
    onAviso: typeof deps.onAviso === "function" ? deps.onAviso : null,
    ...(Number(deps.latidoMs) > 0 ? { latidoMs: Number(deps.latidoMs) } : {}),
    onRespuestaCruda: typeof deps.onRespuestaCruda === "function" ? deps.onRespuestaCruda : null,
  });
  // El turno habla desde el primer segundo: la superficie narra
  // qué se puso en marcha según el carril, en vez de un
  // «Trabajando…» mudo hasta que el modelo entrega algo.
  if (typeof deps.onAviso === "function") {
    const AVISO_INICIAL = {
      ORDEN: "Manos a la obra: ejecuto tu orden…",
      PROPUESTA: "Preparo la propuesta…",
      CONSULTA: "Reviso el proyecto para responderte…",
    };
    const avisoInicial = AVISO_INICIAL[carrilPrevisto];
    if (avisoInicial) { try { deps.onAviso(avisoInicial); } catch { /* avisar nunca tumba el turno */ } }
  }
  const ejecutarHerramienta = crearEjecutarHerramienta({
    execute,
    root: input.projectRoot || process.cwd(),
    helpers: input.helpers || {},
    onActividad: typeof deps.onActividad === "function" ? deps.onActividad : null,
    onToolProgress: typeof deps.onToolProgress === "function" ? deps.onToolProgress : null,
  });

  const tMemoria = Date.now();
  const memoriaExtra = typeof deps.construirMemoria === "function" ? await deps.construirMemoria(input) : "";
  const memoriaMs = Date.now() - tMemoria;
  const memoria = [SISTEMA_NUCLEO, memoriaExtra, String(input.skillsPrompt || "")]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n\n");

  const historialCrudo = Array.isArray(input.history) ? input.history : (Array.isArray(input.messages) ? input.messages : []);
  const historial = seleccionarHistorial(historialCrudo);

  const resultado = await ejecutarTurno({
    ...(fuerzaOrden ? { carrilForzado: "ORDEN" } : {}),
    // Capacidad estructural: hay proyecto abierto — el turno
    // ofrece el set completo de herramientas decida lo que
    // decida la forma del texto (ver turno.js).
    conHerramientas: Boolean(input.projectRoot),
    texto: mensajeEfectivo,
    llamarModelo,
    ejecutarHerramienta,
    herramientasCompletas,
    memoria,
    historial,
    memoriaMs,
    steeringQueue: input.steeringQueue || deps.steeringQueue || [],
  });
  const cierre = componerCierre({ resultado });

  return {
    ok: true,
    text: cierre.voz,
    vozOriginal: cierre.vozOriginal,
    detalle: cierre.detalle,
    cierreCorregida: cierre.corregida,
    kind: resultado.carril,
    steps: resultado.hechos.pasos,
    usage: { total_tokens: resultado.tokensUsados, kernel_nuevo: true },
    mutations: resultado.hechos.aplicados,
    // Archivos entregables del turno: la superficie los pinta
    // en la burbuja como chips que abren el archivo con un clic.
    archivos: (resultado.hechos.archivos || []).map((a) => {
      const p = String(a?.path || "");
      const entrada = { path: p, nombre: p.split(/[\\/]/).filter(Boolean).pop() || p };
      if (Number.isFinite(a?.bytes)) entrada.bytes = a.bytes;
      return entrada;
    }),
    incomplete: resultado.presupuestoAgotado === true || resultado.respuestaParcial === true,
    // Desglose medido del turno (también va en el detalle de hechos).
    tiempos: resultado.tiempos || null,
    threadId: String(input.threadId || input.chatId || ""),
    runId: String(input.runId || ""),
    kernelNuevo: true,
  };
}

module.exports = { manejarChatNuevo, crearLlamarModelo, crearEjecutarHerramienta, normalizarToolCalls, aMensajesProveedor, totalDeUso, seleccionarHistorial, TOPE_SALIDA_POR_CARRIL };
