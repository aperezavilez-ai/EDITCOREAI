"use strict";
const { classify } = require("../editcore-chat-kernel/classify");
const { parseTextToolCalls, stripTextToolMarkup } = require("../editcore-chat-kernel/parse-text-tools");
const PA = require("../project-analysis");

const sample = [
  "<tool_call>",
  "<function=read_file>",
  "<parameter=file_path>",
  "package.json",
  "</parameter>",
  "</function>",
  "</tool_call>",
].join("\n");

const calls = parseTextToolCalls(sample, { projectRoot: "D:\\PROGRAMAS IA\\APP" });
const intentFn = PA.classifyPromptIntent || PA?.ProjectAnalysis?.classifyPromptIntent;
console.log(JSON.stringify({
  chat: classify("PARA QUE FUNCIONA ESTA APP"),
  intent: typeof intentFn === "function" ? intentFn("PARA QUE FUNCIONA ESTA APP") : Object.keys(PA),
  calls: calls.map((c) => ({ name: c.function.name, args: JSON.parse(c.function.arguments) })),
  stripped: stripTextToolMarkup(`Voy a leer\n${sample}`),
}, null, 2));
