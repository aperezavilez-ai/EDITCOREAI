#!/usr/bin/env node
"use strict";

// Arranca el servidor de cuentas de EditCoreAI (Supabase local, proyecto "editcoreai", puertos 553xx)
// con las credenciales de Google tomadas de .env.local, y luego cierra sus rutas de administración.
// Uso: npm run cuentas:start   |   npm run cuentas:restart

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { parseEnvFile } = require("../runtime/editcore-cloud-config");

const root = path.join(__dirname, "..");
const local = parseEnvFile(path.join(root, ".env.local"));
const env = { ...process.env, ...parseEnvFile(path.join(root, "supabase", ".env")) };
const LOCAL_KEYS = [
  "EDITCOREAI_GOOGLE_CLIENT_ID",
  "EDITCOREAI_GOOGLE_SECRET",
  "EDITCOREAI_MEAI_API_KEY",
  "EDITCOREAI_MP_ACCESS_TOKEN",
  "EDITCOREAI_MP_WEBHOOK_SECRET",
  "EDITCOREAI_CLOUD_PUBLIC_URL",
];
for (const key of LOCAL_KEYS) {
  if (local[key] && !env[key]) env[key] = local[key];
}
if (!env.EDITCOREAI_MP_ACCESS_TOKEN) {
  console.warn("Aviso: falta EDITCOREAI_MP_ACCESS_TOKEN en .env.local; las recargas con Mercado Pago quedan desactivadas.");
}
for (const key of ["EDITCOREAI_MP_ACCESS_TOKEN", "EDITCOREAI_MP_WEBHOOK_SECRET", "EDITCOREAI_CLOUD_PUBLIC_URL"]) {
  if (!env[key]) env[key] = "";
}
if (!env.EDITCOREAI_GOOGLE_CLIENT_ID || !env.EDITCOREAI_GOOGLE_SECRET) {
  console.warn("Aviso: faltan EDITCOREAI_GOOGLE_CLIENT_ID / EDITCOREAI_GOOGLE_SECRET en .env.local; el inicio con Google no funcionará.");
}
if (!env.EDITCOREAI_MEAI_API_KEY) {
  env.EDITCOREAI_MEAI_API_KEY = "";
  console.warn("Aviso: falta EDITCOREAI_MEAI_API_KEY en .env.local; los usuarios no podrán usar la IA (ai-proxy sin clave).");
}

const run = (args) => spawnSync("npx", ["supabase", ...args], { cwd: root, env, stdio: "inherit", shell: true });

if (process.argv.includes("--restart")) run(["stop"]);
let started = run(["start"]);
if (started.status !== 0) {
  // Studio y pg_meta (herramientas de desarrollo) a veces tardan más que el chequeo de salud
  // con la máquina cargada, y el CLI apaga todo; las cuentas no dependen de ellos.
  console.warn("Reintentando sin esperar el chequeo de salud de Studio/pg_meta…");
  started = run(["start", "--ignore-health-check"]);
}
if (started.status !== 0) process.exit(started.status || 1);

const closed = spawnSync(process.execPath, [path.join(__dirname, "supabase-cerrar-rutas-admin.js"), "supabase_kong_editcoreai"], { cwd: root, stdio: "inherit" });
process.exit(closed.status || 0);
