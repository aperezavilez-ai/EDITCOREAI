"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];

function ok(name, cond, detail = "") {
  checks.push({ name, ok: Boolean(cond), detail: String(detail || "") });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("version", pkg.version === "3.0.4", pkg.version);
ok("buildVersion", pkg.build?.buildVersion === "3.0.4.0", pkg.build?.buildVersion);

const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
ok("publish-short-ok", /Publicado correctamente/.test(renderer));
ok("publish-continue", /Continuamos con otra tarea/.test(renderer));
ok("publish-progress-pct", /function stagePercentValue/.test(renderer));
ok("no-infra-dump-on-success", !/result\.ok[\s\S]{0,200}project-infra\.json/.test(renderer));

const overlay = fs.readFileSync(path.join(root, "resources/ui-overlay/renderer.js"), "utf8");
ok("overlay-publish-short", /Publicado correctamente/.test(overlay));
ok("overlay-progress-pct", /function stagePercentValue/.test(overlay));

const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
ok("progress-track", /\.fullstack-progress-track/.test(styles));
ok("stage-pct", /\.stage-pct/.test(styles));

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
ok("html-pct", /fullStackProgressPct/.test(html));
ok("html-fill", /fullStackProgressFill/.test(html));

const deploy = fs.readFileSync(path.join(root, "runtime/deploy-one-click.js"), "utf8");
ok("vercel-both-ids", /if \(ids\.projectId && ids\.orgId\)/.test(deploy));

const publish = fs.readFileSync(path.join(root, "runtime/publish-pipeline.js"), "utf8");
ok("publish-onProgress", /onProgress/.test(publish));

const ctx = fs.readFileSync(path.join(root, "PROJECT_CONTEXT.md"), "utf8");
ok("ctx-304", /3\.0\.4/.test(ctx));

const roadmap = fs.readFileSync(path.join(root, "ROADMAP.md"), "utf8");
ok("roadmap-304", /3\.0\.4/.test(roadmap));

const fail = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ pass: checks.length - fail.length, fail: fail.length, checks }, null, 2));
process.exit(fail.length ? 1 : 0);
