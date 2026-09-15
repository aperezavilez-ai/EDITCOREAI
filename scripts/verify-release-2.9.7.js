"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "2.9.7", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "2.9.7.0", pkg.build?.buildVersion);

const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
ok("settleAgentTurnChrome", renderer.includes("function settleAgentTurnChrome"));
ok("no-canned-directa", !renderer.includes("## Respuesta directa"));
ok("no-canned-editcore-loop", !renderer.includes("explorando archivos internos (.editcore/chats/memory)"));
ok("codePreviewBtn-wire", renderer.includes('setPreviewMode("code")') && renderer.includes("codePreviewBtn"));
ok("openPathInEditor-calls-monaco", renderer.includes("EditCoreEditor.openFile"));

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
ok("html-code-tab", html.includes("codePreviewBtn") && html.includes("monacoEditorHost"));

const editor = fs.readFileSync(path.join(root, "ide", "editor-pane.js"), "utf8");
ok("monaco-openFile", editor.includes("readText") && !editor.includes("skippedEditor"));
ok("showCodeMode-enabled", editor.includes("ide-code-mode") && !editor.includes("Desactivado: el modo Código"));

const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
ok("css-dots-stop", css.includes("agent-execution-done .thinking-dots"));

const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
ok("roadmap-297", /v2\.9\.7/.test(roadmap));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
