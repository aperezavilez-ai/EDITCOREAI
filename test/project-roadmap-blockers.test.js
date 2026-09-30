"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRoadmapSyncFromRun } = require("../runtime/project-roadmap");

test("los bloqueos del ROADMAP ignoran código y errores del proveedor", () => {
  const reportText = [
    "Algo falló durante la ejecución: No pude autenticar el modelo. Revisa la API key en Modelos.",
    "falló: Model \"grok-4.3\" is not supported by any configured account in this group",
    "throw new Error(\"write_file_batch requiere un array 'files' no vacio.\");",
    "Error de build: el módulo auth-service no exporta createSession y rompe el login",
  ].join("\n");
  const payload = buildRoadmapSyncFromRun({ steps: [], task: "x", reportText });
  assert.equal(payload.blockers.length, 1);
  assert.match(payload.blockers[0], /auth-service/);
});
