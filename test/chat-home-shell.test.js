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
  assert.match(css, /\.chat-home-sidebar\s*\{[^}]*flex:\s*0 0 var\(--ch-sidebar-width/s);
  assert.match(css, /padding-right:\s*148px/);
  assert.match(css, /#chatHomeFeedHost \.msg[\s\S]*border:\s*0 !important/);
  assert.match(css, /chatHomeMicBtn|chat-home-mic-btn/);
});

test("chat-home assets exist", () => {
  assert.ok(fs.existsSync(path.join(root, "chat-home.js")));
  assert.ok(fs.existsSync(path.join(root, "chat-home.css")));
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

test("chat-home composer centrado con box-sizing", () => {
  const css = fs.readFileSync(path.join(root, "chat-home.css"), "utf8");
  assert.match(css, /\.chat-home-main\s*\{[^}]*align-items:\s*center/s);
  assert.match(css, /\.chat-home-composer-wrap\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(css, /\.chat-home-composer-wrap\s*\{[^}]*align-self:\s*center/s);
  assert.match(css, /\.chat-home-composer\s*\{[^}]*width:\s*100%/s);
});

test("chat-home sidebar splitter y mic a la derecha", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "chat-home.css"), "utf8");
  const js = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
  assert.match(html, /id="chatHomeSidebarSplit"/);
  assert.match(css, /chat-home-sidebar-split/);
  assert.match(js, /bindSidebarResize/);
  assert.match(css, /chat-home-ide-btn[\s\S]{0,220}background:\s*transparent/s);
  assert.doesNotMatch(css, /\.chat-home-ide-btn\s*\{[^}]*background:\s*var\(--ch-ide\)/s);
  const row = html.match(/chat-home-composer-row[\s\S]*?<\/div>/)?.[0] || "";
  assert.match(row, /chat-home-composer-spacer/);
  assert.ok(row.indexOf("chatHomeMicBtn") > row.indexOf("chatHomeModelPill"));
  assert.ok(row.indexOf("chatHomeSendBtn") > row.indexOf("chatHomeMicBtn"));
});

test("chat-home attachments paste/picker y scroll host", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const jsHome = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
  const jsRend = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "chat-home.css"), "utf8");
  assert.match(html, /id="chatHomeAttachmentList"/);
  assert.match(html, /accept="[^"]*\.pdf/);
  assert.match(html, /accept="[^"]*\.docx/);
  assert.match(html, /accept="[^"]*\.xlsx/);
  assert.match(jsHome, /EditCoreAttachments/);
  assert.match(jsRend, /collectClipboardFiles/);
  assert.match(jsRend, /getFeedScrollRoots/);
  assert.match(jsRend, /chatHomeFeedHost/);
  assert.match(css, /chat-home-attachment-list/);
  assert.match(css, /overflow:\s*visible !important/);
});

test("chat-home thread management y apertura de conversaciones anteriores", () => {
  const jsHome = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
  const jsRend = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  assert.match(jsHome, /getThreads/);
  assert.match(jsHome, /selectThread/);
  assert.match(jsHome, /window\.switchChatThread/);
  assert.match(jsHome, /window\.createNewChatThread/);
  assert.match(jsHome, /window\.closeChatThread/);
  assert.match(jsHome, /window\.renameChatThread/);
  assert.match(jsRend, /window\.getChatThreads\s*=/);
  assert.match(jsRend, /window\.switchChatThread\s*=/);
  assert.match(jsRend, /window\.closeChatThread\s*=/);
  assert.match(jsRend, /window\.renameChatThread\s*=/);
  assert.match(jsRend, /window\.selectProject\s*=/);
  assert.match(jsRend, /window\.listProjects\s*=/);
  assert.match(jsHome, /editcore:chats-updated/);
  assert.match(jsHome, /editcore:project-updated/);
});

test("chat-home y IDE: menciones @, slash commands /, diff decisions y terminal autofix", () => {
  const jsHome = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
  const jsRend = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "chat-home.css"), "utf8");
  const jsTerm = fs.readFileSync(path.join(root, "ide", "terminal-pane.js"), "utf8");

  // Autocomplete / mentions
  assert.match(jsHome, /SLASH_COMMANDS/);
  assert.match(jsHome, /MENTION_TYPES/);
  assert.match(jsHome, /setupAutocomplete/);
  assert.match(css, /ec-mention-popup/);

  // Diff decisions
  assert.match(jsRend, /EditCoreDiffDecisions/);
  assert.match(css, /diff-decision-card/);
  assert.match(css, /diff-btn-accept/);
  assert.match(css, /diff-btn-reject/);

  // Terminal AutoFix
  assert.match(jsTerm, /terminalAutoFixBar/);
  assert.match(jsTerm, /Reparar con EditCoreAI/);
  assert.match(css, /terminal-autofix-bar/);

  // Codebase index
  assert.match(jsRend, /EditCoreCodebaseIndex/);
});


