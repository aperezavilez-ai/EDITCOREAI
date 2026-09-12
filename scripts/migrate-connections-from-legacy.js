"use strict";

/**
 * Migra editcore-connections (y opc. providers) desde
 * %APPDATA%\EditCore AI → %APPDATA%\EDITCOREAI
 *
 * Uso (desde la raíz del repo):
 *   node scripts/migrate-connections-from-legacy.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
const ELECTRON = path.join(REPO, "node_modules", "electron", "cli.js");
const APPDATA = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
const LEGACY_DIR = path.join(APPDATA, "EditCore AI");
const TARGET_DIR = path.join(APPDATA, "EDITCOREAI");
const BRIDGE = path.join(os.tmpdir(), `editcore-conn-bridge-${process.pid}.json`);
const REPORT = path.join(os.tmpdir(), "editcore-migrate-connections.json");

function runPhase(label, userDataName, mode) {
  const script = path.join(os.tmpdir(), `editcore-migrate-${mode}-${process.pid}.js`);
  const code = `
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const APPDATA = process.env.APPDATA;
const USER_DATA = path.join(APPDATA, ${JSON.stringify(userDataName)});
const BRIDGE = ${JSON.stringify(BRIDGE)};
const REPORT = ${JSON.stringify(REPORT)};
const MODE = ${JSON.stringify(mode)};

app.setName(${JSON.stringify(userDataName === "EDITCOREAI" ? "EDITCOREAI" : "EditCore AI")});
app.setPath("userData", USER_DATA);

function readSecure(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
}

function writeSecure(filePath, value) {
  const payload = safeStorage.encryptString(JSON.stringify(value && typeof value === "object" ? value : {}));
  const tmp = filePath + "." + process.pid + ".tmp";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmp, payload, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function maskConn(c) {
  const o = c && typeof c === "object" ? c : {};
  return {
    github: Boolean(o.githubToken),
    vercel: Boolean(o.vercelToken),
    selfSupabase: Boolean(o.selfSupabaseUrl && o.selfSupabaseKey),
    selfSupabaseUrl: String(o.selfSupabaseUrl || "").slice(0, 80),
    ssh: Boolean(o.serverHost && o.serverKeyPath),
    keys: Object.keys(o),
  };
}

app.whenReady().then(() => {
  const report = { mode: MODE, userData: USER_DATA, ok: false };
  try {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage no disponible");
    const securePath = path.join(USER_DATA, "editcore-secure-config.bin");

    if (MODE === "export") {
      const secure = readSecure(securePath);
      const connections = secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
        ? secure["editcore-connections"]
        : {};
      const providers = secure["editcore-providers"] && typeof secure["editcore-providers"] === "object"
        ? secure["editcore-providers"]
        : {};
      const profiles = Array.isArray(secure["editcore-provider-profiles"])
        ? secure["editcore-provider-profiles"]
        : [];
      const chat = secure["editcore-chat-config"] && typeof secure["editcore-chat-config"] === "object"
        ? secure["editcore-chat-config"]
        : {};
      fs.writeFileSync(BRIDGE, JSON.stringify({
        connections,
        providers,
        profiles,
        chat,
        exportedAt: new Date().toISOString(),
        from: USER_DATA,
      }), { mode: 0o600 });
      report.ok = true;
      report.exported = maskConn(connections);
      report.providerKeys = Object.keys(providers);
      report.profileCount = profiles.length;
    }

    if (MODE === "import") {
      if (!fs.existsSync(BRIDGE)) throw new Error("Bridge no encontrado: " + BRIDGE);
      const bridge = JSON.parse(fs.readFileSync(BRIDGE, "utf8"));
      let secure = {};
      try { secure = readSecure(securePath); } catch (e) {
        report.decryptWarning = String(e.message || e).slice(0, 160);
        secure = {};
      }
      const prev = secure["editcore-connections"] && typeof secure["editcore-connections"] === "object"
        ? secure["editcore-connections"]
        : {};
      const incoming = bridge.connections && typeof bridge.connections === "object" ? bridge.connections : {};
      // Preferir valores legacy no vacíos; no borrar lo que ya funcione en EDITCOREAI
      const merged = { ...prev };
      for (const [k, v] of Object.entries(incoming)) {
        if (v == null || v === "") continue;
        if (!merged[k] || String(merged[k]).trim() === "") merged[k] = v;
        // Si legacy trae token y target no, o target vacío: ya cubierto.
        // Si ambos tienen, preferir legacy cuando target no estaba configurado (arriba).
        // Para migrar de verdad la bóveda vieja como fuente de verdad:
        if (["githubToken","vercelToken","selfSupabaseUrl","selfSupabaseKey","serverHost","serverKeyPath","supabaseCloudToken","supabaseOrgId","vercelTeamId","vercelOrgId","vercelProjectId"].includes(k)) {
          if (String(incoming[k] || "").trim()) merged[k] = incoming[k];
        }
      }
      // Netlify retirado
      delete merged.netlifyToken;
      delete merged.netlifySiteId;

      secure["editcore-connections"] = merged;
      if (bridge.providers && Object.keys(bridge.providers).length) {
        secure["editcore-providers"] = {
          ...(secure["editcore-providers"] || {}),
          ...bridge.providers,
        };
      }
      if (Array.isArray(bridge.profiles) && bridge.profiles.length) {
        const existing = Array.isArray(secure["editcore-provider-profiles"]) ? secure["editcore-provider-profiles"] : [];
        secure["editcore-provider-profiles"] = existing.length ? existing : bridge.profiles;
      }
      if (bridge.chat && Object.keys(bridge.chat).length) {
        secure["editcore-chat-config"] = {
          ...(secure["editcore-chat-config"] || {}),
          ...bridge.chat,
        };
      }

      // backup
      if (fs.existsSync(securePath)) {
        const bak = securePath + ".backup-pre-migrate-" + Date.now();
        fs.copyFileSync(securePath, bak);
        report.backup = bak;
      }
      writeSecure(securePath, secure);
      report.ok = true;
      report.imported = maskConn(merged);
      report.from = bridge.from;
    }

    const prevReport = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, "utf8")) : {};
    fs.writeFileSync(REPORT, JSON.stringify({ ...prevReport, [MODE]: report }, null, 2));
    console.log(JSON.stringify(report));
    app.exit(report.ok ? 0 : 2);
  } catch (error) {
    report.error = String(error.message || error).slice(0, 300);
    const prevReport = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, "utf8")) : {};
    fs.writeFileSync(REPORT, JSON.stringify({ ...prevReport, [MODE]: report }, null, 2));
    console.error(JSON.stringify(report));
    app.exit(1);
  }
}).catch((e) => {
  console.error(String(e.message || e));
  app.exit(1);
});
`;
  fs.writeFileSync(script, code, "utf8");
  console.log(`\n== ${label} (${mode}) ==`);
  const r = spawnSync(process.execPath, [ELECTRON, script], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env },
    windowsHide: true,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr.slice(0, 800));
  try { fs.unlinkSync(script); } catch { /* ignore */ }
  return r.status === 0;
}

