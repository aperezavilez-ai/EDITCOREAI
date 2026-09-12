"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const imagePath = process.env.EDITCORE_VISION_IMAGE;
const reportPath = process.env.EDITCORE_VISION_REPORT || path.join(process.cwd(), "vision-attachment-acceptance.json");
const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-vision-project-"));
const acceptanceUserData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-vision-profile-"));
const normalUserData = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "EDITCOREAI");
const secureConfig = path.join(normalUserData, "editcore-secure-config.bin");

if (!imagePath || !fs.existsSync(imagePath)) throw new Error("Falta EDITCORE_VISION_IMAGE valida.");
if (fs.existsSync(secureConfig)) fs.copyFileSync(secureConfig, path.join(acceptanceUserData, "editcore-secure-config.bin"));
process.env.EDITCORE_USER_DATA_PATH = acceptanceUserData;
fs.writeFileSync(path.join(projectRoot, "README.md"), "Proyecto temporal para verificar vision.\n", "utf8");

const mimeType = /\.png$/i.test(imagePath) ? "image/png" : /\.webp$/i.test(imagePath) ? "image/webp" : "image/jpeg";
const image = {
  name: path.basename(imagePath),
  mimeType,
  dataUrl: `data:${mimeType};base64,${fs.readFileSync(imagePath).toString("base64")}`,
};

require("../main");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readyWindow() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window) {
      const ready = await window.webContents.executeJavaScript(`document.readyState === "complete" && Boolean(window.editcoreAgent?.plan)`).catch(() => false);
      if (ready) return window;
    }
    await wait(100);
  }
  throw new Error("La interfaz no termino de cargar.");
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), image: { name: image.name, mimeType: image.mimeType, bytes: fs.statSync(imagePath).size } };
  try {
    const window = await readyWindow();
    const result = await window.webContents.executeJavaScript(`(async () => {
      const secure = await window.editcoreSecureConfig.load();
      const providers = secure["editcore-providers"] || {};
      const profiles = (secure["editcore-provider-profiles"] || []).filter((item) => item?.status === "active" && item?.apiKey && item?.model);
      const profile = profiles.find((item) => item.model === "claude-sonnet-4.6") || profiles[0];
      if (!profile) throw new Error("No hay perfiles activos.");
      const provider = providers[profile.providerKey] || {};
      const attached = ${JSON.stringify(image)};
      const persisted = workflowImages([attached]);
      const resumed = workflowImages(persisted);
      const response = await window.editcoreAgent.plan({
        providerKey: profile.providerKey,
        baseUrl: profile.baseUrl || provider.baseUrl,
        apiKey: profile.apiKey,
        model: profile.model,
        prompt: "Lee la imagen adjunta. En el primer paso identifica el encabezado visible y al menos una correccion numerada; despues presenta un plan breve.",
        images: resumed,
        projectRoot: ${JSON.stringify(projectRoot)},
        projectId: "vision-acceptance",
        agentId: "vision-acceptance"
      });
      return {
        providerKey: profile.providerKey,
        model: profile.model,
        persistenceOK: resumed.length === 1 && resumed[0].dataUrl === attached.dataUrl,
        text: response.text,
        usage: response.usage
      };
    })()`);
    const text = String(result.text || "");
    report.result = result;
    report.visualEvidence = /cat[aá]logos|ciudades|clientes|proveedores|bodegas|sales confirmation|pickup/i.test(text);
    report.ok = result.persistenceOK && report.visualEvidence && !/VISUAL_UNAVAILABLE|no (?:puedo|hay).*imagen/i.test(text);
  } catch (error) {
    report.ok = false;
    report.error = String(error?.stack || error).slice(0, 2000);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(acceptanceUserData, { recursive: true, force: true });
    app.exit(report.ok ? 0 : 2);
  }
});
