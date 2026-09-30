"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { replaceInFile } = require("../editcore-chat-kernel/tools");

function tmpProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-replace-"));
  for (const [rel, content] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), content, "utf8");
  return root;
}

test("replace_in_file rechaza un parche que rompe un JS válido y no toca el archivo", () => {
  const original = "function a() {\n  return 1;\n}\nfunction keep() { return 2; }\n";
  const root = tmpProject({ "a.js": original });
  const r = replaceInFile(root, "a.js", "function a() {\n  return 1;\n}", "function a() {\n  return 1;\n}\n}");
  assert.equal(r.ok, false);
  assert.equal(r.soft, true);
  assert.match(r.error, /rompería la sintaxis/);
  assert.equal(fs.readFileSync(path.join(root, "a.js"), "utf8"), original);
});

test("replace_in_file aplica parches válidos", () => {
  const root = tmpProject({ "a.js": "function a() {\n  return 1;\n}\n" });
  const r = replaceInFile(root, "a.js", "return 1;", "return 3;");
  assert.equal(r.ok, true);
  assert.match(fs.readFileSync(path.join(root, "a.js"), "utf8"), /return 3;/);
});

test("replace_in_file no inventa coincidencias con indentación distinta", () => {
  const original = "function a() {\n    return 1;\n}\n";
  const root = tmpProject({ "a.js": original });
  const r = replaceInFile(root, "a.js", "function a() {\n\n  return 1;\n}", "function b() {}");
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(path.join(root, "a.js"), "utf8"), original);
});
