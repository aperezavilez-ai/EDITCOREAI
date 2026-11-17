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
const { ejecutarTurno } = require("./turno");
const { componerCierre } = require("./cierre");
const { SISTEMA_NUCLEO } = require("./textos");

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
    return {
      nombre: String(tc?.nombre || tc?.name || ""),
      args: tc?.args && typeof tc.args === "object" ? tc.args : {},
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

function crearLlamarModelo({ callChat, perfil, definiciones }) {
  const porNombre = new Map();
  for (const d of definiciones || []) {
    const nombre = d?.function?.name;
    if (nombre) porNombre.set(nombre, d);
  }
  return async function llamarModelo({ mensajes, herramientas }) {
    const tools = (herramientas || []).map((n) => porNombre.get(n)).filter(Boolean);
    const resp = await callChat({
      apiBaseUrl: perfil.apiBaseUrl,
      apiKey: perfil.apiKey,
      model: perfil.model,
      messages: aMensajesProveedor(mensajes, perfil.imagenes || []),
      tools,
      signal: perfil.signal || undefined,
      fallbackProfiles: perfil.fallbackProfiles || [],
      refreshApiKey: perfil.refreshAccessToken || null,
    });
    return {
      texto: String(resp?.content ?? resp?.text ?? ""),
      toolCalls: normalizarToolCalls(resp?.toolCalls || resp?.tool_calls),
      uso: { total: totalDeUso(resp?.usage) },
    };
  };
}

function crearEjecutarHerramienta({ execute, root, helpers }) {
  return async function ejecutarHerramienta(nombre, args) {
    let r;
    try {
      r = await execute(nombre, args || {}, root, true, helpers || {});
    } catch (err) {
      return { ok: false, resumen: String(err?.message || err).slice(0, 300) };
    }
    const ok = r?.ok !== false;
    let resumen = "";
    if (typeof r === "string") resumen = r;
    else if (typeof r?.content === "string") resumen = r.content;
    else if (typeof r?.output === "string") resumen = r.output;
    else if (r?.error) resumen = String(r.error);
    else if (Array.isArray(r?.files)) resumen = r.files.map((f) => (typeof f === "string" ? f : f?.path || f?.name || "")).filter(Boolean).join("\n");
    else if (r && typeof r === "object") { try { resumen = JSON.stringify(r).slice(0, 2000); } catch { resumen = ok ? "ok" : "fallo"; } }
    if (!resumen) resumen = ok ? "ok" : "fallo";
    const creaArchivo = /^(write_file|replace_in_file|create_pdf|create_word|create_excel|create_csv)$/.test(nombre);
    const archivoAplicado = ok && creaArchivo && (r?.path || args?.path)
      ? String(r?.path || args.path)
      : undefined;
    return { ok, resumen: String(resumen).slice(0, 2000), archivoAplicado };
  };
}

async function manejarChatNuevo(input, deps = {}) {
  const callChat = deps.callChat || require("../provider").callChat;
  const toolsMod = deps.toolsMod || require("../tools");
  const execute = deps.execute || toolsMod.execute;
  const getToolDefinitions = deps.getToolDefinitions || toolsMod.getToolDefinitions;

  const definiciones = getToolDefinitions({ allowWrite: true, isFullAccess: true }) || [];
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
  const llamarModelo = crearLlamarModelo({ callChat, perfil, definiciones });
  const ejecutarHerramienta = crearEjecutarHerramienta({
    execute,
    root: input.projectRoot || process.cwd(),
    helpers: input.helpers || {},
  });

  const memoriaExtra = typeof deps.construirMemoria === "function" ? await deps.construirMemoria(input) : "";
  const memoria = [SISTEMA_NUCLEO, memoriaExtra, String(input.skillsPrompt || "")]
    .map((s) => String(s || "").trim())
    .filter(Boolean)
    .join("\n\n");

  const historialCrudo = Array.isArray(input.history) ? input.history : (Array.isArray(input.messages) ? input.messages : []);
  const historial = historialCrudo
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  const resultado = await ejecutarTurno({
    texto: String(input.message || ""),
    llamarModelo,
    ejecutarHerramienta,
    herramientasCompletas,
    memoria,
    historial,
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
    incomplete: resultado.presupuestoAgotado === true,
    threadId: String(input.threadId || input.chatId || ""),
    runId: String(input.runId || ""),
    kernelNuevo: true,
  };
}

module.exports = { manejarChatNuevo, crearLlamarModelo, crearEjecutarHerramienta, normalizarToolCalls, aMensajesProveedor, totalDeUso };
