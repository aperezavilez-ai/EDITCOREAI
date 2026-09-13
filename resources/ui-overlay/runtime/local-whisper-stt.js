"use strict";

/**
 * Whisper local (Xenova) — runtime en resources/editcore-whisper (fuera del asar).
 */

const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");

let pipelinePromise = null;
let transcriber = null;
let loadError = "";

function whisperRoots() {
  const roots = [];
  try {
    if (typeof process.resourcesPath === "string" && process.resourcesPath) {
      roots.push(path.join(process.resourcesPath, "editcore-whisper"));
    }
  } catch (_) {}
  // Repo / desarrollo
  roots.push(path.resolve(__dirname, "..", "..", "editcore-whisper"));
  roots.push(path.resolve(__dirname, "..", "node_modules"));
  return roots;
}

function resolveTransformersEntry() {
  for (const root of whisperRoots()) {
    const candidate = path.join(root, "node_modules", "@xenova", "transformers");
    const pkg = path.join(candidate, "package.json");
    if (fs.existsSync(pkg)) return candidate;
    // root already is node_modules parent style
    const alt = path.join(root, "@xenova", "transformers", "package.json");
    if (fs.existsSync(alt)) return path.dirname(alt);
  }
  try {
    return path.dirname(require.resolve("@xenova/transformers/package.json"));
  } catch {
    return "";
  }
}

function loadTransformers() {
  const entry = resolveTransformersEntry();
  if (!entry) throw new Error("Whisper local no instalado (editcore-whisper)");
  const nodeModules = path.resolve(entry, "..", "..");
  if (!Module.globalPaths.includes(nodeModules)) {
    Module.globalPaths.push(nodeModules);
  }
  // eslint-disable-next-line import/no-dynamic-require
  return require(entry);
}

function getCacheDir(userDataPath) {
  const root = userDataPath || path.join(process.env.APPDATA || process.cwd(), "EditCore AI");
  const dir = path.join(root, "whisper-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function getTranscriber(userDataPath, onStatus) {
  if (transcriber) return transcriber;
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    try {
      if (typeof onStatus === "function") onStatus("Cargando Whisper local (1ª vez ~40MB)...");
      const { pipeline, env } = loadTransformers();
      env.allowLocalModels = true;
      env.useBrowserCache = false;
      env.cacheDir = getCacheDir(userDataPath);
      try { env.backends.onnx.wasm.numThreads = 1; } catch (_) {}

      transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", {
        quantized: true,
      });
      loadError = "";
      if (typeof onStatus === "function") onStatus("Whisper local listo");
      return transcriber;
    } catch (err) {
      loadError = String(err?.message || err);
      pipelinePromise = null;
      throw err;
    }
  })();

  return pipelinePromise;
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = (input[i0] * (1 - t)) + (input[i1] * t);
  }
  return out;
}

function int16Base64ToFloat32(base64) {
  const buf = Buffer.from(String(base64 || ""), "base64");
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    out[i] = samples[i] / 32768;
  }
  return out;
}

async function transcribePcm({
  pcm,
  sampleRate = 16000,
  userDataPath = "",
  onStatus = null,
  language = "es",
  int16Base64 = "",
} = {}) {
  let samples;
  if (int16Base64) {
    samples = int16Base64ToFloat32(int16Base64);
  } else if (pcm instanceof Float32Array) {
    samples = pcm;
  } else {
    samples = Float32Array.from(Array.isArray(pcm) ? pcm : []);
  }
  if (!samples.length) return { ok: false, error: "PCM vacío" };

  const sr = Number(sampleRate) || 16000;
  const audio = sr === 16000 ? samples : resampleLinear(samples, sr, 16000);

  try {
    const asr = await getTranscriber(userDataPath, onStatus);
    const result = await asr(audio, {
      language: language || "es",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const text = String(result?.text || "").trim();
    if (!text) return { ok: false, error: "Whisper local: vacío" };
    return { ok: true, text, backend: "whisper-local" };
  } catch (err) {
    return { ok: false, error: `Whisper local: ${err?.message || loadError || err}` };
  }
}

function isAvailable() {
  return Boolean(resolveTransformersEntry());
}

module.exports = {
  isAvailable,
  getTranscriber,
  transcribePcm,
  resampleLinear,
  getCacheDir,
  resolveTransformersEntry,
};
