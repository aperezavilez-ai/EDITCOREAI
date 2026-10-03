#!/usr/bin/env node
"use strict";

// Genera runtime/editcore-cloud.generated.json (ignorado por git) para el EXE empaquetado
// con la dirección pública del servidor de cuentas y su clave anon, tomadas de .env.local.
// Uso: node scripts/write-cloud-config.js [carpeta_destino_de_la_app]

const fs = require("node:fs");
const path = require("node:path");
const { parseEnvFile, looksLikeServiceRole } = require("../runtime/editcore-cloud-config");

function main() {
  const repoRoot = path.join(__dirname, "..");
  const targetRoot = path.resolve(process.argv[2] || repoRoot);
  const env = { ...parseEnvFile(path.join(repoRoot, ".env.local")), ...process.env };
  const url = String(env.EDITCOREAI_CLOUD_PUBLIC_URL || "").replace(/\/+$/, "");
  const anonKey = String(env.EDITCOREAI_CLOUD_ANON_KEY || "").trim();
  if (!/^https:\/\//.test(url)) throw new Error("Falta EDITCOREAI_CLOUD_PUBLIC_URL (https) en .env.local");
  if (!anonKey) throw new Error("Falta EDITCOREAI_CLOUD_ANON_KEY en .env.local");
  if (looksLikeServiceRole(anonKey)) throw new Error("EDITCOREAI_CLOUD_ANON_KEY es una service_role: no se empaqueta");
  const out = path.join(targetRoot, "runtime", "editcore-cloud.generated.json");
  fs.writeFileSync(out, JSON.stringify({ url, anonKey }, null, 2) + "\n", "utf8");
  console.log(`Config de cuentas escrita en ${out} (${url})`);
}

main();
