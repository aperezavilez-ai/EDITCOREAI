"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const providerKeys = new Set(["meai", "apicredits"]);

app.whenReady().then(() => {
  const filePath = path.join(app.getPath("appData"), "EDITCOREAI", "editcore-secure-config.bin");
  if (!fs.existsSync(filePath)) throw new Error("No existe la configuracion cifrada de EDITCOREAI.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows no permite descifrar la configuracion de EDITCOREAI.");
  const secure = JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
  const providers = secure["editcore-providers"] || {};
  const profiles = Array.isArray(secure["editcore-provider-profiles"])
    ? secure["editcore-provider-profiles"]
    : [];
  const result = [...providerKeys].map((providerKey) => {
    const rows = profiles.filter((profile) => profile?.providerKey === providerKey && profile?.model && profile?.apiKey);
    const fingerprints = [...new Set(rows.map((profile) => crypto.createHash("sha256").update(profile.apiKey).digest("hex").slice(0, 12)))];
    return {
      providerKey,
      baseUrl: providers[providerKey]?.baseUrl || rows.find((profile) => profile.baseUrl)?.baseUrl || "",
      models: [...new Set(rows.map((profile) => profile.model))].sort(),
      activeModels: [...new Set(rows.filter((profile) => ["active", "enabled"].includes(profile.status)).map((profile) => profile.model))].sort(),
      keyFingerprints: fingerprints,
      hasSingleKey: fingerprints.length === 1,
    };
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  app.exit(1);
});
