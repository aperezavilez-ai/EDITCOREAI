"use strict";
// ============================================================
// KERNEL NUEVO — SUBAGENTES REALES Y CARRIL PARALELO
// Un subagente es una llamada REAL al modelo, con su propio
// hilo, solo sus herramientas y un TIMEOUT POR TAREA: una
// tarea colgada no bloquea a las demás ni a la oleada (en el
// kernel viejo no había timeout por tarea y 6 subagentes
// pudieron no entregar nada sin que el cierre lo supiera).
// Entrega = informe en texto. Todo lo demás es NO entrega con
// motivo (timeout / error_proveedor / sin_informe), y la
// auditoría lo nombra por id: «sin informe» jamás se disfraza.
// El carril paralelo atiende al usuario MIENTRAS la tarea
// principal corre, sin compartir estado con ella: preguntas,
// dudas, propuestas y consultas se responden en su propio
// turno; una ORDEN no se atiende ahí — escribir en paralelo a
// una tarea que escribe es inseguro — y va a la cola, dicho.
// ============================================================
const { decidirTurno } = require("./despacho");
const { ejecutarTurno } = require("./turno");

const MAX_PASOS_SUBAGENTE = 6;
const TIMEOUT_DEFECTO_MS = 60000;

async function correrSubagente(tarea, { llamarModelo, ejecutarHerramienta }) {
  const permitidas = new Set(Array.isArray(tarea.herramientas) ? tarea.herramientas : []);
  const mensajes = [
    {
      role: "system",
      content: `Subagente de EditCoreAI. Rol: ${tarea.rol}. Trabaja solo en tu encargo y cierra con un informe breve y concreto: qué encontraste o qué aplicaste, con la evidencia.`,
    },
    { role: "user", content: String(tarea.instruccion || "") },
  ];
  let llamadas = 0;
  let tokens = 0;
  while (llamadas < MAX_PASOS_SUBAGENTE) {
    const resp = await llamarModelo({ mensajes, herramientas: [...permitidas] });
    llamadas += 1;
    tokens += Number(resp?.uso?.total || 0);
    const pedidos = Array.isArray(resp?.toolCalls) ? resp.toolCalls : [];
    if (!pedidos.length) {
      const texto = String(resp?.texto || "").trim();
      return texto
        ? { entrego: true, texto, llamadas, tokens }
        : { entrego: false, motivoNoEntrega: "sin_informe", llamadas, tokens };
    }
    mensajes.push({ role: "assistant", toolCalls: pedidos });
    for (const pedido of pedidos) {
      const nombre = String(pedido?.nombre || "");
      if (!permitidas.has(nombre)) {
        mensajes.push({ role: "tool", nombre, content: "Herramienta no disponible para este subagente." });
        continue;
      }
      let r;
      try {
        r = await ejecutarHerramienta(nombre, pedido?.args || {});
      } catch (err) {
        r = { ok: false, resumen: String(err?.message || err).slice(0, 200) };
      }
      mensajes.push({ role: "tool", nombre, content: String(r?.resumen || (r?.ok === false ? "fallo" : "ok")) });
    }
  }
  return { entrego: false, motivoNoEntrega: "sin_informe", llamadas, tokens };
}

async function delegarUna(tarea, deps, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error("timeout");
      e.codigo = "timeout";
      reject(e);
    }, timeoutMs);
  });
  try {
    const r = await Promise.race([correrSubagente(tarea, deps), timeout]);
    return { id: tarea.id, rol: tarea.rol, ...r };
  } catch (err) {
    if (err?.codigo === "timeout") {
      return { id: tarea.id, rol: tarea.rol, entrego: false, motivoNoEntrega: "timeout", llamadas: 0, tokens: 0 };
    }
    return {
      id: tarea.id,
      rol: tarea.rol,
      entrego: false,
      motivoNoEntrega: "error_proveedor",
      detalle: String(err?.message || err).slice(0, 200),
      llamadas: 0,
      tokens: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Todas las tareas corren a la vez, cada una con su timeout:
// ninguna espera a otra ni muere con otra.
async function delegar(tareas, { llamarModelo, ejecutarHerramienta, timeoutMs = TIMEOUT_DEFECTO_MS } = {}) {
  const deps = { llamarModelo, ejecutarHerramienta };
  return Promise.all((tareas || []).map((t) => delegarUna(t, deps, timeoutMs)));
}

function delegacionCompleta(resultados) {
  return (resultados || []).every((r) => r.entrego === true);
}

function lineaAuditoria(resultados) {
  const rs = resultados || [];
  const entregaron = rs.filter((r) => r.entrego).length;
  let linea = `Subagentes: ${entregaron}/${rs.length} entregaron`;
  const faltantes = rs.filter((r) => !r.entrego);
  if (faltantes.length) {
    linea += ` · sin informe: ${faltantes.map((r) => `${r.id} (${r.motivoNoEntrega || "sin_informe"})`).join(", ")}`;
  }
  return linea;
}

// Carril paralelo: un turno independiente por llamada, sin
// estado compartido con la tarea principal.
async function atenderEnParalelo({ texto, llamarModelo, ejecutarHerramienta, memoria = "", historial = [] }) {
  const decision = decidirTurno(texto);
  if (decision.carril === "ORDEN") {
    return {
      atendido: false,
      motivo: "es_una_orden: va a la cola del turno principal; no se escribe en paralelo a una tarea en curso",
    };
  }
  const resultado = await ejecutarTurno({ texto, llamarModelo, ejecutarHerramienta, memoria, historial });
  return { atendido: true, resultado };
}

module.exports = { delegar, delegacionCompleta, lineaAuditoria, atenderEnParalelo, MAX_PASOS_SUBAGENTE };
