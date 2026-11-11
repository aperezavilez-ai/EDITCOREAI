"use strict";

// Expediente persistente (v4.7.2): el agente deja de re-explorar el proyecto
// en cada turno porque la memoria que ya se guardaba en disco por fin se
// LEE: expediente ampliado, recuperación de turnos viejos, memoria
// semántica conectada y verificaciones reales escritas en el expediente.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const threadMemory = require("../editcore-chat-kernel/thread-memory");
const threadCore = require("../editcore-chat-kernel/thread-core");
const { PersistentMemory } = require("../editcore-chat-kernel/memory");

function temporaryProject(t, prefix = "editcore-expediente-test-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });
  return root;
}

function seedTurns(root, threadId, count) {
  const turns = [];
  for (let i = 1; i <= count; i++) {
    turns.push({ role: "user", content: `Pedido ${i}: trabaja en el módulo ${i}.` });
    turns.push({ role: "assistant", content: `Respuesta ${i}: toqué el módulo ${i}.` });
  }
  threadMemory.appendTurns(root, threadId, turns);
}

test("el expediente trae un turno viejo relevante aunque el historial corto solo tenga los últimos 3", (t) => {
  const root = temporaryProject(t);
  const threadId = "hilo-viejo";
  // Turno 1 con una palabra clave única; luego 9 turnos más lo entierran.
  threadMemory.appendTurns(root, threadId, [
    { role: "user", content: "El preview sale en blanco por la paleta brand de Tailwind v4." },
    { role: "assistant", content: "Reviso el CSS con la paleta brand." },
  ]);
  seedTurns(root, threadId, 9);
  const short = threadMemory.shortHistoryMessages([], root, threadId, "paleta brand");
  assert.equal(short.length, 3, "el historial corto sigue siendo de 3 turnos");
  assert.equal(short.some((m) => m.content.includes("paleta brand")), false);
  const block = threadMemory.projectPromptBlock(root, threadId, "paleta brand");
  assert.match(block, /paleta brand/, "el expediente rescata el turno viejo relevante");
  assert.match(block, /De turnos anteriores/);
  assert.ok(block.length <= 3500, `expediente con tope 3500, dio ${block.length}`);
});

test("el expediente muestra las últimas 5 decisiones, no solo la última", (t) => {
  const root = temporaryProject(t);
  for (let i = 1; i <= 6; i++) threadMemory.noteDecision(root, `Decisión número ${i} del proyecto`);
  const block = threadMemory.projectPromptBlock(root, "default", "decisiones");
  assert.match(block, /Decisión número 6/);
  assert.match(block, /Decisión número 3/);
  assert.match(block, /Decisión número 2/);
  assert.equal(block.includes("Decisión número 1"), false, "la más vieja sale de la ventana de 5");
});

test("lo verificado y lo descartado persisten y aparecen en sus secciones del expediente", (t) => {
  const root = temporaryProject(t);
  threadMemory.noteVerified(root, "El build compila en verde con Tailwind v4.3.5", true);
  threadMemory.noteDiscarded(root, "Cambiar gap-2 por gap-[0.5rem]: no era el error", false);
  const state = threadMemory.loadProjectState(root);
  assert.equal(state.verified.length, 1);
  assert.equal(state.discarded.length, 1);
  const block = threadMemory.projectPromptBlock(root, "default", "build");
  assert.match(block, /Verificado en vivo/);
  assert.match(block, /compila en verde/);
  assert.match(block, /Descartado por evidencia/);
  assert.match(block, /gap-2/);
});

test("noteVerified con tope: 25 verificaciones guardan solo las últimas 20", (t) => {
  const root = temporaryProject(t);
  for (let i = 1; i <= 25; i++) threadMemory.noteVerified(root, `Hecho verificado ${i}`, true);
  const state = threadMemory.loadProjectState(root);
  assert.equal(state.verified.length, 20);
  assert.match(state.verified[0].text, /Hecho verificado 6/);
  assert.match(state.verified[19].text, /Hecho verificado 25/);
});

test("rememberExchange ya no registra la primera línea de la respuesta como decisión", (t) => {
  const root = temporaryProject(t);
  threadCore.rememberExchange(
    root,
    "hilo-ruido",
    "Corrige el preview en blanco",
    "Listo. Corregí el error en el archivo principal.",
    { steps: [], written: [] }
  );
  const state = threadMemory.loadProjectState(root);
  assert.equal(state.decisions.length, 0, "la narrativa del agente no es una decisión");
  assert.match(state.workingOn, /Corrige el preview/);
});

test("rememberExchange sí registra lo verificado/descartado que le pasa el llamador", (t) => {
  const root = temporaryProject(t);
  threadCore.rememberExchange(root, "hilo-verificado", "Arregla el CSS", "Hecho.", {
    steps: [],
    written: [],
    verified: "Captura del preview: renderOk true sin errores de consola",
  });
  const state = threadMemory.loadProjectState(root);
  assert.equal(state.verified.length, 1);
  assert.match(state.verified[0].text, /renderOk/);
});

test("promptBlockSemantic cae al bloque clásico sin vector y respeta el tope con notas", async (t) => {
  const root = temporaryProject(t);
  const mem = new PersistentMemory(root);
  mem.load();
  assert.equal(await mem.promptBlockSemantic("cualquier cosa"), mem.promptBlock());
  mem.note("Nota de memoria: el proyecto usa Tailwind v4 con paleta brand.");
  const block = await mem.promptBlockSemantic("paleta brand");
  assert.match(block, /paleta brand/);
  assert.ok(block.length <= 3000, `bloque semántico con tope 3000, dio ${block.length}`);
});

test("retrieveRelevant encuentra el turno viejo por palabra clave (ya no es código muerto)", (t) => {
  const root = temporaryProject(t);
  const threadId = "hilo-retrieve";
  threadMemory.appendTurns(root, threadId, [
    { role: "user", content: "La landing del taller mecánico necesita fotos reales." },
    { role: "assistant", content: "Uso fotos de stock en assets." },
  ]);
  seedTurns(root, threadId, 5);
  const hits = threadMemory.retrieveRelevant(root, threadId, "landing taller fotos", 6);
  assert.ok(hits.length > 0);
  assert.match(hits[0].text, /landing del taller/);
});
