"use strict";

// [EDITCORE-INTEGRAL-B3] MEMORIA QUE RECUERDA HECHOS (Bloque 3 de la
// corrección integral v4.9.0): el expediente persiste HECHOS
// estructurales destilados de los steps (archivo↔sección distinguiendo
// «contiene» de «renderiza», asset↔dónde se usa, lecturas con rastro),
// las decisiones afirmables alimentan noteDecision (antes: 0 llamadores
// en producción), noteVerified se alimenta también en CREACIÓN con
// verificación real (y un softTimeout JAMÁS se registra), la sección de
// hechos tiene reserva protegida dentro del tope de 3.500 y
// retrieveRelevant consulta primero los hechos con umbral y sinónimos
// declarados. Patrón de verdad-turno-b1 / publicacion-verificada:
// callChat guionado, sin red; el único CLI es un `npm run build`
// trivial del proyecto falso (script node -e) en la prueba B3-4.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b3-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

const { ChatOrchestrator, appendRealVerification } = require("../editcore-chat-kernel/orchestrator");
const threadMemory = require("../editcore-chat-kernel/thread-memory");
const threadCore = require("../editcore-chat-kernel/thread-core");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-b3-proj-"));
}

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function writeLanding(root) {
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "components", "Hero.tsx"), [
    'import React from "react";',
    "export function Hero() {",
    "  return (",
    '    <section className="hero">',
    "      <h1>Taller mecánico</h1>",
    '      <img src="/assets/hero-taller.jpg" alt="El taller" />',
    "    </section>",
    "  );",
    "}",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "components", "Footer.tsx"), [
    "export function Footer() {",
    '  return <footer className="footer">Pie de la landing</footer>;',
    "}",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "App.tsx"), [
    'import { Hero } from "./components/Hero";',
    'import { Footer } from "./components/Footer";',
    "export function App() {",
    "  return (<main><Hero /><Footer /></main>);",
    "}",
    "",
  ].join("\n"));
}

const loose = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

test("B3-1/B3-2 la M-5 en miniatura: el turno 1 deja los hechos y el turno 2 responde desde el expediente sin re-leer", async () => {
  const root = tmpProject();
  writeLanding(root);
  const threadId = "hilo-m5";

  // Turno 1: el modelo LEE la landing y lista sus secciones.
  const script1 = [
    {
      text: "",
      toolCalls: [
        toolCall("read_file", { path: "src/components/Hero.tsx" }),
        toolCall("read_file", { path: "src/App.tsx" }),
        toolCall("read_file", { path: "src/components/Footer.tsx" }),
      ],
      usage: {},
    },
    { text: "La landing tiene estas secciones: el hero está en src/components/Hero.tsx y usa la foto assets/hero-taller.jpg; el pie está en src/components/Footer.tsx; y src/App.tsx renderiza ambas secciones en la página principal del taller.", toolCalls: [], usage: {} },
  ];
  const orch1 = new ChatOrchestrator();
  await orch1.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "Revisa la landing completa y dime qué secciones tiene y en qué archivo está cada una",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 5, fullAccess: true, permissionMode: "full",
    helpers: { callChat: async () => script1.shift() || { text: "Listo.", toolCalls: [], usage: {} } },
  });

  // (1) El expediente PERSISTIDO contiene los hechos archivo↔sección y asset↔archivo.
  const state = threadMemory.loadProjectState(root);
  assert.ok(Array.isArray(state.facts) && state.facts.length >= 4, `hechos destilados de las lecturas, dio ${state.facts?.length}`);
  const heroContains = state.facts.find((f) => f.kind === "section" && f.file === "src/components/Hero.tsx" && loose(f.name) === "hero");
  assert.ok(heroContains, "hecho: Hero.tsx ↔ sección hero");
  assert.equal(heroContains.relation, "contiene", "Hero.tsx DEFINE el hero: relación «contiene»");
  const assetFact = state.facts.find((f) => f.kind === "asset" && String(f.asset).includes("hero-taller.jpg"));
  assert.ok(assetFact, "hecho: asset hero-taller.jpg registrado");
  assert.equal(assetFact.file, "src/components/Hero.tsx", "el asset se usa en Hero.tsx");
  assert.equal(loose(assetFact.section), "hero", "el asset queda atado a la sección hero");
  const appRenders = state.facts.find((f) => f.kind === "section" && f.file === "src/App.tsx" && loose(f.name) === "hero");
  assert.ok(appRenders, "hecho: App.tsx ↔ hero");
  assert.equal(appRenders.relation, "renderiza", "App.tsx NO define el hero, lo RENDERIZA: la relación se distingue");
  assert.ok(state.facts.some((f) => f.kind === "read" && f.file === "src/components/Hero.tsx"), "la LECTURA de Hero.tsx dejó rastro (antes solo las escrituras entraban en files[])");

  // Turno 2 (mismo hilo): preguntar por el hero NO requiere re-leer nada.
  const payloads = [];
  const orch2 = new ChatOrchestrator();
  const out2 = await orch2.runModelTask({
    decision: { kind: "ASK", allowTools: true, allowWrite: false },
    message: "De las secciones que encontraste, ¿en qué archivo está el hero y qué foto usa?",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: false, maxSteps: 3, fullAccess: false, permissionMode: "step",
    helpers: {
      callChat: async (args) => {
        payloads.push((args.messages || []).map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""))).join("\n"));
        // El modelo guionado responde SOLO desde el contexto recibido:
        // si el hecho no viniera en el payload, no podría contestar así.
        return { text: "El hero está en src/components/Hero.tsx y la foto que usa es assets/hero-taller.jpg, tal como quedó registrado en el expediente de este hilo.", toolCalls: [], usage: {} };
      },
    },
  });

  // (2) El payload del turno 2 TRAE ambos hechos y no hizo falta read_file.
  const payload = payloads.join("\n");
  assert.match(payload, /Hechos del expediente/, "el bloque de hechos viaja en el contexto del turno 2");
  assert.ok(payload.includes("src/components/Hero.tsx") && payload.includes("contiene «Hero»"), "el payload trae el hecho archivo↔sección del hero");
  assert.ok(payload.includes("hero-taller.jpg") && payload.includes("se usa en `src/components/Hero.tsx`"), "el payload trae el hecho asset↔archivo");
  assert.equal((out2.steps || []).filter((s) => s.name === "read_file").length, 0, "el turno 2 NO re-leyó ningún archivo para responder");
  assert.match(String(out2.text || ""), /hero-taller\.jpg/);
});

