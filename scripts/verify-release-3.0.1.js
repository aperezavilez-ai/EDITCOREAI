"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "3.0.1", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "3.0.1.0", pkg.build?.buildVersion);

ok("project-context", fs.existsSync(path.join(root, "PROJECT_CONTEXT.md")));
ok("cursorrules", fs.existsSync(path.join(root, ".cursorrules")));

const cursorrules = fs.readFileSync(path.join(root, ".cursorrules"), "utf8");
ok("rules-no-gafcore-chat", /PROHIBIDO.*GafCore Gateway/i.test(cursorrules));
ok("rules-project-context-first", /PROJECT_CONTEXT\.md/.test(cursorrules));

const sanitize = fs.readFileSync(path.join(root, "runtime/chat-error-sanitize.js"), "utf8");
ok("sanitize-module", sanitize.includes("sanitizeChatProviderError"));

const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
ok("chat-strip-gafcore", /Nunca pintar GafCore|gafcore-gateway\.vercel\.app/i.test(renderer));
ok("no-quarantine-transient-wire", renderer.includes("shouldQuarantineModelForAuto"));

const auto = fs.readFileSync(path.join(root, "auto-model-selection.js"), "utf8");
ok("auto-should-quarantine", auto.includes("function shouldQuarantineModelForAuto"));

const orch = fs.readFileSync(path.join(root, "editcore-chat-kernel/orchestrator.js"), "utf8");
ok("orch-sanitize-catch", orch.includes("sanitizeChatProviderError"));

const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
ok("main-sanitize", main.includes("chat-error-sanitize"));

const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
ok("roadmap-301", /v3\.0\.1/.test(roadmap));

const ctx = fs.readFileSync(path.join(root, "PROJECT_CONTEXT.md"), "utf8");
ok("ctx-301", /3\.0\.1/.test(ctx));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
