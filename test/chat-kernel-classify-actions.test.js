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
