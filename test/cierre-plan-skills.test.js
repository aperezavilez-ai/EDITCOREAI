"use strict";

// SKILLS EN TODAS LAS RUTAS + COMPUERTA DE CIERRE-PLAN (v4.8.0, línea 3):
// en la batería v4.7.5, el turno «Créame una sección nueva de
// testimonios…» cerró con un PLAN en infinitivos («Mapa UI
// (testimonios)… Para cumplir lo pedido: Conseguir fotos… Ampliar
// testimonials… Verificar visualmente…») sin ejecutar nada y SIN la
// línea «Skills aplicadas este turno». Dos causas, dos arreglos:
//  (a) la línea de skills se emitía dentro de runModelTask y esa ruta
//      no la alcanzó: ahora se emite en handle(), el tronco común,
//      una sola vez al abrir el turno.
//      [EDITCORE-V492-2] La parte (a) quedó SUPERADA a propósito por la
//      regla de voz natural de Luis (2026-11-11): la línea-recibo sale
//      de la superficie en TODAS las rutas y su prueba se invirtió —
//      las skills se siguen seleccionando e inyectando (payload), ya
//      no se anuncian. La parte (b), la compuerta de cierre-plan, no
//      cambia y sus pruebas quedan intactas.
//  (b) ninguna compuerta atrapaba el cierre-plan en un turno
//      autorizado (la de presencia pide una propuesta, no la
//      ejecución): la nueva compuerta devuelve el turno UNA vez
//      ordenando EJECUTAR el plan con las herramientas.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-plan-"));
  fs.mkdirSync(path.join(root, "src", "components", "sections"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "components", "sections", "Showcase.tsx"),
    "export function Showcase() { const testimonials = [{ name: 'Carlos M.', car: 'Versa', text: 'Buen servicio' }]; return null; }\n",
  );
  return root;
}

const LIVE_MESSAGE = "Créame una sección nueva de testimonios para la landing, con fotos y nombres de clientes";

// La silueta EXACTA del cierre en vivo: mapa + «Para cumplir lo
// pedido» + pasos en infinitivo, cero escrituras.
const PLAN_CLOSE = [
  "Mapa UI (testimonios)",
  "Sección actual: src/components/sections/Showcase.tsx — array testimonials con 3 clientes (Carlos M., Laura G., Jorge R.), sin fotos.",
  "Assets disponibles: public/assets/ con las fotos de servicios; no hay fotos de clientes.",
  "",
  "Para cumplir lo pedido (fotos y nombres)",
  "Conseguir fotos reales de clientes con fetch_stock_photo (búsquedas concretas, p. ej. \"happy car customer portrait\") y guardarlas en public/assets/.",
  "Ampliar testimonials con la ruta de imagen y mostrar avatar y nombre visible en cada tarjeta de la sección.",
  "Verificar visualmente con capture_preview_screenshot que las fotos correspondan y el layout sea correcto.",
].join("\n");

test("cierre-plan: en la ruta de testimonios las skills se inyectan SIN línea-recibo visible [V492-2]", async () => {
  const root = tmpProject();
  const events = [];
  const payloads = [];
  const orch = new ChatOrchestrator();
  await orch.handle({
    message: LIVE_MESSAGE,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: {
      callChat: async (args) => {
        payloads.push(JSON.stringify(args || {}));
        return { text: "Entendido.", toolCalls: [], usage: {} };
      },
    },
    history: [], onProgress: (ev) => events.push(ev),
  });

  const skillLines = events.filter((e) => e.phase === "narration" && /^Skills aplicadas este turno:/.test(String(e.text || "")));
  assert.equal(skillLines.length, 0, "la línea-recibo de skills ya no se emite en ninguna ruta (voz natural)");
  assert.ok(payloads.some((p) => /antislop-ui|frontend-design/.test(p)), "las skills de diseño SÍ entraron al contexto del proveedor en esta ruta");
});

test("cierre-plan: un turno autorizado que cierra con el plan es devuelto para que lo EJECUTE", async () => {
  const root = tmpProject();
  const capture = [];
  let wrote = false;
  const helpers = {
    callChat: async (args) => {
      const allText = (args.messages || []).map((m) => String(m.content || "")).join("\n");
      capture.push(allText);
      if (allText.includes("No cierres con el plan") && !wrote) {
        wrote = true;
        return {
          text: "",
          toolCalls: [{ id: "w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "testimonios-nuevos.txt", content: "Testimonios con fotos y nombres de clientes." }) } }],
          usage: {},
        };
      }
      if (wrote) return { text: "Listo: ejecuté el plan y la sección de testimonios quedó creada con fotos y nombres.", toolCalls: [], usage: {} };
      return { text: PLAN_CLOSE, toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: LIVE_MESSAGE,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(capture.some((t) => t.includes("No cierres con el plan")), "la compuerta de cierre-plan devolvió el turno ordenando ejecutar");
  assert.ok(fs.existsSync(path.join(root, "testimonios-nuevos.txt")), "tras el empujón, el plan se ejecutó de verdad (archivo escrito)");
  assert.ok(String(out.text || "").includes("ejecuté el plan"), "el cierre final reporta la ejecución, no el plan");
});
