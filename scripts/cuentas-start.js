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
const env = { ...process.env };
for (const key of ["EDITCOREAI_GOOGLE_CLIENT_ID", "EDITCOREAI_GOOGLE_SECRET"]) {
  if (local[key] && !env[key]) env[key] = local[key];
}
if (!env.EDITCOREAI_GOOGLE_CLIENT_ID || !env.EDITCOREAI_GOOGLE_SECRET) {
  console.warn("Aviso: faltan EDITCOREAI_GOOGLE_CLIENT_ID / EDITCOREAI_GOOGLE_SECRET en .env.local; el inicio con Google no funcionará.");
}

const run = (args) => spawnSync("npx", ["supabase", ...args], { cwd: root, env, stdio: "inherit", shell: true });

if (process.argv.includes("--restart")) run(["stop"]);
const started = run(["start"]);
if (started.status !== 0) process.exit(started.status || 1);

const closed = spawnSync(process.execPath, [path.join(__dirname, "supabase-cerrar-rutas-admin.js"), "supabase_kong_editcoreai"], { cwd: root, stdio: "inherit" });
process.exit(closed.status || 0);
