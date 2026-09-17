"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const VoiceOrb = require("../runtime/voice-orb");
const VoiceMode = require("../runtime/voice-mode");

test("voice-orb: exposicion de API y metodos de control", () => {
  assert.ok(VoiceOrb, "VoiceOrb modulo cargado");
  assert.equal(typeof VoiceOrb.init, "function");
  assert.equal(typeof VoiceOrb.setState, "function");
  assert.equal(typeof VoiceOrb.setVolume, "function");
  assert.equal(typeof VoiceOrb.start, "function");
  assert.equal(typeof VoiceOrb.stop, "function");
  assert.equal(typeof VoiceOrb.getState, "function");

  VoiceOrb.setState("listening");
  assert.equal(VoiceOrb.getState(), "listening");
  VoiceOrb.setState("thinking");
  assert.equal(VoiceOrb.getState(), "thinking");
  VoiceOrb.setState("speaking");
  assert.equal(VoiceOrb.getState(), "speaking");
  VoiceOrb.setState("idle");
  assert.equal(VoiceOrb.getState(), "idle");
});

test("voice-mode: deteccion de frases de cierre verbal", () => {
  assert.ok(VoiceMode.isClosingPhrase("basta"));
  assert.ok(VoiceMode.isClosingPhrase("alto"));
  assert.ok(VoiceMode.isClosingPhrase("fin de consulta"));
  assert.ok(VoiceMode.isClosingPhrase("fin de llamada"));
  assert.ok(VoiceMode.isClosingPhrase("terminar llamada"));
  assert.ok(VoiceMode.isClosingPhrase("finalizar llamada"));
  assert.ok(VoiceMode.isClosingPhrase("listo"));
  assert.ok(VoiceMode.isClosingPhrase("enviar"));
  assert.ok(VoiceMode.isClosingPhrase("procede"));
  assert.ok(VoiceMode.isClosingPhrase("adios"));
  assert.ok(VoiceMode.isClosingPhrase("adiós"));
  assert.ok(VoiceMode.isClosingPhrase("colgar"));

  // Frases que no deben disparar el cierre por sí solas
  assert.equal(VoiceMode.isClosingPhrase("quiero hacer un proyecto nuevo"), false);
  assert.equal(VoiceMode.isClosingPhrase("agrega un boton en la barra de navegacion"), false);
  assert.equal(VoiceMode.isClosingPhrase(""), false);
});

test("voice-mode: limpieza de texto para sintesis de voz natural", () => {
  const markdownText = [
    "# Analisis del proyecto",
    "Vamos a modificar `index.html` y ejecutar ```npm test```.",
    "Para mas detalles consulta [la documentacion](https://ejemplo.com/docs).",
    "**Resultado**: *Todo listo*.",
    "| Col 1 | Col 2 |",
    "|---|---|",
    "| val1 | val2 |",
  ].join("\n");

  const clean = VoiceMode.cleanTextForSpeech(markdownText);
  assert.ok(!clean.includes("```"), "No debe tener bloques de codigo brutos");
  assert.ok(!clean.includes("https://"), "No debe tener URLs directas");
  assert.ok(!clean.includes("|---|"), "No debe tener lineas de tabla markdown");
  assert.ok(!clean.includes("**"), "No debe tener asteriscos markdown");
  assert.ok(!clean.includes("# Analisis"), "No debe tener simbolos de encabezado");
  assert.match(clean, /Analisis del proyecto/);
  assert.match(clean, /index\.html/);
});

test("voice-mode: integracion en index.html y styles.css", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(indexHtml, /id="voiceBtn"/, "Boton de voz presente en index.html");
  assert.match(indexHtml, /class="voice-btn"/, "Clase voice-btn presente");
  assert.match(indexHtml, /id="voiceOverlay"/, "Overlay de voz presente en index.html");
  assert.match(indexHtml, /src="\.\/runtime\/voice-orb\.js"/, "voice-orb.js cargado en index.html");
  assert.match(indexHtml, /src="\.\/runtime\/voice-mode\.js"/, "voice-mode.js cargado en index.html");

  const stylesCss = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.match(stylesCss, /\.voice-btn/, "Estilos de .voice-btn en styles.css");
  assert.match(stylesCss, /\.voice-overlay/, "Estilos de .voice-overlay en styles.css");
});

test("voice-mode: renderer cablea dictado en vivo", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(renderer, /_toggleLiveVoiceDictation|\$("voiceBtn")/, "Handler de voiceBtn presente");
});

test("voice-mode: bridge STT usa editcoreApp (no solo electronAPI)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "runtime", "voice-mode.js"), "utf8");
  assert.match(src, /editcoreApp\?\.transcribeAudio/, "Preferir editcoreApp.transcribeAudio");
  assert.match(src, /function getTranscribeFn/, "Helper getTranscribeFn presente");
  assert.match(src, /onCallEnded/, "Callback onCallEnded al colgar");
  assert.match(src, /formatCallTranscript/, "Formato de transcripcion de sesion");
  assert.match(src, /Misma ruta que escribir|onSend\(cleaned\)/, "Voz despacha al mismo onSend");
  assert.doesNotMatch(src, /if \(!raw\) \{\s*stop\(false\)/, "Vacio no cierra la llamada");
  const preferLine = src.split("\n").find((l) => l.includes("editcoreApp?.transcribeAudio"));
  assert.ok(preferLine, "Linea de preferencia editcoreApp encontrada");
  assert.match(preferLine, /editcoreApp/, "editcoreApp primero en la preferencia");
});

test("voice-mode: formatCallTranscript vacio sin sesion", () => {
  assert.equal(typeof VoiceMode.formatCallTranscript, "function");
  assert.equal(VoiceMode.formatCallTranscript(), "");
  assert.equal(VoiceMode.getTranscribeBridgeName(), "");
});
