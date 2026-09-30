"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("../editcore-chat-kernel/classify");

test("crear/mover/analizá activan tools (no chat ciego)", () => {
  const cases = [
    ["quiero crear una app que funcione", "EXECUTE"],
    ["MUEVELO A LA RUTA CORRECTA", "EXECUTE"],
    ["mueve el proyecto a D:\\PROGRAMAS IA", "EXECUTE"],
    ["analizá el proyecto", "ANALYZE"],
    ["analiza el proyecto", "ANALYZE"],
    ["hola", "CHAT"],
  ];
  for (const [msg, kind] of cases) {
    const d = classify(msg, { fullAccess: true });
    assert.equal(d.kind, kind, msg);
    if (kind === "CHAT") assert.equal(d.allowTools, false);
    else assert.equal(d.allowTools, true);
  }
});

test("análisis con sustantivo lee el disco sin escribir; clíticos ejecutan", () => {
  const cases = [
    ["hazme un analisis forense del proyecto", "ANALYZE", false],
    ["hazme un análisis lo más forense posible y dame un reporte completo", "ANALYZE", false],
    ["dame una auditoría del repo", "ANALYZE", false],
    ["quiero un diagnóstico del login", "ANALYZE", false],
    ["hazme un análisis y corrige los errores", "EXECUTE", true],
    ["genera un reporte en PDF", "EXECUTE", true],
    ["hazme una landing para mi gimnasio", "EXECUTE", true],
    ["créame un proyecto de uñas", "EXECUTE", true],
    ["arréglame el build", "EXECUTE", true],
  ];
  for (const [msg, kind, write] of cases) {
    const d = classify(msg, { fullAccess: true });
    assert.equal(d.kind, kind, msg);
    assert.equal(d.allowTools, true, msg);
    assert.equal(d.allowWrite, write, msg);
  }
});
