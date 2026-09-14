"use strict";

/**
 * Generacion multimodal de assets (imagen / video) para el workspace activo.
 * Proveedores: OpenAI-compatible, Jaaz, Replicate (Flux / video models).
 * Destino por defecto: public/assets/
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");

const DEFAULT_IMAGE_MODEL = {
  openai: "dall-e-3",
  replicate: "black-forest-labs/flux-schnell",
  jaaz: "flux",
};

const DEFAULT_VIDEO_MODEL = {
  openai: "sora-2",
  replicate: "minimax/video-01",
  jaaz: "video",
};

function readAssetGenConfig(projectRoot, kind = "image") {
  const names = kind === "video"
    ? ["video-gen.json", "image-gen.json", "jaaz.json"]
    : ["image-gen.json", "jaaz.json", "video-gen.json"];
  const candidates = names.map((name) => path.join(String(projectRoot || ""), ".editcore", name));
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

  const envUrl = kind === "video"
    ? (process.env.EDITCORE_VIDEO_API_URL || process.env.EDITCORE_IMAGE_API_URL || process.env.REPLICATE_API_TOKEN && "https://api.replicate.com/v1")
    : (process.env.EDITCORE_IMAGE_API_URL || (process.env.REPLICATE_API_TOKEN ? "https://api.replicate.com/v1" : ""));
  const envKey = kind === "video"
    ? (process.env.EDITCORE_VIDEO_API_KEY || process.env.EDITCORE_IMAGE_API_KEY || process.env.REPLICATE_API_TOKEN || "")
    : (process.env.EDITCORE_IMAGE_API_KEY || process.env.REPLICATE_API_TOKEN || "");
  const envProvider = kind === "video"
    ? (process.env.EDITCORE_VIDEO_PROVIDER || process.env.EDITCORE_IMAGE_PROVIDER || (process.env.REPLICATE_API_TOKEN ? "replicate" : "openai-compatible"))
    : (process.env.EDITCORE_IMAGE_PROVIDER || (process.env.REPLICATE_API_TOKEN ? "replicate" : "openai-compatible"));
  const envModel = kind === "video"
    ? (process.env.EDITCORE_VIDEO_MODEL || DEFAULT_VIDEO_MODEL.replicate)
    : (process.env.EDITCORE_IMAGE_MODEL || DEFAULT_IMAGE_MODEL.openai);

  if (envUrl || process.env.REPLICATE_API_TOKEN) {
    return {
      file: "env",
      config: {
        enabled: true,
        provider: envProvider,
        baseUrl: envUrl || "https://api.replicate.com/v1",
        apiKey: envKey,
        model: envModel,
      },
    };
  }
  return { file: "", config: null };
}

/** @deprecated use readAssetGenConfig */
function readImageGenConfig(projectRoot) {
  return readAssetGenConfig(projectRoot, "image");
}

function requestJson(url, { method = "POST", headers = {}, body = null, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const payload = body == null ? null : JSON.stringify(body);
    const req = lib.request(parsed, {
      method,
      headers: {
        "content-type": "application/json",
        ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
        resolve({ status: res.statusCode || 0, json, text, headers: res.headers });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout multimodal asset request"));
    });
    if (payload != null) req.write(payload);
    req.end();
  });
}

