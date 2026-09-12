"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const probe = path.join(os.tmpdir(), "editcore-vault-probe.js");
const reportPath = path.join(os.tmpdir(), "editcore-vault-probe.json");

fs.writeFileSync(
  probe,
  `
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const out = ${JSON.stringify(reportPath)};

function inspect(label, userData) {
  const file = path.join(userData, "editcore-secure-config.bin");
  const r = { label, userData, exists: fs.existsSync(file), connectionsKeys: [], configured: {} };
  if (!r.exists) return r;
  try {
    const raw = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    const c = raw["editcore-connections"] || {};
    r.connectionsKeys = Object.keys(c);
    r.configured = {
      github: Boolean(c.githubToken),
      vercel: Boolean(c.vercelToken),
      netlify: Boolean(c.netlifyToken),
      selfSupabase: Boolean(c.selfSupabaseUrl && c.selfSupabaseKey),
      selfSupabaseUrl: String(c.selfSupabaseUrl || "").slice(0, 80),
      ssh: Boolean(c.serverHost && c.serverKeyPath),
    };
  } catch (e) {
    r.error = String(e.message || e).slice(0, 200);
  }
  return r;
}

app.whenReady().then(() => {
  const appData = app.getPath("appData");
  const report = {
    appName: app.getName(),
    userData: app.getPath("userData"),
    vaults: [
      inspect("EDITCOREAI", path.join(appData, "EDITCOREAI")),
      inspect("EditCore AI", path.join(appData, "EditCore AI")),
      inspect("EditCore", path.join(appData, "EditCore")),
      inspect("editcore-ai", path.join(appData, "editcore-ai")),
    ],
  };
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(out);
  app.exit(0);
}).catch((e) => {
  console.error(e);
  app.exit(1);
});
`,
  "utf8",
);

const electronCli = path.join("D:", "PROGRAMAS IA", "EDITCOREAI", "node_modules", "electron", "cli.js");
const r = spawnSync(process.execPath, [electronCli, probe], {
  encoding: "utf8",
  timeout: 90_000,
  env: { ...process.env },
});

if (r.status !== 0) {
  console.error(r.stderr || r.stdout || "probe failed");
  process.exit(r.status || 1);
}

if (fs.existsSync(reportPath)) {
  console.log(fs.readFileSync(reportPath, "utf8"));
} else {
  console.error("No report written");
  process.exit(1);
}
