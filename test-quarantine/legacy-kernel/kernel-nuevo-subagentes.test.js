"use strict";
// ============================================================
// BATERÍA — KERNEL NUEVO: subagentes reales y carril paralelo.
// Un subagente es una llamada REAL al modelo con su propio
// hilo, sus herramientas acotadas y su timeout por tarea.
// Entrega = texto de informe. Todo lo demás es NO entrega con
// motivo, y la auditoría lo nombra: en el kernel viejo 6
// subagentes no entregaron y el cierre declaró «completado».
// El carril paralelo atiende preguntas mientras la tarea
// principal sigue corriendo, sin tocar su estado; una ORDEN en
// paralelo NO se atiende ahí (escribir en paralelo es inseguro):
// va a la cola y el usuario lo sabe.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  delegar,
  lineaAuditoria,
  delegacionCompleta,
  atenderEnParalelo,
} = require("../editcore-chat-kernel/nuevo/subagentes");
const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");

test("subagente real: llama al modelo y entrega su informe", async () => {
  const prov = async () => ({ texto: "informe del explorador", uso: { total: 800 } });
  const [r] = await delegar(
    [{ id: "e1", rol: "explorador", instruccion: "mapea src/", herramientas: [] }],
    { llamarModelo: prov, ejecutarHerramienta: async () => ({ ok: true }), timeoutMs: 1000 },
  );
  assert.equal(r.entrego, true);
  assert.equal(r.texto, "informe del explorador");
  assert.ok(r.llamadas >= 1);
});

test("subagente colgado: el timeout lo corta y NO bloquea a los demás", async () => {
  const prov = async ({ mensajes }) => {
    const sys = String(mensajes[0]?.content || "");
    if (sys.includes("LENTO")) return new Promise(() => {}); // nunca responde
    return { texto: "informe rapido", uso: { total: 100 } };
  };
  const t0 = Date.now();
  const rs = await delegar(
    [
      { id: "lento", rol: "LENTO", instruccion: "x", herramientas: [] },
      { id: "rapido", rol: "explorador", instruccion: "y", herramientas: [] },
    ],
    { llamarModelo: prov, ejecutarHerramienta: async () => ({ ok: true }), timeoutMs: 60 },
  );
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 1500, `la delegacion tardo ${elapsed}ms: el colgado bloqueo la oleada`);
  const lento = rs.find((r) => r.id === "lento");
  const rapido = rs.find((r) => r.id === "rapido");
  assert.equal(lento.entrego, false);
  assert.equal(lento.motivoNoEntrega, "timeout");
  assert.equal(rapido.entrego, true);
});

test("error de proveedor y respuesta vacía son NO entrega con motivo", async () => {
  const provError = async () => { throw new Error("proveedor caido"); };
  const [r1] = await delegar(
    [{ id: "a", rol: "analista", instruccion: "x", herramientas: [] }],
    { llamarModelo: provError, ejecutarHerramienta: async () => ({ ok: true }), timeoutMs: 1000 },
  );
  assert.equal(r1.entrego, false);
  assert.equal(r1.motivoNoEntrega, "error_proveedor");

  const provVacio = async () => ({ texto: "   ", uso: { total: 50 } });
  const [r2] = await delegar(
    [{ id: "b", rol: "analista", instruccion: "x", herramientas: [] }],
    { llamarModelo: provVacio, ejecutarHerramienta: async () => ({ ok: true }), timeoutMs: 1000 },
  );
  assert.equal(r2.entrego, false);
  assert.equal(r2.motivoNoEntrega, "sin_informe");
});

test("subagente con herramientas: usa solo las suyas; otra se deniega", async () => {
  let turno = 0;
  const prov = async () => {
    turno += 1;
    if (turno === 1) return { toolCalls: [{ nombre: "read_file", args: {} }, { nombre: "write_file", args: {} }], uso: { total: 100 } };
    return { texto: "informe con evidencia", uso: { total: 100 } };
  };
  const ejecutadas = [];
  const [r] = await delegar(
    [{ id: "e", rol: "explorador", instruccion: "lee", herramientas: ["read_file"] }],
    { llamarModelo: prov, ejecutarHerramienta: async (n) => { ejecutadas.push(n); return { ok: true, resumen: "ok" }; }, timeoutMs: 1000 },
  );
  assert.deepEqual(ejecutadas, ["read_file"]);
  assert.equal(r.entrego, true);
});

test("auditoría: nombra a los que no entregaron y su motivo", async () => {
  const prov = async ({ mensajes }) => {
    if (String(mensajes[0]?.content || "").includes("MALO")) throw new Error("boom");
    return { texto: "informe", uso: { total: 10 } };
  };
  const rs = await delegar(
    [
      { id: "bueno", rol: "explorador", instruccion: "x", herramientas: [] },
      { id: "malo", rol: "MALO", instruccion: "x", herramientas: [] },
    ],
    { llamarModelo: prov, ejecutarHerramienta: async () => ({ ok: true }), timeoutMs: 1000 },
  );
  assert.equal(delegacionCompleta(rs), false);
  const linea = lineaAuditoria(rs);
  assert.match(linea, /1\/2 entregaron/);
  assert.match(linea, /malo \(error_proveedor\)/);
});

test("carril paralelo: responde la pregunta MIENTRAS la tarea principal sigue", async () => {
  let liberarPrincipal;
  const puerta = new Promise((res) => { liberarPrincipal = res; });
  const provPrincipal = async () => { await puerta; return { texto: "tarea terminada", uso: { total: 10 } }; };
  const principal = ejecutarTurno({
    texto: "corrije el error del login",
    llamarModelo: provPrincipal,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: ["write_file"],
  });
  let principalTermino = false;
  principal.then(() => { principalTermino = true; });

  const provParalelo = async () => ({ texto: "respuesta a tu duda", uso: { total: 300 } });
  const r = await atenderEnParalelo({
    texto: "¿qué es un jitter buffer?",
    llamarModelo: provParalelo,
    ejecutarHerramienta: async () => ({ ok: true }),
  });
  assert.equal(r.atendido, true);
  assert.equal(r.resultado.textoFinal, "respuesta a tu duda");
  assert.equal(principalTermino, false); // la principal seguia corriendo

  liberarPrincipal();
  await principal;
});

test("carril paralelo: una ORDEN no se atiende en paralelo, va a la cola", async () => {
  const r = await atenderEnParalelo({
    texto: "corrije el error del login",
    llamarModelo: async () => ({ texto: "x" }),
    ejecutarHerramienta: async () => ({ ok: true }),
  });
  assert.equal(r.atendido, false);
  assert.match(r.motivo, /cola/);
});
