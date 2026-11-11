"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function parseSshHost(hostSpec = "") {
  const raw = String(hostSpec || "").trim();
  if (!raw) return null;
  let user = "";
  let host = raw;
  let port = "22";
  if (raw.includes("@")) {
    [user, host] = raw.split("@", 2);
  }
  if (host.includes(":")) {
    const parts = host.split(":");
    host = parts[0];
    port = parts[1] || "22";
  }
  return { user: user || "root", host, port };
}

function runSsh(connections, remoteCommand, { timeoutMs = 300_000 } = {}) {
  const host = parseSshHost(connections.serverHost);
  const keyPath = String(connections.serverKeyPath || "").trim();
  if (!host || !keyPath || !fs.existsSync(keyPath)) {
    return Promise.resolve({ ok: false, message: "SSH no configurado o clave inexistente." });
  }
  const args = [
    "-i", keyPath,
    "-p", host.port,
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    `${host.user}@${host.host}`,
    remoteCommand,
  ];
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { shell: process.platform === "win32", windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, message: "SSH timeout", stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, message: error?.message || String(error), stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: Number(code) || 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        message: code === 0 ? "SSH OK" : (stderr || stdout || `SSH exit ${code}`),
      });
    });
  });
}

// [EDITCORE-INTEGRAL-B8] ssh_deploy ya no declara éxito con
// `|| true` ni sin humo. Antes el comando remoto era
// `git pull … || true` + restart `… || true` y ok salía del código
// del SSH, que el || true final forzaba a 0: deploy «OK» con el
// pull roto y sin comprobar que la app respondiera. Ahora:
//   - pull y restart se ejecutan como pasos SEPARADOS y ok sale de
//     sus resultados REALES (el restart por defecto conserva el
//     fallback systemd→pm2, pero sin el `|| true` final: el código
//     que manda es el del último gestor intentado);
//   - si el pull falla, el restart ni se intenta;
//   - con URL conocida hay HUMO HTTP (verifyProductionDeploy de
//     deploy-one-click: GET con timeout y un reintento) y ok exige
//     humo VERIFICADO: 0/5xx = caído (ok:false), 401/403/404 en la
//     ruta principal = responde pero no verificado (ok:false,
//     smokeNotVerified) — diseño declarado: en esta ruta ningún
//     éxito se declara sin comprobar;
//   - sin URL conocida el resultado lo DICE («sin humo: no hay URL»,
//     smokeSkipped, verified:false) en vez de un éxito a secas, y
//     ok:false por la misma regla.
function resolveSshSmokeUrl(projectRoot, connections = {}, options = {}) {
  const candidates = [
    options.url, options.liveUrl,
    connections.liveUrl, connections.customServerUrl, connections.serverUrl, connections.ownServerUrl, connections.appUrl,
  ];
  for (const c of candidates) {
    const v = String(c || "").trim();
    if (/^https?:\/\//i.test(v)) return v;
  }
  try {
    const infra = JSON.parse(fs.readFileSync(path.join(projectRoot, "project-infra.json"), "utf8"));
    const v = String(infra?.liveUrl || infra?.vercelUrl || "").trim();
    if (/^https?:\/\//i.test(v)) return v;
  } catch { /* sin infra: sin URL */ }
  return "";
}

async function sshDeploy(projectRoot, connections, {
  remotePath = "",
  restartCommand = "",
  url = "",
  liveUrl = "",
  deps = {},
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const name = path.basename(root);
  const target = String(remotePath || connections.serverDeployPath || `/var/www/${name}`).trim();
  const runSshImpl = typeof deps?.runSshImpl === "function" ? deps.runSshImpl : runSsh;
  const restart = String(restartCommand || "").trim()
    || "sudo systemctl restart app || pm2 restart all";
  const base = { remotePath: target, host: connections.serverHost || "" };

  const pullCmd = `mkdir -p ${target} && cd ${target} && git pull origin HEAD`;
  const pull = await runSshImpl(connections, pullCmd);
  if (!pull?.ok) {
    return {
      ...base,
      ok: false,
      verified: false,
      step: "pull",
      pull,
      restart: null,
      smoke: [],
      message: `Deploy SSH falló en el pull: ${pull?.message || pull?.stderr || pull?.stdout || "sin detalle"}`,
    };
  }
  const restartRes = await runSshImpl(connections, `cd ${target} && ${restart}`);
  if (!restartRes?.ok) {
    return {
      ...base,
      ok: false,
      verified: false,
      step: "restart",
      pull,
      restart: restartRes,
      smoke: [],
      message: `Deploy SSH: el pull fue bien pero el reinicio falló: ${restartRes?.message || restartRes?.stderr || restartRes?.stdout || "sin detalle"}`,
    };
  }

  const smokeUrl = resolveSshSmokeUrl(root, connections, { url, liveUrl });
  if (!smokeUrl) {
    return {
      ...base,
      ok: false,
      verified: false,
      smokeSkipped: true,
      pull,
      restart: restartRes,
      smoke: [],
      message: "Deploy SSH: pull y reinicio fueron bien, pero sin humo: no hay URL del proyecto para comprobar que la app responde. No se declara éxito sin comprobar.",
    };
  }
  const { verifyProductionDeploy } = require("./deploy-one-click");
  const verdict = await verifyProductionDeploy({ url: smokeUrl, provider: "", deps });
  if (verdict && verdict.ok && verdict.verified !== false) {
    return {
      ...base,
      ok: true,
      verified: true,
      pull,
      restart: restartRes,
      smoke: verdict.smoke,
      url: smokeUrl,
      message: `Deploy SSH verificado: pull + reinicio OK y la app responde en ${smokeUrl}.`,
    };
  }
  if (verdict?.smokeNotVerified) {
    return {
      ...base,
      ok: false,
      verified: false,
      smokeNotVerified: true,
      smokeCause: verdict.smokeCause || "",
      pull,
      restart: restartRes,
      smoke: verdict.smoke,
      url: smokeUrl,
      message: `Deploy SSH: pull y reinicio fueron bien, pero la publicación NO quedó verificada: ${verdict.smokeCause || "la ruta principal no devolvió la app"}.`,
    };
  }
  return {
    ...base,
    ok: false,
    verified: false,
    productionDown: true,
    pull,
    restart: restartRes,
    smoke: verdict?.smoke || [],
    url: smokeUrl,
    message: `Deploy SSH: pull y reinicio fueron bien, pero la app NO responde en ${smokeUrl} (humo: ${(verdict?.smoke || []).map((s) => `${s.url} → ${s.status || s.error || "sin respuesta"}`).join("; ") || "sin datos"}).`,
  };
}

module.exports = {
  parseSshHost,
  runSsh,
  sshDeploy,
  // [EDITCORE-INTEGRAL-B8] Costura de prueba.
  resolveSshSmokeUrl,
};
