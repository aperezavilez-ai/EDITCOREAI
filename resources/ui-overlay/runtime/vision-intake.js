"use strict";

/**
 * Vision intake: normalize pasted/uploaded images and format provider payloads.
 */

const VISION_MODEL_PATTERN = /vision|claude|gpt-4o|gpt-4\.1|gpt-5|o4-mini|gemini|llava|qwen-vl|qwen2\.5-vl|moonshot|kimi|haiku|sonnet|opus|pixtral|mistral-large|yi-vl|deepseek-vl|internvl|minicpm-v|fable/i;

const VISION_ACK_RULE = [
  "## VISION OBLIGATORIA (imagen adjunta)",
  "- Hay una o mas imagenes en el mensaje del usuario (payload multimodal).",
  "- PROHIBIDO responder que no ves la imagen, que no hay adjunto, o pedir que la suba otra vez.",
  "- PROHIBIDO responder en silencio o ignorar la imagen.",
  "- En la PRIMERA respuesta analiza la imagen: layout, UI, bugs visuales, texto legible, inconsistencias.",
  "- Si parece captura de bug/UI (Vite overlay, stack, consola): identifica archivo/linea/error y propone correccion concreta.",
  "- Si es mock/diseno: resume estructura y siguiente paso de implementacion.",
].join("\n");

function sniffMimeFromDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
  return match ? match[1].toLowerCase() : "";
}

function normalizeImages(images = []) {
  if (!Array.isArray(images)) return [];
  const out = [];
  for (const image of images.slice(0, 8)) {
    let dataUrl = String(image?.dataUrl || image?.url || "").trim();
    if (!dataUrl) continue;
    if (!/^data:/i.test(dataUrl) && /^[A-Za-z0-9+/=\r\n]+$/.test(dataUrl.slice(0, 80))) {
      dataUrl = `data:image/png;base64,${dataUrl.replace(/\s+/g, "")}`;
    }
    let mimeType = String(image?.mimeType || sniffMimeFromDataUrl(dataUrl) || "").toLowerCase();
    if (mimeType === "image/jpg") mimeType = "image/jpeg";
    if (!mimeType && /^data:image\//i.test(dataUrl)) mimeType = sniffMimeFromDataUrl(dataUrl);
    if (!/^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.test(dataUrl)) continue;
    // Normalize gif/bmp stay as-is for OpenAI-compatible; Anthropic prefers png/jpeg/webp
    out.push({
      name: String(image?.name || `image-${out.length + 1}`).slice(0, 120),
      mimeType: mimeType || sniffMimeFromDataUrl(dataUrl) || "image/png",
      dataUrl,
    });
  }
  return out;
}

function modelSupportsVision(model = "") {
  return VISION_MODEL_PATTERN.test(String(model || ""));
}

function buildOpenAiImageContent(prompt = "", images = []) {
  const normalized = normalizeImages(images);
  const parts = [];
  const text = String(prompt || "").trim() || (normalized.length ? "Analiza la imagen adjunta." : "");
  if (text) parts.push({ type: "text", text });
  for (const image of normalized) {
    parts.push({
      type: "image_url",
      image_url: { url: image.dataUrl },
    });
  }
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}

function splitDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), data: match[2].replace(/\s+/g, "") };
}

function convertContentPartForAnthropic(part) {
  if (!part || typeof part !== "object") return part;
  if (part.type === "text") return { type: "text", text: String(part.text || "") };
  if (part.type === "image_url") {
    const url = part.image_url?.url || part.url || "";
    const split = splitDataUrl(url);
    if (!split) return { type: "text", text: "[imagen adjunta no convertible]" };
    let mediaType = split.mimeType;
    if (mediaType === "image/jpg") mediaType = "image/jpeg";
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(mediaType)) mediaType = "image/png";
    return {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: split.data },
    };
  }
  return part;
}

function convertContentPartForGemini(part) {
  if (!part || typeof part !== "object") return null;
  if (part.type === "text") return { text: String(part.text || "") };
  if (part.type === "image_url") {
    const split = splitDataUrl(part.image_url?.url || part.url || "");
    if (!split) return { text: "[imagen adjunta no convertible]" };
    return { inlineData: { mimeType: split.mimeType, data: split.data } };
  }
  if (part.text) return { text: String(part.text) };
  if (part.inlineData) return part;
  return null;
}

function rewriteMessagesForProvider(messages = [], kind = "openai-compatible") {
  if (kind === "openai-compatible" || kind === "ollama") return messages;
  return messages.map((msg) => {
    if (!Array.isArray(msg?.content)) return msg;
    if (kind === "anthropic") {
      return { ...msg, content: msg.content.map(convertContentPartForAnthropic) };
    }
    if (kind === "gemini") {
      // Gemini path uses normalizeForGemini separately; keep OpenAI shape here
      // and let normalizeForGemini call convertContentPartForGemini.
      return msg;
    }
    return msg;
  });
}

function pickVisionModelCandidate(candidates = [], currentModel = "") {
  const list = Array.isArray(candidates) ? candidates : [];
  const scored = list
    .map((item) => {
      const model = String(item?.model || item || "");
      let score = 0;
      if (/gemini-2\.5-flash|gemini-2\.0-flash|gpt-4o|claude-sonnet-4|claude-3-5-sonnet|claude-opus/i.test(model)) score += 40;
      if (modelSupportsVision(model)) score += 20;
      if (model === currentModel) score += 5;
      return { item, model, score };
    })
    .filter((row) => row.score > 0 && modelSupportsVision(row.model))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.item || null;
}

function ensureVisionRoute({ model, images, candidates = [] } = {}) {
  const normalized = normalizeImages(images);
  if (!normalized.length) {
    return { model, images: [], routed: false, reason: "no-images" };
  }
  if (modelSupportsVision(model)) {
    return { model, images: normalized, routed: false, reason: "already-vision" };
  }
  const pick = pickVisionModelCandidate(candidates, model);
  if (pick?.model) {
    return {
      model: String(pick.model),
      apiKey: pick.apiKey,
      baseUrl: pick.baseUrl,
      providerKey: pick.providerKey,
      images: normalized,
      routed: true,
      reason: `auto-route:${model}->${pick.model}`,
      previousModel: model,
    };
  }
  return {
    model,
    images: normalized,
    routed: false,
    reason: "no-vision-candidate",
    keepImages: true,
  };
}

module.exports = {
  VISION_MODEL_PATTERN,
  VISION_ACK_RULE,
  normalizeImages,
  modelSupportsVision,
  buildOpenAiImageContent,
  convertContentPartForAnthropic,
  convertContentPartForGemini,
  rewriteMessagesForProvider,
  pickVisionModelCandidate,
  ensureVisionRoute,
  sniffMimeFromDataUrl,
  splitDataUrl,
};
