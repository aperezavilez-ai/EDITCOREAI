"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const { MultiFileComposer } = require("../runtime/multi-file-composer");

test("multi-file-composer: crea plan atómico, previsualiza y aplica cambios en 3 archivos", async () => {
  const composer = new MultiFileComposer();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-composer-"));

  const file1 = path.join(tmpDir, "header.js");
  const file2 = path.join(tmpDir, "footer.js");
  const file3 = path.join(tmpDir, "app.js");

  fs.writeFileSync(file1, "const header = 'v1';");
  fs.writeFileSync(file2, "const footer = 'v1';");
  fs.writeFileSync(file3, "const app = 'v1';");

  try {
    const plan = composer.createPlan({
      goal: "Upgrade components to v2",
      workspace: tmpDir,
      changes: [
        { path: "header.js", newContent: "const header = 'v2';" },
        { path: "footer.js", newContent: "const footer = 'v2';" },
        { path: "app.js", newContent: "const app = 'v2';" },
      ],
    });

    assert.equal(plan.filesCount, 3);
    assert.ok(plan.planId.startsWith("plan_"));

    // Preview
    const preview = composer.previewChanges(plan.planId);
    assert.equal(preview.files.length, 3);
    assert.ok(preview.files[0].diff.includes("+const header = 'v2';"));

    // Apply
    const applyRes = await composer.applyAtomicChanges(plan.planId);
    assert.equal(applyRes.ok, true);
    assert.equal(applyRes.filesModified, 3);

    assert.equal(fs.readFileSync(file1, "utf8"), "const header = 'v2';");
    assert.equal(fs.readFileSync(file2, "utf8"), "const footer = 'v2';");
    assert.equal(fs.readFileSync(file3, "utf8"), "const app = 'v2';");

    // Rollback
    const rollbackRes = await composer.rollbackAtomicChanges(plan.planId);
    assert.equal(rollbackRes.ok, true);
    assert.equal(rollbackRes.status, "rolled_back");

    assert.equal(fs.readFileSync(file1, "utf8"), "const header = 'v1';");
    assert.equal(fs.readFileSync(file2, "utf8"), "const footer = 'v1';");
    assert.equal(fs.readFileSync(file3, "utf8"), "const app = 'v1';");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
