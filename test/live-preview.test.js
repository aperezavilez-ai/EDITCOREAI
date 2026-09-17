"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { LivePreviewManager, INSPECTOR_INJECTION_SCRIPT } = require("../runtime/live-preview-manager");

test("LivePreviewManager detects active dev servers, provides inspector script, and handles Click-to-Edit", async (t) => {
  const manager = new LivePreviewManager();

  // Iniciar servidor HTTP dummy en un puerto específico (ej. 3001)
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h1>EditCoreAI App Preview</h1>");
  });

  await new Promise((resolve) => server.listen(3001, "127.0.0.1", resolve));

  try {
    // 1. Detección de servidor activo
    const detection = await manager.detectActiveDevServer([3001]);
    assert.equal(detection.active, true);
    assert.equal(detection.port, 3001);
    assert.equal(detection.url, "http://localhost:3001");

    // 2. Script de inyección
    const script = manager.getInspectorScript();
    assert.ok(script.includes("__EDITCORE_INSPECTOR_ACTIVE__"));
    assert.ok(script.includes("EDITCORE_ELEMENT_SELECTED"));

    // 3. Selección y Click-to-Edit
    const inspected = manager.handleElementSelected({
      tagName: "button",
      id: "submit-btn",
      className: "btn btn-primary px-4",
      innerText: "Comprar ahora",
    });

    assert.ok(inspected.promptSuggestion.includes("<button #submit-btn>"));
    assert.ok(inspected.promptSuggestion.includes('con texto "Comprar ahora"'));

    // 4. Toggle inspect mode
    const mode = manager.setInspectMode(true);
    assert.equal(mode, true);
  } finally {
    server.close();
  }
});
