"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { isAuthorization, isRecoveryInstruction, recoveryPrompt, redactCredentials } = require("../project-analysis");

test("el arranque restaura el catalogo y el id activo sin borrar la seleccion", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");

  assert.doesNotMatch(source, /localStorage\.removeItem\(ACTIVE_PROJECT_STORAGE_KEY\)/);
  assert.match(source, /const storedActiveProjectId = String\(localStorage\.getItem\(ACTIVE_PROJECT_STORAGE_KEY\)/);
  assert.match(source, /state\.projects\.find\(\(project\) => project\.id === sourceActiveId && project\.projectRoot\)/);
  // Arranque en welcome (no auto-abrir proyecto); conserva id activo en localStorage.
  assert.match(source, /showWelcomeScreen\(\)/);
  assert.match(source, /WINDOW_ID === "main" && sourceActiveId/);
  assert.match(source, /\["READY", "RECOVERABLE", "AWAITING_AUTHORIZATION", "PLAN_READY"\]\.includes\(durableTask\.status\)/);
  assert.match(source, /durableTask\.status === "AWAITING_AUTHORIZATION"/);
  assert.match(source, /durableTask\.status === "PLAN_READY"/);
  assert.match(source, /phase: awaitingAuthorization \? "awaiting_authorization" : "interrupted"/);
  assert.match(source, /plan: recovered\?\.planContent \|\| project\.agentWorkflow\?\.plan \|\| ""/);
});

test("la autorizacion explicita continua el plan existente", () => {
  for (const phrase of [
    "Acepto el plan",
    "Acepto la propuesta.",
    "Autorizo la tarea",
    "Autorizo",
    "Procede",
    "Si, procede",
    "Procede con los cambios",
    "Sí, procede con todos los cambios.",
    "Continua con el plan",
    "Autorizo tu propuesta",
  ]) assert.equal(isAuthorization(phrase), true, phrase);
  for (const phrase of [
    "Analiza el proyecto",
    "Cuando autorices procedo con los cambios.",
    "Acepto revisar el problema, pero no ejecutes cambios",
    "No procedas con los cambios",
  ]) assert.equal(isAuthorization(phrase), false, phrase);
});

test("las correcciones de una tarea interrumpida conservan la autorizacion original", () => {
  for (const phrase of [
    "corrije los fallos",
    "continua con la tarea pendiente",
    "vamos a hacer paso por paso las correcciones ya descritas",
    "repara los errores anteriores",
  ]) assert.equal(isRecoveryInstruction(phrase), true, phrase);
  assert.equal(isRecoveryInstruction("corrige el login del proyecto nuevo"), false);

  const prompt = recoveryPrompt({ task: "Implementa el chat", plan: "Conectar y verificar", error: "Fallo npm" }, "corrige los fallos");
  assert.match(prompt, /SOLICITUD ORIGINAL:\nImplementa el chat/);
  assert.match(prompt, /PLAN AUTORIZADO:\nConectar y verificar/);
  assert.match(prompt, /INSTRUCCION ACTUAL:\ncorrige los fallos/);
  assert.match(prompt, /autorizacion original sigue vigente/i);
});

test("las credenciales se ocultan antes de persistir o mostrar una tarea", () => {
  const value = redactCredentials("endpoint https://example.test/chat clave: 12345678-1234-1234-1234-123456789abc Authorization: Bearer secret-token-value-123456");
  assert.doesNotMatch(value, /12345678-1234|secret-token-value/);
  assert.match(value, /clave:\s*\[REDACTED\]/i);
  assert.match(value, /Bearer \[REDACTED\]/);
});
