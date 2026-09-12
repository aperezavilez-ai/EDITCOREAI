"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const applyToUser = process.env.EDITCORE_PROVIDER_APPLY === "1";
const providerName = String(process.env.EDITCORE_PROVIDER_NAME || "GafCore Gateway").trim().toLowerCase();
const normalUserData = path.join(app.getPath("appData"), "EDITCOREAI");
const acceptanceUserData = applyToUser ? normalUserData : fs.mkdtempSync(path.join(os.tmpdir(), "editcore-provider-catalog-"));
const reportPath = process.env.EDITCORE_PROVIDER_REPORT || path.join(process.cwd(), "provider-catalog-acceptance.json");

if (!applyToUser) {
  const secureConfig = path.join(normalUserData, "editcore-secure-config.bin");
  if (fs.existsSync(secureConfig)) fs.copyFileSync(secureConfig, path.join(acceptanceUserData, "editcore-secure-config.bin"));
}

process.env.EDITCORE_USER_DATA_PATH = acceptanceUserData;
process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
require("../main");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readyWindow() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const win = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (win) {
      const ready = await win.webContents.executeJavaScript("document.readyState === 'complete' && typeof loadCustomProviders === 'function'").catch(() => false);
      if (ready) return win;
    }
    await wait(100);
  }
  throw new Error("EDITCOREAI no termino de cargar la configuracion de proveedores.");
}

function persist(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), providerName, applyToUser, stage: "starting", ok: false };
  try {
    const win = await readyWindow();
    report.stage = "window-ready";
    const result = await win.webContents.executeJavaScript(`(async () => {
      const list = loadCustomProviders();
      const provider = list.find((item) => String(item?.name || "").trim().toLowerCase() === ${JSON.stringify(providerName)}
        || String(item?.baseUrl || "").toLowerCase().includes("gafcore-gateway.vercel.app"));
      if (!provider) {
        const available = list.map((item) => {
          let host = "sin-host";
          try { host = new URL(item?.baseUrl || "").hostname; } catch {}
          return String(item?.name || "sin-nombre") + "@" + host;
        });
        throw new Error("No se encontro el proveedor solicitado. Disponibles: " + (available.join(", ") || "ninguno"));
      }
      const providerKey = "custom:" + provider.id;
      const catalog = await window.editcoreModels.list({ providerKey, baseUrl: provider.baseUrl, apiKey: provider.apiKey });
      provider.models = [...new Set(catalog.map((model) => String(model || "").trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
      provider.modelCount = provider.models.length;
      provider.enabledModels = [...provider.models];
      provider.visibleModelLimit = 0;
      provider.showAllModels = true;
      provider.status = "active";
      provider.error = "";
      provider.checkedAt = Date.now();
      if (!provider.models.includes(provider.model)) provider.model = provider.models.find((model) => /claude-sonnet-4-6/i.test(model)) || provider.models[0] || "";
      if (!provider.model) throw new Error("El proveedor no devolvio modelos.");
      await saveCustomProviders(list);
      await syncCustomProviderProfiles(provider);
      const verification = await window.editcoreProviders.test({
        providerKey,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
      });
      const profiles = loadProviderProfiles();
      const selectedProfiles = profiles.filter((profile) => profile.providerKey === providerKey && provider.enabledModels.includes(profile.model));
      const verifiedProfile = selectedProfiles.find((profile) => profile.model === verification.model);
      if (verifiedProfile) {
        verifiedProfile.status = "active";
        verifiedProfile.chatVerified = verification.chatOK === true;
        verifiedProfile.toolOK = verification.toolOK === true;
        verifiedProfile.checkedAt = Date.now();
        verifiedProfile.error = "";
      }
      await saveProviderProfiles(profiles);
      provider.model = verification.model;
      await saveCustomProviders(list);
      await activateProvider({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.model, providerKey, profileId: verifiedProfile?.id || "" });
      setChatModelOptions([], provider.model, providerKey, verifiedProfile?.id || "");
      const chatOptions = [...document.getElementById("chatModelSelect").options]
        .filter((option) => option.dataset.providerKey === providerKey);
      return {
        provider: provider.name,
        providerKey,
        catalogCount: provider.models.length,
        selectedCount: provider.enabledModels.length,
        activeProfileCount: selectedProfiles.filter((profile) => profile.status === "active").length,
        visibleChatCount: chatOptions.length,
        selectedModel: provider.model,
        chatOK: verification.chatOK === true,
        toolOK: verification.toolOK === true,
        visibleModelLimit: provider.visibleModelLimit,
      };
    })()`);
    report.result = result;
    report.ok = Boolean(result.catalogCount > 0
      && result.selectedCount === result.catalogCount
      && result.activeProfileCount === result.catalogCount
      && result.visibleChatCount === result.selectedCount
      && result.visibleModelLimit === 0
      && result.chatOK
      && result.toolOK);
    report.stage = report.ok ? "complete" : "failed-criteria";
  } catch (error) {
    report.error = String(error?.stack || error).slice(0, 3000);
    report.stage = "failed";
  } finally {
    persist(report);
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.destroy();
    await wait(250);
    app.exit(report.ok ? 0 : 1);
  }
});
