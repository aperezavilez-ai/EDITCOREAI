"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const defaults = require("../runtime/platform-defaults");
const { resolveProjectSupabase, projectOwnedSupabaseUrl } = require("../runtime/operator-connections-context");

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-user-conn-"));
}

test("Conexiones: un usuario sin Supabase propio no recibe el servidor del administrador", () => {
  defaults.setAdminInfra(false);
  const root = tempProject();
  assert.equal(defaults.defaultSupabaseOrigin(), "");
  assert.equal(projectOwnedSupabaseUrl(root, ""), "");
  const resolved = resolveProjectSupabase(root, { selfSupabaseKey: "clave-del-usuario" });
  assert.equal(resolved.url, "");
});

test("Conexiones: el Supabase propio del usuario se respeta tal cual", () => {
  defaults.setAdminInfra(false);
  const root = tempProject();
  const resolved = resolveProjectSupabase(root, { selfSupabaseUrl: "https://db.cliente.mx", selfSupabaseKey: "k" });
  assert.equal(resolved.url, "https://db.cliente.mx");
});

test("Conexiones: el administrador conserva su servidor por defecto", () => {
  defaults.setAdminInfra(true);
  try {
    const root = tempProject();
    const url = projectOwnedSupabaseUrl(root, "");
    assert.match(url, /^https:\/\/supabase\.gafcore\.com\/ec-user-conn-/);
  } finally {
    defaults.setAdminInfra(false);
  }
});

test("Conexiones: el interruptor del administrador solo se activa con la sesión admin (no en Ver como usuario)", () => {
  const main = read("main.js");
  assert.match(main, /setAdminInfra\(access\.role === "admin" && apiKey !== CLOUD_SESSION_KEY\)/);
  assert.match(main, /setAdminInfra\(access\?\.ok === true && access\.role === "admin"\)/);
});

test("Conexiones: GitHub crea repos en la cuenta del token, sin dueño fijo", () => {
  const boot = read("runtime/project-bootstrap.js");
  assert.doesNotMatch(boot, /aperezavilez/);
  assert.match(boot, /api\.github\.com\/user"/);
});

test("Conexiones: en Ver como usuario el panel se ve vacío y no guarda ni detecta", () => {
  const r = read("renderer.js");
  assert.match(r, /const saved = preview \? \{\} : loadJson\("editcore-connections", \{\}\);/);
  assert.match(r, /async function saveConnections\(\) \{\r?\n  if \(isPreviewAsUser\(\)\)/);
  assert.match(r, /async function detectConnections\(\) \{\r?\n  if \(isPreviewAsUser\(\)\)/);
  assert.match(r, /return root && isCurrentUserAdmin\(\) \? `https:\/\/supabase\.gafcore\.com/);
});
