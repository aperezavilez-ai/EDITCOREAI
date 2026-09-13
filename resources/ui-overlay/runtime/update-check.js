"use strict";

const https = require("node:https");
const http = require("node:http");

/**
 * Comprobacion de actualizaciones sin electron-updater ni firma de codigo.
 * Usa GitHub Releases (gratis). Si no hay repo configurado, queda idle.
 */

function compareSemver(a = "", b = "") {
  const pa = String(a).replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((n) => Number(n) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function resolveUpdateRepo({ packageJson = {}, env = process.env } = {}) {
  const fromEnv = String(env.EDITCORE_GITHUB_REPO || env.GITHUB_REPOSITORY || "").trim();
  if (fromEnv && /^[\w.-]+\/[\w.-]+$/.test(fromEnv)) return fromEnv;
  const repo = packageJson.repository;
  if (typeof repo === "string") {
    const m = repo.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i);
    if (m) return m[1];
  }
  if (repo && typeof repo === "object" && repo.url) {
    const m = String(repo.url).match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/i);
    if (m) return m[1];
  }
  // Fallback estable del producto publicado.
  return "aperezavilez-ai/EditCore-AI";
}

function fetchJson(url, { timeoutMs = 12_000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(parsed, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "EditCore-AI-UpdateCheck",
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: res.statusCode || 0, json, text });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout comprobando actualizaciones"));
    });
    req.end();
  });
}

async function checkForUpdates({
  currentVersion = "",
  packageJson = {},
  env = process.env,
  fetchImpl = fetchJson,
} = {}) {
  const current = String(currentVersion || packageJson.version || "").trim();
  const repo = resolveUpdateRepo({ packageJson, env });
  if (!repo) {
    return {
      available: false,
      configured: false,
      idle: true,
      currentVersion: current,
      message: "Auto-update idle: define EDITCORE_GITHUB_REPO=owner/repo o repository en package.json.",
    };
  }
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`);
    if (response.status === 404) {
      return {
        available: false,
        configured: true,
        status: "noReleases",
        checkFailed: false,
        currentVersion: current,
        repo,
        message: "No hay releases publicos todavia en GitHub.",
      };
    }
    if (response.status >= 400) {
      return {
        available: false,
        configured: true,
        status: "checkFailed",
        checkFailed: true,
        currentVersion: current,
        repo,
        message: `No se pudo comprobar actualizaciones (GitHub HTTP ${response.status}).`,
      };
    }
    const release = response.json || {};
    const latest = String(release.tag_name || release.name || "").replace(/^v/i, "").trim();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const setup = assets.find((asset) => /setup.*\.exe$/i.test(asset.name || ""))
      || assets.find((asset) => /\.exe$/i.test(asset.name || ""));
    const updateAvailable = Boolean(latest && current && compareSemver(latest, current) > 0);
    return {
      available: updateAvailable,
      configured: true,
      status: updateAvailable ? "updateAvailable" : "upToDate",
      checkFailed: false,
      currentVersion: current,
      latestVersion: latest,
      repo,
      htmlUrl: release.html_url || `https://github.com/${repo}/releases/latest`,
      downloadUrl: setup?.browser_download_url || release.html_url || "",
      message: updateAvailable
        ? `Hay una version nueva: ${latest} (tienes ${current}).`
        : `Estas al dia (${current}).`,
    };
  } catch (error) {
    return {
      available: false,
      configured: true,
      status: "checkFailed",
      checkFailed: true,
      currentVersion: current,
      repo,
      message: `No se pudo comprobar actualizaciones: ${String(error?.message || error).slice(0, 240)}`,
    };
  }
}

module.exports = {
  compareSemver,
  resolveUpdateRepo,
  checkForUpdates,
};
