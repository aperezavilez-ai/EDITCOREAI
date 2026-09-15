"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "3.0.2", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "3.0.2.0", pkg.build?.buildVersion);

const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
ok("thought-glass", /backdrop-filter:\s*blur\(16px\)/.test(styles));
ok("thought-theme-color", /\.agent-thought-stream[\s\S]*?color:\s*var\(--ec-text\)/.test(styles));
ok("msg-body-theme", /\.msg-body\s*\{[\s\S]*?color:\s*var\(--ec-text\)/.test(styles));
ok("narration-theme", /\.agent-narrative-entry\.agent-narration\s*\{[\s\S]*?color:\s*var\(--ec-text\)/.test(styles));
ok("no-solid-thought-white", !/\.agent-thought-accordion\s*\{[^}]*background:\s*#f8fafc/.test(styles));

const overlay = fs.readFileSync(path.join(root, "resources/ui-overlay/styles.css"), "utf8");
ok("overlay-synced", /backdrop-filter:\s*blur\(16px\)/.test(overlay));

ok("project-context", fs.existsSync(path.join(root, "PROJECT_CONTEXT.md")));
const ctx = fs.readFileSync(path.join(root, "PROJECT_CONTEXT.md"), "utf8");
ok("ctx-302", /3\.0\.2/.test(ctx));

const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
ok("roadmap-302", /3\.0\.2|theme.*chat|Pensamiento.*difumin/i.test(roadmap));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
