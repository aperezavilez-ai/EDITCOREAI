"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { WorkspaceApi } = require("./workspace-api");
const { createAgentTools } = require("./agent-tools");

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-tools-"));
  fs.writeFileSync(path.join(root, "a.txt"), "hola", "utf8");
  return { root, api: new WorkspaceApi({ root }) };
}

const names = (d) => d.definitions().map((t) => t.function.name).sort();

test("sin permiso de escritura el modelo solo ve herramientas de lectura", () => {
  const { root, api } = workspace();
  try {
    const d = createAgentTools(api, { canWrite: false });
    assert.deepEqual(names(d), ["list_files", "read_file", "search_files"]);
    for (const forbidden of ["write_file", "replace_in_file", "run_command", "create_project", "service_write"]) {
      assert.ok(!names(d).includes(forbidden), forbidden);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("con permiso de escritura reaparecen las herramientas de escritura", () => {
  const { root, api } = workspace();
  try {
    const d = createAgentTools(api, { canWrite: true, runCommand: async () => "ok" });
    const list = names(d);
    for (const expected of ["write_file", "replace_in_file", "run_command"]) {
      assert.ok(list.includes(expected), expected);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("en modo analisis run_command sigue disponible sin habilitar escrituras", () => {
  const { root, api } = workspace();
  try {
    const d = createAgentTools(api, { canWrite: false, analysisMode: true, runCommand: async () => "ok", parseAnalysisCommand: () => true });
    const list = names(d);
    assert.ok(list.includes("run_command"), "run_command debe estar en analisis");
    assert.ok(!list.includes("write_file"), "write_file no debe estar");
    assert.ok(!list.includes("replace_in_file"), "replace_in_file no debe estar");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("authorize sigue siendo el segundo control de las escrituras registradas", async () => {
  const { root, api } = workspace();
  try {
    const d = createAgentTools(api, { canWrite: true, authorize: async () => false });
    const result = await d.dispatch("write_file", { path: "b.txt", content: "x" }, {});
    assert.equal(result.ok, false);
    assert.match(String(result.error), /no autorizada/i);
    assert.ok(!fs.existsSync(path.join(root, "b.txt")), "no debe haber escrito");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("un archivo existente exige lectura vigente antes de modificarse", async () => {
  const { root, api } = workspace();
  try {
    const d = createAgentTools(api, { canWrite: true, authorize: async () => true });
    const unread = await d.dispatch("write_file", { path: "a.txt", content: "nuevo" }, {});
    assert.equal(unread.ok, false);
    assert.match(String(unread.error), /Lee a\.txt antes de modificarlo/);

    assert.equal((await d.dispatch("read_file", { path: "a.txt" }, {})).ok, true);
    fs.writeFileSync(path.join(root, "a.txt"), "cambio externo", "utf8");
    const stale = await d.dispatch("write_file", { path: "a.txt", content: "nuevo" }, {});
    assert.equal(stale.ok, false);
    assert.match(String(stale.error), /cambio desde la ultima lectura/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("un env existente nunca se sobrescribe completo y un parche leido si se aplica", async () => {
  const { root, api } = workspace();
  try {
    fs.writeFileSync(path.join(root, ".env"), "PUBLIC=1\nSECRET=old\n", "utf8");
    const d = createAgentTools(api, { canWrite: true, authorize: async () => true });
    assert.equal((await d.dispatch("read_file", { path: ".env" }, {})).ok, true);
    const overwrite = await d.dispatch("write_file", { path: ".env", content: "SECRET=new\n" }, {});
    assert.equal(overwrite.ok, false);
    assert.match(String(overwrite.error), /No se permite sobrescribir/);
    const patched = await d.dispatch("replace_in_file", { path: ".env", oldText: "SECRET=old", newText: "SECRET=new" }, {});
    assert.equal(patched.ok, true);
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), "PUBLIC=1\nSECRET=new\n");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
