"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("chat-home shell exists in index.html", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="chatHomeShell"/);
  assert.match(html, /id="chatHomeIdeBtn"/);
  assert.match(html, /id="chatHomeComposer"/);
  assert.match(html, /id="chatHomePrompt"/);
  assert.match(html, /id="openChatHomeBtn"/);
  assert.match(html, /chat-home\.js/);
  assert.match(html, /chat-home\.css/);
  assert.match(html, /data-app-mode="chat"/);
});

test("chat-home css pins sidebar left full-height", () => {
  const css = fs.readFileSync(path.join(root, "chat-home.css"), "utf8");
  assert.match(css, /\.chat-home-body\s*\{[^}]*flex-direction:\s*row/s);
  assert.match(css, /\.chat-home-sidebar\s*\{[^}]*flex:\s*0 0 260px/s);
  assert.match(css, /padding-right:\s*148px/);
  assert.match(css, /#chatHomeFeedHost \.msg[\s\S]*border:\s*0 !important/);
  assert.match(css, /chatHomeMicBtn|chat-home-mic-btn/);
});

test("chat-home assets exist", () => {
  assert.ok(fs.existsSync(path.join(root, "chat-home.js")));
  assert.ok(fs.existsSync(path.join(root, "chat-home.css")));
  assert.ok(fs.existsSync(path.join(root, "docs/CHAT_AGENT_AUDIT.md")));
});

test("chat-home settings panels tema/permisos cableados", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
  assert.match(html, /id="chatHomeSettingsTheme"/);
  assert.match(html, /id="chatHomeSettingsPerms"/);
  assert.match(html, /data-ch-theme="negro"/);
  assert.match(html, /data-ch-perm="full"/);
  assert.match(js, /showSettingsPanel/);
  assert.match(js, /applyThemeFromSettings/);
  assert.match(js, /EditCoreTheme/);
  assert.match(js, /EditCorePermissions/);
});

test("chat-home context panel (2 hojas) existe", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "chat-home.css"), "utf8");
  const js = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
  assert.match(html, /id="chatHomeContextBtn"/);
  assert.match(html, /id="chatHomeContextPanel"/);
  assert.match(html, /id="chatHomeCtxFiles"/);
  assert.match(html, /id="chatHomeCtxSkills"/);
  assert.match(html, /id="chatHomeContextDock"/);
  assert.match(html, /chat-home-context-tabs/);
  assert.match(css, /\.chat-home-context\b/);
  assert.match(css, /\.chat-home-context-tab\b/);
  assert.match(js, /toggleContextPanel/);
  assert.match(js, /selectContextTab/);
  assert.match(js, /EditCoreSessionContext/);
});

test("chat-home top bar tiene IDE visible y sin Settings/context en titlebar", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const actions = html.match(/chat-home-top-actions[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(actions, /id="chatHomeIdeBtn"/);
  assert.match(actions, /id="chatHomeFolderBtn"/);
  assert.doesNotMatch(actions, /chatHomeSettingsTopBtn/);
  assert.doesNotMatch(actions, /chatHomeContextBtn/);
  // Orden: carpeta antes que IDE
  assert.ok(actions.indexOf("chatHomeFolderBtn") < actions.indexOf("chatHomeIdeBtn"));
});

test("IDE internals not replaced by chat-home", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="previewWebview"/);
  assert.match(html, /id="monacoEditorHost"/);
  assert.match(html, /class="app-toolbar"/);
  assert.match(html, /id="publishBtn"/);
});
