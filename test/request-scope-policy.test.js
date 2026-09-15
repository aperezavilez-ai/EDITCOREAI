"use strict";

const assert = require("assert");
const Scope = require("../runtime/request-scope-policy");
const Elite = require("../runtime/elite-communication-policy");

assert.strictEqual(Scope.classifyRequestScope("ANALIZA EL ROADMAP Y DIME EN QUE ESTADO SE ENCUENTRA"), "focused");
assert.strictEqual(Scope.classifyRequestScope("haz un analisis completo 0 a 100 del proyecto"), "broad");
assert.strictEqual(Scope.classifyRequestScope("arregla el bug del login"), "action");

const focused = Scope.buildScopedUserDirective("ANALIZA EL ROADMAP", "evidencia");
assert.ok(focused.includes("FOCALIZADO"));
assert.ok(focused.includes("PROHIBIDO"));

const broad = Scope.buildScopedUserDirective("auditoria completa 0 a 100", "evidencia");
assert.ok(broad.includes("AMPLIO"));

const viaElite = Elite.withEliteCommunicationPolicy("Eres agente.");
assert.ok(Scope.hasRequestScopePolicy(viaElite), "elite injects scope policy");
assert.ok(viaElite.includes("ENFOQUE DE LA SOLICITUD"));

console.log("request-scope-policy.test.js OK");
