"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const selfGuard = require("../editcore-chat-kernel/self-guard");
const tools = require("../editcore-chat-kernel/tools");

function fakeApp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-selfguard-"));
  const put = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body, "utf8");
  };
  put("main.js", 'const a = require("./runtime/a");\nfunction lazy() {\n  return require("./scripts/optional");\n}\nmodule.exports = { a, lazy };\n');
  put("runtime/a.js", "module.exports = 1;\n");
  put("preload.js", "module.exports = {};\n");
  put("editcore-chat-kernel/index.js", 'const { run } = require("./orchestrator");\nmodule.exports = { run };\n');
  put("editcore-chat-kernel/orchestrator.js", "module.exports = { run() { return 1; } };\n");
  put("renderer.js", "window.x = 1;\n");
  return root;
}

const writeStep = (name, result) => ({ name, result });

test("checkBoot: app sana pasa; los requires diferidos (indentados) no cuentan", () => {
  const root = fakeApp();
  const r = selfGuard.checkBoot(root);
  assert.equal(r.ok, true, r.problems.join("\n"));
  assert.ok(r.checked >= 5);
});

test("checkBoot: detecta require de nivel superior inexistente y error de sintaxis", () => {
  const root = fakeApp();
  fs.appendFileSync(path.join(root, "main.js"), 'const { ContextEngine } = require("./runtime/context-engine");\n');
  fs.writeFileSync(path.join(root, "editcore-chat-kernel/orchestrator.js"), "module.exports = { run() { return 1; };\n");
  const r = selfGuard.checkBoot(root);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /main\.js:6: require\("\.\/runtime\/context-engine"\) no existe/.test(p)), r.problems.join("\n"));
  assert.ok(r.problems.some((p) => /orchestrator\.js: error de sintaxis/.test(p)), r.problems.join("\n"));
});

test("verifyAfterTurn: revierte las escrituras del turno que rompen el arranque", () => {
  const root = fakeApp();
  const originalMain = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const created = tools.writeFile(root, "runtime/helper.js", "module.exports = 2;\n");
  const patched = tools.replaceInFile(root, "main.js", 'const a = require("./runtime/a");', 'const a = require("./runtime/a");\nconst cache = require("./prompt-cache");');
  assert.ok(created.snapshotId && patched.snapshotId);

  const guard = selfGuard.verifyAfterTurn(root, [writeStep("write_file", created), writeStep("replace_in_file", patched)], { appRoot: root });
  assert.equal(guard.ok, false);
  assert.ok(guard.problems.some((p) => p.includes('require("./prompt-cache") no existe')));
  assert.equal(fs.readFileSync(path.join(root, "main.js"), "utf8"), originalMain);
  assert.equal(fs.existsSync(path.join(root, "runtime/helper.js")), false);
  assert.deepEqual(guard.stillBroken, []);
  assert.match(selfGuard.formatGuardNotice(guard), /Cambios revertidos[\s\S]*main\.js` \(restaurado\)[\s\S]*helper\.js` \(creado en este turno, eliminado\)/);
});

test("verifyAfterTurn: cambio en varios pasos (require + archivo nuevo) no se revierte", () => {
  const root = fakeApp();
  const patched = tools.replaceInFile(root, "editcore-chat-kernel/index.js", 'const { run } = require("./orchestrator");', 'const { run } = require("./orchestrator");\nconst engine = require("./engine");');
  const created = tools.writeFile(root, "editcore-chat-kernel/engine.js", "module.exports = {};\n");
  const guard = selfGuard.verifyAfterTurn(root, [writeStep("replace_in_file", patched), writeStep("write_file", created)], { appRoot: root });
  assert.equal(guard.ok, true);
  assert.ok(fs.existsSync(path.join(root, "editcore-chat-kernel/engine.js")));
  assert.match(fs.readFileSync(path.join(root, "editcore-chat-kernel/index.js"), "utf8"), /require\("\.\/engine"\)/);
});

test("verifyAfterTurn: no actúa en otros proyectos ni en turnos sin escrituras", () => {
  const root = fakeApp();
  const other = fakeApp();
  fs.appendFileSync(path.join(other, "main.js"), 'require("./no-existe");\n');
  const step = writeStep("write_file", { ok: true, snapshotId: null });
  assert.equal(selfGuard.verifyAfterTurn(other, [step], { appRoot: root }), null);
  assert.equal(selfGuard.verifyAfterTurn(root, [{ name: "read_file", result: { ok: true } }], { appRoot: root }), null);
  assert.equal(selfGuard.verifyAfterTurn(root, [], { appRoot: root }), null);
});

test("el código real de EditCoreAI arranca según la guardia y handleChat la aplica", () => {
  const r = selfGuard.checkBoot();
  assert.equal(r.ok, true, r.problems.join("\n"));
  const index = fs.readFileSync(path.join(__dirname, "..", "editcore-chat-kernel", "index.js"), "utf8");
  assert.match(index, /selfGuard\.verifyAfterTurn\(input\?\.projectRoot, out\?\.steps\)/);
});
