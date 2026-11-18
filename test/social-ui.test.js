"use strict";
// Batería — UI de CONEXIONES SOCIALES en el diálogo de Conexiones:
// las tres secciones (Meta / TikTok / YouTube) existen con los
// campos data-conn EXACTOS que los clientes runtime leen de
// Conexiones, los nombres IPC coinciden entre main.js, preload.js
// y renderer.js, y los handlers de main usan los clientes runtime
// (createClientFromHelpers) en vez de duplicar llamadas HTTP.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const raizRepo = path.join(__dirname, "..");
const leerRepo = (rel) => fs.readFileSync(path.join(raizRepo, rel), "utf8");

const REDES = [
  {
    red: "meta",
    cliente: "runtime/social-meta.js",
    campos: ["metaAppId", "metaAppSecret", "metaRedirectUri"],
    secretos: ["metaAppSecret"],
  },
  {
    red: "tiktok",
    cliente: "runtime/social-tiktok.js",
    campos: ["tiktokClientKey", "tiktokClientSecret", "tiktokRedirectUri"],
    secretos: ["tiktokClientSecret"],
  },
  {
    red: "youtube",
    cliente: "runtime/social-youtube.js",
    campos: ["googleClientId", "googleClientSecret", "googleRedirectUri"],
    secretos: ["googleClientSecret"],
  },
];

test("las tres secciones sociales existen: badge, detalle, código y botones", () => {
  const html = leerRepo("index.html");
  for (const { red } of REDES) {
    assert.match(html, new RegExp(`class="conn-status" data-service="${red}"`), `badge conn-status de ${red}`);
    assert.match(html, new RegExp(`data-social-detail="${red}"`), `detalle de estado de ${red}`);
    assert.match(html, new RegExp(`data-social-code="${red}"`), `input de código de ${red}`);
    assert.match(html, new RegExp(`data-social-connect="${red}"`), `botón Conectar de ${red}`);
    assert.match(html, new RegExp(`data-social-complete="${red}"`), `botón Completar conexión de ${red}`);
    assert.match(html, new RegExp(`class="conn-error-detail" data-service="${red}"`), `detalle de error de ${red}`);
  }
});

test("los data-conn de la UI son EXACTAMENTE los que lee cada cliente runtime", () => {
  const html = leerRepo("index.html");
  for (const { cliente, campos, secretos } of REDES) {
    const srcCliente = leerRepo(cliente);
    for (const campo of campos) {
      assert.match(html, new RegExp(`data-conn="${campo}"`), `index.html ofrece data-conn="${campo}"`);
      // El cliente lo lee del objeto de Conexiones: c.<campo>
      assert.match(srcCliente, new RegExp(`c\\.${campo}\\b`), `${cliente} lee c.${campo}`);
    }
    for (const secreto of secretos) {
      assert.match(html, new RegExp(`data-conn="${secreto}" type="password"`), `${secreto} va como type="password"`);
    }
  }
});

test("los nombres IPC coinciden entre main.js, preload.js y renderer.js", () => {
  const main = leerRepo("main.js");
  const preload = leerRepo("preload.js");
  const renderer = leerRepo("renderer.js");
  for (const canal of ["social:auth-url", "social:complete", "social:status"]) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\("${canal}"`), `main.js maneja ${canal}`);
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\("${canal}"`), `preload.js invoca ${canal}`);
  }
  for (const metodo of ["socialAuthUrl", "socialComplete", "socialStatus"]) {
    assert.match(preload, new RegExp(`${metodo}:`), `preload.js expone ${metodo}`);
    assert.match(renderer, new RegExp(`editcoreConnections\\??\\.${metodo}`), `renderer.js usa ${metodo}`);
  }
  // El renderer abre la URL de autorización con el mecanismo de
  // siempre (openExternal) y guarda antes de pedirla.
  assert.match(renderer, /async function conectarSocial\(red\)/);
  assert.match(renderer, /async function completarSocial\(red\)/);
  assert.match(renderer, /renderSocialConnectionStatus/);
});

test("los handlers de main usan los clientes runtime y no duplican llamadas HTTP", () => {
  const main = leerRepo("main.js");
  assert.match(main, /require\("\.\/runtime\/social-meta"\)/);
  assert.match(main, /require\("\.\/runtime\/social-tiktok"\)/);
  assert.match(main, /require\("\.\/runtime\/social-youtube"\)/);
  assert.match(main, /createClientFromHelpers/);
  // Ningún host de las APIs sociales aparece en main.js: toda la
  // HTTP vive en los clientes runtime.
  for (const host of ["graph.facebook.com", "open.tiktokapis.com", "oauth2.googleapis.com", "accounts.google.com", "www.facebook.com"]) {
    assert.ok(!main.includes(host), `main.js no debe llamar directo a ${host}`);
  }
  // El estado que devuelve social:status se construye con las
  // vistas públicas (sin tokens) de los clientes.
  assert.match(main, /paginaPublica/);
  assert.match(main, /canalPublico/);
});
