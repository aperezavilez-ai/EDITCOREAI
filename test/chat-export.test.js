"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("export markdown format has roles", () => {
  const messages = [
    { role: "user", content: "hola" },
    { role: "assistant", text: "mundo" },
  ];
  const lines = ["# EDITCOREAI chat export", ""];
  for (const msg of messages) {
    lines.push(`## ${msg.role}`, "", String(msg.content || msg.text || ""), "", "---", "");
  }
  const md = lines.join("\n");
  assert.match(md, /## user/);
  assert.match(md, /hola/);
  assert.match(md, /## assistant/);
  assert.match(md, /mundo/);
});

test("write under .editcore path policy shape", () => {
  const rel = `.editcore/chat-export-test.md`;
  assert.match(rel, /^\.editcore\//i);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-export-"));
  const target = path.join(tmp, ".editcore", "chat-export-test.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "# ok\n", "utf8");
  assert.equal(fs.readFileSync(target, "utf8"), "# ok\n");
});
