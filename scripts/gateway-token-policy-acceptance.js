"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

process.env.EDITCORE_ACCEPTANCE_HIDDEN = "1";
process.env.EDITCORE_ACCEPTANCE_ALLOW_MULTI_INSTANCE = "1";
const normalUserData = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "EDITCOREAI");
process.env.EDITCORE_USER_DATA_PATH = normalUserData;
const reportPath = process.env.EDITCORE_GATEWAY_POLICY_REPORT || path.join(os.tmpdir(), "editcore-gateway-policy-acceptance.json");

require("../main");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mainWindow() {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (window && await window.webContents.executeJavaScript('document.body?.dataset?.editcoreReady === "1"').catch(() => false)) return window;
    await wait(100);
  }
  throw new Error("EDITCOREAI no termino de iniciar para validar Gateway.");
}

app.whenReady().then(async () => {
  const report = { generatedAt: new Date().toISOString(), ok: false };
  try {
    const window = await mainWindow();
    const profile = await window.webContents.executeJavaScript(`(async () => {
      const secure = await window.editcoreSecureConfig.load();
      const profile = (secure["editcore-provider-profiles"] || []).find((item) =>
        item?.providerKey === "custom:gafcore-gateway" && ["active", "enabled"].includes(item.status) && item.apiKey && item.baseUrl
      );
      if (!profile) throw new Error("No existe un perfil seguro de GafCore Gateway.");
      return { apiKey: profile.apiKey, baseUrl: profile.baseUrl };
    })()`);
    const origin = new URL(profile.baseUrl).origin;
    const response = await fetch(`${origin}/api/v1/capabilities`, {
      headers: { Authorization: `Bearer ${profile.apiKey}`, "x-api-key": profile.apiKey },
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    const result = {
      status: response.status,
      ok: response.ok && payload?.ok !== false,
      gateway: payload?.data?.gateway || "",
      maxInputTokensPerRequest: Number(payload?.data?.limits?.max_input_tokens_per_request),
    };
    Object.assign(report, result);
    report.ok = result.ok === true && result.gateway === "gafcore-gateway" && result.maxInputTokensPerRequest === 0;
  } catch (error) {
    report.error = String(error?.message || error).slice(0, 1000);
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    app.exit(report.ok ? 0 : 2);
  }
});
