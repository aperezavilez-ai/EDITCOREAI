const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractLspDiagnostics,
  buildLspPromptNudge,
  parseTerminalFailure,
  buildTerminalAutoFixPayload,
} = require("../runtime/lsp-terminal-autofix");

test("LSP Diagnostics - extractLspDiagnostics filters errors and warnings", () => {
  const rawMarkers = [
    { severity: 8, message: "Type 'string' is not assignable to type 'number'.", resource: { path: "src/types.ts" }, startLineNumber: 12, startColumn: 5 },
    { severity: 4, message: "Unused variable 'temp'", resource: { path: "src/utils.ts" }, startLineNumber: 3, startColumn: 1 },
    { severity: 1, message: "Info message", resource: { path: "src/info.ts" }, startLineNumber: 1, startColumn: 1 },
  ];

  const diagnostics = extractLspDiagnostics(rawMarkers);
  assert.equal(diagnostics.length, 2);
  assert.equal(diagnostics[0].severity, "ERROR");
  assert.equal(diagnostics[1].severity, "WARNING");

  const nudge = buildLspPromptNudge(diagnostics);
  assert.ok(nudge.includes("DIAGNÓSTICOS LSP EN VIVO"));
  assert.ok(nudge.includes("src/types.ts:12:5"));
});

test("Terminal Auto-Fix - parseTerminalFailure extracts exit code, error text and suspect files", () => {
  const terminalOut = [
    "> next build",
    "Failed to compile.",
    "src/components/Header.tsx:24:18 - error TS2304: Cannot find name 'useSession'.",
    "  24 |   const session = useSession();",
  ].join("\n");

  const failure = parseTerminalFailure("npm run build", terminalOut, 1);
  assert.ok(failure);
  assert.equal(failure.command, "npm run build");
  assert.equal(failure.exitCode, 1);
  assert.ok(failure.suspectLocations.some((loc) => loc.file.includes("Header.tsx") && loc.line === 24));
});

test("Terminal Auto-Fix - buildTerminalAutoFixPayload generates actionable agent prompt", () => {
  const terminalOut = "Error: Cannot find module './missing-module'\n    at Object.<anonymous> (server.js:5:1)";
  const payload = buildTerminalAutoFixPayload("node server.js", terminalOut, 1, "/app");

  assert.ok(payload);
  assert.ok(payload.title.includes("node server.js"));
  assert.ok(payload.prompt.includes("node server.js"));
  assert.ok(payload.prompt.includes("server.js"));
  assert.ok(payload.prompt.includes("Analiza el error"));
});
