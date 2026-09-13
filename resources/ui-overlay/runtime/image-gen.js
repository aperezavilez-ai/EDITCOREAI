"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");

function readImageGenConfig(projectRoot) {
  const candidates = [
    path.join(String(projectRoot || ""), ".editcore", "image-gen.json"),
    path.join(String(projectRoot || ""), ".editcore", "jaaz.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!raw || raw.enabled === false) continue;
      return { file, config: raw };
    } catch {
      continue;
    }
  }
  if (process.env.EDITCORE_IMAGE_API_URL) {
    return {
      file: "env",
      config: {
        enabled: true,
        provider: process.env.EDITCORE_IMAGE_PROVIDER || "openai-compatible",
        baseUrl: process.env.EDITCORE_IMAGE_API_URL,
        apiKey: process.env.EDITCORE_IMAGE_API_KEY || "",
        model: process.env.EDITCORE_IMAGE_MODEL || "dall-e-3",
      },
    };
  }
  return { file: "", config: null };
}

function requestJson(url, { method = "POST", headers = {}, body = null, timeoutMs = 90_000 } = {}) {
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
      method,
      headers: { "content-type": "application/json", ...headers },
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
      reject(new Error("Timeout generate_image"));
    });
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

async function generateImage(projectRoot, input = {}) {
  const prompt = String(input.prompt || input.text || "").trim();
  if (!prompt) throw new Error("generate_image requiere prompt.");
  const { file, config } = readImageGenConfig(projectRoot);
  if (!config) {
    return {
      available: false,
      ok: false,
      message: "Gen de imagen no configurada. Crea .editcore/image-gen.json (OpenAI-compatible o Jaaz) o define EDITCORE_IMAGE_API_URL.",
      configHint: path.join(String(projectRoot || ""), ".editcore", "image-gen.json"),
    };
  }

  const baseUrl = String(config.baseUrl || config.url || "").replace(/\/$/, "");
  const apiKey = String(config.apiKey || "");
  const model = String(config.model || "dall-e-3");
  const provider = String(config.provider || "openai-compatible").toLowerCase();
  if (!baseUrl) {
    return { available: false, ok: false, message: "image-gen.json sin baseUrl." };
  }

  const endpoint = provider.includes("jaaz")
    ? `${baseUrl}/api/generate`
    : `${baseUrl}/images/generations`;

  const body = provider.includes("jaaz")
    ? { prompt, model, size: input.size || "1024x1024" }
    : { model, prompt, n: 1, size: input.size || "1024x1024" };

  try {
    const response = await requestJson(endpoint, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      body,
    });
    if (response.status >= 400) {
      return {
        available: true,
        ok: false,
        message: `Proveedor imagen HTTP ${response.status}: ${String(response.text || "").slice(0, 300)}`,
        configFile: file,
      };
    }

    const data = response.json?.data?.[0] || response.json?.result || response.json || {};
    const b64 = data.b64_json || data.image_base64 || "";
    const remoteUrl = data.url || data.image_url || "";
    const outDir = path.join(String(projectRoot || ""), "assets", "generated");
    fs.mkdirSync(outDir, { recursive: true });
    const name = `img-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.png`;
    const relative = path.join("assets", "generated", name).replace(/\\/g, "/");
    const absolute = path.join(outDir, name);

    if (b64) {
      fs.writeFileSync(absolute, Buffer.from(b64, "base64"));
      return { available: true, ok: true, path: relative, provider, model, prompt };
    }
    if (remoteUrl) {
      fs.writeFileSync(absolute, JSON.stringify({ url: remoteUrl, prompt, savedAt: new Date().toISOString() }, null, 2));
      return {
        available: true,
        ok: true,
        path: relative.replace(/\.png$/i, ".json"),
        url: remoteUrl,
        provider,
        model,
        prompt,
        note: "Se guardo la URL remota (el proveedor no devolvio base64).",
      };
    }
    return {
      available: true,
      ok: false,
      message: "El proveedor respondio sin imagen usable.",
      raw: String(response.text || "").slice(0, 400),
    };
  } catch (error) {
    return {
      available: true,
      ok: false,
      message: String(error?.message || error).slice(0, 400),
      configFile: file,
    };
  }
}

module.exports = { generateImage, readImageGenConfig };
