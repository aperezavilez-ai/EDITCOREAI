"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");

const appRoot = path.resolve(__dirname, "..");
const files = ["index.html", "renderer.js", "styles.css", "auto-model-selection.js"];
const targets = [
  path.resolve(appRoot, "..", "app.asar"),
  path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI", "resources", "app.asar"),
];

async function patch(asarPath) {
  if (!fs.existsSync(asarPath)) {
    console.log("SKIP", asarPath);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-perm-"));
  const dir = path.join(tmp, "x");
  const out = path.join(tmp, "next.asar");
  fs.mkdirSync(dir, { recursive: true });
  asar.extractAll(asarPath, dir);
  for (const file of files) {
    fs.copyFileSync(path.join(appRoot, file), path.join(dir, file));
  }
  await asar.createPackage(dir, out);
  fs.copyFileSync(out, asarPath);
  const renderer = asar.extractFile(asarPath, "renderer.js").toString("utf8");
  const ok = renderer.includes("applyPermissionMode")
    && renderer.includes("planAuthorized: Boolean(planAuthorizedExecution)")
    && renderer.includes('state.allowWrite = next !== "readonly"');
  console.log(ok ? "PATCHED_OK" : "PATCHED_BAD", asarPath);
  if (!ok) process.exitCode = 1;
}

(async () => {
  for (const target of targets) await patch(target);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
