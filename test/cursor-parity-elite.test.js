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
