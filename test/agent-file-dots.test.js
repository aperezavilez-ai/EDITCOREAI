"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("el implementer avisa stage done para que main emita files-changed al árbol", async () => {
  const { runImplementer } = require("../editcore-chat-kernel/subagents/implementer");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-dots-"));
  try {
    fs.writeFileSync(path.join(dir, "a.js"), "const a = 1;\n");
    const events = [];
    await runImplementer({ projectRoot: dir, path: "a.js", oldText: "1", newText: "2", onProgress: (p) => events.push(p) });
    await runImplementer({ projectRoot: dir, path: "b.js", content: "module.exports = 2;\n", onProgress: (p) => events.push(p) });
    const writes = events.filter((e) => e.phase === "tool" && ["replace_in_file", "write_file"].includes(e.name));
    assert.equal(writes.length, 2);
    for (const w of writes) assert.equal(w.stage, "done");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("el análisis marca en el árbol los archivos con hallazgos", () => {
  const src = read("editcore-chat-kernel/orchestrator.js");
  assert.match(src, /const flagged = \[\.\.\.new Set\(\(verified\?\.findings \|\| \[\]\)\.map\(\(f\) => f\.file\)/);
  assert.match(src, /for \(const file of flagged\) onProgress\?\.\(\{ phase: "tool", stage: "done", name: "read_file"/);
});

test("el renderer marca el archivo antes de pintar el paso y sin cortar el log", () => {
  const src = read("renderer.js");
  const notify = src.indexOf("try { notifyAgentFileMutationProgress(thinkingEl, progress); }");
  const step = src.indexOf("addAgentStepToThinking(thinkingEl, progress);", notify);
  assert.ok(notify > 0, "notify envuelto en try");
  assert.ok(step > notify, "notify va antes del paso");
  const payload = require("../runtime/project-files-ui").filesChangedPayload(
    { phase: "tool", stage: "done", name: "read_file", input: { path: "runtime/clone-web-page.js" } },
    "D:\\PROGRAMAS IA\\EDITCOREAI",
  );
  assert.equal(payload.relativePath, "runtime/clone-web-page.js");
  assert.deepEqual(payload.highlightNames, ["runtime", "clone-web-page.js"]);
});
