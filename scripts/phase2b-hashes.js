"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "main.js", "preload.js", "renderer.js", "package.json", "scripts/phase1-baseline.js",
  "runtime/context-engine.js", "runtime/context-manifest.js", "runtime/context-store.js", "runtime/tool-context.js", "runtime/token-ledger.js",
  "runtime/task-models.js", "runtime/task-store.js", "runtime/task-manager.js", "runtime/task-recovery.js", "runtime/task-ipc.js",
  "test/phase2b-task-store.test.js", "scripts/phase2b-crash-child.js", "scripts/phase2b-crash-acceptance.js",
  "scripts/phase2b-electron-seed.js", "scripts/phase2b-electron-verify.js", "scripts/phase2b-electron-acceptance.js",
].filter((relative) => fs.existsSync(path.join(root, relative)));
const output = Object.fromEntries(files.map((relative) => {
  const content = fs.readFileSync(path.join(root, relative));
  return [relative, { sha256: crypto.createHash("sha256").update(content).digest("hex"), bytes: content.length }];
}));
const target = path.join(root, "phase2b-results", "post-fase2b-hashes.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, `${JSON.stringify({ generatedAt: new Date().toISOString(), files: output }, null, 2)}\n`, "utf8");
