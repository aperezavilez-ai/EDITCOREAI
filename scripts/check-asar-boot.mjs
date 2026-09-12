import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const install = path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI", "resources", "app.asar");
const repo = "D:\\PROGRAMAS IA\\EDITCOREAI\\resources\\app.asar";

function check(p) {
  const main = asar.extractFile(p, "main.js").toString("utf8");
  let post = false;
  try {
    asar.extractFile(p, "runtime/post-write-diagnostics.js");
    post = true;
  } catch {
    try {
      asar.extractFile(p, "runtime\\post-write-diagnostics.js");
      post = true;
    } catch {}
  }
  return {
    path: p,
    postWrite: post,
    gemini: main.includes("gemini-2.5-flash"),
    grok45: main.includes("grok-4.5"),
    deepseek: main.includes("deepseek-v4-pro"),
    sizeMB: +(fs.statSync(p).size / 1e6).toFixed(1),
  };
}

console.log(JSON.stringify({ install: check(install), repo: check(repo) }, null, 2));
