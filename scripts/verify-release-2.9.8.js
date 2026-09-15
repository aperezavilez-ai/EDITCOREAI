"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "2.9.8", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "2.9.8.0", pkg.build?.buildVersion);

const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
ok("prepareChatProseForRender", renderer.includes("function prepareChatProseForRender"));
ok("ensureChatParagraphs-wire", renderer.includes("ensureChatParagraphs"));
ok("settleAgentTurnChrome", renderer.includes("function settleAgentTurnChrome"));
ok("codePreviewBtn-wire", renderer.includes('setPreviewMode("code")'));

const elite = fs.readFileSync(path.join(root, "runtime/elite-communication-policy.js"), "utf8");
ok("elite-paragraphs", elite.includes("ensureChatParagraphs") && /P[AÁ]RRAFOS LEGIBLES/.test(elite));

const roadmapGen = fs.readFileSync(path.join(root, "runtime/project-roadmap.js"), "utf8");
ok("roadmap-proceso", roadmapGen.includes("## Proceso") && roadmapGen.includes("## Bloqueos"));
ok("roadmap-anti-reexplore", roadmapGen.includes("Regla anti-reexploracion"));

const orch = fs.readFileSync(path.join(root, "editcore-chat-kernel/orchestrator.js"), "utf8");
ok("vision-first", orch.includes("visionAsk") && orch.includes("taskImages"));
ok("formatAgentVisibleText", orch.includes("function formatAgentVisibleText"));
ok("no-filterToolsByPlan-runtime", !/function\s+filterToolsByPlan|filterToolsByPlan\s*\(/.test(orch));

const auto = fs.readFileSync(path.join(root, "auto-model-selection.js"), "utf8");
ok("auto-forbid-haiku-vision", auto.includes("hardForbid") && auto.includes("claude-haiku"));

const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
ok("roadmap-298", /v2\.9\.8/.test(roadmap));
ok("roadmap-proceso-producto", /Proceso del producto/.test(roadmap));

const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
ok("main-editcore-chat", main.includes('ipcMain.handle("editcore:chat"'));
ok("main-not-tiny", main.length > 200_000, String(main.length));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
