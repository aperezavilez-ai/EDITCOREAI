"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestCommitMessage } = require("../runtime/agent-git");

test("suggestCommitMessage resume un archivo", () => {
  const out = suggestCommitMessage({
    files: [{ path: "resources/app/runtime/agent-git.js" }],
    runId: "abc",
  });
  assert.match(out.message, /agent-git\.js/);
  assert.match(out.message, /resources\/app\/runtime\/agent-git\.js/);
  assert.match(out.message, /Run: abc/);
});

test("suggestCommitMessage usa task si viene", () => {
  const out = suggestCommitMessage({
    task: "Semana 5 git helpers",
    files: ["a.js", "b.js"],
  });
  assert.match(out.message, /^Semana 5 git helpers/);
});
