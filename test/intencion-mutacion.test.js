"use strict";

// LÉXICO DE INTENCIÓN CENTRALIZADO (v4.8.0, línea 2): en vivo, el
// turno «Ahora mejora el hero» cerró con «no es necesario hacer ningún
// cambio adicional» y NINGUNA compuerta se enteró: el detector de
// intención de mutación (FIX_INTENT_RE + un suplemento regex DUPLICADO
// en la compuerta de cierre y en la garantía del «procede») no conoce
// el verbo «mejora». Ahora hay una sola fuente, hasMutationIntent, que
// suma los verbos de mejora/estética — como ORDEN, no como hipótesis:
// en condicional («¿cómo mejoraría…?») no hay pedido de mutación.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator, hasMutationIntent } = require("../editcore-chat-kernel/orchestrator");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-intencion-"));
}

test("intención: el léxico centralizado reconoce la mejora y no convierte preguntas en órdenes", () => {
  assert.equal(hasMutationIntent("Ahora mejora el hero"), true, "«mejora» como orden SÍ es intención de mutación (el fallo en vivo)");
  assert.equal(hasMutationIntent("optimiza la carga de la landing"), true);
  assert.equal(hasMutationIntent("rediseña la sección de precios"), true);
  assert.equal(hasMutationIntent("Créame una sección nueva de testimonios"), true, "«Créame» con acento y pronombre también cuenta");
  assert.equal(hasMutationIntent("corrige los archivos Footer.tsx y Navbar.tsx"), true, "el léxico histórico sigue intacto");
  assert.equal(hasMutationIntent("crea el archivo nota.txt"), true);
  assert.equal(hasMutationIntent("¿cómo mejoraría el hero?"), false, "la hipótesis en condicional NO es una orden");
  assert.equal(hasMutationIntent("¿qué optimizarías de esta página?"), false, "pregunta en condicional, sin mutación");
  assert.equal(hasMutationIntent("¿puedes mejorar el hero?"), true, "la orden en forma de pregunta cortés SÍ pide mutar");
  assert.equal(hasMutationIntent("revisa la landing y dime qué secciones tiene y en qué archivo está cada una"), false, "un pedido de contenido no es mutación");
  assert.equal(hasMutationIntent("revisa la landing y dime si las imágenes corresponden al negocio"), false, "la revisión visual no es mutación");
});

test("intención: «Ahora mejora el hero» con cierre pelado SÍ dispara la compuerta de cierre propositivo", async () => {
  const root = tmpProject();
  // El cierre EXACTO de la corrida en vivo: conclusión sin propuesta,
  // sin pregunta, sin escrituras. Antes de la v4.8.0 pasaba de largo.
  const BARE = "El hero ya está como estaba (sin el degradado rojo). El fondo actual es el original y no hay rastros del cambio anterior, así que no es necesario hacer ningún cambio adicional.";
  const PROPOSITIVE = "Propongo mejorar el hero con una entrada animada del titular, la foto real del taller a la derecha y el botón de WhatsApp fijo al hacer scroll. ¿Sigo con eso o prefieres otro enfoque?";

  const capture = [];
  const helpers = {
    callChat: async (args) => {
      const allText = (args.messages || []).map((m) => String(m.content || "")).join("\n");
      capture.push(allText);
      if (allText.includes("No cierres «mocho»")) return { text: PROPOSITIVE, toolCalls: [], usage: {} };
      return { text: BARE, toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "Ahora mejora el hero",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(capture.some((t) => t.includes("No cierres «mocho»")), "la compuerta de cierre propositivo se disparó con el verbo «mejora»");
  assert.ok(String(out.text || "").includes("Propongo mejorar el hero"), "el cierre final trae la propuesta");
});
