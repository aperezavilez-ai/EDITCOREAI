#!/usr/bin/env node
"use strict";

// Da (o quita con --quitar) el rol de administrador a una cuenta del servidor de cuentas de EditCoreAI.
// Se ejecuta solo en la PC del servidor: escribe directo en la base local, no hay forma de hacerlo desde la app.
// La persona debe haber iniciado sesión con Google al menos una vez.
// Uso: npm run cuentas:admin -- correo@gmail.com [--quitar]

const { execFileSync } = require("node:child_process");

const email = String(process.argv[2] || "").trim().toLowerCase();
const role = process.argv.includes("--quitar") ? "user" : "admin";
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error("Uso: npm run cuentas:admin -- correo@gmail.com [--quitar]");
  process.exit(1);
}

const sql = `insert into editcoreai.accounts (user_id, email, role)
select id, lower(email), '${role}' from auth.users where lower(email) = '${email}'
on conflict (user_id) do update set role = excluded.role, updated_at = now()
returning email || ' -> ' || role;`;

const out = execFileSync("docker", ["exec", "supabase_db_editcoreai", "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql], { encoding: "utf8" }).trim();
if (!out) {
  console.error(`No existe una cuenta con ${email}. Primero debe iniciar sesión con Google en EditCoreAI.`);
  process.exit(2);
}
console.log(out.split("\n")[0]);
