#!/usr/bin/env node
"use strict";

// Cambia las claves del servidor de cuentas de EditCoreAI (Supabase local "editcoreai") por claves
// nuevas y únicas. Solo toca este servidor: no busca ni reemplaza claves en otros proyectos ni en Vercel.
// Las claves nuevas quedan en supabase/.env, supabase/signing_keys.json y .env.local (ignorados por git).
// Respaldo previo en Z RESPALDOS; si la verificación falla, restaura todo y reinicia.
// Uso: node scripts/cuentas-rotar-claves.js

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const lib = require("./lib/supabase-keys");
const { parseEnvFile } = require("../runtime/editcore-cloud-config");

const ROOT = path.join(__dirname, "..");
const SB_DIR = path.join(ROOT, "supabase");
const FILES = {
  config: path.join(SB_DIR, "config.toml"),
  sbEnv: path.join(SB_DIR, ".env"),
  signing: path.join(SB_DIR, "signing_keys.json"),
  envLocal: path.join(ROOT, ".env.local"),
};
const LOCAL_URL = "http://127.0.0.1:55321";
const PUBLIC_URL = parseEnvFile(FILES.envLocal).EDITCOREAI_CLOUD_PUBLIC_URL || "https://api-editcoreai.gafcore.com";
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const BACKUP_DIR = path.join(ROOT, "..", "Z RESPALDOS", "editcoreai-claves", stamp);

const log = (msg) => console.log(`[cuentas-claves] ${msg}`);

function restartServer() {
  return spawnSync(process.execPath, [path.join(__dirname, "cuentas-start.js"), "--restart"], { cwd: ROOT, stdio: "inherit" }).status;
}

function statusKeys() {
  const res = spawnSync("npx", ["supabase", "status", "-o", "env"], { cwd: ROOT, encoding: "utf8", shell: true });
  return lib.parseEnvText(res.stdout || "");
}

async function httpStatus(url, key) {
  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    return res.status;
  } catch {
    return 0;
  }
}

// Con signing_keys_path, PostgREST solo recibe la clave pública ES256: anon y service_role deben ir firmadas con ella.
function signEs256Jwt(payload, signingKey) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const data = `${b64({ alg: "ES256", typ: "JWT", kid: signingKey.kid })}.${b64(payload)}`;
  const key = crypto.createPrivateKey({ key: signingKey, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" });
  return `${data}.${sig.toString("base64url")}`;
}

function withEs256RoleKeys(keys, signingKey) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 10 * 365 * 24 * 3600;
  const claims = (role) => ({ iss: "supabase", ref: "editcoreai", role, iat, exp });
  return { ...keys, ANON_KEY: signEs256Jwt(claims("anon"), signingKey), SERVICE_ROLE_KEY: signEs256Jwt(claims("service_role"), signingKey) };
}

async function diagnoseRest(keys) {
  const out = {};
  try {
    const res = await fetch(`${LOCAL_URL}/rest/v1/`, { headers: { apikey: keys.ANON_KEY, Authorization: `Bearer ${keys.ANON_KEY}` } });
    out.respuesta = (await res.text()).slice(0, 200);
    const auth = await fetch(`${LOCAL_URL}/auth/v1/settings`, { headers: { apikey: keys.ANON_KEY } });
    out.authSettings = auth.status;
  } catch (error) {
    out.error = error.message;
  }
  const inspect = spawnSync("docker", ["inspect", "supabase_rest_editcoreai"], { encoding: "utf8" });
  try {
    const env = JSON.parse(inspect.stdout)[0].Config.Env;
    const raw = (env.find((l) => l.startsWith("PGRST_JWT_SECRET=")) || "").slice("PGRST_JWT_SECRET=".length);
    const jwks = JSON.parse(raw);
    const oct = jwks.keys.find((k) => k.kty === "oct");
    out.restKeys = jwks.keys.map((k) => k.kty);
    out.octCoincideRaw = oct?.k === Buffer.from(keys.JWT_SECRET).toString("base64url");
    out.octCoincideB64 = oct?.k === keys.JWT_SECRET;
  } catch (error) {
    out.restError = error.message;
  }
  return out;
}

