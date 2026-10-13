"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { buildProjectGraph, categorizeNode, extractImports } = require("../editcore-chat-kernel/graphify-runner");
const tools = require("../editcore-chat-kernel/tools");

test("categorizeNode identifica correctamente tipos de archivos", () => {
  assert.equal(categorizeNode("src/components/Header.jsx"), "component");
  assert.equal(categorizeNode("api/auth/login.js"), "service");
  assert.equal(categorizeNode("lib/supabase.js"), "database");
  assert.equal(categorizeNode("test/my-test.test.js"), "test");
  assert.equal(categorizeNode("styles/globals.css"), "style");
});

test("extractImports extrae imports y requires de JS", () => {
  const code = `
    import React from 'react';
    import { useState } from 'react';
    const utils = require('./utils');
    const dynamic = import('./dynamic');
  `;
  const imports = extractImports(code, ".js");
  assert.ok(imports.includes("react"));
  assert.ok(imports.includes("./utils"));
  assert.ok(imports.includes("./dynamic"));
});

test("tools.execute ejecuta graphify_project y genera salidas", async () => {
  const result = await tools.execute("graphify_project", { path: "." }, process.cwd(), false);
  assert.equal(result.ok, true);
  assert.ok(result.totalNodes > 0);
  assert.ok(result.totalEdges >= 0);
  assert.ok(fs.existsSync(path.join(process.cwd(), "graphify-out", "graph.json")));
  assert.ok(fs.existsSync(path.join(process.cwd(), "graphify-out", "GRAPH_REPORT.md")));
  assert.ok(fs.existsSync(path.join(process.cwd(), "graphify-out", "graph.html")));
});

test("tools.execute despacha invoke_subagent con exploración real", async () => {
  const result = await tools.execute("invoke_subagent", { role: "explorer", task: "buscar tests" }, process.cwd(), false);
  assert.equal(result.mode, "parallel-explore");
  assert.ok(Array.isArray(result.agents));
  assert.ok(result.durationMs >= 0);
});
