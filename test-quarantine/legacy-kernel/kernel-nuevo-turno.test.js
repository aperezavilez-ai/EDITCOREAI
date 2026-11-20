"use strict";
// ============================================================
// BATERÍA — KERNEL NUEVO: bucle de turno por carril.
// Sin proveedor real: el modelo es un guion. Lo que se prueba
// es el MECANISMO del kernel, no al modelo:
//  - CONVERSACION/PROPUESTA: 1 llamada y herramientas = []
//    (el modelo no puede explorar porque no recibe con qué).
//  - CONSULTA: solo lectura dirigida; una escritura pedida por
//    el modelo se DENIEGA en el despacho y queda registrada.
//  - ORDEN: bucle con hechos; el resumen lo generan los hechos,
//    no el relato — sin aplicados dice «sin cambios aplicados»
//    aunque el modelo declare «todo completado».
//  - Presupuesto de tokens por carril: al agotarse, el turno se
//    cierra con lo que hay y el hecho queda en el resumen.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const { ejecutarTurno, PRESUPUESTOS } = require("../editcore-chat-kernel/nuevo/turno");

function proveedorGuion(guion) {
  const llamadas = [];
  const fn = async ({ herramientas }) => {
    llamadas.push((herramientas || []).slice());
    const paso = guion[Math.min(llamadas.length - 1, guion.length - 1)];
    return typeof paso === "function" ? paso() : paso;
  };
  fn.llamadas = llamadas;
  return fn;
}

test("CONVERSACION: una sola llamada y el modelo recibe cero herramientas", async () => {
  const prov = proveedorGuion([
    { toolCalls: [{ nombre: "read_file", args: {} }], texto: "respuesta directa", uso: { total: 900 } },
  ]);
  let herramientasEjecutadas = 0;
  const r = await ejecutarTurno({
    texto: "realizaste el analisis o leiste un analisis creado por otra ia, no es lo que te pedi",
    llamarModelo: prov,
    ejecutarHerramienta: async () => { herramientasEjecutadas += 1; return { ok: true }; },
  });
  assert.equal(r.carril, "CONVERSACION");
  assert.equal(r.llamadas, 1);
  assert.deepEqual(prov.llamadas[0], []);
  assert.equal(herramientasEjecutadas, 0);
  assert.equal(r.textoFinal, "respuesta directa");
});

test("PROPUESTA: una sola llamada, sin herramientas, sin ejecutar", async () => {
  const prov = proveedorGuion([{ texto: "mi propuesta es…", uso: { total: 1200 } }]);
  const r = await ejecutarTurno({
    texto: "que propones para corregir editcoreai",
    llamarModelo: prov,
    ejecutarHerramienta: async () => { throw new Error("no debio ejecutarse"); },
  });
  assert.equal(r.carril, "PROPUESTA");
  assert.equal(r.llamadas, 1);
  assert.deepEqual(prov.llamadas[0], []);
});

test("CONSULTA: lee lo dirigido y DENIEGA la escritura que el modelo pida", async () => {
  const prov = proveedorGuion([
    { toolCalls: [{ nombre: "search_files", args: { q: "getUserMediaWithTimeout" } }], uso: { total: 2000 } },
    { toolCalls: [{ nombre: "write_file", args: { path: "src/App.jsx" } }], uso: { total: 2000 } },
    { texto: "esta en src/App.jsx", uso: { total: 1500 } },
  ]);
  const ejecutadas = [];
  const r = await ejecutarTurno({
    texto: "¿dónde está la función getUserMediaWithTimeout en el código?",
    llamarModelo: prov,
    ejecutarHerramienta: async (nombre) => { ejecutadas.push(nombre); return { ok: true, resumen: "1 resultado" }; },
  });
  assert.equal(r.carril, "CONSULTA");
  assert.deepEqual(ejecutadas, ["search_files"]);
  assert.equal(r.hechos.denegadas.length, 1);
  assert.equal(r.hechos.denegadas[0].nombre, "write_file");
  assert.equal(r.textoFinal, "esta en src/App.jsx");
});

test("ORDEN: aplica, y el resumen sale de los hechos", async () => {
  const prov = proveedorGuion([
    { toolCalls: [{ nombre: "write_file", args: { path: "src/x.js" } }], uso: { total: 5000 } },
    { texto: "hecho", uso: { total: 3000 } },
  ]);
  const r = await ejecutarTurno({
    texto: "corrije el error del login",
    llamarModelo: prov,
    ejecutarHerramienta: async () => ({ ok: true, resumen: "escrito", archivoAplicado: "src/x.js" }),
    herramientasCompletas: ["write_file", "read_file"],
  });
  assert.equal(r.carril, "ORDEN");
  assert.deepEqual(r.hechos.aplicados, ["src/x.js"]);
  assert.match(r.resumen, /Aplicado: src\/x\.js/);
});

test("ORDEN: si el modelo declara completado sin aplicar, el resumen dice la verdad", async () => {
  const prov = proveedorGuion([
    { texto: "Listo, todo corregido y completado.", uso: { total: 4000 } },
  ]);
  const r = await ejecutarTurno({
    texto: "corrije todas las fallas",
    llamarModelo: prov,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: ["write_file"],
  });
  assert.equal(r.hechos.aplicados.length, 0);
  assert.match(r.resumen, /Sin cambios aplicados/);
});

test("ORDEN: un fallo de herramienta queda en el resumen, no se esconde", async () => {
  const prov = proveedorGuion([
    { toolCalls: [{ nombre: "write_file", args: {} }], uso: { total: 5000 } },
    { texto: "no pude", uso: { total: 2000 } },
  ]);
  const r = await ejecutarTurno({
    texto: "agrega el boton de exportar",
    llamarModelo: prov,
    ejecutarHerramienta: async () => ({ ok: false, resumen: "archivo bloqueado" }),
    herramientasCompletas: ["write_file"],
  });
  assert.match(r.resumen, /Fallos: write_file/);
});

test("respuesta parcial del proveedor: el turno la declara incompleta en el resumen", async () => {
  const prov = proveedorGuion([
    { texto: "La respuesta quedó a mit", uso: { total: 3000 }, parcial: true },
  ]);
  const r = await ejecutarTurno({
    texto: "¿qué queda pendiente?",
    llamarModelo: prov,
    ejecutarHerramienta: async () => ({ ok: true }),
  });
  assert.equal(r.respuestaParcial, true);
  assert.match(r.resumen, /Respuesta (parcial|incompleta|cortada)/);
});

test("ORDEN: el presupuesto de tokens cierra el turno y el hecho queda escrito", async () => {
  const prov = proveedorGuion([
    { toolCalls: [{ nombre: "read_file", args: {} }], uso: { total: 200000 } },
  ]);
  const r = await ejecutarTurno({
    texto: "corrije todas las fallas",
    llamarModelo: prov,
    ejecutarHerramienta: async () => ({ ok: true, resumen: "leido" }),
    herramientasCompletas: ["read_file"],
  });
  assert.equal(r.presupuestoAgotado, true);
  assert.ok(r.tokensUsados > PRESUPUESTOS.ORDEN.maxTokens);
  assert.ok(r.llamadas <= 3, `llamadas: ${r.llamadas}`);
  assert.match(r.resumen, /Presupuesto de tokens agotado/);
});
