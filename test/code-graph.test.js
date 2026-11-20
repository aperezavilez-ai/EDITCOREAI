"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { analyzeCodeSymbols, buildProjectSymbolGraph } = require("../runtime/code-graph");

test("code-graph: analyzeCodeSymbols extrae funciones, clases, tipos e imports de TypeScript", () => {
  const code = `
import { useState, useEffect } from 'react';
import authService from './auth';

export interface UserProfile {
  id: string;
  name: string;
}

export type UserRole = 'ADMIN' | 'DEV';

export function calculateScore(a: number, b: number): number {
  return a + b;
}

export class AnalyticsService {
  process() {}
}

const privateHelper = () => {};
`;

  const result = analyzeCodeSymbols("src/analytics.ts", code);
  assert.equal(result.filePath, "src/analytics.ts");

  // Verificar exports
  const exportNames = result.exports.map((e) => e.name);
  assert.ok(exportNames.includes("UserProfile"));
  assert.ok(exportNames.includes("UserRole"));
  assert.ok(exportNames.includes("calculateScore"));
  assert.ok(exportNames.includes("AnalyticsService"));
  assert.ok(!exportNames.includes("privateHelper"));

  // Verificar imports
  assert.equal(result.imports.length, 2);
  const reactImport = result.imports.find((i) => i.module === "react");
  assert.ok(reactImport);
  assert.ok(reactImport.symbols.some((s) => s.name === "useState"));
  assert.ok(reactImport.symbols.some((s) => s.name === "useEffect"));
});

test("code-graph: buildProjectSymbolGraph vincula definiciones y referencias cruzadas", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-codegraph-test-"));
  try {
    const fileA = path.join(tmp, "math.ts");
    const fileB = path.join(tmp, "app.ts");

    fs.writeFileSync(fileA, "export function sum(a: number, b: number) { return a + b; }\nexport const PI = 3.14;", "utf8");
    fs.writeFileSync(fileB, "import { sum, PI } from './math';\nexport function run() { return sum(2, PI); }", "utf8");

    const graph = buildProjectSymbolGraph(tmp);
    assert.equal(graph.totalFilesIndexed, 2);

    // Buscar símbolo 'sum'
    const sym = graph.findSymbol("sum");
    assert.equal(sym.symbol, "sum");
    assert.equal(sym.definitions.length, 1);
    assert.equal(sym.definitions[0].filePath, "math.ts");
    assert.equal(sym.definitions[0].kind, "function");
    assert.ok(sym.importedBy.includes("app.ts"));

    // Dependencias de archivo
    const deps = graph.getFileDependencies("math.ts");
    assert.ok(deps);
    assert.ok(deps.importedByFiles.includes("app.ts"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
