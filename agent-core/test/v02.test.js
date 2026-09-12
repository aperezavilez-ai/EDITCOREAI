"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const core = require("../index.js");
const { parseToolCalls, runLlmToolLoop } = require("../src/llm-loop");
const { hasMutation, isMetaVerification } = require("../src/verifier");

test("version 0.2", () => {
  assert.match(String(core.version), /^0\.2/);
});

test("parseToolCalls entiende function.arguments JSON", () => {
  const calls = parseToolCalls({
    tool_calls: [{
      id: "1",
      function: { name: "read_file", arguments: "{\"path\":\"a.js\"}" },
    }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "read_file");
  assert.equal(calls[0].input.path, "a.js");
});

test("execute mode planAuthorized permite mutacion en plan", () => {
  const plan = core.planTask({
    prompt: "PROCEDE\nCorrige resources/app/runtime/action-registry.js: arregla el bug real",
    allowWrite: true,
    planAuthorized: true,
  });
  assert.equal(plan.mode, "execute");
  assert.equal(plan.allowMutation, true);
});

test("PROCEDE solo sin pedido concreto no inventa mutaciones", () => {
  const plan = core.planTask({
    prompt: "PROCEDE",
    allowWrite: true,
    planAuthorized: true,
  });
  assert.equal(plan.mode, "execute");
  assert.equal(plan.needsConcreteChange, true);
  assert.equal(plan.allowMutation, false);
});

test("runLlmToolLoop con provider mock puede replace_in_file", async () => {
  let wrote = false;
  const result = await runLlmToolLoop({
    prompt: "Corrige action-registry.js",
    projectRoot: "D:/demo",
    allowWrite: true,
    planAuthorized: true,
    tools: {
      async execute(name, input) {
        if (name === "read_file") return { path: input.path, content: "class ActionRegistry {}\n" };
        if (name === "replace_in_file") {
          wrote = true;
          return { path: input.path, replaced: true };
        }
        throw new Error(name);
      },
    },
    providerApi: {
      async call() {
        if (!wrote) {
          return {
            text: "Voy a corregir",
            tool_calls: [{
              id: "c1",
              function: {
                name: "replace_in_file",
                arguments: JSON.stringify({
                  path: "resources/app/runtime/action-registry.js",
                  oldText: "class ActionRegistry {}",
                  newText: "class ActionRegistry {\n  // ok\n}",
                }),
              },
            }],
          };
        }
        return { text: "## Evidencia de correccion\nArchivo mutado." };
      },
    },
  }, { mode: "execute", allowWrite: true, seedSteps: [], maxIterations: 4 });

  assert.equal(wrote, true);
  assert.equal(hasMutation(result.steps), true);
  assert.equal(isMetaVerification(result.finalText), false);
});

test("runAgent list+explain sin provider sigue funcionando", async () => {
  const candidates = [
    path.join(__dirname, "..", "..", "app", "runtime"),
    path.join(__dirname, "..", "..", "runtime"),
  ];
  const runtimeDir = candidates.find((p) => fs.existsSync(p));
  assert.ok(runtimeDir, "runtime dir");
  const entries = fs.readdirSync(runtimeDir).slice(0, 20).map((name) => ({
    name,
    kind: fs.statSync(path.join(runtimeDir, name)).isDirectory() ? "directory" : "file",
  }));
  const content = fs.readFileSync(path.join(runtimeDir, "action-registry.js"), "utf8").slice(0, 2000);
  const result = await core.runAgent({
    prompt: "Lista resources/app/runtime y explica action-registry.js",
    projectRoot: path.join(__dirname, "..", "..", ".."),
    allowWrite: false,
    tools: {
      async execute(name, input) {
        if (name === "list_files") return { entries, path: input.path };
        if (name === "read_file") return { path: input.path, content };
        throw new Error(name);
      },
    },
  });
  assert.equal(result.completed, true);
  assert.doesNotMatch(result.text, /Verificacion completada con evidencia real/i);
});
