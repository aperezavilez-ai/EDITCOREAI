"use strict";

/**
 * Integración de las 4 fases del kernel EditCoreAI:
 * 1) snapshots  2) process-runner  3) vision-inspector  4) global-memory
 *
 * Uso: node scripts/test-kernel-features.js
 */

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const KERNEL = path.join(REPO_ROOT, "editcore-chat-kernel");

function resolveKernel(rel) {
  const abs = path.join(KERNEL, rel);
  if (!fs.existsSync(abs)) {
    throw new Error(`No se encuentra el módulo del kernel: ${abs}`);
  }
  return abs;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function phase1Snapshots() {
  section("Fase 1 · Snapshots");
  const snapshot = require(resolveKernel("snapshot.js"));
  const tools = require(resolveKernel("tools.js"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-it-snap-"));
  const rel = "src/phase1.txt";
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, rel), "ORIGINAL_A", "utf8");

  const write = tools.writeFile(root, rel, "MODIFIED_B");
  assert(write.ok, "write_file debe OK");
  assert(write.snapshotId, "write_file debe devolver snapshotId");

  const snapDir = path.join(root, ".editcore", "snapshots", write.snapshotId);
  assert(fs.existsSync(snapDir), `Debe existir carpeta snapshot: ${snapDir}`);
  assert(fs.existsSync(path.join(snapDir, "manifest.json")), "manifest.json requerido");
  assert(fs.existsSync(path.join(root, ".editcore", "snapshots", "latest.json")), "latest.json requerido");

  const listed = snapshot.listSnapshots(root);
  assert(listed.ok && listed.snapshots.length >= 1, "listSnapshots debe listar al menos 1");
  assert(listed.latest === write.snapshotId, "latest debe coincidir con snapshotId");

  const rb = tools.rollbackLastChange(root);
  assert(rb.ok, "rollback_last_change OK");
  const restored = fs.readFileSync(path.join(root, rel), "utf8");
  assert(restored === "ORIGINAL_A", `Rollback restauró ORIGINAL_A, got=${restored}`);

  console.log("OK snapshotId=", write.snapshotId, "rollback=ORIGINAL_A");
  return { root, snapshotId: write.snapshotId };
}

async function phase2ProcessRunner() {
  section("Fase 2 · Process runner");
  const { runProcess, detectSevereIssue } = require(resolveKernel("process-runner.js"));

  const direct = detectSevereIssue("Build error: Failed to compile\n", "");
  assert(direct && /Build error/i.test(direct.summary), "detectSevereIssue debe pillar Build error");

  const script = path.join(os.tmpdir(), `editcore-it-compile-${process.pid}.js`);
  fs.writeFileSync(
    script,
    [
      "setTimeout(() => {",
      "  console.error('Build error: Failed to compile');",
      "  console.error('TypeScript error TS2307');",
      "  process.exit(1);",
      "}, 80);",
      "",
    ].join("\n"),
    "utf8",
  );

  let severe = null;
  const chunks = [];
  const started = Date.now();
  const result = await runProcess({
    cwd: REPO_ROOT,
    command: `node "${script}"`,
    timeoutMs: 15_000,
    onChunk: (ev) => chunks.push(ev),
    onSevereError: (issue) => {
      severe = issue;
    },
  });
  const elapsed = Date.now() - started;

  assert(result.ok === false, "comando con exit 1 => ok false");
  assert(!result.timedOut, "NO debe hacer timeout");
  assert(elapsed < 12_000, `debe terminar rápido sin timeout (elapsed=${elapsed}ms)`);
  assert(severe || /Build error|TypeScript error/i.test(result.stderr), "debe interceptar error en stream o stderr");
  assert(chunks.length > 0 || result.stderr, "debe haber captura de stream");

  try { fs.unlinkSync(script); } catch { /* ignore */ }

  console.log("OK severe=", (severe?.summary || result.stderr).slice(0, 80), `elapsed=${elapsed}ms`);
  return { elapsed, severe: severe?.summary || null };
}

async function phase3Vision() {
  section("Fase 3 · Vision inspector");
  const {
    capture_preview_screenshot,
    DEFAULT_PREVIEW_URL,
    assertLocalPreviewUrl,
  } = require(resolveKernel("vision-inspector.js"));

  assert(String(DEFAULT_PREVIEW_URL).includes("4568"), "default preview URL 4568");
  assert(assertLocalPreviewUrl("http://127.0.0.1:4568/").includes("4568"), "assertLocalPreviewUrl");

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-it-vision-"));
  const html = `<!doctype html><html><head><title>EditCore Vision IT</title></head>
<body style="margin:0;font-family:sans-serif;background:#111;color:#eee;padding:24px">
  <h1>Preview iframe smoke</h1>
  <button id="cta">Continuar</button>
  <p>${"contenido visible ".repeat(20)}</p>
</body></html>`;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;

  // PNG mínimo válido (~70 bytes) — el fallback Electron del inspector pide >=800 bytes;
  // usamos buffer grande + header png-like para pasar el umbral si puppeteer no está.
  const fakePng = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(1200, 7),
  ]);

  try {
    const shot = await capture_preview_screenshot({
      url,
      projectRoot,
      viewport: "desktop",
      electronCapture: async () => ({
        ok: true,
        imageDataUrl: `data:image/png;base64,${fakePng.toString("base64")}`,
        diagnostics: {
          title: "EditCore Vision IT",
          issues: [],
          renderOk: true,
          bodyTextLength: 200,
          horizontalOverflow: false,
          visibleControls: 1,
        },
      }),
    });

    assert(shot.ok, `capture_preview_screenshot OK (error=${shot.error || ""})`);
    assert(shot.engine, "engine definido");
    assert(shot.screenshotPath, "screenshotPath definido");
    const abs = path.join(projectRoot, shot.screenshotPath);
    assert(fs.existsSync(abs) || fs.existsSync(shot.screenshotAbs || ""), "archivo PNG en disco");
    assert(typeof shot.multimodalHint === "string" && shot.multimodalHint.length > 0, "multimodalHint");

    console.log("OK engine=", shot.engine, "path=", shot.screenshotPath, "url=", url);
    return { engine: shot.engine, screenshotPath: shot.screenshotPath, url };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function phase4GlobalMemory() {
  section("Fase 4 · Global memory");
  const {
    recordSolution,
    promptBlock,
    loadGlobalMemory,
    globalMemoryPath,
    classifyErrorType,
  } = require(resolveKernel("global-memory.js"));

  const marker = `integration-test-${Date.now()}`;
  const tipo = classifyErrorType("Failed to compile\nerror TS2307");
  assert(tipo === "typescript" || tipo === "compile", `tipo clasificado=${tipo}`);

  const rec = recordSolution({
    tipoError: "typescript",
    solucionAplicada: `${marker}: añadir dependencia faltante y re-ejecutar tsc --noEmit`,
    errorExcerpt: "error TS2307: Cannot find module './missing'",
    projectHint: "scripts/test-kernel-features",
    source: "integration-test",
  });
  assert(rec.ok, "recordSolution OK");

  const file = globalMemoryPath();
  assert(file.includes(path.join(".editcore", "global_memory.json")) || /[\\/]\.editcore[\\/]global_memory\.json$/i.test(file), `path home: ${file}`);
  assert(fs.existsSync(file), `debe existir ${file}`);

  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert(Array.isArray(raw.solutions), "solutions[] en JSON");
  const found = raw.solutions.some((s) => String(s.solucionAplicada || "").includes(marker));
  assert(found, "entrada de integración persistida en global_memory.json");

  const block = promptBlock(`TypeScript error TS2307 ${marker}`, 10);
  assert(/MEMORIA GLOBAL/i.test(block), "promptBlock con cabecera");
  assert(block.includes(marker), "promptBlock recupera la solución aprendida");

  // Limpieza: quitar solo entradas de este test (deja el resto intacto)
  const store = loadGlobalMemory();
  store.solutions = (store.solutions || []).filter((s) => !String(s.solucionAplicada || "").includes(marker));
  const { saveGlobalMemory } = require(resolveKernel("global-memory.js"));
  saveGlobalMemory(store);

  console.log("OK persisted=", file, "promptLen=", block.length);
  return { path: file, promptPreview: block.split("\n").slice(0, 3) };
}

async function main() {
  console.log("EditCoreAI · test-kernel-features");
  console.log("repo=", REPO_ROOT);
  console.log("kernel=", KERNEL);

  assert(fs.existsSync(KERNEL), `Kernel no encontrado: ${KERNEL}`);

  const results = {
    phase1: null,
    phase2: null,
    phase3: null,
    phase4: null,
  };

  results.phase1 = await phase1Snapshots();
  results.phase2 = await phase2ProcessRunner();
  results.phase3 = await phase3Vision();
  results.phase4 = await phase4GlobalMemory();

  console.log("\n==============================");
  console.log("TODAS LAS FASES OK");
  console.log(JSON.stringify({
    snapshotId: results.phase1.snapshotId,
    processMs: results.phase2.elapsed,
    visionEngine: results.phase3.engine,
    globalMemory: results.phase4.path,
  }, null, 2));
}

main().catch((err) => {
  console.error("\nFALLO:", err && err.stack ? err.stack : err);
  process.exit(1);
});
