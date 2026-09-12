"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const windowsStt = require("../runtime/windows-stt");

test("windows-stt: API basica", () => {
  assert.equal(typeof windowsStt.isSupported, "function");
  assert.equal(typeof windowsStt.start, "function");
  assert.equal(typeof windowsStt.stop, "function");
  assert.equal(typeof windowsStt.setPaused, "function");
  assert.equal(windowsStt.isSupported(), process.platform === "win32");
});

test("windows-stt: limpia ruido CLIXML", () => {
  assert.equal(windowsStt.isCliXmlNoise("<Objs Version=\"1.1.0.1\""), true);
  assert.equal(windowsStt.isCliXmlNoise("READY"), false);
  assert.match(windowsStt.cleanError("<Objs Version=\"1.1.0.1\" xmlns"), /reconocimiento|Windows/i);
});

test("voice-mode: usa Windows STT y evita getUserMedia exclusivo", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "runtime", "voice-mode.js"), "utf8");
  assert.match(src, /windowsSttStart/);
  assert.match(src, /isEchoOfTts/);
  assert.match(src, /No se captó voz del usuario/);
  assert.match(src, /!useWindows && navigator\.mediaDevices/);
  assert.match(src, /await flushCurrentAudioChunks\(true\)/);
});

test("preload: expone windows STT bridge", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  assert.match(src, /windowsSttStart/);
  assert.match(src, /onWindowsSttText/);
  assert.match(src, /agent:windows-stt-start/);
});
