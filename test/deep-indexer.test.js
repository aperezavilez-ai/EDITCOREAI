"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { DeepIndexer } = require("../runtime/deep-indexer");

test("deep-indexer: escanea workspace y extrae símbolos, imports y dependencias", async () => {
  const indexer = new DeepIndexer();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-deepindex-"));

  const fileA = path.join(tmpDir, "math.js");
  const fileB = path.join(tmpDir, "calculator.js");

  fs.writeFileSync(fileA, `
    const PI = 3.14159;
    function add(a, b) { return a + b; }
    class MathUtil {
      static multiply(a, b) { return a * b; }
    }
    module.exports = { add, MathUtil };
  `);

  fs.writeFileSync(fileB, `
    const { add, MathUtil } = require("./math");
    async function calculateTotal(items) {
      return items.reduce((acc, x) => add(acc, x), 0);
    }
    module.exports = calculateTotal;
  `);

  try {
    const res = await indexer.indexWorkspace(tmpDir);
    assert.equal(res.ok, true);

    const status = indexer.getGraphStatus();
    assert.equal(status.filesIndexed, 2);
    assert.ok(status.totalSymbols >= 4);

    // Búsqueda de símbolos
    const foundAdd = indexer.searchSymbols("add");
    assert.ok(foundAdd.length >= 1);
    assert.equal(foundAdd[0].name, "add");

    const foundClass = indexer.searchSymbols("MathUtil");
    assert.ok(foundClass.length >= 1);
    assert.equal(foundClass[0].type, "class");

    // Referencias
    const refs = indexer.findReferences("add");
    assert.ok(refs.length >= 1);

    // Consulta semántica rápida
    const queryRes = indexer.queryCodebase("calculateTotal items add", 3);
    assert.ok(queryRes.length >= 1);

    // Grafo de dependencias
    const deps = indexer.getDependencyGraph();
    assert.ok(deps["calculator.js"]?.includes("./math"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
