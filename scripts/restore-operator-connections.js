"use strict";

/**
 * Restaura GitHub (gh) + Supabase (TAXIDRIV .env) en la boveda EDITCOREAI.
 * Debe usar la misma identidad DPAPI que EDITCOREAI.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { app, safeStorage } = require("electron");

const editCoreAppData = app.getPath("appData");
app.setName("EDITCOREAI");
app.setPath("userData", path.join(editCoreAppData, "EDITCOREAI"));

const REPORT = path.join(app.getPath("temp"), "editcore-restore-connections.json");

function readEnvValues(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = String(match[2] || "").trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value.replace(/^=+/, "").trim();
  }
  return out;
}

function normalizeUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/gafcore-gateway(?:\/api(?:\/openai(?:\/v1)?)?)?$/i, "")
    .replace(/\/api\/openai\/v1$/i, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/+$/, "");
}

function readSecure(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
}

function writeSecure(filePath, value) {
  const payload = safeStorage.encryptString(JSON.stringify(value && typeof value === "object" ? value : {}));
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, payload, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

async function probe(url, headers) {
  const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(25000) });
  return { ok: response.ok, status: response.status };
}

function finish(report, code) {
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${REPORT}\n`);
  app.exit(code);
}

app.whenReady().then(async () => {
  const report = {
    ok: false,
    userData: app.getPath("userData"),
    github: { restored: false, status: 0, account: "", hadToken: false },
    supabase: { restored: false, status: 0, url: "", source: "", keyKind: "", hadKey: false },
    error: "",
  };
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage no disponible");
    const securePath = path.join(app.getPath("userData"), "editcore-secure-config.bin");
    const secure = readSecure(securePath);
    const connections = {
      ...(secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
        ? secure["editcore-connections"]
        : {}),
    };
    report.github.hadToken = Boolean(connections.githubToken);
    report.supabase.hadKey = Boolean(connections.selfSupabaseKey);
    report.supabase.url = normalizeUrl(connections.selfSupabaseUrl || "");

    // GitHub
    try {
      const ghPath = "C:\\Program Files\\GitHub CLI\\gh.exe";
      const bin = fs.existsSync(ghPath) ? ghPath : "gh";
      const token = String(execFileSync(bin, ["auth", "token"], {
        windowsHide: true,
        encoding: "utf8",
        timeout: 20000,
      })).trim();
      if (token) {
        const who = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: AbortSignal.timeout(20000),
        });
        report.github.status = who.status;
        if (who.ok) {
          const data = await who.json();
          connections.githubToken = token;
          report.github.restored = true;
          report.github.account = String(data.login || "").slice(0, 80);
        }
      }
    } catch (error) {
      report.github.error = String(error?.message || error).slice(0, 160);
    }

    // Supabase from TAXIDRIV
    const envFiles = [
      "D:\\PROGRAMAS IA\\TAXIDRIV\\.env",
      "D:\\PROGRAMAS IA\\TAXIDRIV\\.env.local",
      "D:\\PROGRAMAS IA\\TAXIDRIV\\TAXIDRIV\\.env",
    ];
    for (const filePath of envFiles) {
      const values = readEnvValues(filePath);
      const url = normalizeUrl(values.SUPABASE_URL || values.VITE_SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL || "");
      const keyKind = values.SUPABASE_SERVICE_ROLE_KEY
        ? "SERVICE_ROLE"
        : (values.SUPABASE_ANON_KEY || values.NEXT_PUBLIC_SUPABASE_ANON_KEY)
          ? "ANON"
          : (values.SUPABASE_PUBLISHABLE_KEY || values.VITE_SUPABASE_PUBLISHABLE_KEY)
            ? "PUBLISHABLE"
            : "";
      const key = values.SUPABASE_SERVICE_ROLE_KEY
        || values.SUPABASE_ANON_KEY
        || values.NEXT_PUBLIC_SUPABASE_ANON_KEY
        || values.SUPABASE_PUBLISHABLE_KEY
        || values.VITE_SUPABASE_PUBLISHABLE_KEY
        || "";
      if (!/supabase\.gafcore\.com/i.test(url) || !key) continue;
      const result = await probe(`${url}/rest/v1/`, {
        apikey: key,
        Authorization: `Bearer ${key}`,
      });
      report.supabase.status = result.status;
      report.supabase.url = url;
      report.supabase.source = filePath;
      report.supabase.keyKind = keyKind;
      if (result.ok) {
        connections.selfSupabaseUrl = url;
        connections.selfSupabaseKey = key;
        report.supabase.restored = true;
        break;
      }
    }

    secure["editcore-connections"] = connections;
    writeSecure(securePath, secure);
    const saved = readSecure(securePath)?.["editcore-connections"] || {};
    report.github.hasToken = Boolean(saved.githubToken);
    report.supabase.hasKey = Boolean(saved.selfSupabaseKey);
    report.ok = Boolean(saved.githubToken && saved.selfSupabaseKey && report.supabase.restored);
    finish(report, report.ok ? 0 : 2);
  } catch (error) {
    report.error = String(error?.message || error).slice(0, 300);
    finish(report, 1);
  }
}).catch((error) => {
  fs.writeFileSync(REPORT, JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  app.exit(1);
});
