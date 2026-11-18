"use strict";
// ============================================================
// CAPACIDAD ESTRUCTURAL — la reconstrucción del despacho
// (2026-11-18). El registro en vivo probó el veto de la
// cascada de texto por tercera vez y en la tercera dirección:
// la orden completa del SaaS clasificó CONVERSACION
// («declarativo_sin_orden»: una orden larga y bien
// especificada tiene FORMA de declaración), el modelo no
// recibió herramientas y el turno cerró con una promesa:
// «Voy a revisar primero el estado actual del proyecto
// `rental-equipment-saas`… Déjame explorar la estructura del
// proyecto.» (19:57:51Z, pasos 0).
// La reconstrucción: con proyecto abierto, la capacidad la
// manda la ESTRUCTURA (set completo + presupuesto de ORDEN)
// y el modelo decide si responde o trabaja; el texto solo
// sugiere la etiqueta. Y una promesa con herramientas sobre
// la mesa se corrige en el acto, como el trabajo simulado.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");
const { anunciaTrabajoSinEjecutar } = require("../editcore-chat-kernel/nuevo/textos");

const ORDEN_SAAS = "Necesito un SaaS completo y funcional para una empresa de renta de equipos de impresión: reportes de servicio con número de folio automático, solicitudes de tóner con seguimiento de estado, y gestión de equipos con sus contadores y fechas de contrato. Con Next.js, TypeScript, Tailwind y Supabase (tablas profiles, equipment, service_reports y toner_requests, con autenticación y panel protegido). Hazlo en este proyecto.";
const ANUNCIO_REGISTRO = "Entiendo que necesitas un SaaS completo para gestión de equipos de impresión. Voy a revisar primero el estado actual del proyecto `rental-equipment-saas` para ver qué ya existe y qué necesito crear o mejorar.\n\nDéjame explorar la estructura del proyecto.";
const REPORTE_EXISTENCIA = "Ya tienes un proyecto SaaS completo implementado en la carpeta `rental-equipment-saas`: Next.js 14, Supabase y las tablas profiles, equipment, service_reports y toner_requests. ¿Qué quieres hacer ahora?";

const DEFS = [
  { type: "function", function: { name: "list_files", description: "Lista.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "write_file", description: "Escribe.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
];

function depsConGuion(guion, capturas) {
  let llamada = 0;
  return {
    callChat: async (params) => {
      capturas.push({ herramientasOfrecidas: (params?.tools || []).length });
      const paso = guion[Math.min(llamada, guion.length - 1)];
      llamada += 1;
      return paso;
    },
    getToolDefinitions: () => DEFS,
    execute: async () => ({ ok: true, resumen: "listado", listado: { archivos: ["rental-equipment-saas/package.json"] } }),
    construirMemoria: async () => "",
  };
}
const TEXTO = (content) => ({ content, toolCalls: [], usage: { input_tokens: 10, output_tokens: 8 } });
const LLAMADA_LIST = { content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "list_files", arguments: JSON.stringify({ path: "rental-equipment-saas" }) } }], usage: { input_tokens: 10, output_tokens: 5 } };
const BASE = { threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m", history: [] };

test("el detector de anuncio reconoce la promesa exacta del registro y respeta la pregunta", () => {
  assert.equal(anunciaTrabajoSinEjecutar(ANUNCIO_REGISTRO), true);
  assert.equal(anunciaTrabajoSinEjecutar("¿Quieres que revise primero el estado del proyecto?"), false);
  assert.equal(anunciaTrabajoSinEjecutar("La capital de Francia es París."), false);
});

test("LA ORDEN DEL REGISTRO: con proyecto, el anuncio se corrige en el acto y el turno ejecuta", async () => {
  const capturas = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: ORDEN_SAAS },
    depsConGuion([TEXTO(ANUNCIO_REGISTRO), LLAMADA_LIST, TEXTO(REPORTE_EXISTENCIA)], capturas),
  );
  assert.ok(capturas[0].herramientasOfrecidas > 0, "la orden recibió herramientas aunque su texto clasifica CONVERSACION");
  assert.equal(capturas.length, 3, "anuncio → corrección → ejecución → reporte");
  assert.equal(out.kind, "ORDEN");
  assert.ok(out.steps.length >= 1, "la exploración ocurrió de verdad");
  assert.match(out.text, /Ya tienes un proyecto SaaS completo/);
});

test("si tras la corrección el modelo SOLO vuelve a anunciar, el turno se reporta ORDEN sin aplicar nada", async () => {
  const capturas = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: ORDEN_SAAS },
    depsConGuion([TEXTO(ANUNCIO_REGISTRO), TEXTO(ANUNCIO_REGISTRO)], capturas),
  );
  assert.equal(capturas.length, 2, "una sola corrección, ni un bucle");
  assert.equal(out.kind, "ORDEN");
  assert.deepEqual(out.mutations, []);
});

test("una PREGUNTA con proyecto abierto se responde como conversación (con herramientas ofrecidas, sin usarlas)", async () => {
  const capturas = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: "cual es la capital de francia?" },
    depsConGuion([TEXTO("La capital de Francia es París.")], capturas),
  );
  assert.equal(out.kind, "CONVERSACION");
  assert.equal(capturas.length, 1, "sin correcciones: responder no anuncia trabajo");
  assert.ok(capturas[0].herramientasOfrecidas > 0, "la capacidad estaba sobre la mesa; el modelo decidió responder");
  assert.match(out.text, /París/);
});

test("SIN proyecto, la misma orden conserva el mecanismo viejo: sin herramientas no hay corrección posible", async () => {
  const capturas = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "", message: ORDEN_SAAS },
    depsConGuion([TEXTO(ANUNCIO_REGISTRO)], capturas),
  );
  assert.equal(out.kind, "CONVERSACION");
  assert.equal(capturas[0].herramientasOfrecidas, 0);
  assert.equal(capturas.length, 1);
});

test("en PROPUESTA, describir el trabajo futuro ES la entrega: no se corrige el anuncio", async () => {
  const capturas = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: "¿qué me propones para montar el SaaS de renta de equipos?" },
    depsConGuion([TEXTO("Mi propuesta: voy a crear primero el esquema en Supabase y luego las pantallas de reportes y tóner, en ese orden.")], capturas),
  );
  assert.equal(out.kind, "PROPUESTA");
  assert.equal(capturas.length, 1);
});
