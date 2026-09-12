"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
const acceptanceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-save-acceptance-"));
const projectRoot = path.join(acceptanceRoot, "PROYECTO_GUARDAR");
const userData = path.join(acceptanceRoot, "user-data");
const reportPath = process.env.EDITCORE_SAVE_REPORT
  || path.join(process.cwd(), "save-project-acceptance.json");

fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, "package.json"), `${JSON.stringify({ name: "proyecto-guardar", private: true }, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(projectRoot, "index.html"), "<!doctype html><title>Guardar</title><h1>Proyecto guardar</h1>\n", "utf8");
app.setPath("userData", userData);

require("../main");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findMainWindow() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window) return window;
    await wait(100);
  }
  throw new Error("EDITCOREAI no creo la ventana principal.");
}

async function waitForRenderer(window) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const ready = await window.webContents.executeJavaScript(`document.readyState === "complete" && Boolean(document.getElementById("saveProjectBtn"))`);
      if (ready) return;
    } catch {}
    await wait(100);
  }
  throw new Error("El renderizador de EDITCOREAI no termino de cargar.");
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), projectRoot, checks: {} };
  try {
    const window = await findMainWindow();
    const rendererErrors = [];
    window.webContents.on("console-message", (_event, _level, message, line, sourceId) => {
      if (/error|exception|failed|invalid|proyecto/i.test(String(message))) {
        rendererErrors.push({ message: String(message).slice(0, 1000), line, sourceId });
      }
    });
    window.webContents.on("render-process-gone", (_event, details) => rendererErrors.push({ renderProcessGone: details }));
    await waitForRenderer(window);
    report.startup = await window.webContents.executeJavaScript(`({
      readyState: document.readyState,
      saveButton: Boolean(document.getElementById("saveProjectBtn")),
      saveDialog: Boolean(document.getElementById("saveProjectDialog")),
      bootStatus: document.getElementById("status")?.textContent || ""
    })`);
    await window.webContents.executeJavaScript(`(() => {
      const project = {
        id: "save-acceptance-project",
        title: "Proyecto guardar",
        mode: "claude",
        model: "claude-sonnet-4.6",
        messages: [],
        projectRoot: ${JSON.stringify(projectRoot)},
        permissionMode: "full",
        agents: [],
        updatedAt: Date.now()
      };
      localStorage.setItem("editcore-projects", JSON.stringify([project]));
      localStorage.setItem("editcore-active-project", project.id);
      state.projects = [ensureProjectAgent(project)];
      state.activeProjectId = project.id;
      state.projectRoot = project.projectRoot;
      saveProjects();
      renderProjects();
    })()`);
    report.restoredState = await window.webContents.executeJavaScript(`({
      activeId: localStorage.getItem("editcore-active-project"),
      projects: JSON.parse(localStorage.getItem("editcore-projects") || "[]").map((item) => ({ id: item.id, root: item.projectRoot })),
      runtimeRoot: activeProject()?.projectRoot || ""
    })`);
    const opened = await window.webContents.executeJavaScript(`(async () => {
      try {
        const button = document.getElementById("saveProjectBtn");
        if (!button) throw new Error("No existe saveProjectBtn");
        button.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const dialog = document.getElementById("saveProjectDialog");
        return {
          open: dialog?.open === true,
          location: document.getElementById("saveProjectLocation")?.value || "",
          message: document.getElementById("saveProjectMessage")?.textContent || ""
        };
      } catch (error) {
        return { open: false, error: String(error?.stack || error) };
      }
    })()`);
    report.checks.dialogOpened = opened.open === true;
    report.checks.locationVisible = opened.location === projectRoot;
    report.dialog = opened;
    report.rendererErrors = rendererErrors;
    if (!report.checks.dialogOpened || !report.checks.locationVisible) throw new Error("El dialogo no mostro la ubicacion real.");

    await window.webContents.executeJavaScript(`document.getElementById("saveProjectForm").requestSubmit()`);
    const manifestPath = path.join(projectRoot, ".editcore", "project.json");
    for (let attempt = 0; attempt < 50 && !fs.existsSync(manifestPath); attempt += 1) await wait(100);
    report.checks.manifestWritten = fs.existsSync(manifestPath);
    if (!report.checks.manifestWritten) throw new Error("No se creo .editcore/project.json.");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const ui = await window.webContents.executeJavaScript(`({
      dialogOpen: document.getElementById("saveProjectDialog").open,
      status: document.getElementById("status").textContent
    })`);
    report.checks.dialogClosed = ui.dialogOpen === false;
    report.checks.statusConfirmed = ui.status.includes(manifestPath);
    report.checks.manifestRoot = manifest.root === projectRoot;
    report.manifestPath = manifestPath;
    report.manifest = manifest;
    report.ui = ui;
    report.ok = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.ok = false;
    report.error = String(error?.stack || error);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.rmSync(acceptanceRoot, { recursive: true, force: true });
    app.exit(report.ok ? 0 : 2);
  }
});