function backup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  for (const [name, file] of Object.entries(FILES)) {
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(BACKUP_DIR, `${name}.bak`));
  }
}

function restore() {
  for (const [name, file] of Object.entries(FILES)) {
    const saved = path.join(BACKUP_DIR, `${name}.bak`);
    if (fs.existsSync(saved)) fs.copyFileSync(saved, file);
    else fs.rmSync(file, { force: true });
  }
}

function upsertEnvFile(file, vars) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  fs.writeFileSync(file, lib.upsertEnvText(text, vars), { encoding: "utf8", mode: 0o600 });
}

async function main() {
  const oldKeys = statusKeys();
  if (!oldKeys.JWT_SECRET) throw new Error("El servidor de cuentas no está corriendo (npm run cuentas:start).");

  backup();
  log(`Respaldo en ${BACKUP_DIR}`);

  const signingKey = lib.generateSigningKey();
  const keys = withEs256RoleKeys(lib.generateKeySet({ projectRef: "editcoreai" }), signingKey);
  fs.writeFileSync(FILES.config, lib.applyAuthKeyConfig(fs.readFileSync(FILES.config, "utf8"), { signingKeysPath: "./signing_keys.json" }), "utf8");
  fs.writeFileSync(FILES.signing, JSON.stringify([signingKey], null, 2), { encoding: "utf8", mode: 0o600 });
  upsertEnvFile(FILES.sbEnv, Object.fromEntries(Object.entries(lib.CONFIG_ENV_NAMES).map(([kind, name]) => [name, keys[kind]])));
  upsertEnvFile(FILES.envLocal, {
    EDITCOREAI_CLOUD_ANON_KEY: keys.ANON_KEY,
    EDITCOREAI_SERVICE_ROLE_KEY: keys.SERVICE_ROLE_KEY,
  });

  log("Reiniciando el servidor de cuentas con las claves nuevas…");
  const started = restartServer();
  const after = statusKeys();
  const mismatched = Object.keys(keys).filter((k) => after[k] !== keys[k]);
  const applied = started === 0 && mismatched.length === 0;
  if (!applied) log(`Arranque: código ${started}; sin aplicar: ${mismatched.join(", ") || "ninguna"}`);

  let checks = {};
  if (applied) {
    for (let i = 0; i < 24; i += 1) {
      checks = {
        nuevaLocal: await httpStatus(`${LOCAL_URL}/rest/v1/`, keys.ANON_KEY),
        viejaLocal: await httpStatus(`${LOCAL_URL}/rest/v1/`, oldKeys.ANON_KEY),
        viejaSecretaPublica: await httpStatus(`${PUBLIC_URL}/auth/v1/admin/users?per_page=1`, oldKeys.SECRET_KEY),
        viejaServicioPublica: await httpStatus(`${PUBLIC_URL}/auth/v1/admin/users?per_page=1`, oldKeys.SERVICE_ROLE_KEY),
        saludPublica: await httpStatus(`${PUBLIC_URL}/auth/v1/health`, keys.ANON_KEY),
      };
      if (checks.nuevaLocal === 200 && checks.viejaLocal === 401 && checks.saludPublica === 200
        && checks.viejaSecretaPublica !== 200 && checks.viejaServicioPublica !== 200) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  log(`Verificación: ${JSON.stringify({ claves_aplicadas: applied, ...checks })}`);

  const ok = applied && checks.nuevaLocal === 200 && checks.viejaLocal === 401
    && checks.viejaSecretaPublica !== 200 && checks.viejaServicioPublica !== 200;
  if (!ok) {
    if (applied) log(`Diagnóstico: ${JSON.stringify(await diagnoseRest(keys))}`);
    log("La verificación falló: restaurando la configuración anterior…");
    restore();
    restartServer();
    process.exitCode = 1;
    return;
  }
  log("Listo: las claves de fábrica ya no sirven y las nuevas funcionan.");
}

main().catch((error) => {
  log(`Error: ${error.message}`);
  process.exitCode = 1;
});
