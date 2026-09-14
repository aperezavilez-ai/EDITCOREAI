"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ToolDispatcher, registerBuiltinMultimodalTools, normalizeToolInput } = require("../runtime/tool-dispatcher");
const { generateImage, generateVideo, resolveAssetsDir } = require("../runtime/image-gen");
const { listTemplateIds, ANIMATED_PWA_DEPENDENCIES } = require("../runtime/templates");

test("multimodal tools se registran en ToolDispatcher", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mm-"));
  try {
    const dispatcher = new ToolDispatcher();
    registerBuiltinMultimodalTools(dispatcher, { rootPath: root, canWrite: true });
    const names = dispatcher.definitions().map((d) => d.function.name);
    assert.ok(names.includes("generate_image"));
    assert.ok(names.includes("generate_video"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("normalizeToolInput rellena prompt y public/assets", () => {
  const image = normalizeToolInput("generate_image", { text: "logo azul" });
  assert.equal(image.prompt, "logo azul");
  assert.equal(image.outputDir, "public/assets");
  const video = normalizeToolInput("generate_video", { description: "clip corto", aspect_ratio: "16:9" });
  assert.equal(video.prompt, "clip corto");
  assert.equal(video.aspectRatio, "16:9");
});

test("generate_image / generate_video sin config no rompen", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mm-noconfig-"));
  try {
    const image = await generateImage(dir, { prompt: "logo azul" });
    assert.equal(image.available, false);
    assert.equal(image.ok, false);
    const video = await generateVideo(dir, { prompt: "ola suave" });
    assert.equal(video.available, false);
    assert.equal(video.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveAssetsDir crea public/assets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mm-assets-"));
  try {
    const resolved = resolveAssetsDir(dir, {});
    assert.equal(resolved.relative, "public/assets");
    assert.ok(fs.existsSync(resolved.absolute));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("template catalog incluye animated-pwa con framer-motion", () => {
  assert.ok(listTemplateIds().includes("animated-pwa"));
  assert.ok(ANIMATED_PWA_DEPENDENCIES["framer-motion"]);
});