test("B3-3 un «procede» aceptado registra la decisión de autorización vía noteDecision (ya no tiene 0 llamadores)", async () => {
  const root = tmpProject();
  writeLanding(root);
  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "Procede",
    projectRoot: root,
    apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    threadId: "hilo-procede",
    history: [
      { role: "user", content: "Corrige el Footer de la landing" },
      { role: "assistant", content: "Propongo corregir el Footer de la landing ajustando su contenido. Si quieres que lo aplique, responde «procede»." },
    ],
    helpers: {
      callChat: async () => ({ text: "Listo: apliqué la corrección del Footer que habías aprobado en este mismo chat, siguiendo exactamente el cambio que te presenté antes.", toolCalls: [], usage: {} }),
    },
  });

  const state = threadMemory.loadProjectState(root);
  assert.ok(state.decisions.some((d) => /Autorización/.test(String(d.text || ""))), `la decisión de autorización quedó en el expediente, decisiones: ${JSON.stringify(state.decisions)}`);
  const block = threadMemory.projectPromptBlock(root, "hilo-procede", "¿qué quedó autorizado?");
  assert.match(block, /Autorización/, "la decisión aparece en el expediente que recibe el turno siguiente");
});

test("B3-4 creación con verificación real registra verificado; un softTimeout JAMÁS se registra", async () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "landing-b3", scripts: { build: 'node -e "process.exit(0)"' } }));
  const script = [
    { text: "", toolCalls: [toolCall("write_file", { path: "src/components/Testimonios.tsx", content: "export function Testimonios() {\n  return <section className=\"testimonios\"><h2>Clientes</h2></section>;\n}\n" })], usage: {} },
    { text: "", toolCalls: [toolCall("run_command", { command: "npm run build" })], usage: {} },
    { text: "Listo: creé la sección nueva de testimonios para la landing, con su componente propio, y el build del proyecto pasó en verde al final del turno.", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "Créame una sección nueva de testimonios para la landing",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 6, fullAccess: true, permissionMode: "full",
    helpers: { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } },
  });

  const state = threadMemory.loadProjectState(root);
  assert.ok(state.verified.length >= 1, `el turno de CREACIÓN con build en verde alimentó noteVerified, verificado: ${JSON.stringify(state.verified)}`);
  assert.match(state.verified.map((v) => v.text).join("\n"), /Testimonios\.tsx/);

  // softTimeout: la misma forma de turno pero la «verificación» tardó y
  // no concluyó — no es verificado ni descartado (criterio intocable).
  const root2 = tmpProject();
  const softSteps = [
    { name: "write_file", input: { path: "src/components/Testimonios.tsx" }, ok: true, result: { ok: true } },
    { name: "run_command", input: { command: "npm run build" }, ok: true, result: { ok: true, softTimeout: true } },
  ];
  const untouched = await appendRealVerification(root2, ["src/components/Testimonios.tsx"], softSteps, "texto del turno", null, { repairTask: false });
  assert.equal(untouched, "texto del turno");
  const state2 = threadMemory.loadProjectState(root2);
  assert.equal(state2.verified.length, 0, "un softTimeout NO se registra como verificado");
  assert.equal(state2.discarded.length, 0, "un softTimeout tampoco se registra como descartado");
});

