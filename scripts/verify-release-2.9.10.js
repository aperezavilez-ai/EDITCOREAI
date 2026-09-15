"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "2.9.10", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "2.9.10.0", pkg.build?.buildVersion);

const sanitize = fs.readFileSync(path.join(root, "runtime/chat-error-sanitize.js"), "utf8");
ok("sanitize-module", sanitize.includes("sanitizeChatProviderError") && sanitize.includes("shouldQuarantineModelForAuto"));

const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
ok("chat-strip-gafcore", /gafcore-gateway\.vercel\.app|Nunca pintar GafCore/i.test(renderer));
ok("userFacing-gafcore", /gafcore\/i\.test\(text\)/.test(renderer) || /\/gafcore\/i\.test/.test(renderer));
ok("no-quarantine-transient-wire", renderer.includes("shouldQuarantineModelForAuto"));

const auto = fs.readFileSync(path.join(root, "auto-model-selection.js"), "utf8");
ok("auto-should-quarantine", auto.includes("function shouldQuarantineModelForAuto"));

const orch = fs.readFileSync(path.join(root, "editcore-chat-kernel/orchestrator.js"), "utf8");
ok("orch-sanitize-catch", orch.includes("sanitizeChatProviderError"));

const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
ok("main-sanitize", main.includes("chat-error-sanitize"));
ok("main-transient-retry", main.includes("isTransientProviderFailure"));

const ops = fs.readFileSync(path.join(root, "runtime/operator-connections-context.js"), "utf8");
ok("ops-no-gateway-chat", /NUNCA menciones GafCore Gateway/i.test(ops));
ok("ops-no-dashboard-url", !/gafcore-gateway\.vercel\.app\/dashboard/.test(ops));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
