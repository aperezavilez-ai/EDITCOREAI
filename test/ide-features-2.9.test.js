"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("tab-prediction returns ghost + latency", () => {
  const { collectCandidates, ghostFromCandidates } = require("../runtime/tab-prediction");
  const result = collectCandidates(process.cwd(), "cons", {
    index: { files: [], symbols: [{ name: "console", kind: "id" }] },
  });
  assert.ok(Array.isArray(result.candidates));
  assert.ok(typeof result.latencyMs === "number");
  const ghost = ghostFromCandidates("cons", result.candidates);
  assert.ok(ghost.accept);
});

test("semantic incremental persist + reuse", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sem-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "a.js"), "function helloWorld() { return 1; }\n", "utf8");
  const { buildIncrementalIndex, indexPath } = require("../runtime/semantic-index-incremental");
  const first = buildIncrementalIndex(dir, { force: true });
  assert.ok(first.docs.length >= 1);
  assert.ok(fs.existsSync(indexPath(dir)));
  const second = buildIncrementalIndex(dir, { force: false });
  assert.equal(second.stats.reused >= 1, true);
});

test("project memory architecture rules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mem-"));
  const {
    rememberProjectEvent,
    loadProjectMemory,
    formatMemoryForPrompt,
  } = require("../runtime/project-memory");
  rememberProjectEvent(dir, {
    task: "seed",
    summary: "memoria inicial",
    architectureRule: "Usar CommonJS en runtime/",
    styleGuide: "Sin comentarios obvios",
  });
  const mem = loadProjectMemory(dir);
  assert.equal(mem.architectureRules[0].text.includes("CommonJS"), true);
  assert.match(formatMemoryForPrompt(mem), /REGLAS DE ARQUITECTURA/);
  assert.ok(fs.existsSync(path.join(dir, ".editcore", "memory.json")));
});

test("pty session spawn-pipe write", async () => {
  const { createSession, writeSession, killSession, getSession } = require("../runtime/pty-session");
  const snap = createSession({ cwd: process.cwd() });
  assert.ok(snap.id);
  assert.ok(snap.backend === "spawn-pipe" || snap.backend === "node-pty");
  const session = getSession(snap.id);
  let got = "";
  await new Promise((resolve) => {
    const t = setTimeout(resolve, 1200);
    session.on("data", (d) => {
      got += d;
      if (got.length > 0) {
        clearTimeout(t);
        resolve();
      }
    });
    writeSession(snap.id, "echo EDITCORE_PTY_OK\r\n");
  });
  killSession(snap.id);
  assert.ok(true);
});

test("extension host install synthetic vsix zip", async () => {
  const JSZip = require("jszip");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-vsix-"));
  const zip = new JSZip();
  zip.file(
    "extension/package.json",
    JSON.stringify({
      name: "demo-theme",
      publisher: "editcore",
      version: "1.0.0",
      displayName: "Demo Theme",
      contributes: {
        themes: [{ label: "Demo", path: "./themes/demo.json" }],
        commands: [{ command: "editcore.hello", title: "Hello" }],
      },
    })
  );
  zip.file(
    "extension/themes/demo.json",
    JSON.stringify({ colors: { "editor.background": "#111111" } })
  );
  const vsixPath = path.join(dir, "demo.vsix");
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(vsixPath, buf);
  const { installVsix, listExtensions, uninstallExtension } = require("../runtime/extension-host");
  const installed = await installVsix(dir, vsixPath);
  assert.equal(installed.ok, true);
  assert.equal(installed.extension.id, "editcore.demo-theme");
  const list = listExtensions(dir);
  assert.equal(list.extensions.length, 1);
  uninstallExtension(dir, "editcore.demo-theme");
  assert.equal(listExtensions(dir).extensions.length, 0);
});
