#!/usr/bin/env node
"use strict";

// Da (o quita con --quitar) el rol de administrador a una cuenta del servidor de cuentas de EditCoreAI.
// Se ejecuta solo en la PC del servidor: escribe directo en la base local, no hay forma de hacerlo desde la app.
// La persona debe haber iniciado sesión con Google al menos una vez.
// Uso: npm run cuentas:admin -- correo@gmail.com [--quitar]

const path = require("node:path");
const fs = require("node:fs");
const { execFileSync, spawnSync } = require("node:child_process");

const email = String(process.argv[2] || "").trim().toLowerCase();
const role = process.argv.includes("--quitar") ? "user" : "admin";
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error("Uso: npm run cuentas:admin -- correo@gmail.com [--quitar]");
  process.exit(1);
}

function parseEnv(filePath) {
  const out = {};
  try {
    const text = fs.readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return out;
}

const localEnv = parseEnv(path.join(__dirname, "..", ".env.local"));
const dbUrl = process.env.DATABASE_URL || localEnv.DATABASE_URL || "";

const sql = `insert into editcoreai.accounts (user_id, email, role)
select id, lower(email), '${role}' from auth.users where lower(email) = '${email}'
on conflict (user_id) do update set role = excluded.role, updated_at = now()
returning email || ' -> ' || role;`;

let out = "";
if (dbUrl) {
  try {
    const psqlRes = spawnSync("psql", [dbUrl, "-tAc", sql], { encoding: "utf8", windowsHide: true });
    if (psqlRes.status === 0 && psqlRes.stdout.trim()) {
      out = psqlRes.stdout.trim();
    }
  } catch {}
}

if (!out) {
  try {
    out = execFileSync("docker", ["exec", "supabase_db_editcoreai", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
  } catch (err) {
    if (!dbUrl) {
      console.error(`Error conectando a la base de datos: ${err.message}`);
      process.exit(1);
    }
  }
}

if (!out) {
  console.error(`No existe una cuenta con ${email}. Primero debe iniciar sesión con Google en EditCoreAI.`);
  process.exit(2);
}
console.log(out.split("\n")[0]);
