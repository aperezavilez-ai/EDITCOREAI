#!/usr/bin/env node
"use strict";

// Normalmente la web se publica sola al subir a main (Vercel corre scripts/write-web-config.js con sus
// variables de entorno). Este script es la vía manual:
// publica web-portal (www.editcore.mx) en el proyecto Vercel "editcoreai" desde una copia temporal:
// genera ahí js/cuentas-config.js con la dirección pública del servidor de cuentas y su clave anon
// (de .env.local; ese archivo nunca entra en git) y vincula la copia, nunca la raíz del repo.
// Uso: node scripts/deploy-web.js [--prepare-only]

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseEnvFile } = require("../runtime/editcore-cloud-config");
const { cuentasConfigJs, writeWebConfig } = require("./write-web-config");

const VERCEL_PROJECT = "editcoreai";

function prepare(repoRoot, outDir, env) {
  fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.cpSync(path.join(repoRoot, "web-portal"), outDir, {
    recursive: true,
    filter: (src) => !/[\\/](\.vercel|node_modules|\.git)([\\/]|$)/.test(path.relative(repoRoot, src)),
  });
  writeWebConfig(outDir, env);
  return outDir;
}

function vercel(args, cwd) {
  const res = spawnSync("vercel", args, { cwd, stdio: "inherit", shell: true });
  if (res.status !== 0) throw new Error(`vercel ${args[0]} falló (código ${res.status})`);
}

function main() {
  const repoRoot = path.join(__dirname, "..");
  const env = { ...parseEnvFile(path.join(repoRoot, ".env.local")), ...process.env };
  const outDir = prepare(repoRoot, path.join(os.tmpdir(), "ec-web-deploy"), env);
  console.log(`Copia lista en ${outDir}`);
  if (process.argv.includes("--prepare-only")) return;
  vercel(["link", "--yes", "--project", VERCEL_PROJECT], outDir);
  vercel(["deploy", "--prod", "--yes"], outDir);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { cuentasConfigJs, prepare };
