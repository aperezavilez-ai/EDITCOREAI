"use strict";

/**
 * Arranque oficial: EDITCOREAI.exe (logo EditCoreAI).
 * Nunca invoca `electron` CLI ni electron.exe por nombre de producto Electron.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const launcher = path.join(appRoot, "EDITCOREAI.exe");

try {
  require("./brand-electron-runtime").brandElectronRuntime({ force: false });
} catch (error) {
  console.warn("[start-editcore] brand:", error?.message || error);
}

if (!fs.existsSync(launcher)) {
  const rebuilt = require("node:child_process").spawnSync(
    process.execPath,
    [path.join(__dirname, "rebuild-root-exe.js")],
    { cwd: appRoot, stdio: "inherit", shell: false },
  );
  if (rebuilt.status !== 0 || !fs.existsSync(launcher)) {
    console.error("No se pudo crear EDITCOREAI.exe");
    process.exit(1);
  }
}

const child = spawn(launcher, [], {
  cwd: appRoot,
  detached: true,
  stdio: "ignore",
  shell: false,
  env: {
    ...process.env,
    EDITCORE_USER_DATA_PATH: path.join(process.env.APPDATA || "", "EDITCOREAI"),
  },
});
child.unref();
