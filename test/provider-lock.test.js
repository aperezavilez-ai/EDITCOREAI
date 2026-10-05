"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { loadCloudConfig } = require("../runtime/editcore-cloud-config");
const { assertProviderAllowed, setAdminInfra } = require("../runtime/platform-defaults");

const CLOUD = loadCloudConfig({ packaged: true }).url;

test("Candado: la app instalada ignora variables de entorno del servidor de cuentas", () => {
  const env = { EDITCOREAI_CLOUD_URL: "https://servidor-falso.example", EDITCOREAI_CLOUD_ANON_KEY: "x" };
  const packaged = loadCloudConfig({ packaged: true, env, envFile: null });
  assert.notEqual(packaged.url, "https://servidor-falso.example");
  const dev = loadCloudConfig({ packaged: false, env, envFile: null });
  assert.equal(dev.url, "https://servidor-falso.example");
});

test("Candado: usuario de la app instalada solo usa la IA del servidor de EditCoreAI", () => {
  setAdminInfra(false);
  assert.doesNotThrow(() => assertProviderAllowed(`${CLOUD}/functions/v1/ai-proxy/v1`, { packaged: true }));
  assert.doesNotThrow(() => assertProviderAllowed(`${CLOUD}/functions/v1/ai-proxy/v1/`, { packaged: true }));
  for (const base of [
    "https://api.openai.com/v1",
    "https://meai.cloud/v1",
    "http://127.0.0.1:11434/v1",
    `${CLOUD}/functions/v1/otra-funcion`,
    `${CLOUD}.evil.example/functions/v1/ai-proxy/meai/v1`,
    "",
  ]) {
    assert.throws(() => assertProviderAllowed(base, { packaged: true }), (err) => err.code === "PROVIDER_LOCKED", base);
  }
});

test("Candado: admin y modo desarrollo no se bloquean", () => {
  setAdminInfra(true);
  try {
    assert.doesNotThrow(() => assertProviderAllowed("https://api.openai.com/v1", { packaged: true }));
  } finally {
    setAdminInfra(false);
  }
  assert.doesNotThrow(() => assertProviderAllowed("https://api.openai.com/v1", { packaged: false }));
});

test("Candado: las dos rutas de llamada a la IA pasan por el candado", () => {
  const aiCore = fs.readFileSync(path.join(ROOT, "runtime", "ai-core.js"), "utf8");
  const kernel = fs.readFileSync(path.join(ROOT, "editcore-chat-kernel", "provider.js"), "utf8");
  assert.match(aiCore, /assertProviderAllowed\(/);
  assert.match(kernel, /assertProviderAllowed\(/);
});

test("Candado: el instalador activa los fusibles contra modificación", () => {
  const fuses = require("../package.json").build.electronFuses;
  assert.equal(fuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(fuses.onlyLoadAppFromAsar, true);
  assert.equal(fuses.enableNodeCliInspectArguments, false);
  assert.equal(fuses.enableNodeOptionsEnvironmentVariable, false);
  // La vista previa y los chequeos forenses lanzan Node con ELECTRON_RUN_AS_NODE.
  assert.equal(fuses.runAsNode, true);
});
