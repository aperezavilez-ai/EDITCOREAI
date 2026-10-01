"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { renameSyncFile } = require("../runtime/rename-sync");
const { imagesToCode } = require("../runtime/images-to-code");
const { generateAutoDocs } = require("../runtime/auto-docs");
const { applyDockerPlaybook, listDockerPlaybooks } = require("../runtime/docker-playbooks");
test("rename sync updates import refs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ren-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "OldWidget.js"), "module.exports = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "app.js"), "const w = require('./OldWidget');\n", "utf8");
  fs.writeFileSync(path.join(root, "README.md"), "see app elsewhere\n", "utf8");
  const out = renameSyncFile(root, "src/OldWidget.js", "src/NewWidget.js");
  assert.equal(out.ok, true);
  assert.equal(fs.existsSync(path.join(root, "src", "NewWidget.js")), true);
  assert.equal(fs.existsSync(path.join(root, "src", "OldWidget.js")), false);
  assert.match(fs.readFileSync(path.join(root, "src", "app.js"), "utf8"), /NewWidget/);
  assert.ok(out.refsUpdated >= 1);
  // no tocar README por basename inocente
  assert.match(fs.readFileSync(path.join(root, "README.md"), "utf8"), /see app elsewhere/);
});

test("rename sync no explota basenames cortos como app.js", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ren2-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.js"), "export default 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "index.html"), "<script src=\"./app.js\"></script>\n", "utf8");
  fs.writeFileSync(path.join(root, "other.json"), "{\"app\":true}\n", "utf8");
  const out = renameSyncFile(root, "src/app.js", "src/main.js");
  assert.equal(out.ok, true);
  assert.match(fs.readFileSync(path.join(root, "src", "index.html"), "utf8"), /\.\/main\.js/);
  assert.match(fs.readFileSync(path.join(root, "other.json"), "utf8"), /"app":true/);
  assert.equal(out.refsUpdated, 1);
});

test("images to code writes scaffold", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-img-"));
  const out = imagesToCode(root, { title: "Landing", description: "hero oscuro", folder: "landing" });
  assert.equal(out.ok, true);
  assert.ok(fs.existsSync(path.join(root, "src", "landing", "index.html")));
  assert.match(fs.readFileSync(path.join(root, "src", "landing", "index.html"), "utf8"), /Landing/);
});

test("auto docs creates markdown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-docs-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo", scripts: { start: "node ." } }), "utf8");
  const out = generateAutoDocs(root);
  assert.ok(out.files.includes("docs/AUTO_README.md"));
  assert.match(fs.readFileSync(path.join(root, "docs", "AUTO_README.md"), "utf8"), /demo/);
});

test("docker playbook writes templates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-dock-"));
  assert.ok(listDockerPlaybooks().length >= 2);
  const out = applyDockerPlaybook(root, "node");
  assert.equal(out.playbook, "node");
  assert.ok(fs.existsSync(path.join(root, ".editcore", "playbooks", "docker", "node", "Dockerfile")));
  assert.ok(fs.existsSync(path.join(root, "Dockerfile")));
});