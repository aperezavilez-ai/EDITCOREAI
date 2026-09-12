"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  pickBestFinalChatText,
  shouldKeepExistingStream,
  isThinFinalFragment,
} = require("../runtime/chat-stream-preserve");

const longReport = [
  "## Qué sí funcionó",
  "",
  "Backend FastAPI con CRUD de proyectos y escenas. Frontend Next.js con workspace completo.",
  "Cliente API tipado y Docker Compose configurado.",
  "",
  "## Qué falló / hallazgos",
  "",
  "- Falta generacion real de video.",
  "- Auth stub sin JWT.",
  "",
  "## Evidencia",
  "",
  "- backend/app/main.py",
  "- frontend/src/lib/api.ts",
  "",
  "## Cómo lo corregiré",
  "",
  "- Unificar entrypoint y crear Dockerfile backend.",
  "",
  "Cuando autorices procedo con las correcciones.",
].join("\n");

test("pickBestFinalChatText conserva el informe largo frente a un fragmento corto", () => {
  const thin = [
    "## Escritura no disponible en esta sesión",
    "",
    "No se modifico ningun archivo.",
  ].join("\n");
  const best = pickBestFinalChatText(thin, longReport, "");
  assert.equal(best, longReport);
  assert.match(best, /Cuando autorices procedo/);
});

test("pickBestFinalChatText prefiere reporte grounded completo", () => {
  const shortAwait = "Cuando autorices procedo con las correcciones.";
  const best = pickBestFinalChatText(longReport, shortAwait, "");
  assert.equal(best, longReport);
});

test("pickBestFinalChatText nunca deja que Avances sustituyan el informe", () => {
  const avances = [
    "### Avance — leí `src/components/InputBox.tsx` (285 líneas)",
    "- Símbolos: InputBox, useState",
    "",
    "### Avance — leí `src/lib/gpt-client.ts` (149 líneas)",
    "- Símbolos: GPTClient",
    "",
    "### Avance — leí `package.json` (44 líneas)",
    "- Vista: `{ \"name\": \"calili\" }`",
  ].join("\n");
  const best = pickBestFinalChatText(longReport, avances, "");
  assert.equal(best, longReport);
  assert.match(best, /Qué falló/);
  assert.doesNotMatch(best, /^### Avance/m);
});

test("pickBestFinalChatText con solo Avances no inventa cierre", () => {
  const avances = "### Avance — leí `a.ts`\n\n### Avance — leí `b.ts`";
  const best = pickBestFinalChatText("", avances, "");
  assert.equal(best, "");
});

test("shouldKeepExistingStream no deja pisar un informe largo con un corte corto", () => {
  assert.equal(shouldKeepExistingStream(longReport, "No puedo ejecutar write_file."), true);
  assert.equal(shouldKeepExistingStream(longReport, `${longReport}\n\nNota extra de cierre.`), false);
});

test("isThinFinalFragment detecta mensajes de stop cortos", () => {
  assert.equal(isThinFinalFragment("No se modifico ningun archivo."), true);
  assert.equal(isThinFinalFragment(longReport), false);
});

test("index.html carga chat-stream-preserve antes del renderer", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /chat-stream-preserve\.js/);
  const preserveAt = html.indexOf("chat-stream-preserve.js");
  const rendererAt = html.indexOf("renderer.js");
  assert.ok(preserveAt > 0 && rendererAt > preserveAt);
});
