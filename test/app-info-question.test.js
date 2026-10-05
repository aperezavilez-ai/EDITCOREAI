"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadIsAppInfoQuestion() {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const start = source.indexOf("function isAppInfoQuestion(");
  const end = source.indexOf("\nfunction localAppInfoAnswer(", start);
  assert.ok(start >= 0 && end > start, "isAppInfoQuestion debe existir en renderer.js");
  const sandbox = {};
  vm.runInNewContext(`${source.slice(start, end)}\nthis.fn = isAppInfoQuestion;`, sandbox);
  return sandbox.fn;
}

const isAppInfoQuestion = loadIsAppInfoQuestion();

test("preguntas sobre EditCoreAI usan la respuesta local", () => {
  for (const prompt of [
    "¿qué es esta app?",
    "que hace editcoreai",
    "para qué sirve EditCore AI?",
    "quién eres?",
    "como te llamas",
    "para que sirves",
    "ayuda",
    "¿Ayuda?",
  ]) {
    assert.equal(isAppInfoQuestion(prompt), true, prompt);
  }
});

test("preguntas sobre el proyecto u otros temas van al modelo", () => {
  for (const prompt of [
    "que es calili?",
    "que hace calili?",
    "¿qué es React?",
    "qué hace esta función?",
    "para qué sirve el archivo main.js",
    "necesito ayuda con el login",
    "que haces?",
    "corrige qué es esta app",
  ]) {
    assert.equal(isAppInfoQuestion(prompt), false, prompt);
  }
});
