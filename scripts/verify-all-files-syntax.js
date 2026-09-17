"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
let tested = 0;
let failed = [];

function checkDir(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist" || ent.name === "out") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      checkDir(full);
    } else if (ent.name.endsWith(".js") && !ent.name.endsWith(".bak") && !ent.name.includes(".bak-")) {
      tested += 1;
      const res = spawnSync(process.execPath, ["--check", full], { encoding: "utf8" });
      if (res.status !== 0) {
        failed.push({ file: path.relative(root, full), error: res.stderr || res.stdout });
      }
    }
  }
}

checkDir(root);

console.log(JSON.stringify({
  totalJsFilesTested: tested,
  failuresCount: failed.length,
  failed,
  allSyntaxOk: failed.length === 0,
}, null, 2));

if (failed.length > 0) process.exit(1);
