"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getToolDefinitions, execute } = require("../runtime/tools/tools");

test("brain_remember está definida en getToolDefinitions", () => {
  const defs = getToolDefinitions({ allowWrite: true, isFullAccess: true });
  const found = defs.find((d) => d.function.name === "brain_remember");
  assert.ok(found, "La herramienta brain_remember debe estar registrada");
  assert.equal(found.function.parameters.required[0], "content");
});

test("brain_remember ejecuta correctamente sobre helpers.brainRemember", async () => {
  let record = null;
  const helpers = {
    brainRemember: async (root, item) => {
      record = { root, item };
      return true;
    }
  };

  const res = await execute(
    "brain_remember",
    { title: "Prueba Nexus 14B", content: "Regla de arquitectura aprendida", type: "architecture" },
    "C:\\test-project",
    true,
    helpers
  );

  assert.equal(res.ok, true);
  assert.equal(res.saved, true);
  assert.equal(res.title, "Prueba Nexus 14B");
  assert.equal(res.type, "architecture");
  assert.ok(record);
  assert.equal(record.item.title, "Prueba Nexus 14B");
  assert.equal(record.item.content, "Regla de arquitectura aprendida");
});
