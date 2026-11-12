"use strict";

// [EDITCORE-V492-3] ANTI-CONFABULACIÓN (fallo en vivo 9.1 de la
// v4.9.1): ante «¿Qué recuerdas del cambio de precios que hicimos la
// semana pasada?», el agente ACEPTÓ la premisa falsa adornando hechos
// vecinos reales (Showcase.tsx tocado por TESTIMONIOS y un descarte
// registrado) en vez de decir «no consta».
//
// Camino completo: handle → clasificación del turno → protocolo
// inyectado (payload al proveedor) → cierre con la guarda determinista
// del kernel. El expediente se siembra con la API real del expediente
// (thread-memory) con EXACTAMENTE los asientos del fallo en vivo.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-mem-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

const { ChatOrchestrator, detectMemoryEventQuestion } = require("../editcore-chat-kernel/orchestrator");
const threadMemory = require("../editcore-chat-kernel/thread-memory");

const SHOWCASE = "src/components/sections/Showcase.tsx";

// La respuesta CONFABULADA, en el estilo literal del fallo en vivo:
// mezcla el archivo vecino (Showcase, «la sección que contiene los
// precios») y el descarte para «recordar» un cambio de precios que
// nunca se registró.
const CONFABULATED_ANSWER = "Recuerdo que la semana pasada modificamos src/components/sections/Showcase.tsx (la sección que contiene los precios), y tú descartaste el último cambio. No tengo más detalle registrado, pero ese fue el cambio de precios del que hablamos.";

function seededProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-mem-proj-"));
  fs.mkdirSync(path.join(root, "src", "components", "sections"), { recursive: true });
  fs.writeFileSync(
    path.join(root, SHOWCASE),
    "export default function Showcase() { return (<section><h2>Testimonios</h2><p>Lo que dicen nuestros clientes</p></section>); }\n",
  );
  // Expediente EXACTO del escenario: Showcase modificado (testimonios)
  // y un último cambio descartado. Nada de precios.
  threadMemory.noteFacts(root, [{ kind: "section", file: SHOWCASE, name: "Testimonios" }]);
  threadMemory.noteDiscarded(root, "Descartado por el usuario (su mensaje lo dice): el degradado rojo del hero — el último cambio quedó descartado");
  return root;
}

function scriptedHelpers(answer, payloads) {
  return {
    callChat: async (args) => {
      if (payloads) payloads.push(JSON.stringify(args || {}));
      return { text: answer, toolCalls: [], usage: {} };
    },
  };
}

test("V492-3a escenario EXACTO 9.1: la salida final declara que el cambio de precios NO consta, aunque el modelo lo afirme con hechos vecinos", async () => {
  const root = seededProject();
  const payloads = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "¿Qué recuerdas del cambio de precios que hicimos la semana pasada?",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "gpt-5",
    history: [],
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    helpers: scriptedHelpers(CONFABULATED_ANSWER, payloads),
  });

  const text = String(out.text || "");
  assert.ok(
    /no consta ningún cambio de precios/i.test(text),
    "la corrección honesta del kernel abre la respuesta: el evento preguntado NO consta en el expediente",
  );
  assert.ok(
    payloads.some((p) => p.includes("PREGUNTA DE RECUERDO")),
    "el protocolo anti-confabulación llegó al proveedor en el payload del turno",
  );
});

test("V492-3b control positivo: el cambio de TESTIMONIOS sí consta y se recuerda SIN la corrección", async () => {
  const root = seededProject();
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "¿Qué recuerdas del cambio de testimonios que hicimos?",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "gpt-5",
    history: [],
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    helpers: scriptedHelpers("Recuerdo que modificamos src/components/sections/Showcase.tsx para crear la sección de testimonios con las reseñas de los clientes."),
  });

  const text = String(out.text || "");
  assert.ok(/testimonios/i.test(text), "la respuesta recuerda el cambio que sí consta");
  assert.ok(!/no consta ningún/i.test(text), "sin corrección del kernel: el evento consta y no se castiga un recuerdo correcto");
  assert.ok(!/Ojo: en el expediente/.test(text), "no se antepone el banner anti-confabulación");
});

test("V492-3c si el modelo obedece el protocolo y dice «no consta», la guarda no duplica la corrección", async () => {
  const root = seededProject();
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "¿Qué recuerdas del cambio de precios que hicimos la semana pasada?",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1",
    apiKey: "sk-test",
    model: "gpt-5",
    history: [],
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    helpers: scriptedHelpers("No consta ningún cambio de precios en lo que tengo registrado de este proyecto. Sí consta un cambio en Showcase.tsx (la sección de testimonios) y un descarte posterior, pero de precios no tengo registro."),
  });

  const text = String(out.text || "");
  assert.ok(/no consta/i.test(text), "la respuesta honesta del modelo se conserva");
  assert.ok(!/Ojo: en el expediente/.test(text), "la guarda no antepone su banner cuando el modelo ya declaró la ausencia");
});

test("V492-3d el detector distingue pregunta de recuerdo con evento de una orden de cambio", () => {
  assert.deepEqual(detectMemoryEventQuestion("¿Qué recuerdas del cambio de precios que hicimos la semana pasada?")?.tokens, ["precios"]);
  assert.deepEqual(detectMemoryEventQuestion("¿Qué recuerdas del cambio de testimonios que hicimos?")?.tokens, ["testimonios"]);
  assert.equal(detectMemoryEventQuestion("cambia los precios de la landing"), null, "una orden de cambio no es pregunta de recuerdo");
  assert.equal(detectMemoryEventQuestion("Hola, ¿qué puedes hacer en este proyecto?"), null, "una pregunta general no trae evento");
  assert.equal(detectMemoryEventQuestion("¿Qué recuerdas de mí?"), null, "recuerdo sin evento concreto no activa la guarda");
});
