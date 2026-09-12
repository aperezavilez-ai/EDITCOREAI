"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("renderer.js parsea sin SyntaxError (botones dependen de ello)", () => {
  const file = path.join(__dirname, "..", "renderer.js");
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout || "check failed");
});

test("parche elite en systemPrompt cierra parentesis del withElite", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.match(
    src,
    /withEliteCommunicationPolicy\s*\n\s*\|\|\s*\(\(s\)\s*=>\s*s\)\)\(\[[\s\S]*?\]\.join\("\\n\\n"\)\)\s*:\s*""/,
  );
});
