"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rendererPath = path.join(__dirname, "..", "renderer.js");
const stylesPath = path.join(__dirname, "..", "styles.css");

test("thinking status: narration_delta no vacia la etiqueta (anti-titileo)", () => {
  const src = fs.readFileSync(rendererPath, "utf8");
  assert.doesNotMatch(
    src,
    /phase === "narration_delta"[\s\S]{0,400}setAgentLiveActivity\(\s*thinkingEl\s*,\s*""\s*\)/,
    "narration_delta no debe llamar setAgentLiveActivity(\"\")",
  );
  assert.match(src, /Redactando respuesta\.\.\./);
  assert.match(
    src,
    /function setAgentLiveActivity[\s\S]{0,280}if \(!value\) return/,
    "setAgentLiveActivity vacio debe ser no-op",
  );
});

test("CSS: thinking-status is-streaming no usa display none", () => {
  const css = fs.readFileSync(stylesPath, "utf8");
  assert.doesNotMatch(
    css,
    /\.thinking-status\.is-streaming\s*,\s*\.thinking-status:empty\s*\{\s*display:\s*none/i,
  );
});
