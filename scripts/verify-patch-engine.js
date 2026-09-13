"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  applyPatch,
  generateDiff,
  writeFileAtomic,
  rollbackPatch,
  listBackups,
} = require("../patch-engine");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-patch-"));
const file = path.join(dir, "sample.txt");
writeFileAtomic(file, "alpha\nbeta\ngamma\n");
const first = applyPatch(dir, file, "beta", "BETA");
assert.equal(first.ok, true);
assert.match(fs.readFileSync(file, "utf8"), /BETA/);
assert.ok(String(generateDiff(file, "a", "b")).includes("+++"));
const backups = listBackups(file);
assert.ok(Array.isArray(backups));
assert.ok(backups.length >= 1);
const rolled = rollbackPatch(file, backups[0].path);
assert.equal(rolled.ok, true);
assert.match(fs.readFileSync(file, "utf8"), /beta/);
console.log("PATCH_ENGINE_OK");
