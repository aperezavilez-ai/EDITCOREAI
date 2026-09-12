"use strict";

const assert = require("assert");
const { parseTextToolCalls, stripTextToolMarkup } = require("../editcore-chat-kernel/parse-text-tools");

const sample = [
  "Voy a revisar el proyecto.",
  "<list_directory>",
  "<path>D:\\PROGRAMAS IA\\APP</path>",
  "</list_directory>",
  "<read_file>",
  "<path>D:\\PROGRAMAS IA\\APP\\package.json</path>",
  "</read_file>",
  "<execute_command>",
  "<command>cd \"D:\\PROGRAMAS IA\\APP\" && npm run build</command>",
  "</execute_command>",
].join("\n");

const calls = parseTextToolCalls(sample, { projectRoot: "D:\\PROGRAMAS IA\\APP" });
assert.strictEqual(calls.length, 3);
assert.strictEqual(calls[0].function.name, "list_files");
assert.strictEqual(JSON.parse(calls[0].function.arguments).path, ".");
assert.strictEqual(calls[1].function.name, "read_file");
assert.strictEqual(JSON.parse(calls[1].function.arguments).path, "package.json");
assert.strictEqual(calls[2].function.name, "run_command");
assert.strictEqual(JSON.parse(calls[2].function.arguments).command, "npm run build");
assert.ok(!/<list_directory>/i.test(stripTextToolMarkup(sample)));
console.log(JSON.stringify({ ok: true, calls: calls.map((c) => ({ name: c.function.name, args: JSON.parse(c.function.arguments) })) }, null, 2));
