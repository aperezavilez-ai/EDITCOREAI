"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createDiscoveryLedger } = require("../runtime/evidence-grounding");
const { TOOL_ALLOWLIST, MODES } = require("../runtime/intent-orchestrator");

test("discovery: archivo real en disco se puede leer sin list_files previo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-exists-"));
  try {
    fs.writeFileSync(path.join(dir, "secret-config.ts"), "export const x=1\n", "utf8");
    const ledger = createDiscoveryLedger({ projectRoot: dir });
    const gate = ledger.assertReadable("secret-config.ts");
    assert.equal(gate.ok, true);
    assert.equal(gate.reason, "exists-on-disk");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("discovery: path inventado que NO existe sigue bloqueado", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-missing-"));
  try {
    const ledger = createDiscoveryLedger({ projectRoot: dir });
    ledger.rememberList("", [{ path: "package.json", kind: "file" }]);
    assert.throws(
      () => ledger.assertReadable("vite.config.js"),
      /no aparecio|Path no descubierto|Antes de leer/i,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("EXECUTE allowlist incluye create_pdf/word/excel/csv", () => {
  const tools = TOOL_ALLOWLIST[MODES.EXECUTE] || [];
  for (const name of ["create_pdf", "create_word", "create_excel", "create_csv", "write_file", "read_file"]) {
    assert.ok(tools.includes(name), `falta ${name} en EXECUTE`);
  }
});

test("main: read_file no aborta por tamaño y extrae documentos", () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.doesNotMatch(mainSrc, /Archivo demasiado grande\./);
  assert.match(mainSrc, /extractableDocument/);
  assert.match(mainSrc, /extractDocumentFromBuffer/);
  assert.match(mainSrc, /NO te detengas pidiendo que el usuario lo pegue/);
});