function main() {
  if (!fs.existsSync(path.join(LEGACY_DIR, "editcore-secure-config.bin"))) {
    console.error("No existe la bóveda legacy:", path.join(LEGACY_DIR, "editcore-secure-config.bin"));
    process.exit(1);
  }
  if (!fs.existsSync(ELECTRON)) {
    console.error("No se encuentra electron:", ELECTRON);
    process.exit(1);
  }

  fs.mkdirSync(TARGET_DIR, { recursive: true });
  try { if (fs.existsSync(BRIDGE)) fs.unlinkSync(BRIDGE); } catch { /* ignore */ }
  try { if (fs.existsSync(REPORT)) fs.unlinkSync(REPORT); } catch { /* ignore */ }

  const exported = runPhase("Exportar EditCore AI", "EditCore AI", "export");
  if (!exported) {
    console.error("Fallo export desde EditCore AI");
    process.exit(1);
  }
  const imported = runPhase("Importar EDITCOREAI", "EDITCOREAI", "import");
  try { if (fs.existsSync(BRIDGE)) fs.unlinkSync(BRIDGE); } catch { /* ignore */ }

  console.log("\nREPORT:", REPORT);
  if (fs.existsSync(REPORT)) console.log(fs.readFileSync(REPORT, "utf8"));
  if (!imported) process.exit(1);
  console.log("\nOK — Reinicia EDITCOREAI y abre Conexiones (deberías ver en bóveda / verificada).");
}

main();
