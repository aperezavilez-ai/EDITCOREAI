"use strict";

/**
 * Importa Supabase GafCore (URL + SERVICE_ROLE) desde TAXIDRIV/.env
 * hacia editcore-secure-config.bin. No imprime secretos.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

const ENV_CANDIDATES = [
  "D:\\PROGRAMAS IA\\TAXIDRIV\\.env",
  "D:\\PROGRAMAS IA\\TAXIDRIV\\.env.local",
  "D:\\PROGRAMAS IA\\TAXIDRIV\\TAXIDRIV\\.env",
];

function readEnvValues(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = String(match[2] || "").trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Algunos .env tienen SUPABASE_URL==https://...
    value = value.replace(/^=+/, "").trim();
    out[match[1]] = value;
  }
  return out;
}

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/gafcore-gateway(?:\/api(?:\/openai(?:\/v1)?)?)?$/i, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/+$/, "");
}

function readSecure(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const payload = fs.readFileSync(filePath);
  return JSON.parse(safeStorage.decryptString(payload));
}

function writeSecure(filePath, value) {
  const payload = safeStorage.encryptString(JSON.stringify(value && typeof value === "object" ? value : {}));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, payload, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

async function probeSupabase(url, key) {
  const response = await fetch(`${url}/rest/v1/`, {
    method: "GET",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, bodyPreview: String(text || "").slice(0, 80) };
}

app.whenReady().then(async () => {
  const report = {
    ok: false,
    source: "",
    url: "",
    keyKind: "",
    validateStatus: 0,
    error: "",
  };
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("safeStorage no disponible");
    }

    let values = {};
    let source = "";
    for (const filePath of ENV_CANDIDATES) {
      const next = readEnvValues(filePath);
      const url = normalizeUrl(
        next.SUPABASE_URL || next.VITE_SUPABASE_URL || next.NEXT_PUBLIC_SUPABASE_URL || "",
      );
      const key = next.SUPABASE_SERVICE_ROLE_KEY
        || next.SUPABASE_ANON_KEY
        || next.SUPABASE_PUBLISHABLE_KEY
        || next.VITE_SUPABASE_PUBLISHABLE_KEY
        || next.NEXT_PUBLIC_SUPABASE_ANON_KEY
        || "";
      if (/supabase\.gafcore\.com/i.test(url) && key) {
        values = next;
        source = filePath;
        break;
      }
    }
    if (!source) throw new Error("No encontre SUPABASE_URL/KEY en TAXIDRIV .env");

    const url = normalizeUrl(
      values.SUPABASE_URL || values.VITE_SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL || "",
    );
    const keyKind = values.SUPABASE_SERVICE_ROLE_KEY
      ? "SERVICE_ROLE"
      : values.SUPABASE_ANON_KEY || values.NEXT_PUBLIC_SUPABASE_ANON_KEY
        ? "ANON"
        : "PUBLISHABLE";
    const key = values.SUPABASE_SERVICE_ROLE_KEY
      || values.SUPABASE_ANON_KEY
      || values.SUPABASE_PUBLISHABLE_KEY
      || values.VITE_SUPABASE_PUBLISHABLE_KEY
      || values.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    report.source = source;
    report.url = url;
    report.keyKind = keyKind;

    const probe = await probeSupabase(url, key);
    report.validateStatus = probe.status;
    if (!probe.ok) {
      throw new Error(`Probe fallo HTTP ${probe.status}`);
    }

    const userData = path.join(app.getPath("appData"), "EDITCOREAI");
    const securePath = path.join(userData, "editcore-secure-config.bin");
    const secure = readSecure(securePath);
    const connections = {
      ...(secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
        ? secure["editcore-connections"]
        : {}),
      selfSupabaseUrl: url,
      selfSupabaseKey: key,
    };
    secure["editcore-connections"] = connections;
    writeSecure(securePath, secure);

    // Re-leer y verificar que quedo configurado (sin leer el valor).
    const saved = readSecure(securePath)?.["editcore-connections"] || {};
    const savedUrl = normalizeUrl(saved.selfSupabaseUrl || "");
    const savedKeyLen = String(saved.selfSupabaseKey || "").length;
    report.ok = savedUrl === url && savedKeyLen === String(key).length && savedKeyLen > 20;
    if (!report.ok) throw new Error("Se escribio el secure-config pero la verificacion de longitud fallo");
    console.log(JSON.stringify(report, null, 2));
    app.exit(0);
  } catch (error) {
    report.error = String(error?.message || error).slice(0, 300);
    console.log(JSON.stringify(report, null, 2));
    app.exit(1);
  }
}).catch((error) => {
  console.error(String(error?.message || error));
  app.exit(1);
});