function downloadBinary(url, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(parsed, { timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadBinary(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`Download HTTP ${res.statusCode}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout downloading asset"));
    });
  });
}

function slugifyFilename(value, fallback = "asset") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function resolveAssetsDir(projectRoot, input = {}) {
  const preferred = String(input.outputDir || input.dir || "public/assets").replace(/\\/g, "/").replace(/^\/+/, "");
  const safe = preferred.split("/").filter((part) => part && part !== "." && part !== "..");
  const relative = (safe.length ? safe : ["public", "assets"]).join("/");
  const absolute = path.join(String(projectRoot || ""), ...relative.split("/"));
  fs.mkdirSync(absolute, { recursive: true });
  return { relative, absolute };
}

function normalizeProvider(config) {
  const raw = String(config?.provider || config?.backend || "openai-compatible").toLowerCase();
  if (raw.includes("replicate") || raw.includes("flux")) return "replicate";
  if (raw.includes("jaaz")) return "jaaz";
  if (raw.includes("openai") || raw.includes("compatible")) return "openai";
  return raw || "openai";
}

async function pollReplicatePrediction(getUrl, apiKey, { timeoutMs = 180_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await requestJson(getUrl, {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        prefer: "wait",
      },
      timeoutMs: 60_000,
    });
    if (response.status >= 400) {
      throw new Error(`Replicate poll HTTP ${response.status}: ${String(response.text || "").slice(0, 240)}`);
    }
    const status = String(response.json?.status || "").toLowerCase();
    if (status === "succeeded") return response.json;
    if (status === "failed" || status === "canceled") {
      throw new Error(`Replicate prediction ${status}: ${String(response.json?.error || response.text || "").slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Replicate prediction timeout");
}

async function generateViaReplicate({ baseUrl, apiKey, model, input, kind }) {
  const root = String(baseUrl || "https://api.replicate.com/v1").replace(/\/$/, "");
  const endpoint = `${root}/predictions`;
  const body = {
    input: kind === "video"
      ? {
          prompt: input.prompt,
          ...(input.duration ? { duration: Number(input.duration) } : {}),
          ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
        }
      : {
          prompt: input.prompt,
          ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
          ...(input.size ? { size: input.size } : {}),
          num_outputs: 1,
        },
  };
  // Prefer owner/name model form; fall back to version hash when "owner/name:hash".
  if (model.includes(":")) body.version = model.split(":").pop();
  else body.model = model;

  const create = await requestJson(endpoint, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      prefer: "wait",
    },
    body,
    timeoutMs: 120_000,
  });
  if (create.status >= 400) {
    return {
      ok: false,
      message: `Replicate HTTP ${create.status}: ${String(create.text || "").slice(0, 300)}`,
    };
  }

  let prediction = create.json;
  if (prediction?.urls?.get && String(prediction.status || "").toLowerCase() !== "succeeded") {
    prediction = await pollReplicatePrediction(prediction.urls.get, apiKey);
  }
  const output = prediction?.output;
  const remoteUrl = Array.isArray(output) ? output[0] : (typeof output === "string" ? output : output?.url || "");
  return { ok: true, remoteUrl: String(remoteUrl || ""), raw: prediction };
}

async function generateViaOpenAiImages({ baseUrl, apiKey, model, input }) {
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/images/generations`;
  const response = await requestJson(endpoint, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    body: {
      model,
      prompt: input.prompt,
      n: 1,
      size: input.size || "1024x1024",
    },
  });
  if (response.status >= 400) {
    return { ok: false, message: `OpenAI image HTTP ${response.status}: ${String(response.text || "").slice(0, 300)}` };
  }
  const data = response.json?.data?.[0] || {};
  return {
    ok: true,
    b64: data.b64_json || "",
    remoteUrl: data.url || "",
  };
}

async function generateViaOpenAiVideo({ baseUrl, apiKey, model, input }) {
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/videos/generations`;
  const response = await requestJson(endpoint, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    body: {
      model,
      prompt: input.prompt,
      ...(input.size ? { size: input.size } : {}),
      ...(input.duration ? { seconds: Number(input.duration) } : {}),
    },
    timeoutMs: 180_000,
  });
  if (response.status >= 400) {
    return { ok: false, message: `OpenAI video HTTP ${response.status}: ${String(response.text || "").slice(0, 300)}` };
  }
  const data = response.json?.data?.[0] || response.json || {};
  return {
    ok: true,
    remoteUrl: data.url || data.video_url || "",
    b64: data.b64_json || data.video_base64 || "",
  };
}

async function generateViaJaaz({ baseUrl, apiKey, model, input, kind }) {
  const endpoint = `${String(baseUrl).replace(/\/$/, "")}/api/generate`;
  const response = await requestJson(endpoint, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
    body: {
      prompt: input.prompt,
      model,
      kind,
      size: input.size || (kind === "video" ? "1280x720" : "1024x1024"),
      ...(input.duration ? { duration: Number(input.duration) } : {}),
    },
    timeoutMs: 180_000,
  });
  if (response.status >= 400) {
    return { ok: false, message: `Jaaz HTTP ${response.status}: ${String(response.text || "").slice(0, 300)}` };
  }
  const data = response.json?.data?.[0] || response.json?.result || response.json || {};
  return {
    ok: true,
    b64: data.b64_json || data.image_base64 || data.video_base64 || "",
    remoteUrl: data.url || data.image_url || data.video_url || "",
  };
}

