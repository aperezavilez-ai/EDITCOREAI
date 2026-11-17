"use strict";
// ============================================================
// KERNEL NUEVO — BUCLE DE TURNO POR CARRIL
// El carril (despacho.js) decide el mecanismo, no el modelo:
//  - CONVERSACION / PROPUESTA: UNA llamada al proveedor con la
//    lista de herramientas VACÍA. No es una instrucción de «no
//    explores»: el modelo no recibe con qué explorar.
//  - CONSULTA: solo las herramientas de lectura dirigida del
//    carril; cualquier otra que el modelo pida se deniega en el
//    despacho y queda registrada en los hechos.
//  - ORDEN: set completo del llamador, con presupuesto duro.
// Todo turno lleva un libro de HECHOS (pasos reales) y el
// resumen del turno se genera DESDE los hechos: el relato del
// modelo es su texto, pero la contabilidad no la escribe él.
// Presupuesto: al agotarse los tokens del carril, no se ejecuta
// ni una herramienta más; se hace UNA llamada de cierre sin
// herramientas y el agotamiento queda escrito en el resumen.
// ============================================================
const { decidirTurno } = require("./despacho");

const PRESUPUESTOS = {
  CONVERSACION: { maxLlamadas: 1, maxTokens: 12000, herramientas: [] },
  PROPUESTA: { maxLlamadas: 1, maxTokens: 16000, herramientas: [] },
  CONSULTA: { maxLlamadas: 4, maxTokens: 40000, herramientas: ["list_files", "read_file", "search_files", "read_pdf"] },
  ORDEN: { maxLlamadas: 30, maxTokens: 300000, herramientas: null }, // null = set completo del llamador
};

function resumenDeHechos({ carril, hechos, tokensUsados, llamadas, presupuestoAgotado }) {
  const lineas = [`Carril: ${carril} · llamadas: ${llamadas} · tokens: ${tokensUsados}`];
  if (hechos.aplicados.length) lineas.push(`Aplicado: ${hechos.aplicados.join(", ")}`);
  if (hechos.fallos.length) {
    lineas.push(`Fallos: ${hechos.fallos.map((f) => `${f.nombre} (${f.resumen || "sin detalle"})`).join("; ")}`);
  }
  if (hechos.denegadas.length) {
    lineas.push(`Denegadas por el carril: ${hechos.denegadas.map((d) => d.nombre).join(", ")}`);
  }
  if (carril === "ORDEN" && hechos.aplicados.length === 0) {
    lineas.push("Sin cambios aplicados en este turno.");
  }
  if (presupuestoAgotado) {
    lineas.push("Presupuesto de tokens agotado: el turno se cerró con lo que había, sin ejecutar más pasos.");
  }
  return lineas.join("\n");
}

async function ejecutarTurno({ texto, llamarModelo, ejecutarHerramienta, herramientasCompletas = [], memoria = "", historial = [] }) {
  const decision = decidirTurno(texto);
  const carril = decision.carril;
  const presupuesto = PRESUPUESTOS[carril];
  const herramientasDelCarril = presupuesto.herramientas === null
    ? herramientasCompletas.slice()
    : presupuesto.herramientas.slice();
  const permitidas = new Set(herramientasDelCarril);

  const mensajes = [];
  if (memoria) mensajes.push({ role: "system", content: memoria });
  for (const m of historial || []) mensajes.push(m);
  mensajes.push({ role: "user", content: String(texto || "") });

  const hechos = { pasos: [], aplicados: [], fallos: [], denegadas: [] };
  let llamadas = 0;
  let tokensUsados = 0;
  let presupuestoAgotado = false;
  let textoFinal = "";

  const llamadaCierre = async () => {
    const resp = await llamarModelo({ mensajes, herramientas: [] });
    llamadas += 1;
    tokensUsados += Number(resp?.uso?.total || 0);
    return String(resp?.texto || "");
  };

  while (llamadas < presupuesto.maxLlamadas) {
    const resp = await llamarModelo({ mensajes, herramientas: herramientasDelCarril });
    llamadas += 1;
    tokensUsados += Number(resp?.uso?.total || 0);

    if (tokensUsados > presupuesto.maxTokens) {
      presupuestoAgotado = true;
      textoFinal = String(resp?.texto || "") || (await llamadaCierre());
      break;
    }

    const pedidos = Array.isArray(resp?.toolCalls) ? resp.toolCalls : [];
    if (!pedidos.length || !herramientasDelCarril.length) {
      // Sin pedidos, o carril sin herramientas (los pedidos de un
      // carril sin herramientas se ignoran: nunca se ofrecieron).
      textoFinal = String(resp?.texto || "");
      break;
    }

    mensajes.push({ role: "assistant", toolCalls: pedidos });
    for (const pedido of pedidos) {
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
      if (paso.ok && resultado?.archivoAplicado) hechos.aplicados.push(String(resultado.archivoAplicado));
      if (!paso.ok) hechos.fallos.push(paso);
      mensajes.push({ role: "tool", nombre, content: paso.resumen || (paso.ok ? "ok" : "fallo") });
    }
  }

  if (!textoFinal && llamadas >= presupuesto.maxLlamadas && !presupuestoAgotado) {
    textoFinal = await llamadaCierre();
  }

  const resumen = resumenDeHechos({ carril, hechos, tokensUsados, llamadas, presupuestoAgotado });
  return { carril, textoFinal, llamadas, tokensUsados, presupuestoAgotado, hechos, resumen };
}

module.exports = { ejecutarTurno, resumenDeHechos, PRESUPUESTOS };
