"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "2.9.9", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "2.9.9.0", pkg.build?.buildVersion);

const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
ok("prepareChatProseForRender", renderer.includes("function prepareChatProseForRender"));
ok("ensureChatParagraphs-wire", renderer.includes("ensureChatParagraphs"));
ok("settleAgentTurnChrome", renderer.includes("function settleAgentTurnChrome"));
ok("no-thought-prose-mirror", /Prosa SOLO abajo|jamás dentro de la caja Pensamiento|looksLikeChatProse/.test(renderer));
ok("continua-resume-memory", renderer.includes("resumeWithMemory") && renderer.includes("lastNarration"));
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
ok("incomplete-intent-nudge", orch.includes("incompleteIntent") && orch.includes("CONTINUA YA"));
ok("no-full-visible-resend", orch.includes("reenviar `visible` completo") || orch.includes("NUNCA"));

const auto = fs.readFileSync(path.join(root, "auto-model-selection.js"), "utf8");
ok("auto-forbid-haiku-vision", auto.includes("hardForbid") && auto.includes("claude-haiku"));

const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
ok("roadmap-299", /v2\.9\.9/.test(roadmap));
ok("roadmap-proceso-producto", /Proceso del producto/.test(roadmap));

const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
ok("main-editcore-chat", main.includes('ipcMain.handle("editcore:chat"'));
ok("main-not-tiny", main.length > 200_000, String(main.length));
ok("no-dual-chunk-narration", !/phase === "narration_delta"[\s\S]{0,120}editcore:chunk/.test(main));

const analysis = fs.readFileSync(path.join(root, "project-analysis.js"), "utf8");
ok("recovery-last-narration", analysis.includes("ULTIMO AVANCE DEL AGENTE"));
ok("porque-paras-recovery", /por\s\*qu\[eé\]|porque\)\s\+\(?:paras/.test(analysis) || /porque\)\s\+\s*\(\?:paras/.test(analysis) || analysis.includes("porque)\\s+(?:paras"));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
