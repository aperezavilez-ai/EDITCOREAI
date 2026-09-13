"use strict";
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const release = path.join("D:", "PROGRAMAS IA", "release-EDITCOREAI");
const portableAsar = path.join(release, "EDITCOREAI-portable", "resources", "app.asar");
const setup = path.join(release, "EDITCOREAI-Setup.exe");
const portableExe = path.join(release, "EDITCOREAI-portable", "EDITCOREAI.exe");

for (const p of [setup, portableExe, portableAsar]) {
  if (!fs.existsSync(p)) {
    console.error("MISSING", p);
    process.exit(1);
  }
  console.log("ok", p, fs.statSync(p).size);
}

const t = asar.extractFile(portableAsar, "editcore-chat-kernel/orchestrator.js").toString("utf8");
const pkg = JSON.parse(asar.extractFile(portableAsar, "package.json").toString("utf8"));
const bad = /new\s+TaskQueue\s*\(/.test(t);
const ok = /const\s+taskQueue\s*=\s*require\(["']\.\/task-queue["']\)/.test(t);
console.log("version", pkg.version, "name", pkg.name, "product", pkg.productName);
console.log("bad_new_TaskQueue", bad);
console.log("ok_singleton", ok);
if (bad || !ok || pkg.version !== "2.8.1" || pkg.name !== "editcoreai") {
  process.exit(1);
}
console.log("RELEASE_OK");
