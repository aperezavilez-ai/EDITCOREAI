"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  chunkCodeFile,
  tokenize,
  extractSymbolsFromCode,
  buildSymbolGraph,
  findRelatedSymbolsAndFiles,
} = require("../runtime/codebase-indexer");

const {
  computeLineDiffHunks,
  applyAcceptedHunks,
  formatMonacoDecorations,
} = require("../runtime/monaco-diff-engine");

const { GitCheckpointManager } = require("../runtime/git-checkpoint-manager");
const { planDiagnostics } = require("../runtime/post-write-diagnostics");

test("Cursor-Parity 1: AST Symbol Extraction and Dependency Graph", () => {
  const sampleCode = `
import * as React from "react";
import { HeroSection } from "./components/sections/HeroSection";
import { BuySection } from "./components/sections/BuySection";

export function HomePage() {
  return (
    <div>
      <HeroSection />
      <BuySection />
    </div>
  );
}

export const config = { title: "Lipoblue" };
`;

  const data = extractSymbolsFromCode("src/pages/HomePage.tsx", sampleCode);
  assert.equal(data.exports.length, 2);
  assert.ok(data.symbols.includes("HomePage"));
  assert.ok(data.symbols.includes("config"));
  assert.equal(data.imports.length, 2);
  assert.ok(data.imports.some((i) => i.names.includes("HeroSection")));
  assert.ok(data.imports.some((i) => i.names.includes("BuySection")));
});

test("Cursor-Parity 2: Monaco Interactive Diff Hunk Engine", () => {
  const origText = "line 1\nline 2\nline 3\nline 4";
  const newText = "line 1\nline 2 modified\nline 3\nline 4 added";

  const hunks = computeLineDiffHunks(origText, newText);
  assert.ok(hunks.length >= 1);

  const applied = applyAcceptedHunks(origText, hunks);
  assert.equal(applied, newText);

  const decorations = formatMonacoDecorations(hunks);
  assert.ok(Array.isArray(decorations));
  assert.ok(decorations.length >= 1);
});

test("Cursor-Parity 3: Git Turn Checkpoint Manager and Time Travel", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-chk-test-"));
  const testFile = path.join(tmpDir, "src", "App.tsx");
  fs.mkdirSync(path.dirname(testFile), { recursive: true });
  fs.writeFileSync(testFile, "initial content", "utf8");

  const manager = new GitCheckpointManager({ projectRoot: tmpDir });
  const chk = manager.createCheckpoint({
    description: "Before Agent Mutation",
    modifiedFiles: ["src/App.tsx"],
  });

  assert.ok(chk.id);
  assert.equal(chk.filesCount, 1);

  fs.writeFileSync(testFile, "corrupted content", "utf8");
  assert.equal(fs.readFileSync(testFile, "utf8"), "corrupted content");

  const revert = manager.timeTravelTo(chk.id);
  assert.equal(revert.ok, true);
  assert.equal(fs.readFileSync(testFile, "utf8"), "initial content");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Cursor-Parity 4: Post-Write Diagnostics Planner", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-diag-test-"));
  const pkgPath = path.join(tmpDir, "package.json");
  fs.writeFileSync(pkgPath, JSON.stringify({
    name: "test-app",
    scripts: {
      check: "tsc --noEmit",
      test: "node --test",
    },
  }), "utf8");

  const plan = planDiagnostics(tmpDir, ["src/App.tsx"]);
  assert.equal(plan.skipped, false);
  assert.ok(plan.commands.length >= 1);
  assert.ok(plan.commands.some((c) => c.script === "check" || c.script === "test"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});