"use strict";

// [EDITCORE-V491-D] CIERRE CON PROPUESTA EN TURNO AUTORIZADO
// (corrección v4.9.1, bloque D): en vivo (v4.9.0, «Ahora mejora el
// hero» en modo Agente) el modelo cerró con la PROPUESTA estructurada
// — «**Propuesta: hero más profesional (sin implementar aún)**», pasos
// como infinitivos a mitad de línea tras encabezados («Composición
// más clara: mantener…», «Fondo premium: conservar…», «Confianza
// visible: convertir…») y el remate «dime "procede" y lo implemento»
// — sin ejecutar NADA pese a estar autorizado. looksLikePlanClose no
// reconocía ninguna de esas formas (el infinitivo no abría la línea y
// «Propuesta» no era encabezado conocido), así que la compuerta
// planClose nunca disparó. Ahora la detección cubre las formas reales
// y la compuerta devuelve el turno ordenando EJECUTAR.
//
// Camino completo: handle → cierre del modelo → compuerta → ejecución.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

const HERO_REL = "src/components/sections/Hero.tsx";
const HERO_V1 = "export function Hero() { return (<section className=\"bg-gradient-to-br from-secondary\">Hero</section>); }\n";

// La silueta EXACTA del cierre observado en vivo (v4.9.0): propuesta
// con encabezado en negrita, «sin implementar aún», infinitivos tras
// encabezado/dos puntos y «dime "procede"».
const PROPOSAL_CLOSE = [
  "**Estado actual (evidencia)**",
  `${HERO_REL}: hero oscuro (bg-gradient-to-br from-secondary…), titular grande, 2 CTAs (WhatsApp + "Ver servicios") y tarjeta con foto /assets/servicio-frenos.webp.`,
  "",
  "**Propuesta: hero más profesional (sin implementar aún)**",
  "Composición más clara (split editorial): mantener 2 columnas pero con más aire: copy y CTAs a la izquierda, bloque visual a la derecha con la foto enmarcada y la tarjeta de confianza superpuesta con mejor jerarquía.",
  "Fondo premium, no plano: conservar la base oscura del secondary pero refinarla con un degradado más sutil y un acento cálido muy contenido del color primario en un glow lateral.",
  "Confianza visible: convertir los puntos actuales en una franja de pruebas compacta (+1,200 autos, garantía escrita, entrega a tiempo) con iconos consistentes y mejor legibilidad.",
  "Pulido visual: aprovechar la tipografía display ya presente para el H1, espaciado en escala consistente y foto con object-cover y overlay suave.",
  "",
  "Si te parece bien esta dirección, dime \"procede\" y lo implemento en src/components/sections/Hero.tsx manteniendo la foto actual.",
].join("\n");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v491-cierre-"));
  fs.mkdirSync(path.join(root, "src", "components", "sections"), { recursive: true });
  fs.writeFileSync(path.join(root, HERO_REL), HERO_V1);
  fs.writeFileSync(
    path.join(root, "src", "App.tsx"),
    "import { Navbar } from \"./components/layout/Navbar\";\nimport { Hero } from \"./components/sections/Hero\";\nimport { Showcase } from \"./components/sections/Showcase\";\nimport { Footer } from \"./components/layout/Footer\";\nexport default function App() { return null; }\n",
  );
  return root;
}

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

test("V491-D1 el cierre-propuesta EXACTO de la sesión en vivo dispara planClose y el turno EJECUTA", async () => {
  const root = tmpProject();
  const calls = [];
  let pushed = false;
  const helpers = {
    callChat: async (args) => {
      const allText = (args.messages || []).map((m) => String(m.content || "")).join("\n");
      calls.push(allText);
      if (allText.includes("No cierres con el plan")) {
        pushed = true;
        return {
          text: "",
          toolCalls: [toolCall("replace_in_file", {
            path: HERO_REL,
            oldText: "bg-gradient-to-br from-secondary",
            newText: "bg-gradient-to-br from-secondary via-secondary/95 to-black",
          })],
          usage: {},
        };
      }
      if (pushed) return { text: "Listo: hero mejorado con la dirección propuesta, aplicado y verificado en el preview.", toolCalls: [], usage: {} };
      return { text: PROPOSAL_CLOSE, toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "Ahora mejora el hero",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(calls.some((t) => t.includes("No cierres con el plan")), "la compuerta de cierre-plan disparó ante la forma real de propuesta");
  const hero = fs.readFileSync(path.join(root, HERO_REL), "utf8");
  assert.ok(hero.includes("to-black"), "tras el empujón, la mejora se EJECUTÓ en el archivo (no quedó en propuesta)");
});

test("V491-D2 una PREGUNTA genuina sin intención de mutación no dispara ninguna compuerta de ejecución", async () => {
  const root = tmpProject();
  const calls = [];
  let n = 0;
  const helpers = {
    callChat: async (args) => {
      calls.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
      n += 1;
      // Primero LEE (respuesta fundamentada: la capa de grounding
      // descartaría un inventario afirmado sin lecturas) y después
      // cierra con la pregunta genuina.
      if (n === 1) return { text: "", toolCalls: [toolCall("read_file", { path: "src/App.tsx" })], usage: {} };
      return { text: "La landing tiene Navbar, Hero, Showcase con servicios y testimonios, y Footer. ¿Quieres que te detalle alguna sección en particular?", toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "¿Qué secciones tiene la landing?",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });

  assert.ok(!calls.some((t) => t.includes("No cierres con el plan")), "sin intención de mutación, planClose no se inmiscuye");
  assert.ok(!(out.steps || []).some((s) => s.name === "write_file" || s.name === "replace_in_file"), "el turno no ejecutó ninguna escritura");
  assert.equal(fs.readFileSync(path.join(root, HERO_REL), "utf8"), HERO_V1, "nada se escribió");
});
