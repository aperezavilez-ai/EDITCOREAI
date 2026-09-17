"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const mainSrc = fs.readFileSync(path.join(root, "main.js"), "utf8");
const taskIpcSrc = fs.readFileSync(path.join(root, "runtime/task-ipc.js"), "utf8");
const preloadSrc = fs.readFileSync(path.join(root, "preload.js"), "utf8");
const chatHomeSrc = fs.readFileSync(path.join(root, "chat-home.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

// 1. Extraer todos los ipcRenderer.invoke(...) en preload.js
const invokedChannels = new Set();
const invokeRe = /ipcRenderer\.invoke\(\s*["']([^"']+)["']/g;
let m;
while ((m = invokeRe.exec(preloadSrc)) !== null) {
  invokedChannels.add(m[1]);
}

// 2. Extraer todos los ipcMain.handle(...) en main.js y task-ipc.js
const handledChannels = new Set();
const handleRe = /ipcMain\.handle\(\s*["']([^"']+)["']/g;
while ((m = handleRe.exec(mainSrc)) !== null) {
  handledChannels.add(m[1]);
}
const taskIpcRe = /["'](task:[^"']+|workflow:[^"']+)["']\s*:/g;
while ((m = taskIpcRe.exec(taskIpcSrc)) !== null) {
  handledChannels.add(m[1]);
}

const missingIpcHandlers = [];
for (const ch of invokedChannels) {
  if (!handledChannels.has(ch)) {
    missingIpcHandlers.push(ch);
  }
}

// 3. Extraer IDs de DOM buscados con $("...") o document.getElementById("...") en chat-home.js
const queriedIds = new Set();
const idRe1 = /\$\(\s*["']([^"']+)["']\s*\)/g;
while ((m = idRe1.exec(chatHomeSrc)) !== null) {
  queriedIds.add(m[1]);
}
const idRe2 = /document\.getElementById\(\s*["']([^"']+)["']\s*\)/g;
while ((m = idRe2.exec(chatHomeSrc)) !== null) {
  queriedIds.add(m[1]);
}

const missingDomIds = [];
for (const id of queriedIds) {
  const pattern = new RegExp(`id=["']${id}["']`);
  if (!pattern.test(indexHtml)) {
    missingDomIds.push(id);
  }
}

console.log(JSON.stringify({
  totalInvokedChannels: invokedChannels.size,
  totalHandledChannels: handledChannels.size,
  missingIpcHandlers,
  totalQueriedDomIdsInChatHome: queriedIds.size,
  missingDomIds,
  allIpcOk: missingIpcHandlers.length === 0,
  allDomOk: missingDomIds.length === 0,
}, null, 2));

if (missingIpcHandlers.length > 0 || missingDomIds.length > 0) {
  process.exit(1);
}
