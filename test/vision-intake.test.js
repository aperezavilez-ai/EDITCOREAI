"use strict";

const assert = require("node:assert/strict");
const {
  normalizeImages,
  buildOpenAiImageContent,
  convertContentPartForAnthropic,
  convertContentPartForGemini,
  modelSupportsVision,
  ensureVisionRoute,
} = require("../runtime/vision-intake");
const {
  shouldPersistTool,
  summarizeToolResult,
} = require("../runtime/external-knowledge-persist");

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

{
  const images = normalizeImages([{ name: "a.png", dataUrl: tinyPng }]);
  assert.equal(images.length, 1);
  assert.equal(images[0].mimeType, "image/png");
}

{
  const content = buildOpenAiImageContent("mira esto", [{ dataUrl: tinyPng }]);
  assert.ok(Array.isArray(content));
  assert.equal(content[0].type, "text");
  assert.equal(content[1].type, "image_url");
}

{
  const part = convertContentPartForAnthropic({ type: "image_url", image_url: { url: tinyPng } });
  assert.equal(part.type, "image");
  assert.equal(part.source.type, "base64");
  assert.equal(part.source.media_type, "image/png");
}

{
  const part = convertContentPartForGemini({ type: "image_url", image_url: { url: tinyPng } });
  assert.ok(part.inlineData);
  assert.equal(part.inlineData.mimeType, "image/png");
}

assert.equal(modelSupportsVision("gpt-4o"), true);
assert.equal(modelSupportsVision("text-only-7b"), false);

{
  const routed = ensureVisionRoute({
    model: "text-only-7b",
    images: [{ dataUrl: tinyPng }],
    candidates: [
      { model: "gemini-2.5-flash", apiKey: "k", baseUrl: "https://example.com", providerKey: "gemini" },
    ],
  });
  assert.equal(routed.routed, true);
  assert.equal(routed.model, "gemini-2.5-flash");
}

assert.equal(shouldPersistTool("fetch_url", "x".repeat(100)), true);
assert.equal(shouldPersistTool("read_file", "x".repeat(100)), false);
assert.ok(summarizeToolResult("fetch_url", { ok: true, body: "docs" }).includes("docs"));

console.log("vision-intake + external-knowledge-persist ok");
