"use strict";
// ============================================================
// BATERÍA — KERNEL NUEVO: nombre fuera y techos por carril.
// El nombre del dueño no existe en el kernel nuevo: ni en sus
// textos visibles, ni en su identidad, ni en su memoria. Las
// reglas son de EditCoreAI y el agente las enuncia como suyas,
// en primera persona. (En el kernel viejo la rendición decía
// «la regla de avance de Luis», orchestrator.js:2017.)
// Los techos son los del diseño y se cumplen en el bucle:
// conversación 12.000 · propuesta 16.000 · consulta 40.000 ·
// orden 300.000 tokens por turno.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const textos = require("../editcore-chat-kernel/nuevo/textos");
const { ejecutarTurno, PRESUPUESTOS } = require("../editcore-chat-kernel/nuevo/turno");

test("ningún texto del kernel nuevo nombra al dueño", () => {
  for (const [clave, valor] of Object.entries(textos)) {
    if (typeof valor === "string") {
      assert.ok(!/\bLuis\b/.test(valor), `el texto ${clave} contiene el nombre`);
    }
  }
  const rendicion = textos.textoRendicion({ pasosSinAplicar: 12, tokensEnVueltas: 516220, pasosAplicados: 1, tokensAplicados: 20217 });
  assert.ok(!/\bLuis\b/.test(rendicion));
  assert.match(rendicion, /EditCoreAI/);
  assert.match(rendicion, /Detengo este turno/);
});

test("guarda permanente: ningún archivo del kernel nuevo contiene el nombre", () => {
  const dir = path.join(__dirname, "..", "editcore-chat-kernel", "nuevo");
  for (const archivo of fs.readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const contenido = fs.readFileSync(path.join(dir, archivo), "utf8");
    assert.ok(!/\bLuis\b/.test(contenido), `${archivo} contiene el nombre del dueño`);
  }
});

test("la identidad del agente: es EditCoreAI, con las tres conductas", () => {
  const s = textos.SISTEMA_NUCLEO;
  assert.match(s, /EditCoreAI/);
  assert.match(s, /respondo/i);
  assert.match(s, /propongo/i);
  assert.match(s, /procedo/i);
});

test("techos por carril: los valores del diseño, en orden creciente", () => {
  assert.equal(PRESUPUESTOS.CONVERSACION.maxTokens, 12000);
  assert.equal(PRESUPUESTOS.PROPUESTA.maxTokens, 16000);
  assert.equal(PRESUPUESTOS.CONSULTA.maxTokens, 40000);
  assert.equal(PRESUPUESTOS.ORDEN.maxTokens, 300000);
});

test("techo de CONVERSACION: una respuesta cara se marca agotada en el resumen", async () => {
  const r = await ejecutarTurno({
    texto: "¿qué queda pendiente?",
    llamarModelo: async () => ({ texto: "respuesta", uso: { total: 999999 } }),
    ejecutarHerramienta: async () => ({ ok: true }),
  });
  assert.equal(r.carril, "CONVERSACION");
  assert.equal(r.presupuestoAgotado, true);
  assert.match(r.resumen, /Presupuesto de tokens agotado/);
});

test("techo de CONSULTA: el bucle de lecturas se corta al cruzar el tope", async () => {
  const r = await ejecutarTurno({
    texto: "¿dónde está la función getUserMediaWithTimeout en el código?",
    llamarModelo: async () => ({ toolCalls: [{ nombre: "search_files", args: {} }], uso: { total: 25000 } }),
    ejecutarHerramienta: async () => ({ ok: true, resumen: "resultados" }),
  });
  assert.equal(r.carril, "CONSULTA");
  assert.equal(r.presupuestoAgotado, true);
  assert.ok(r.tokensUsados > PRESUPUESTOS.CONSULTA.maxTokens);
});
