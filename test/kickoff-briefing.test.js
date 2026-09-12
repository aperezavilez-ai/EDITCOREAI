"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");

test("publishKickoffBriefing emite Avance visible sin esperar al modelo", () => {
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 2, tokenBudget: 1000, logger: { log() {}, warn() {}, error() {} } });
  const events = [];
  adapter.publishKickoffBriefing({
    prompt: "Analiza el proyecto EDITCOREAI y corrige el chat",
    analysisMode: true,
    onProgress: (ev) => events.push(ev),
  }, []);
  assert.ok(events.some((e) => e.phase === "narration_delta" && /Avance — inicio/i.test(e.text)));
  assert.ok(events.some((e) => e.phase === "model" && /Trabajando/i.test(e.text)));
  assert.match(events.find((e) => e.phase === "narration_delta").text, /análisis/i);
  assert.doesNotMatch(events.find((e) => e.phase === "narration_delta").text, /cuello de botella|proveedor directo/i);
});

test("publishKickoffBriefing en procede menciona escritura", () => {
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 2, tokenBudget: 1000, logger: { log() {}, warn() {}, error() {} } });
  const events = [];
  adapter.publishKickoffBriefing({
    prompt: "PROCEDE",
    planAuthorized: true,
    analysisMode: false,
    onProgress: (ev) => events.push(ev),
  }, [{ name: "read_file", ok: true }]);
  const narr = events.find((e) => e.phase === "narration_delta");
  assert.match(narr.text, /escritura|write_file|ejecución autorizada/i);
  assert.match(narr.text, /Pasos locales previos:\s*1|1 paso/i);
});
