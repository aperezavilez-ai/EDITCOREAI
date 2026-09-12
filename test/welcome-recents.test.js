"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rendererSource = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("welcome muestra solo ultimos 4 abiertos por lastOpenedAt/recents", () => {
  assert.match(rendererSource, /RECENT_PROJECT_ROOTS_KEY/);
  assert.match(rendererSource, /RECENT_PROJECTS_LIMIT = 4/);
  assert.match(rendererSource, /function touchRecentProjectRoot/);
  assert.match(rendererSource, /Number\(item\.lastOpenedAt\) > 0/);
  assert.match(rendererSource, /touchRecentProjectRoot\(selected\.projectRoot\)/);
  assert.match(indexSource, /Ultimos 4 proyectos/);
  assert.doesNotMatch(
    rendererSource,
    /function recentProjectsForWelcome\(limit = 8\)[\s\S]{0,200}\.filter\(\(item\) => item\?\.projectRoot\)/,
  );
});
