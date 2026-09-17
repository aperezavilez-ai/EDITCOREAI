"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "3.0.5", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "3.0.5.0", pkg.build?.buildVersion);

const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
ok("chat-first-boot", /const chatFirst = document\.body\.dataset\.appMode === "chat"/.test(renderer));
ok("preview-skip-chat", /wantPreview/.test(renderer) && /dataset\.appMode !== ["']chat["']/.test(renderer));
ok("dictation-api", /window\.EditCoreDictation\s*=/.test(renderer));
ok("session-context", /window\.EditCoreSessionContext\s*=/.test(renderer));
ok("theme-bridge", /window\.EditCoreTheme\s*=/.test(renderer));
ok("permissions-bridge", /window\.EditCorePermissions\s*=/.test(renderer));

const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
ok("preload-single-app", (preload.match(/exposeInMainWorld\(\s*["']editcoreApp["']/g) || []).length === 1);
ok("preload-setUiTheme", /setUiTheme/.test(preload));
ok("preload-no-stale-303", !/v3\.0\.3/.test(preload));

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
ok("context-panel", /id="chatHomeContextPanel"/.test(html));
ok("context-btn", /id="chatHomeContextBtn"/.test(html));
ok("ide-in-top-actions", /chat-home-top-actions[\s\S]*?id="chatHomeIdeBtn"/.test(html));
ok("no-settings-in-top", !/chat-home-top-actions[\s\S]*?chatHomeSettingsTopBtn/.test(html));
ok("context-tabs", /chat-home-context-tabs/.test(html));
ok("chat-after-publish", /publishBtn[\s\S]{0,260}openChatHomeBtn/.test(html));
ok("no-save-btn", !/id="saveProjectBtn"/.test(html));

const chatHome = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
ok("settings-panels", /showSettingsPanel/.test(chatHome));
ok("context-toggle", /toggleContextPanel/.test(chatHome));
ok("dictation-home", /EditCoreDictation/.test(chatHome));

const css = fs.readFileSync(path.join(root, "chat-home.css"), "utf8");
ok("context-css", /\.chat-home-context\b/.test(css));
ok("send-not-black", !/\.chat-home-send-btn\s*\{[^}]*background:\s*var\(--ec-text\)/s.test(css));

ok("composer-centered", /\.chat-home-composer-wrap\s*\{[^}]*box-sizing:\s*border-box/s.test(css) && /\.chat-home-main\s*\{[^}]*align-items:\s*center/s.test(css));

const launcher = fs.readFileSync(path.join(root, "scripts/EditCoreAiRootLauncher.cs"), "utf8");
ok("launcher-305", /AssemblyInformationalVersion\("3\.0\.5"\)/.test(launcher));

const ctx = fs.readFileSync(path.join(root, "PROJECT_CONTEXT.md"), "utf8");
ok("ctx-305", /3\.0\.5/.test(ctx));

const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
ok("roadmap-305", /3\.0\.5/.test(roadmap));

const overlayRenderer = fs.readFileSync(path.join(root, "resources/ui-overlay/renderer.js"), "utf8");
ok("overlay-wantPreview", /wantPreview/.test(overlayRenderer));
ok("overlay-dictation", /EditCoreDictation/.test(overlayRenderer));

const orch = fs.readFileSync(path.join(root, "editcore-chat-kernel/orchestrator.js"), "utf8");
ok("orchestrator-path-require", /const path = require\(["']path["']\)/.test(orch));
ok("orchestrator-basename-safe", /path\.basename\(projectRoot/.test(orch));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
