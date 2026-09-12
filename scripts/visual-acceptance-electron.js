"use strict";

const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const { capturePreview } = require("../visual-preview-inspector");

app.whenReady().then(async () => {
  const keeper = new BrowserWindow({ show: false, width: 100, height: 100 });
  const outputRoot = process.cwd();
  const reportPath = path.join(outputRoot, "visual-acceptance-report.json");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EDITCOREAI Visual Acceptance</title><style>body{margin:0;font:16px Arial;background:#fff;color:#111}main{width:1800px;padding:24px}button{margin-left:1650px;width:120px;height:44px}</style></head><body><main><h1>Visual acceptance</h1><p>Contenido real para validar la captura.</p><button>Accion</button></main></body></html>`;
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-visual-script-"));
  fs.writeFileSync(path.join(projectRoot, "index.html"), html, "utf8");
  let child = null;
  try {
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const selected = probe.address().port;
        probe.close(() => resolve(selected));
      });
    });
    child = spawn(process.execPath, [path.resolve(__dirname, "..", "static-preview-server.js"), projectRoot, String(port)], {
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.text()).includes("Visual acceptance")) { ready = true; break; }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error("El servidor estatico de aceptacion no respondio.");
    const report = { generatedAt: new Date().toISOString(), implementation: path.resolve(__dirname, "..", "visual-preview-inspector.js"), inspections: [] };
    for (const viewport of ["desktop", "mobile"]) {
      const result = await capturePreview({ BrowserWindow, url, viewport, outputRoot });
      const { imageDataUrl: _imageDataUrl, ...evidence } = result;
      evidence.screenshotSha256 = crypto.createHash("sha256").update(fs.readFileSync(result.screenshotPath)).digest("hex");
      evidence.nonblank = result.screenshotBytes > 1000;
      evidence.detectedKnownOverflow = result.diagnostics.horizontalOverflow === true && result.diagnostics.clippedControls.length > 0;
      evidence.exactViewport = result.diagnostics.viewport.width === result.requestedViewport.width && result.diagnostics.viewport.height === result.requestedViewport.height;
      report.inspections.push(evidence);
    }
    report.ok = report.inspections.length === 2 && report.inspections.every((item) => item.ok && item.nonblank && item.detectedKnownOverflow && item.exactViewport);
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.exitCode = report.ok ? 0 : 2;
  } catch (error) {
    fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ok: false, fatal: String(error?.stack || error) }, null, 2)}\n`, "utf8");
    process.exitCode = 3;
  } finally {
    if (child?.pid) {
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
    }
    fs.rmSync(projectRoot, { recursive: true, force: true });
    if (!keeper.isDestroyed()) keeper.destroy();
    app.exit(process.exitCode || 0);
  }
});
