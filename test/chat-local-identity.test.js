"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { isCasualPrompt, localConversationResponse } = require("../runtime/chat-local");

test("chat-local: Identidad EditCoreAI y detección de preguntas casuales", () => {
  const prompts = [
    "HOLA",
    "hola!",
    "Buenas tardes",
    "QUIEN ERES?",
    "quien eres",
    "QUE MODELO ERES?",
    "QUE MODELOS ERES?",
    "qué modelo usas?",
    "QUE CAPACIDADES TIENES?",
    "que capacidades tienes",
    "QUE PUEDES HACER?",
    "que puedes hacer",
    "QUE HACES?",
    "para que sirves?"
  ];

  for (const p of prompts) {
    assert.strictEqual(isCasualPrompt(p), true, `Debe reconocer casual prompt: "${p}"`);
    const resp = localConversationResponse(p);
    assert.ok(resp.length > 0, `Debe responder a: "${p}"`);
    assert.ok(resp.includes("EditCoreAI"), `La respuesta a "${p}" debe identificarse como EditCoreAI: ${resp}`);
  }
});

test("chat-local: No intercepta intenciones de código o comandos", () => {
  const codePrompts = [
    "analiza el index.js",
    "crea un archivo server.js",
    "corrige el bug en el login",
    "vamos a crear un nuevo proyecto",
    "deploy a vercel"
  ];

  for (const cp of codePrompts) {
    assert.strictEqual(isCasualPrompt(cp), false, `No debe clasificar como casual: "${cp}"`);
    assert.strictEqual(localConversationResponse(cp), "", `Debe devolver cadena vacía: "${cp}"`);
  }
});
