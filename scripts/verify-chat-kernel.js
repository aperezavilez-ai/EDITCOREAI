"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const root = path.join(projectRoot, "editcore-chat-kernel");
const srcRoot = "c:/Users/apere/Downloads/editcore-chat-kernel-unpack/editcore-chat-kernel";

function walk(dir, base = dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.name === "_INSTALL_MANIFEST.json") continue;
    if (ent.isDirectory()) walk(full, base, acc);
    else {
      const rel = path.relative(base, full).split(path.sep).join("/");
      const buf = fs.readFileSync(full);
      acc.push({
        path: rel,
        bytes: buf.length,
        sha256: crypto.createHash("sha256").update(buf).digest("hex").toUpperCase(),
      });
    }
  }
  return acc;
}

const man = walk(root);
fs.writeFileSync(path.join(root, "_INSTALL_MANIFEST.json"), `${JSON.stringify(man, null, 2)}\n`);

let ok = 0;
let bad = 0;
let missing = 0;
for (const m of man) {
  const src = path.join(srcRoot, m.path);
  if (!fs.existsSync(src)) {
    missing += 1;
    continue;
  }
  const h = crypto.createHash("sha256").update(fs.readFileSync(src)).digest("hex").toUpperCase();
  if (h !== m.sha256) bad += 1;
  else ok += 1;
}

const {
  handleChat,
  stopChat,
  classify,
  SKILL_IDS,
} = require(path.join(projectRoot, "editcore-chat-kernel"));
const main = fs.readFileSync(path.join(projectRoot, "main.js"), "utf8");
const nodeCheck = spawnSync(process.execPath, ["--check", path.join(projectRoot, "main.js")], { encoding: "utf8" });

const report = {
  installedFiles: man.length,
  matchSourceSha256: ok,
  mismatchVsSource: bad,
  missingInSource: missing,
  skillIds: SKILL_IDS.length,
  stopText: stopChat().text,
  classify: {
    alto: classify("alto").kind,
    meta: classify("eso no te lo pedi").kind,
    analyze: classify("analiza X no modifiques").kind,
  },
  exportsOk: typeof handleChat === "function" && typeof stopChat === "function",
  subagents: ["explorer", "analyst", "implementer", "verifier"].map((n) =>
    fs.existsSync(path.join(root, "subagents", `${n}.js`))),
  mainSyntaxOk: nodeCheck.status === 0,
  mainUsesKernel: /handleChatKernel/.test(main) && /editcore-chat-kernel/.test(main),
  mainAgentRunNoAdapterExecute: !/adapter\.executeTask/.test(main),
  mainChatWired: main.includes('ipcMain.handle("editcore:chat"'),
  mainAgentWired: main.includes('ipcMain.handle("agent:run"'),
};

fs.writeFileSync(
  path.join(root, "_VERIFY_REPORT.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
process.exit(bad || missing || !report.exportsOk || !report.mainSyntaxOk || !report.mainUsesKernel ? 1 : 0);