async function persistAsset(projectRoot, input, { extension, b64, remoteUrl, prompt, provider, model, kind }) {
  const { relative, absolute } = resolveAssetsDir(projectRoot, input);
  const baseName = `${kind}-${slugifyFilename(input.filename || prompt.slice(0, 40), kind)}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  let fileName = `${baseName}.${extension}`;
  let absolutePath = path.join(absolute, fileName);

  if (b64) {
    fs.writeFileSync(absolutePath, Buffer.from(b64, "base64"));
  } else if (remoteUrl) {
    try {
      const buffer = await downloadBinary(remoteUrl);
      const contentTypeGuess = remoteUrl.toLowerCase().includes(".webm") ? "webm"
        : remoteUrl.toLowerCase().includes(".jpg") || remoteUrl.toLowerCase().includes(".jpeg") ? (kind === "video" ? extension : "jpg")
          : extension;
      if (contentTypeGuess !== extension) {
        fileName = `${baseName}.${contentTypeGuess}`;
        absolutePath = path.join(absolute, fileName);
      }
      fs.writeFileSync(absolutePath, buffer);
    } catch {
      fileName = `${baseName}.json`;
      absolutePath = path.join(absolute, fileName);
      fs.writeFileSync(absolutePath, JSON.stringify({
        url: remoteUrl,
        prompt,
        provider,
        model,
        kind,
        savedAt: new Date().toISOString(),
      }, null, 2));
      return {
        available: true,
        ok: true,
        path: `${relative}/${fileName}`.replace(/\\/g, "/"),
        url: remoteUrl,
        provider,
        model,
        prompt,
        kind,
        note: "Se guardo la URL remota (descarga binaria no disponible).",
      };
    }
  } else {
    return {
      available: true,
      ok: false,
      message: "El proveedor respondio sin asset usable.",
    };
  }

  return {
    available: true,
    ok: true,
    path: `${relative}/${fileName}`.replace(/\\/g, "/"),
    absolutePath,
    provider,
    model,
    prompt,
    kind,
  };
}

async function generateImage(projectRoot, input = {}) {
  const prompt = String(input.prompt || input.text || "").trim();
  if (!prompt) throw new Error("generate_image requiere prompt.");
  const { file, config } = readAssetGenConfig(projectRoot, "image");
  if (!config) {
    return {
      available: false,
      ok: false,
      message: "Gen de imagen no configurada. Crea .editcore/image-gen.json (OpenAI, Replicate/Flux o Jaaz) o define EDITCORE_IMAGE_API_URL / REPLICATE_API_TOKEN.",
      configHint: path.join(String(projectRoot || ""), ".editcore", "image-gen.json"),
    };
  }

  const provider = normalizeProvider(config);
  const baseUrl = String(config.baseUrl || config.url || (provider === "replicate" ? "https://api.replicate.com/v1" : "")).replace(/\/$/, "");
  const apiKey = String(config.apiKey || config.token || "");
  const model = String(input.model || config.model || DEFAULT_IMAGE_MODEL[provider] || DEFAULT_IMAGE_MODEL.openai);
  if (!baseUrl && provider !== "replicate") {
    return { available: false, ok: false, message: "image-gen.json sin baseUrl." };
  }

  try {
    let result;
    if (provider === "replicate") {
      result = await generateViaReplicate({
        baseUrl: baseUrl || "https://api.replicate.com/v1",
        apiKey,
        model,
        input: { ...input, prompt },
        kind: "image",
      });
    } else if (provider === "jaaz") {
      result = await generateViaJaaz({ baseUrl, apiKey, model, input: { ...input, prompt }, kind: "image" });
    } else {
      result = await generateViaOpenAiImages({ baseUrl, apiKey, model, input: { ...input, prompt } });
    }
    if (!result.ok) {
      return { available: true, ok: false, message: result.message, configFile: file, provider, model };
    }
    const saved = await persistAsset(projectRoot, input, {
      extension: "png",
      b64: result.b64 || "",
      remoteUrl: result.remoteUrl || "",
      prompt,
      provider,
      model,
      kind: "image",
    });
    return { ...saved, configFile: file };
  } catch (error) {
    return {
      available: true,
      ok: false,
      message: String(error?.message || error).slice(0, 400),
      configFile: file,
      provider,
      model,
    };
  }
}

async function generateVideo(projectRoot, input = {}) {
  const prompt = String(input.prompt || input.text || "").trim();
  if (!prompt) throw new Error("generate_video requiere prompt.");
  const { file, config } = readAssetGenConfig(projectRoot, "video");
  if (!config) {
    return {
      available: false,
      ok: false,
      message: "Gen de video no configurada. Crea .editcore/video-gen.json o image-gen.json (Replicate/OpenAI) o define EDITCORE_VIDEO_API_URL / REPLICATE_API_TOKEN.",
      configHint: path.join(String(projectRoot || ""), ".editcore", "video-gen.json"),
    };
  }

  const provider = normalizeProvider(config);
  const baseUrl = String(config.baseUrl || config.url || (provider === "replicate" ? "https://api.replicate.com/v1" : "")).replace(/\/$/, "");
  const apiKey = String(config.apiKey || config.token || "");
  const model = String(input.model || config.videoModel || config.model || DEFAULT_VIDEO_MODEL[provider] || DEFAULT_VIDEO_MODEL.replicate);
  if (!baseUrl && provider !== "replicate") {
    return { available: false, ok: false, message: "video-gen/image-gen sin baseUrl." };
  }

  try {
    let result;
    if (provider === "replicate") {
      result = await generateViaReplicate({
        baseUrl: baseUrl || "https://api.replicate.com/v1",
        apiKey,
        model,
        input: { ...input, prompt },
        kind: "video",
      });
    } else if (provider === "jaaz") {
      result = await generateViaJaaz({ baseUrl, apiKey, model, input: { ...input, prompt }, kind: "video" });
    } else {
      result = await generateViaOpenAiVideo({ baseUrl, apiKey, model, input: { ...input, prompt } });
    }
    if (!result.ok) {
      return { available: true, ok: false, message: result.message, configFile: file, provider, model };
    }
    const saved = await persistAsset(projectRoot, input, {
      extension: "mp4",
      b64: result.b64 || "",
      remoteUrl: result.remoteUrl || "",
      prompt,
      provider,
      model,
      kind: "video",
    });
    return { ...saved, configFile: file };
  } catch (error) {
    return {
      available: true,
      ok: false,
      message: String(error?.message || error).slice(0, 400),
      configFile: file,
      provider,
      model,
    };
  }
}

function registerMultimodalAssetTools(dispatcher, { rootPath, canWrite = false } = {}) {
  if (!dispatcher || !rootPath || !canWrite) return dispatcher;
  dispatcher.register({
    name: "generate_image",
    write: true,
    timeoutMs: 180_000,
    description: "Genera una imagen (OpenAI-compatible, Replicate/Flux o Jaaz) y la guarda en public/assets/ del workspace activo.",
    schema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        size: { type: "string" },
        model: { type: "string" },
        filename: { type: "string" },
        outputDir: { type: "string", description: "Relativo al proyecto; default public/assets" },
        aspectRatio: { type: "string" },
      },
      required: ["prompt"],
    },
    execute: async (toolInput = {}) => generateImage(rootPath, toolInput),
  });
  dispatcher.register({
    name: "generate_video",
    write: true,
    timeoutMs: 240_000,
    description: "Genera un video corto (Replicate u OpenAI-compatible) y lo guarda en public/assets/ del workspace activo.",
    schema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        model: { type: "string" },
        duration: { type: "number" },
        size: { type: "string" },
        filename: { type: "string" },
        outputDir: { type: "string" },
        aspectRatio: { type: "string" },
      },
      required: ["prompt"],
    },
    execute: async (toolInput = {}) => generateVideo(rootPath, toolInput),
  });
  return dispatcher;
}

module.exports = {
  generateImage,
  generateVideo,
  readImageGenConfig,
  readAssetGenConfig,
  registerMultimodalAssetTools,
  resolveAssetsDir,
};
