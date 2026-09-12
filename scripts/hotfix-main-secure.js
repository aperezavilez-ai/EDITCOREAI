"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");

const appRoot = path.resolve(__dirname, "..");
const files = [
  "main.js",
  "index.html",
  "renderer.js",
  "styles.css",
  "preload.js",
  "auto-model-selection.js",
];
const targets = [
  path.resolve(appRoot, "..", "app.asar"),
  path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI", "resources", "app.asar"),
];

function assertPatched(asarPath) {
  const main = asar.extractFile(asarPath, "main.js").toString("utf8");
  const renderer = asar.extractFile(asarPath, "renderer.js").toString("utf8");
  const checks = [
    [/function fallbackProviderProfiles\([\s\S]{0,200}const secure = readSecureState\(\)/, "main.secure"],
    [/planAuthorized: Boolean\(planAuthorizedExecution\)/, "renderer.planAuthorized"],
    [/state\.allowWrite = next !== "readonly"/, "renderer.allowWrite"],
  ];
  for (const [pattern, label] of checks) {
    const haystack = label.startsWith("main") ? main : renderer;
    if (!pattern.test(haystack)) throw new Error(`${asarPath}: falta ${label}`);
  }
}

async function patch(asarPath) {
  if (!fs.existsSync(asarPath)) {
    console.log("SKIP", asarPath);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-main-fix-"));
  const dir = path.join(tmp, "x");
  const out = path.join(tmp, "next.asar");
  fs.mkdirSync(dir, { recursive: true });
  asar.extractAll(asarPath, dir);
  for (const file of files) {
    const source = path.join(appRoot, file);
    if (!fs.existsSync(source)) continue;
    fs.copyFileSync(source, path.join(dir, file));
    console.log("  +", file);
  }
  // Also sync critical runtime modules used by failover
  for (const rel of [
    "runtime/model-failover.js",
    "runtime/worker-supervisor.js",
    "runtime/editcore-claude-adapter.js",
    "runtime/evidence-grounding.js",
    "agent-runtime.js",
    "project-analysis.js",
  ]) {
    const source = path.join(appRoot, ...rel.split("/"));
    if (!fs.existsSync(source)) continue;
    const dest = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    console.log("  +", rel);
  }
  await asar.createPackage(dir, out);
  fs.copyFileSync(out, asarPath);
  assertPatched(asarPath);
  console.log("PATCHED_OK", asarPath);
}

(async () => {
  for (const target of targets) {
    console.log("Patching", target);
    await patch(target);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
