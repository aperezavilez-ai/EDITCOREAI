"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const orchestratorPath = require.resolve(path.join(__dirname, "..", "agent-core", "src", "orchestrator"));

function loadOrchestrator(extendedImpl) {
  delete require.cache[orchestratorPath];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, ...rest) {
    if (request === "./tools-extended" && parent?.filename === orchestratorPath) {
      if (!extendedImpl) throw new Error("Cannot find module 'axios'");
      return extendedImpl;
    }
    return originalLoad.call(this, request, parent, ...rest);
  };
  try {
    return require(orchestratorPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[orchestratorPath];
  }
}

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-executor-"));
  fs.writeFileSync(path.join(root, "a.txt"), "uno\ndos\ntres\n");
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "b.js"), "const marca = 'aguja';\n");
  fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "x", "c.js"), "aguja oculta\n");
  return root;
}

test("tools nativas: list_files, read_file (con rango), write/replace/delete y search_files", async () => {
  const { buildDefaultExecutor } = loadOrchestrator(null);
  const root = tmpRoot();
  const { execute } = buildDefaultExecutor({ projectRoot: root });

  const list = await execute("list_files", {});
  assert.ok(Array.isArray(list));
  const sub = list.find((e) => e.name === "sub");
  assert.deepEqual(sub, { name: "sub", path: path.join(root, "sub"), isDirectory: true, isFile: false });
  const badList = await execute("list_files", { path: "no-existe" });
  assert.equal(badList.ok, false);
  assert.match(badList.error, /^list_files fallo: /);

  const read = await execute("read_file", { path: "a.txt" });
  assert.deepEqual(read, { ok: true, path: path.join(root, "a.txt"), content: "uno\ndos\ntres\n", truncated: false, totalLines: 4 });
  const ranged = await execute("read_file", { path: "a.txt", startLine: 2, endLine: 3 });
  assert.equal(ranged.content, "dos\ntres");
  assert.equal(ranged.truncated, true);
  assert.match((await execute("read_file", { path: "x.txt" })).error, /^read_file fallo: /);

  const wrote = await execute("write_file", { path: "nuevo/d.txt", content: "hola" });
  assert.deepEqual(wrote, { ok: true, path: path.join(root, "nuevo", "d.txt"), bytes: 4 });
  assert.equal((await execute("replace_in_file", { path: "nuevo/d.txt", oldText: "zzz", newText: "x" })).error, "oldText no encontrado en el archivo");
  const replaced = await execute("replace_in_file", { path: "nuevo/d.txt", oldText: "hola", newText: "hola mundo" });
  assert.equal(replaced.diffChars, 6);
  assert.equal(fs.readFileSync(path.join(root, "nuevo", "d.txt"), "utf8"), "hola mundo");
  assert.deepEqual(await execute("delete_file", { path: "nuevo/d.txt" }), { ok: true, path: path.join(root, "nuevo", "d.txt") });
  assert.match((await execute("delete_file", { path: "nuevo/d.txt" })).error, /^delete_file fallo: /);

  assert.deepEqual(await execute("search_files", {}), { ok: false, error: "query es requerido" });
  const found = await execute("search_files", { query: "aguja" });
  assert.equal(found.count, 1);
  assert.equal(found.matches[0].path, path.join(root, "sub", "b.js"));
  assert.equal(found.matches[0].line, 1);
});

test("sin tools-extended: mensajes de run_command, run_shell, tools extendidas y nombres desconocidos", async () => {
  const { buildDefaultExecutor } = loadOrchestrator(null);
  const { execute } = buildDefaultExecutor({ projectRoot: tmpRoot() });
  assert.deepEqual(await execute("run_command", { command: "echo hi" }), { ok: false, error: "run_shell no disponible (tools-extended no cargado)" });
  assert.match((await execute("run_shell", { command: "echo hi" })).error, /^Tool "run_shell" no disponible/);
  assert.match((await execute("web_search", { query: "x" })).error, /^Tool "web_search" no disponible/);
  assert.deepEqual(await execute("borrar_todo", {}), { ok: false, error: "Herramienta desconocida: borrar_todo" });
  assert.deepEqual(await execute("toString", {}), { ok: false, error: "Herramienta desconocida: toString" });
  assert.deepEqual(await execute("constructor", {}), { ok: false, error: "Herramienta desconocida: constructor" });
});

test("con tools-extended: despacha extendidas, run_command usa run_shell con cwd del proyecto y los errores se envuelven", async () => {
  const calls = [];
  const fake = {
    web_search: async (args) => { calls.push(["web_search", args]); return { ok: true, results: [] }; },
    run_shell: async (args) => { calls.push(["run_shell", args]); return { ok: true, stdout: "hi" }; },
    git_log: async () => { throw new Error("repo roto"); },
  };
  const { buildDefaultExecutor } = loadOrchestrator(fake);
  const root = tmpRoot();
  const { execute } = buildDefaultExecutor({ projectRoot: root });
  assert.deepEqual(await execute("web_search", { query: "electron" }), { ok: true, results: [] });
  assert.deepEqual(await execute("run_command", { command: "echo hi" }), { ok: true, stdout: "hi" });
  assert.deepEqual(calls[1], ["run_shell", { command: "echo hi", cwd: root }]);
  await execute("run_shell", { command: "dir" });
  assert.deepEqual(calls[2], ["run_shell", { command: "dir" }]);
  assert.deepEqual(await execute("git_log", { repoPath: root }), { ok: false, error: "Error en git_log: repo roto" });
  assert.match((await execute("git_clone", { url: "x" })).error, /^Tool "git_clone" no disponible/);
});
