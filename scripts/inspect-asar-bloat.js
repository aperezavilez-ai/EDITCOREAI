"use strict";
const asar = require("@electron/asar");
const fs = require("node:fs");
const path = require("node:path");

const asarPath = process.argv[2] || "D:/PROGRAMAS IA/EDITCOREAI/resources/app.asar";
const list = asar.listPackage(asarPath);
const tops = {};
let distCount = 0;
let nmCount = 0;
const samples = [];
for (const e of list) {
  const n = String(e).replace(/\\/g, "/").replace(/^\//, "");
  const top = n.split("/")[0] || "root";
  tops[top] = (tops[top] || 0) + 1;
  if (n.startsWith("dist/") || n === "dist") {
    distCount += 1;
    if (samples.length < 8) samples.push(n);
  }
  if (n.startsWith("node_modules/") || n === "node_modules") nmCount += 1;
}
console.log(JSON.stringify({
  total: list.length,
  sizeMB: +(fs.statSync(asarPath).size / 1e6).toFixed(1),
  tops: Object.entries(tops).sort((a, b) => b[1] - a[1]).slice(0, 20),
  distCount,
  nmCount,
  samples,
}, null, 2));
