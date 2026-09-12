"use strict";

/**
 * EDITCOREAI: 20 modelos DIRECTOS (7 MEAI + 13 APICREDITS). Sin GafCore Gateway.
 * Escribe reporte en scripts/_direct-20-report.json (sin secretos).
 */
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const USER = path.join(process.env.APPDATA || "", "EDITCOREAI");
const SECURE = path.join(USER, "editcore-secure-config.bin");
const OLD_SECURE = path.join(process.env.APPDATA || "", "EditCore AI", "editcore-secure-config.bin");
const TOOLS = "D:\\PROGRAMAS IA\\GAFCORE GATEWAY\\tools";
const REPORT = path.join(__dirname, "_direct-20-report.json");

function bootLog(msg) {
  try {
    fs.appendFileSync(path.join(__dirname, "_direct-20-boot.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {}
}
bootLog("script-loaded");

const MEAI_MODELS = [
  "claude-sonnet-4.6",
  "claude-haiku-4-5",
  "claude-opus-4.8",
  "qwen3.6-plus",
  "glm-5",
  "deepseek-v4-pro",
  "kimi-k2.6",
];

const APICREDITS_MODELS = [
  "claude-fable-5",
  "claude-haiku-4-5",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gemini-2.5-flash",
  "grok-4.3",
  "grok-4.5",
  "deepseek-v4-pro",
];

try { app.setName("EDITCOREAI"); } catch {}
try { app.setPath("userData", USER); } catch {}

function readKeys(file) {
  try {
    const out = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

function isKey(v) {
  const k = String(v || "").trim();
  return k.startsWith("sk-") || k.startsWith("sk-ant-");
}

function mask(v) {
  const k = String(v || "");
  return k.length < 10 ? "(none)" : `${k.slice(0, 6)}…${k.slice(-4)}`;
}

function decrypt(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
}

function writeSecure(state) {
  fs.mkdirSync(USER, { recursive: true });
  const tmp = `${SECURE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(state)));
  fs.renameSync(tmp, SECURE);
}

function apicreditsKeyForModel(model, keys) {
  const m = String(model || "").toLowerCase();
  if (m.startsWith("gpt-")) return keys.gpt || keys.apicredits || keys.claude_default || "";
  if (m.startsWith("gemini-")) return keys.gemini || keys.apicredits || "";
  if (m.startsWith("grok-")) return keys.grok || keys.apicredits || "";
  if (m.startsWith("deepseek-")) return keys.deepseek || keys.apicredits || "";
  if (m.startsWith("glm")) return keys.glm || keys.apicredits || "";
  return keys.claude || keys.claude_default || keys.apicredits || "";
}

function requestJson(url, { method = "GET", headers = {}, body = null, timeoutMs = 35000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method,
      headers,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = { raw: raw.slice(0, 180) }; }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (body) req.write(body);
    req.end();
  });
}

async function chatTest(baseUrl, apiKey, model) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "Responde solo: OK" }],
    max_tokens: 64,
    temperature: 0,
  });
  const res = await requestJson(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
  const c0 = res.json?.choices?.[0] || {};
  const msg = c0.message || {};
  const content = [
    msg.content,
    Array.isArray(msg.content) ? msg.content.map((p) => p?.text || p?.content || "").join("") : "",
    c0.text,
    msg.reasoning_content,
    msg.reasoning,
    res.json?.output_text,
  ].map((p) => String(p || "").trim()).find(Boolean) || "";
  const err = res.json?.error?.message || res.json?.message || "";
  const okHttp = res.status >= 200 && res.status < 300;
  return {
    status: res.status,
    ok: okHttp && (Boolean(content) || Boolean(c0.finish_reason)),
    snippet: String(content).trim().slice(0, 32),
    error: String(err || "").slice(0, 120),
  };
}

function saveReport(report) {
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

app.whenReady().then(async () => {
  const report = {
    ok: false,
    mode: "direct-only",
    expected: { meai: 7, apicredits: 13, total: 20 },
    meai: [],
    apicredits: [],
    summary: { meaiOk: 0, apicreditsOk: 0, totalOk: 0 },
    preferred: null,
    errors: [],
  };

  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage unavailable");

    let secure = {};
    try { secure = decrypt(SECURE) || {}; } catch (e) { report.errors.push(`newVault:${e.message}`); }
    try {
      const old = decrypt(OLD_SECURE);
      if (old) {
        secure = {
          ...old,
          ...secure,
          "editcore-providers": {
            ...(old["editcore-providers"] || {}),
            ...(secure["editcore-providers"] || {}),
          },
        };
      }
    } catch (e) {
      report.errors.push(`oldVault:${e.message}`);
    }

    const meaiKeys = readKeys(path.join(TOOLS, ".meai-keys.local"));
    const apicreditsKeys = readKeys(path.join(TOOLS, ".apicredits-keys.local"));
    const providers = {};
    const profiles = [];

    // ---- 7 MEAI (key por modelo) ----
    for (const model of MEAI_MODELS) {
      const apiKey = String(meaiKeys[model] || "").trim();
      const row = {
        provider: "meai",
        model,
        key: mask(apiKey),
        hasKey: isKey(apiKey),
        ok: false,
        status: 0,
        error: "",
      };
      if (!isKey(apiKey)) {
        row.error = "missing key";
        report.meai.push(row);
        continue;
      }
      const chat = await chatTest("https://api.meai.cloud/v1", apiKey, model);
      row.ok = chat.ok;
      row.status = chat.status;
      row.error = chat.error;
      row.snippet = chat.snippet;
      report.meai.push(row);
      if (chat.ok) {
        providers.meai = providers.meai || {
          baseUrl: "https://api.meai.cloud/v1",
          apiKey,
          label: "ME AI Cloud",
        };
        profiles.push({
          id: `meai:${model}`,
          providerKey: "meai",
          providerName: "ME AI Cloud",
          baseUrl: "https://api.meai.cloud/v1",
          apiKey,
          model,
          status: "active",
          catalogConfirmed: true,
          chatVerified: true,
          checkedAt: Date.now(),
          error: "",
        });
      }
    }

    // ---- 13 APICREDITS (key por familia) ----
    for (const model of APICREDITS_MODELS) {
      const apiKey = String(apicreditsKeyForModel(model, apicreditsKeys) || "").trim();
      const row = {
        provider: "apicredits",
        model,
        key: mask(apiKey),
        hasKey: isKey(apiKey),
        ok: false,
        status: 0,
        error: "",
      };
      if (!isKey(apiKey)) {
        row.error = "missing key";
        report.apicredits.push(row);
        continue;
      }
      const chat = await chatTest("https://api.apicredits.site/v1", apiKey, model);
      row.ok = chat.ok;
      row.status = chat.status;
      row.error = chat.error;
      row.snippet = chat.snippet;
      report.apicredits.push(row);
      // Keep profile even if one model fails transiently, but mark verified only if ok
      providers.apicredits = providers.apicredits || {
        baseUrl: "https://api.apicredits.site/v1",
        apiKey: String(apicreditsKeys.claude || apicreditsKeys.claude_default || apiKey).trim(),
        label: "APICredits",
      };
      profiles.push({
        id: `apicredits:${model}`,
        providerKey: "apicredits",
        providerName: "APICredits",
        baseUrl: "https://api.apicredits.site/v1",
        apiKey,
        model,
        status: chat.ok ? "active" : "error",
        catalogConfirmed: true,
        chatVerified: Boolean(chat.ok),
        checkedAt: Date.now(),
        error: chat.ok ? "" : (chat.error || `HTTP ${chat.status}`),
      });
    }

    report.summary.meaiOk = report.meai.filter((r) => r.ok).length;
    report.summary.apicreditsOk = report.apicredits.filter((r) => r.ok).length;
    report.summary.totalOk = report.summary.meaiOk + report.summary.apicreditsOk;

    const preferred =
      profiles.find((p) => p.providerKey === "apicredits" && p.chatVerified && p.model === "claude-fable-5")
      || profiles.find((p) => p.providerKey === "meai" && p.chatVerified && p.model === "claude-sonnet-4.6")
      || profiles.find((p) => p.chatVerified)
      || profiles[0];

    // Persist DIRECT only — purge gateway / aiapiflow
    secure["editcore-providers"] = {
      ...(providers.meai ? { meai: providers.meai } : {}),
      ...(providers.apicredits ? { apicredits: providers.apicredits } : {}),
    };
    secure["editcore-provider-profiles"] = profiles;
    secure["editcore-custom-providers"] = [];
    if (preferred) {
      secure["editcore-chat-config"] = {
        providerKey: preferred.providerKey,
        provider: preferred.providerKey,
        providerName: preferred.providerName,
        baseUrl: preferred.baseUrl,
        apiKey: preferred.apiKey,
        model: preferred.model,
        modelSelectionAuto: false,
      };
    }
    // Ensure no gateway private link stays active in this app profile
    try {
      const gwFile = path.join(USER, "editcore-gafcore-projects.bin");
      if (fs.existsSync(gwFile)) fs.renameSync(gwFile, `${gwFile}.disabled`);
    } catch {}

    writeSecure(secure);
    report.preferred = preferred
      ? { providerKey: preferred.providerKey, model: preferred.model }
      : null;
    report.ok = report.summary.meaiOk === 7 && report.summary.apicreditsOk === 13;
    report.profileCount = profiles.length;

    saveReport(report);
    app.exit(report.ok ? 0 : 2);
  } catch (error) {
    report.errors.push(String(error?.message || error));
    saveReport(report);
    app.exit(1);
  }
});
