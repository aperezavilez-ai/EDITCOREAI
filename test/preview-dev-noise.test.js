"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { stripDevCacheNoise, detectDevLogIssue } = require("../editcore-chat-kernel/dev-log-detector");
const { detectSevereIssue } = require("../editcore-chat-kernel/process-runner");

const CACHE_NOISE = [
  " ⨯ unhandledRejection: [Error: ENOENT: no such file or directory, stat 'D:\\P\\CALILI\\.next\\cache\\webpack\\server-development\\0.pack.gz'] {",
  "  errno: -4058,",
  "  code: 'ENOENT',",
  "  syscall: 'stat',",
  "  path: 'D:\\P\\CALILI\\.next\\cache\\webpack\\server-development\\0.pack.gz'",
  "}",
  "<w> [webpack.cache.PackFileCacheStrategy] Caching failed for pack: Error: ENOENT: no such file or directory, stat 'D:\\P\\CALILI\\.next\\cache\\webpack\\server-development\\0.pack.gz'",
  "<w> [webpack.cache.PackFileCacheStrategy] Caching failed for pack: Error: ENOENT: no such file or directory, rename 'D:\\P\\CALILI\\.next\\cache\\webpack\\client-development-fallback\\0.pack.gz_' -> 'D:\\P\\CALILI\\.next\\cache\\webpack\\client-development-fallback\\0.pack.gz'",
  " ✓ Compiled / in 3.2s",
].join("\n");

test("La caché interna de Next (.next) no se reporta como error del preview", () => {
  assert.equal(stripDevCacheNoise(CACHE_NOISE).trim(), "✓ Compiled / in 3.2s");
  assert.equal(detectSevereIssue(CACHE_NOISE, CACHE_NOISE), null);
  assert.equal(detectDevLogIssue(CACHE_NOISE), null);
});

test("Los errores reales del proyecto se siguen reportando", () => {
  const compile = "Failed to compile\n./src/app/page.tsx\nModule not found: Can't resolve './Foo'";
  assert.ok(detectSevereIssue(compile, compile));
  const userEnoent = "Error: ENOENT: no such file or directory, open 'D:\\P\\CALILI\\src\\data\\menu.json'";
  assert.ok(detectSevereIssue(userEnoent, userEnoent));
});

test("El panel de errores del navegador ignora la caché de webpack", () => {
  const renderer = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");
  assert.match(renderer, /\|\| \/packfilecachestrategy\/\.test\(text\)/);
  assert.match(renderer, /\|\| \/\^<w>\/\.test\(text\)/);
});

test("Nunca se borra .next con el servidor del proyecto corriendo", async () => {
  const { autoHealNextProject, detectNextCacheCorruption } = require("../runtime/inspector-local-heal");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-next-heal-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" }, scripts: { dev: "next dev" } }));
    fs.mkdirSync(path.join(dir, ".next", "cache", "webpack"), { recursive: true });
    const detection = detectNextCacheCorruption(dir);
    assert.equal(detection.issues.some((i) => i.code === "ENOENT_NEXT_SERVER_APP"), false);
    const heal = await autoHealNextProject(dir, { force: true, rebuild: false, serverRunning: true });
    assert.equal(heal.skipped, true);
    assert.equal(heal.reason, "server-running");
    assert.ok(fs.existsSync(path.join(dir, ".next", "cache", "webpack")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  assert.match(main, /const serverRunning = isProjectServerRunning\(runtimeRoot\);\s*if \(!serverRunning && detection\.isNext/);
  assert.match(main, /rebuild: !pkg\?\.scripts\?\.dev,/);
  assert.equal((main.match(/serverRunning: isProjectServerRunning\(/g) || []).length, 4);
});
