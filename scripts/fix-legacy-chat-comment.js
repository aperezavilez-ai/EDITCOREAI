"use strict";

const fs = require("fs");
const path = require("path");

const mainPath = path.join(__dirname, "..", "main.js");
const lines = fs.readFileSync(mainPath, "utf8").split(/\n/);
const start = lines.findIndex((l) => l.includes("/* LEGACY editcore:chat retained"));
if (start < 0) throw new Error("legacy start not found");

let end = -1;
for (let i = start + 1; i < lines.length; i++) {
  const next = lines[i + 1] || "";
  const after = lines[i + 2] || "";
  if (lines[i].trim() === "});" && next.trim() === "" && after.includes('ipcMain.handle("editcore:cancel"')) {
    end = i;
    break;
  }
}
if (end < 0) throw new Error(`legacy end not found (start=${start + 1})`);

console.log(JSON.stringify({ removeFrom: start + 1, removeTo: end + 1, removed: end - start + 1 }));
const out = [...lines.slice(0, start), "", ...lines.slice(end + 1)];
fs.writeFileSync(mainPath, out.join("\n"));
console.log("newLines", out.length);
