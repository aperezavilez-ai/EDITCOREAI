"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { getBotRegistry } = require("../runtime/bot-registry");

test("bot registry carga los 5 bots Jarvis portados", () => {
  const registry = getBotRegistry();
  const bots = registry.list();
  assert.equal(bots.length, 5);
  assert.ok(bots.every((bot) => bot.source === "jarvis-port"));
  assert.ok(bots.every((bot) => bot.subAgent));
});

test("code health escanea proyecto temporal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-bot-"));
  fs.writeFileSync(path.join(root, "app.js"), "// TODO fix\n// TODO refactor\n", "utf8");
  const registry = getBotRegistry();
  const result = await registry.run("jarvis-code-health", { projectRoot: root });
  assert.equal(result.ok, true);
  assert.equal(result.botId, "jarvis-code-health");
  assert.match(result.summary, /Auditoría rápida/i);
});

test("matchWake encuentra bots por evento", () => {
  const registry = getBotRegistry();
  const matches = registry.matchWake("memory.pressure");
  assert.ok(matches.some((bot) => bot.id === "jarvis-memory-gardener"));
});
