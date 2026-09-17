const test = require("node:test");
const assert = require("node:assert/strict");

const {
  computeLineDiffHunks,
  applyHunkToText,
  applyAcceptedHunks,
  formatMonacoDecorations,
} = require("../runtime/monaco-diff-engine");

test("Monaco Diff Engine - computeLineDiffHunks identifies insert, delete and replace hunks", () => {
  const original = [
    "function greet() {",
    "  console.log('hola');",
    "  return true;",
    "}",
  ].join("\n");

  const modified = [
    "function greet(name) {",
    "  console.log(`hola ${name}`);",
    "  const valid = true;",
    "  return valid;",
    "}",
  ].join("\n");

  const hunks = computeLineDiffHunks(original, modified);
  assert.ok(hunks.length > 0);
  assert.equal(hunks[0].type, "replace");
  assert.ok(hunks[0].newLines.some((l) => l.includes("greet(name)")));
});

test("Monaco Diff Engine - applyHunkToText and applyAcceptedHunks merge code cleanly", () => {
  const original = "line 1\nline 2\nline 3";
  const modified = "line 1\nline TWO MODIFIED\nline 3";

  const hunks = computeLineDiffHunks(original, modified);
  assert.equal(hunks.length, 1);

  const appliedOne = applyHunkToText(original, hunks[0]);
  assert.equal(appliedOne, modified);

  hunks[0].status = "accepted";
  const appliedAll = applyAcceptedHunks(original, hunks);
  assert.equal(appliedAll, modified);
});

test("Monaco Diff Engine - formatMonacoDecorations returns Monaco-compliant decorations", () => {
  const hunks = [
    {
      id: "hunk_1",
      startLineNumber: 2,
      endLineNumber: 4,
      originalLines: ["const x = 1;"],
      newLines: ["const x = 2;", "const y = 3;"],
      type: "replace",
      status: "pending",
    },
  ];

  const decorations = formatMonacoDecorations(hunks);
  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].options.className, "monaco-diff-line-inserted");
  assert.equal(decorations[0].options.isWholeLine, true);
  assert.ok(decorations[0].options.hoverMessage.value.includes("Aceptar"));
});
