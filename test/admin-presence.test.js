"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Actividad: la app manda un latido con su versión mientras hay sesión", () => {
  const main = read("main.js");
  assert.match(main, /authManager\.rpc\("editcoreai_heartbeat", \{ p_version: app\.getVersion\(\) \}\)/);
  assert.match(main, /if \(presenceHeartbeatBusy \|\| !authManager\.isAuthenticated\(\)\) return;/);
  assert.match(main, /setInterval\(sendPresenceHeartbeat, PRESENCE_HEARTBEAT_MS\)/);
});

test("Actividad: solo usuarios con sesión registran latido y solo el admin ve la lista", () => {
  const sql = read("supabase/migrations/20261003180000_editcoreai_presence.sql");
  assert.match(sql, /editcoreai_heartbeat[\s\S]*editcoreai\.require_uid\(\)/);
  assert.match(sql, /revoke all on function public\.editcoreai_heartbeat\(text\) from public, anon;/);
  assert.match(sql, /editcoreai_admin_list_users[\s\S]*editcoreai\.require_admin\(\)[\s\S]*a\.last_seen_at, a\.app_version/);
});

test("Ver como usuario: sin franja que tape botones; se sale con un botón en la barra o con Esc", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /ecPreviewBanner/);
  assert.match(html, /<button id="ideExitPreviewBtn"[^>]*hidden>✕ Salir de vista usuario<\/button>/);
  assert.match(html, /id="chatHomeExitPreviewBtn"[^>]*hidden>✕ Salir de vista usuario<\/button>/);
  const css = read("chat-home.css");
  const line = css.match(/body\.is-preview-as-user::before \{[^}]*\}/)?.[0] || "";
  assert.match(line, /height: 3px;/);
  assert.match(line, /pointer-events: none;/);
  assert.match(css.match(/\.app-toolbar \.ec-preview-exit-btn \{[^}]*\}/)?.[0] || "", /-webkit-app-region: no-drag;/);
  const home = read("chat-home.js");
  assert.match(home, /\["chatHomeExitPreviewBtn", "ideExitPreviewBtn"\][\s\S]{0,120}btn\.hidden = !\(realAdmin && previewAsUser\);/);
  assert.match(home, /\$\("ideExitPreviewBtn"\)\?\.addEventListener\("click", \(\) => void setPreviewAsUser\(false\)\);/);
  assert.match(home, /ev\.key === "Escape" && previewAsUser[^\n]*setPreviewAsUser\(false\)/);
});

test("Admin: Administración y Ver como usuario también existen en la vista de proyectos, ocultos por defecto", () => {
  const html = read("index.html");
  assert.match(html, /<button id="ideAdminBtn"[^>]*hidden>/);
  assert.match(html, /<button id="idePreviewBtn"[^>]*hidden>/);
  const home = read("chat-home.js");
  assert.match(home, /\["chatHomeAdminBtn", "chatHomePreviewBtn", "ideAdminBtn", "idePreviewBtn"\]/);
  assert.match(home, /btn\.hidden = !realAdmin \|\| previewAsUser;/);
  assert.match(home, /\$\("ideAdminBtn"\)\?\.addEventListener\("click", \(\) => openAdminPanel\(\)\);/);
  assert.match(home, /\$\("idePreviewBtn"\)\?\.addEventListener\("click", \(\) => void setPreviewAsUser\(true\)\);/);
});
