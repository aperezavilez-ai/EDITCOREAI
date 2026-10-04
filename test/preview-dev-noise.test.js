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

function injectedCacheErrorRegex() {
  const renderer = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");
  const literal = renderer.match(/const cacheError = (\/.*\/i)\.test\(/)[1];
  // El regex vive dentro de un template literal que se inyecta en el webview.
  const injected = new Function("return `" + literal + "`;")();
  return new Function(`return ${injected};`)();
}

test("Navegador: error de código no se repara ni recarga en bucle; caché dañada sí, con límite", () => {
  const re = injectedCacheErrorRegex();
  assert.equal(re.test("Module not found: Can't resolve '@/components/ChatInterface'"), false);
  assert.equal(re.test("Failed to compile ./src/app/page.tsx"), false);
  assert.equal(re.test("Error: ENOENT: no such file or directory, open 'D:\\P\\CALILI\\.next\\server\\app\\page.js'"), true);
  assert.equal(re.test("Cannot find module './chunks/vendor-chunks/next.js'"), true);
  assert.equal(re.test("ENOENT routes-manifest.json"), true);

  const renderer = fs.readFileSync(path.join(ROOT, "renderer.js"), "utf8");
  assert.match(renderer, /if \(snapshot\?\.serverError\) return snapshot\?\.cacheError \? "server-error" : "code-error";/);
  assert.match(renderer, /if \(documentState === "code-error"\) \{\s*showProjectCodeErrorPage\(webview\);\s*return;/);
  assert.match(renderer, /Date\.now\(\) - lastHeal < PREVIEW_CACHE_HEAL_COOLDOWN_MS/);
  assert.match(renderer, /if \(heal\?\.ok && !heal\?\.skipped\) \{/);
  assert.doesNotMatch(renderer, /heal\?\.ok \? "Caché de Next\.js regenerada exitosamente"/);
  assert.match(renderer, /previewForcedRecoveries\.length >= 3/);
});

test("Navegador: un servidor vivo que tarda en compilar no se reinicia", () => {
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  assert.match(main, /runtime\.child\.exitCode === null && !\(await portIsFree\(port\)\)\) \{\s*return \{ available: true, url: runtime\.url, pid: runtime\.child\.pid, warming: true \};/);
});
