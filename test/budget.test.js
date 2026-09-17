"use strict";

/**
 * budget.test.js
 * Tests de regresión que reproducen el bug de bucle infinito
 * ("Esperando al modelo… 11:21") y verifican que ahora corta.
 *
 * Ejecutar:
 *   node --test resources/app/agent-core/test/budget.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { runAgent } = require("../agent-core/src/orchestrator");
const { classifyMode, extractPathsFromPrompt } = require("../agent-core/src/modes");
const { isSufficient } = require("../agent-core/src/verifier");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempTree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-budget-"));
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(
      path.join(tmp, `file-${i}.js`),
      `"use strict";\nmodule.exports = { n: ${i} };\n`,
    );
  }
  fs.mkdirSync(path.join(tmp, "sub"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, "sub", "index.js"),
    `"use strict";\nfunction hello() { return "hi"; }\nmodule.exports = { hello };\n`,
  );
  return tmp;
}

function cleanup(tmp) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("1) el agente NO entra en bucle: corta por maxSteps", async () => {
  const tmp = makeTempTree();
  try {
    const events = [];
    const report = await runAgent(
      `Analiza todos los archivos de ${tmp} en profundidad`,
      {
        limits: { maxSteps: 5, maxToolCalls: 15, maxWallMs: 10_000 },
        onProgress: (e) => events.push(e.type),
      },
    );

    assert.ok(report.steps <= 5, `steps=${report.steps} debe ser <= 5`);
    assert.ok(
      report.toolCalls <= 15,
      `toolCalls=${report.toolCalls} debe ser <= 15`,
    );
    assert.ok(events.includes("start"), "debe emitir 'start'");
    assert.ok(
      events.includes("converged") ||
        events.includes("sufficient") ||
        events.includes("budget") ||
        events.includes("done") ||
        events.includes("verifying"),
      `debe terminar limpiamente. Eventos: ${events.join(",")}`,
    );
  } finally {
    cleanup(tmp);
  }
});

test("2) dedupe: la MISMA ruta dos veces NO cuenta doble", async () => {
  const target = "resources/app/agent-core/src/orchestrator.js";
  if (!fs.existsSync(target)) {
    // el repo no tiene este archivo → saltamos sin fallar
    return;
  }
  const report = await runAgent(
    `Lee ${target} y también ${target} por favor`,
    { limits: { maxSteps: 3, maxToolCalls: 10, maxWallMs: 5000 } },
  );
  assert.ok(
    report.toolCalls <= 10,
    `toolCalls=${report.toolCalls} debe ser <= 10`,
  );
});

test("3) presupuesto de tiempo: corta antes de maxWallMs + margen", async () => {
  const tmp = makeTempTree();
  try {
    const t0 = Date.now();
    const report = await runAgent(
      `Analiza recursivamente todo dentro de ${tmp} sin parar`,
      {
        limits: { maxSteps: 1000, maxToolCalls: 1000, maxWallMs: 1500 },
      },
    );
    const elapsed = Date.now() - t0;
    assert.ok(
      elapsed < 1500 + 2000,
      `el loop debe cortar cerca de 1.5s, tardó ${elapsed}ms`,
    );
    assert.ok(
      report.reason === "wall_timeout" ||
        report.reason === "tool_budget" ||
        report.reason === "token_budget" ||
        report.ok === true,
      `debe terminar por presupuesto o suficiente. reason=${report.reason}`,
    );
  } finally {
    cleanup(tmp);
  }
});

test("4) modo 'chat' NO explora archivos", async () => {
  const report = await runAgent("hola, ¿cómo estás?", {
    limits: { maxSteps: 5, maxToolCalls: 5, maxWallMs: 3000 },
  });
  assert.equal(report.mode, "chat");
  assert.equal(report.toolCalls, 0, "chat no debe hacer tool calls");
  assert.equal(report.steps, 0, "chat no debe avanzar pasos");
});

test("5) modo 'list' termina con al menos un listado", async () => {
  const events = [];
  const report = await runAgent(
    "enlista los archivos de resources/app/agent-core/src",
    {
      limits: { maxSteps: 5, maxToolCalls: 10, maxWallMs: 5000 },
      onProgress: (e) => events.push(e.type),
    },
  );
  assert.equal(report.mode, "list");
  assert.ok(
    events.includes("sufficient") || events.includes("converged"),
    `debe converger. Eventos: ${events.join(",")}`,
  );
});

test("6) classifyMode respeta el contrato de modes.js", () => {
  assert.equal(classifyMode(""), "chat");
  assert.equal(classifyMode("hola"), "chat");
  assert.equal(
    classifyMode("enlista los archivos de src"),
    "list",
  );
  assert.equal(
    classifyMode("explica qué hace el archivo src/foo.js"),
    "explain",
  );
  assert.equal(
    classifyMode("analiza esto y dime hallazgos"),
    "diagnose",
  );
  assert.equal(
    classifyMode("procede"),
    "execute",
  );
});

test("7) extractPathsFromPrompt devuelve { dirs, files }", () => {
  const out = extractPathsFromPrompt(
    "revisa resources/app/agent-core/src y también lee src/modes.js",
  );
  assert.ok(Array.isArray(out.dirs), "dirs debe ser array");
  assert.ok(Array.isArray(out.files), "files debe ser array");
  assert.ok(
    out.dirs.length + out.files.length > 0,
    "debe extraer al menos 1 path",
  );
});

test("8) isSufficient respeta el modo", () => {
  const base = { mode: "chat", evidence: [] };
  assert.equal(isSufficient(base, "x"), false);

  const listState = {
    mode: "list",
    evidence: [{ op: "list", path: "foo", dirs: [], files: [] }],
  };
  assert.equal(isSufficient(listState, "enlista foo"), true);

  const diagnoseThin = {
    mode: "diagnose",
    evidence: [{ op: "read", path: "a.js" }],
  };
  assert.equal(
    isSufficient(diagnoseThin, "analiza a.js"),
    false,
    "diagnose necesita más evidencia",
  );
});