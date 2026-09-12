"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * Deploy one-click usando tokens locales (Vercel/Netlify).
 * Sin APIs de pago obligatorias: usa la cuenta gratuita del usuario.
 */

function runProcess(command, args, { cwd, env, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout deploy (${timeoutMs}ms)`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code) || 0, stdout, stderr });
    });
  });
}

function detectProvider(projectRoot, requested = "") {
  const forced = String(requested || "").toLowerCase().trim();
  if (forced === "vercel" || forced === "netlify") return forced;
  if (fs.existsSync(path.join(projectRoot, "vercel.json"))) return "vercel";
  if (fs.existsSync(path.join(projectRoot, "netlify.toml"))) return "netlify";
  return "vercel";
}

async function deployOneClick(projectRoot, input = {}, { connections = {} } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) throw new Error("deploy_one_click requiere projectRoot valido.");
  const provider = detectProvider(root, input.provider);
  const production = input.production !== false;

  if (provider === "vercel") {
    const token = String(connections.vercelToken || process.env.VERCEL_TOKEN || "").trim();
    if (!token) {
      return {
        ok: false,
        available: false,
        provider,
        message: "Vercel no configurado. Anade vercelToken en Conexiones (token gratis en vercel.com/account/tokens).",
      };
    }
    const args = ["--yes"];
    if (production) args.push("--prod");
    const bin = process.platform === "win32" ? "vercel.cmd" : "vercel";
    try {
      const result = await runProcess(bin, args, {
        cwd: root,
        env: {
          VERCEL_TOKEN: token,
          VERCEL_ORG_ID: String(connections.vercelOrgId || "").trim(),
          VERCEL_PROJECT_ID: String(connections.vercelProjectId || "").trim(),
        },
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      const urlMatch = combined.match(/https:\/\/[^\s]+\.vercel\.app[^\s]*/i);
      return {
        ok: result.code === 0,
        available: true,
        provider: "vercel",
        url: urlMatch ? urlMatch[0].replace(/[).,]+$/, "") : "",
        exitCode: result.code,
        output: combined.slice(-4000),
      };
    } catch (error) {
      return {
        ok: false,
        available: true,
        provider: "vercel",
        message: String(error?.message || error).slice(0, 400),
        hint: "Instala Vercel CLI (`npm i -g vercel`) o usa el token en Conexiones.",
      };
    }
  }

  if (provider === "netlify") {
    const token = String(connections.netlifyToken || process.env.NETLIFY_AUTH_TOKEN || "").trim();
    if (!token) {
      return {
        ok: false,
        available: false,
        provider,
        message: "Netlify no configurado. Anade netlifyToken en Conexiones (token personal gratis).",
      };
    }
    const args = ["deploy"];
    if (production) args.push("--prod");
    if (connections.netlifySiteId) args.push("--site", String(connections.netlifySiteId));
    args.push("--dir", String(input.dir || "dist"));
    const bin = process.platform === "win32" ? "netlify.cmd" : "netlify";
    try {
      const result = await runProcess(bin, args, {
        cwd: root,
        env: { NETLIFY_AUTH_TOKEN: token },
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      const urlMatch = combined.match(/https:\/\/[^\s]+\.netlify\.app[^\s]*/i);
      return {
        ok: result.code === 0,
        available: true,
        provider: "netlify",
        url: urlMatch ? urlMatch[0].replace(/[).,]+$/, "") : "",
        exitCode: result.code,
        output: combined.slice(-4000),
      };
    } catch (error) {
      return {
        ok: false,
        available: true,
        provider: "netlify",
        message: String(error?.message || error).slice(0, 400),
        hint: "Instala Netlify CLI (`npm i -g netlify-cli`) o configura netlifyToken.",
      };
    }
  }

  return { ok: false, available: false, message: `Proveedor deploy desconocido: ${provider}` };
}

module.exports = { deployOneClick, detectProvider };
