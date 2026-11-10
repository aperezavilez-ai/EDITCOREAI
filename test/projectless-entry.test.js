"use strict";

// La puerta de entrada al chat sin proyecto (hallazgo en vivo de Luis,
// 2026-11-10): teniendo proyectos guardados, "+ Nuevo Chat" pasaba por
// ensureProject() y el chat nacía amarrado al primer proyecto con carpeta —
// no había forma de abrir en blanco aunque el motor lo soporta desde la
// v4.6.2. Estos tests fijan la puerta en sus tres superficies: la función
// del renderer (registro que nace sin raíz), la pantalla de bienvenida del
// IDE y la barra lateral del Chat.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");
const chatHome = fs.readFileSync(path.join(ROOT, "chat-home.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

test("el renderer crea el chat sin proyecto SIN pasar por ensureProject", () => {
  const start = renderer.indexOf("function createProjectlessChatThread()");
  assert.ok(start >= 0, "debe existir createProjectlessChatThread");
  const body = renderer.slice(start, renderer.indexOf("function createNewChatThread()", start));
  assert.ok(!body.includes("= ensureProject("), "no debe amarrarse al proyecto activo");
  assert.match(body, /projectRoot: ""/, "el registro nace sin carpeta");
  assert.match(body, /state\.activeProjectId = project\.id/, "el registro queda activo");
  assert.match(body, /state\.projectRoot = ""/, "la raíz global queda vacía");
  assert.match(body, /activeChatId: chat\.id/, "su chat queda activo");
});

test("el renderer expone la función y la tarjeta de bienvenida la invoca", () => {
  assert.match(renderer, /window\.createProjectlessChatThread = createProjectlessChatThread;/);
  assert.match(renderer, /\$\("welcomeChatBtn"\)\?\.addEventListener\("click"/);
});

test("la pantalla de bienvenida ofrece la tarjeta «Chat sin proyecto»", () => {
  assert.match(indexHtml, /id="welcomeChatBtn"/);
  assert.match(indexHtml, /Chat sin proyecto/);
});

test("la barra del Chat ofrece el botón y chat-home lo conecta al renderer", () => {
  assert.match(indexHtml, /id="chatHomeProjectlessBtn"/);
  assert.match(chatHome, /function createProjectlessThread\(\)/);
  assert.match(chatHome, /window\.createProjectlessChatThread\(\)/);
  assert.match(chatHome, /\$\("chatHomeProjectlessBtn"\)\?\.addEventListener\("click"/);
});
