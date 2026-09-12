"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { buildProjectTemplate } = require("../project-template");
const { ProjectScaffoldService } = require("../project-scaffold-service");

test("plantilla blank solo crea README.md", () => {
  const built = buildProjectTemplate({ name: "Demo", template: "blank" });
  assert.deepEqual(Object.keys(built.files).sort(), ["README.md"]);
  assert.match(built.files["README.md"], /Demo/);
});

test("plantilla web conserva AGENTS.md", () => {
  const built = buildProjectTemplate({ name: "Demo", template: "web" });
  assert.ok(built.files["README.md"]);
  assert.ok(built.files["AGENTS.md"]);
  assert.ok(built.files["ROADMAP.md"]);
  assert.ok(built.files["index.html"]);
});

test("listTemplates oculta soundonemusic", () => {
  const service = new ProjectScaffoldService();
  const ids = service.listTemplates().map((item) => item.id);
  assert.ok(ids.includes("blank"));
  assert.ok(!ids.includes("soundonemusic"));
});

test("blank scaffold no escribe metadatos .editcore", async () => {
  const service = new ProjectScaffoldService();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-blank-"));
  const name = `blank-${Date.now()}`;
  try {
    const created = await service.create({ name, template: "blank", parentPath: parent, install: false });
    const root = created.root;
    const entries = fs.readdirSync(root);
    assert.deepEqual(entries.sort(), ["README.md"]);
    assert.equal(fs.existsSync(path.join(root, "AGENTS.md")), false);
    assert.equal(fs.existsSync(path.join(root, "instructions.md")), false);
    assert.equal(fs.existsSync(path.join(root, ".editcore")), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
