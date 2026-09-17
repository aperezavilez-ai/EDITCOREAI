"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const {
  safeParseToolArguments,
  sanitizeToolCallArguments,
  sanitizeMessagesToolArguments,
  providerToolCallAction,
} = require("../agent-parser");
const { normalizeForAnthropic, normalizeToolCallsOut } = require("../runtime/ai-core");

const adapterSource = fs.readFileSync(path.join(__dirname, "..", "runtime", "editcore-claude-adapter.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

test("safeParseToolArguments: '}' solo no lanza y devuelve {}", () => {
  assert.doesNotThrow(() => safeParseToolArguments("}"));
  assert.deepEqual(safeParseToolArguments("}"), {});
  assert.deepEqual(safeParseToolArguments("{"), {});
  assert.deepEqual(safeParseToolArguments('{"path":"a.js"}'), { path: "a.js" });
  assert.deepEqual(safeParseToolArguments('nota {"path":"x.js"} extra'), { path: "x.js" });
});

test("sanitizeToolCallArguments: arguments invalidos salen como {}", () => {
  assert.equal(sanitizeToolCallArguments("}"), "{}");
  assert.equal(sanitizeToolCallArguments(""), "{}");
  const ok = sanitizeToolCallArguments('{"path":"runtime/a.js"}');
  assert.equal(JSON.parse(ok).path, "runtime/a.js");
});

test("sanitizeMessagesToolArguments repara tool_calls rotos antes de enviar al proveedor", () => {
  const messages = sanitizeMessagesToolArguments([
    {
      role: "assistant",
      content: "",
      tool_calls: [{
        id: "c1",
        type: "function",
        function: { name: "read_file", arguments: "}" },
      }],
    },
  ]);
  assert.equal(messages[0].tool_calls[0].function.arguments, "{}");
  assert.doesNotThrow(() => JSON.parse(messages[0].tool_calls[0].function.arguments));
});

test("providerToolCallAction no lanza con arguments '}'", () => {
  const action = providerToolCallAction({
    id: "x",
    function: { name: "read_file", arguments: "}" },
  });
  assert.equal(action?.type, "tool");
  assert.equal(action?.name, "list_files"); // path vacio => list_files
});

test("normalizeForAnthropic acepta arguments rotos sin Unexpected token", () => {
  assert.doesNotThrow(() => normalizeForAnthropic([
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "t1", function: { name: "list_files", arguments: "}" } }],
    },
  ]));
  const out = normalizeForAnthropic([
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "t1", function: { name: "list_files", arguments: "}" } }],
    },
  ]);
  assert.equal(out[0].content[0].type, "tool_use");
  assert.deepEqual(out[0].content[0].input, {});
});

test("normalizeToolCallsOut limpia arguments de stream", () => {
  const calls = normalizeToolCallsOut([
    { id: "1", function: { name: "read_file", arguments: "}" } },
  ]);
  assert.equal(calls[0].function.arguments, "{}");
});

test("adapter reintenta y fuerza failover en Unexpected token (hasta 2 reintentos con autocorrección)", () => {
  assert.match(adapterSource, /MALFORMED_TOOL_JSON/);
  assert.match(adapterSource, /forzando failover/);
  assert.match(adapterSource, /isMalformedToolJson[\s\S]{0,1600}throw apiError/);
});

test("main traduce Unexpected token a mensaje accionable", () => {
  assert.match(mainSource, /unexpected token\|invalid json\|malformed/);
  assert.match(mainSource, /EditCore reintento en silencio|Escribe CONTINUA/);
});
