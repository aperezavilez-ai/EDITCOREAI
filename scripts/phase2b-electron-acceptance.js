"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const reportPath = path.resolve(process.env.EDITCORE_PHASE2B_ELECTRON_REPORT || path.join(process.cwd(), "phase2b-results", "electron-reopen.json"));
const electron = require("electron");

function seed(root, taskId, forceKill) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    const child = spawn(electron, [path.join(__dirname, "phase2b-electron-seed.js")], {
      env: { ...process.env, EDITCORE_USER_DATA_PATH: root, EDITCORE_PHASE2B_TASK_ID: taskId, EDITCORE_PHASE2B_NORMAL_EXIT: forceKill ? "0" : "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGKILL");
      reject(new Error(`Electron no creo la tarea activa. ${stderr.slice(-1000)}`));
    }, 30_000);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("READY")) return;
      clearTimeout(timer);
      if (forceKill) {
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
        else child.kill("SIGKILL");
        resolve();
      }
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      if (!forceKill && code === 0) { clearTimeout(timer); resolve(); return; }
      if (code !== null && code !== 0 && !forceKill) { clearTimeout(timer); reject(new Error(`Electron termino antes de READY (${code}). ${stderr.slice(-1000)}`)); }
    });
  });
}

function verify(root, taskId, target) {
  return spawnSync(electron, [path.join(__dirname, "phase2b-electron-verify.js")], {
    env: { ...process.env, EDITCORE_USER_DATA_PATH: root, EDITCORE_PHASE2B_TASK_ID: taskId, EDITCORE_PHASE2B_ELECTRON_REPORT: target }, stdio: "inherit", windowsHide: true, timeout: 30_000,
  });
}

function cleanup(target, recursive = false) {
  try {
    fs.rmSync(target, { recursive, force: true, maxRetries: 12, retryDelay: 250 });
  } catch (error) {
    console.warn(`No se pudo limpiar el temporal ${target}: ${error?.message || error}`);
  }
}

async function main() {
  const forcedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-phase2b-electron-force-"));
  const normalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-phase2b-electron-normal-"));
  const forcedReport = `${reportPath}.forced.tmp`;
  const normalReport = `${reportPath}.normal.tmp`;
  try {
    await seed(forcedRoot, "task-electron-forced", true);
    const forced = verify(forcedRoot, "task-electron-forced", forcedReport);
    await seed(normalRoot, "task-electron-normal", false);
    const normal = verify(normalRoot, "task-electron-normal", normalReport);
    const forcedData = JSON.parse(fs.readFileSync(forcedReport, "utf8"));
    const normalData = JSON.parse(fs.readFileSync(normalReport, "utf8"));
    const report = { generatedAt: new Date().toISOString(), ok: forcedData.ok && normalData.ok, forced: forcedData, normal: normalData };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.exitCode = report.ok && forced.status === 0 && normal.status === 0 ? 0 : 2;
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 500));
    cleanup(forcedRoot, true);
    cleanup(normalRoot, true);
    cleanup(forcedReport);
    cleanup(normalReport);
  }
}

main();