test("B3-5 con el expediente lleno de prosa, los hechos recientes SOBREVIVEN al tope de 3.500 (se corta la prosa, no los hechos)", (t) => {
  const root = tmpProject();
  threadMemory.noteFacts(root, [
    { kind: "section", file: "src/components/Hero.tsx", name: "Hero", relation: "contiene" },
    { kind: "asset", file: "src/components/Hero.tsx", asset: "assets/hero-taller.jpg", section: "Hero" },
  ]);
  // Prosa de sobra: notas, decisiones, verificados y turnos largos.
  const state = threadMemory.loadProjectState(root);
  state.notes = Array.from({ length: 50 }, (_, i) => ({ t: Date.now(), text: `Nota de relleno ${i}: ${"prosa ".repeat(60)}` }));
  state.decisions = Array.from({ length: 10 }, (_, i) => ({ t: Date.now(), text: `Decisión de relleno ${i}: ${"contexto ".repeat(40)}` }));
  state.verified = Array.from({ length: 20 }, (_, i) => ({ t: Date.now(), text: `Verificado de relleno ${i}: ${"detalle ".repeat(40)}` }));
  threadMemory.saveProjectState(root, state);
  const turns = [];
  for (let i = 0; i < 20; i++) {
    turns.push({ role: "user", content: `Pedido largo ${i}: ${"explicación ".repeat(80)}` });
    turns.push({ role: "assistant", content: `Respuesta larga ${i}: ${"narrativa ".repeat(80)}` });
  }
  threadMemory.appendTurns(root, "hilo-largo", turns);

  const block = threadMemory.projectPromptBlock(root, "hilo-largo", "¿en qué archivo está el hero y qué foto usa?");
  assert.ok(block.length <= 3500, `el bloque completo respeta el tope, dio ${block.length}`);
  assert.match(block, /Hechos del expediente/, "la sección de hechos está presente pese a la prosa");
  assert.ok(block.includes("hero-taller.jpg"), "el hecho del asset sobrevive al corte");
  assert.ok(block.includes("contiene «Hero»"), "el hecho archivo↔sección sobrevive al corte");
});

test("B3-6 retrieveRelevant: hechos primero con sinónimo portada↔hero, y umbral ante una pregunta sin relación", (t) => {
  const root = tmpProject();
  threadMemory.noteFacts(root, [
    { kind: "section", file: "src/components/Hero.tsx", name: "Hero", relation: "contiene" },
    { kind: "asset", file: "src/components/Hero.tsx", asset: "assets/hero-taller.jpg", section: "Hero" },
  ]);
  threadMemory.appendTurns(root, "hilo-retrieve", [
    { role: "user", content: "Revisa la landing del taller" },
    { role: "assistant", content: "La landing quedó revisada." },
  ]);

  const hits = threadMemory.retrieveRelevant(root, "hilo-retrieve", "¿qué foto usa la portada?", 6);
  assert.ok(hits.length >= 1, "la pregunta con sinónimos encuentra hechos");
  assert.equal(hits[0].source, "fact", "los HECHOS van primero en la recuperación");
  assert.ok(hits[0].text.includes("hero-taller.jpg"), "portada→hero y foto→imagen conectan con el hecho del asset");

  const noise = threadMemory.retrieveRelevant(root, "hilo-retrieve", "¿cuánto cuesta el hosting morado del servidor?", 6);
  assert.equal(noise.filter((h) => h.source === "fact").length, 0, "sin relación: ningún hecho ajeno se inyecta (umbral)");
  assert.equal(noise.length, 0, "sin relación: tampoco vuelve prosa de relleno");
});

test("B3-7 el descarte explícito del usuario en su mensaje alimenta noteDiscarded y queda como decisión", async () => {
  const root = tmpProject();
  writeLanding(root);
  const orch = new ChatOrchestrator();
  await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "Descarta el degradado rojo del hero: no uses ese degradado",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 3, fullAccess: true, permissionMode: "full",
    helpers: { callChat: async () => ({ text: "Entendido: el degradado rojo queda descartado y no lo vuelvo a proponer en este proyecto; el hero conserva su fondo actual.", toolCalls: [], usage: {} }) },
  });

  const state = threadMemory.loadProjectState(root);
  assert.ok(state.discarded.some((d) => /degradado rojo/.test(String(d.text || ""))), `el descarte del USUARIO quedó en descartados, dio: ${JSON.stringify(state.discarded)}`);
  assert.ok(state.decisions.some((d) => /descartó/.test(String(d.text || ""))), "el descarte también queda como hecho-decisión del expediente");
});
