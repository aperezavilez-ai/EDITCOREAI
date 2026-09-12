"use strict";
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const USER = path.join(process.env.APPDATA || "", "EDITCOREAI");
try { app.setName("EDITCOREAI"); } catch {}
try { app.setPath("userData", USER); } catch {}

app.whenReady().then(() => {
  try {
    const state = JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(USER, "editcore-secure-config.bin"))));
    const chat = state["editcore-chat-config"] || {};
    const custom = state["editcore-custom-providers"] || [];
    const profiles = state["editcore-provider-profiles"] || [];
    const providers = state["editcore-providers"] || {};
    const gwProfiles = profiles.filter((p) => String(p.providerKey || "").includes("gafcore") || String(p.baseUrl || "").includes("gafcore-gateway"));
    const gwCustom = custom.filter((p) => String(p.id || "").includes("gafcore") || String(p.baseUrl || "").includes("gafcore-gateway"));
    console.log(JSON.stringify({
      ok: true,
      chat: { providerKey: chat.providerKey, model: chat.model, baseUrl: chat.baseUrl, hasKey: Boolean(chat.apiKey) },
      providerKeys: Object.keys(providers),
      profileCount: profiles.length,
      gatewayProfiles: gwProfiles.length,
      gatewayCustom: gwCustom.length,
    }, null, 2));
    app.exit(gwProfiles.length || gwCustom.length || String(chat.baseUrl || "").includes("gafcore-gateway") ? 2 : 0);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
    app.exit(1);
  }
});
