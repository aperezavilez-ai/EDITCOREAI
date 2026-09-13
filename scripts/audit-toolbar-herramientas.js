"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const renderer = fs.readFileSync(path.join(root, "renderer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const toolsMenu = (html.match(/id="toolsMoreMenu"[\s\S]*?<\/div>\s*<button id="connectProjectBtn"/) || [])[0] || "";
assert.ok(toolsMenu.includes("logsBtn"));
assert.ok(!toolsMenu.includes("terminalBtn"), "Terminal UI eliminada");
assert.ok(toolsMenu.includes("brainBtn"));
assert.ok(toolsMenu.includes("inspectorBtn"));
assert.ok(toolsMenu.includes("themeCycleBtn"), "Tema en Herramientas");
assert.ok(!toolsMenu.includes("composerPanelBtn"), "Composer UI eliminado del menú");
assert.ok(!toolsMenu.includes("extensionsBtn"), "Extensiones UI eliminada del menú");
assert.ok(!toolsMenu.includes("maintenanceBtn"), "Mantenimiento fusionado en Inspector");

assert.ok(!html.includes('id="composerPanel"'));
assert.ok(!html.includes('id="extensionsDialog"'));
assert.ok(!html.includes('id="maintenanceDialog"'));
assert.ok(html.includes('id="inspectorMaintenancePane"'));
assert.ok(html.includes('id="publishBtn"'), "Botón Publicar");
assert.ok(html.includes('id="connectProjectBtn"'), "Botón Conectar");
assert.ok(!html.includes('id="updatePublishBtn"'), "Actualizar publicación eliminado (duplicado de Publicar)");
assert.ok(!html.includes('id="undoAgentRunBtn"'), "Deshacer eliminado de la barra");
assert.ok(!html.includes('id="publishMoreBtn"'), "Menú Publicar fragmentado eliminado");
assert.ok(!html.includes('id="fullStackDeployBtn"'), "fullStackDeployBtn reemplazado por publishBtn");
assert.ok(!html.includes('id="terminalBtn"'));
assert.ok(!html.includes('id="terminalPanel"'));
assert.ok(!html.includes("Cloud token"));
assert.ok(!html.includes("supabaseCloudToken"));
assert.ok(!html.includes("Solo conectar"));
assert.ok(!html.includes("Solo preparar"));
assert.ok(!html.includes("Solo publicar"));
assert.ok(!html.includes("Solo deploy"));
assert.ok(!html.includes("Publicar todo (1 clic)"));

assert.ok(css.includes('html[data-theme="negro"]'));
assert.ok(css.includes('html[data-theme="azul"]'));
assert.ok(css.includes("--ec-terminal-bg"));

assert.match(renderer, /Salud de proyectos/);
assert.match(renderer, /openMaintenanceDialog[\s\S]*openInspector/);
assert.match(renderer, /cycleEditCoreTheme|applyEditCoreTheme/);
assert.match(renderer, /fullStackDeployOneClick\(\{\s*mode:\s*"update"/);
assert.match(renderer, /fullStackDeployOneClick\(\{\s*mode:\s*"full"/);

console.log("TOOLBAR_CLEANUP_OK");
