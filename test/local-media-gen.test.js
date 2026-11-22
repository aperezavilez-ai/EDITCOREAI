"use strict";

process.env.EDITCORE_LOCAL_MEDIA = "1";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { generateImage, generateVideo } = require("../runtime/image-gen");

function isMediaStudioRunning() {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:11436/health", { timeout: 1000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

test("Nexus Media Studio: generateImage genera y guarda PNG localmente", async (t) => {
  if (!(await isMediaStudioRunning())) {
    t.skip("Nexus Media Studio no está activo en puerto 11436");
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-media-test-"));
  const res = await generateImage(tmpDir, {
    prompt: "Cyberpunk logo for EditCore Nexus",
    size: "512x512",
  });

  assert.equal(res.ok, true, `Fallo generateImage: ${res.message}`);
  assert.ok(res.path.startsWith("public/assets/"), "Debe guardarse en public/assets");
  assert.ok(res.path.endsWith(".png"), "Debe ser extension .png");

  const absPath = path.join(tmpDir, ...res.path.split("/"));
  assert.ok(fs.existsSync(absPath), "El archivo PNG debe existir fisicamente en disco");
  assert.ok(fs.statSync(absPath).size > 1000, "El PNG debe tener tamano real en bytes");

  // Limpieza
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("Nexus Media Studio: generateVideo genera y guarda MP4 localmente", async (t) => {
  if (!(await isMediaStudioRunning())) {
    t.skip("Nexus Media Studio no está activo en puerto 11436");
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-video-test-"));
  const res = await generateVideo(tmpDir, {
    prompt: "Futuristic animated banner in motion",
    seconds: 2,
  });

  assert.equal(res.ok, true, `Fallo generateVideo: ${res.message}`);
  assert.ok(res.path.startsWith("public/assets/"), "Debe guardarse en public/assets");
  assert.ok(res.path.endsWith(".mp4"), "Debe ser extension .mp4");

  const absPath = path.join(tmpDir, ...res.path.split("/"));
  assert.ok(fs.existsSync(absPath), "El archivo MP4 debe existir fisicamente en disco");
  assert.ok(fs.statSync(absPath).size > 1000, "El MP4 debe tener tamano real en bytes");

  // Limpieza
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
