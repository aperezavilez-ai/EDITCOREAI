"use strict";

/**
 * Verifica que cada ipcRenderer.invoke del preload tenga ipcMain.handle en main.js,
 * y reporta APIs de nube expuestas pero no usadas por la UI.
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const preload = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const taskIpc = fs.readFileSync(path.join(root, "runtime", "task-ipc.js"), "utf8");

const invokeRe = /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g;
const handleRe = /ipcMain\.handle\(\s*["']([^"']+)["']/g;
const registeredRe = /["']((?:task|workflow):[^"']+)["']\s*:/g;

const invokes = [...preload.matchAll(invokeRe)].map((m) => m[1]);
const handlers = new Set([
  ...[...main.matchAll(handleRe)].map((m) => m[1]),
  ...[...taskIpc.matchAll(registeredRe)].map((m) => m[1]),
]);

assert.match(main, /registerTaskIpc\(ipcMain/);

const missing = [...new Set(invokes)].filter((ch) => !handlers.has(ch));
assert.deepEqual(missing, [], `Canales preload sin handler en main/task-ipc: ${missing.join(", ")}`);

const cloudChannels = [
  "cloud:vault-status",
  "cloud:deploy-github",
  "cloud:deploy-vercel",
  "cloud:provision-supabase",
  "cloud:provision-gafcore-ai",
  "cloud:provision-fullstack",
  "cloud:probe-endpoint",
  "cloud:test-local-api",
];
for (const ch of cloudChannels) {
  assert.ok(invokes.includes(ch), `preload falta ${ch}`);
  assert.ok(handlers.has(ch), `main falta ${ch}`);
}

assert.ok(/editcoreCloud\s*:/.test(preload) || /exposeInMainWorld\(\s*["']editcoreCloud["']/.test(preload));
assert.ok(/editcoreProject/.test(preload));
assert.ok(/fullStackDeploy|fullstack-deploy|project:fullstack-deploy/.test(preload + main));

// UI publica por editcoreProject (pipeline determinista); editcoreCloud es ruta del agente/IPC.
const uiUsesProjectPublish = /fullStackDeployOneClick|editcoreProject\.(?:publish|fullStackDeploy|onboard)/.test(renderer);
assert.ok(uiUsesProjectPublish, "renderer debe usar pipeline de proyecto para Publicar");

const agentCloudTools = [
  "deploy_github",
  "deploy_vercel",
  "provision_supabase",
  "provision_gafcore_ai",
  "provision_fullstack_project",
];
const registerSrc = fs.readFileSync(path.join(root, "runtime", "register-agent-capability-tools.js"), "utf8");
for (const name of agentCloudTools) {
  assert.ok(registerSrc.includes(`"${name}"`) || registerSrc.includes(`'${name}'`), `tool ${name} no registrada`);
}

console.log("IPC_WIRING_OK", {
  preloadInvokes: invokes.length,
  uniqueChannels: new Set(invokes).size,
  mainHandlers: handlers.size,
  uiUsesEditcoreCloud: /editcoreCloud/.test(renderer),
  note: "UI Publicar → editcoreProject.*; agente → tools vault/cloud",
});
