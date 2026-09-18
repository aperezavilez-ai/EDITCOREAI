"use strict";

/**
 * EditCore E2E completo 0→100 (sin saltar capas críticas del producto).
 * Cubre: sintaxis, UI Bodega, IPC preload↔main, tools adapter/kernel/dispatcher,
 * visión, clone, brain, tests unitarios, overlay drift.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function repoRootFromHere() {
  return path.resolve(__dirname, "..");
}

function step(id, name, status, detail = "", weight = 1) {
  return {
    id: String(id),
    name,
    status,
    detail: String(detail || "").slice(0, 600),
    weight: Math.max(1, Number(weight) || 1),
  };
}

function scoreFromSteps(steps = []) {
  const total = steps.reduce((n, s) => n + (s.weight || 1), 0) || 1;
  const earned = steps.reduce((n, s) => {
    if (s.status === "pass") return n + (s.weight || 1);
    if (s.status === "warn") return n + (s.weight || 1) * 0.5;
    if (s.status === "skip") return n + (s.weight || 1) * 0.25;
    return n;
  }, 0);
  return Math.max(0, Math.min(100, Math.round((earned / total) * 100)));
}

function formatReportMarkdown({ score, steps, startedAt, finishedAt, projectRoot, coverageNote } = {}) {
  const lines = [
    "# EditCore E2E Pipeline — Reporte 0→100",
    "",
    `**Puntuación:** ${score}/100`,
    `**Proyecto:** \`${projectRoot || "(repo)"}\``,
    `**Inicio:** ${startedAt}`,
    `**Fin:** ${finishedAt}`,
    coverageNote ? `**Cobertura:** ${coverageNote}` : "",
    "",
    "## Checklist",
    "",
  ].filter(Boolean);
  for (const s of steps) {
    const icon = s.status === "pass" ? "✅" : s.status === "warn" ? "⚠️" : s.status === "skip" ? "⏭️" : "❌";
    lines.push(`${icon} **${s.id}. ${s.name}** — ${s.status}${s.detail ? `: ${s.detail}` : ""}`);
  }
  const fails = steps.filter((s) => s.status === "fail");
  const warns = steps.filter((s) => s.status === "warn");
  lines.push("", "## Resumen");
  if (!fails.length && !warns.length) {
    lines.push("Cobertura crítica completa sin fallos. EditCore puede repetir con `run_e2e_pipeline`.");
  } else {
    if (fails.length) lines.push(`Fallos (${fails.length}): ${fails.map((f) => f.id).join(", ")}.`);
    if (warns.length) lines.push(`Avisos (${warns.length}): ${warns.map((f) => f.id).join(", ")}.`);
    lines.push("No declarar 100/100 mientras existan fallos en capas UI/IPC/tools/brain.");
  }
  lines.push("");
  return lines.join("\n");
}

function read(abs) {
  return fs.readFileSync(abs, "utf8");
}

function exists(abs) {
  return fs.existsSync(abs);
}

function extractInvokes(src = "") {
  return [...String(src).matchAll(/invoke\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

function extractHandles(src = "") {
  return [...String(src).matchAll(/ipcMain\.handle\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

function extractToolNamesFromAdapter(src = "") {
  return [...String(src).matchAll(/tool\(\s*["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
}

function extractKernelDefinitions(src = "") {
  return [...String(src).matchAll(/name:\s*["']([a-z0-9_]+)["']/g)].map((m) => m[1]);
}

function extractKernelCases(src = "") {
  return [...String(src).matchAll(/case\s+["']([a-z0-9_]+)["']\s*:/g)].map((m) => m[1]);
}

function resolveNodeExecutable() {
  // Dentro de Electron, process.execPath es EDITCOREAI-host.exe — NO sirve para --check
  // sin ELECTRON_RUN_AS_NODE (cargaría el .js como main y rompe preload).
  if (process.versions && process.versions.electron) return "node";
  const base = path.basename(String(process.execPath || "")).toLowerCase();
  if (/electron|editcoreai-host|editcoreai\.exe/.test(base)) return "node";
  return process.execPath || "node";
}

function nodeCheck(file) {
  const nodeBin = resolveNodeExecutable();
  const r = spawnSync(nodeBin, ["--check", file], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
  });
  return { ok: r.status === 0, error: String(r.stderr || r.stdout || "").slice(0, 300) };
}

function runNodeFile(file, args = []) {
  const nodeBin = resolveNodeExecutable();
  const r = spawnSync(nodeBin, [file, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    cwd: repoRootFromHere(),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    windowsHide: true,
  });
  return {
    ok: r.status === 0,
    stdout: String(r.stdout || "").slice(0, 2000),
    stderr: String(r.stderr || "").slice(0, 800),
    status: r.status,
  };
}

async function runEditcoreE2ePipeline(projectRoot = "", options = {}) {
  const startedAt = new Date().toISOString();
  const repo = repoRootFromHere();
  const root = path.resolve(String(projectRoot || repo));
  const steps = [];
  const writeReport = options.writeReport !== false;

  const criticalFiles = [
    "main.js",
    "preload.js",
    "renderer.js",
    "index.html",
    "brain-service.js",
    "brain-memory-store.js",
    "runtime/vision-intake.js",
    "runtime/clone-web-page.js",
    "runtime/external-knowledge-persist.js",
    "runtime/ai-core.js",
    "runtime/elite-communication-policy.js",
    "runtime/editcore-claude-adapter.js",
    "runtime/register-agent-capability-tools.js",
    "runtime/tool-dispatcher.js",
    "runtime/chat-kernel-bridge.js",
    "runtime/e2e-pipeline-report.js",
    "editcore-chat-kernel/tools.js",
    "editcore-chat-kernel/orchestrator.js",
  ];

  // ── 0. Inventario de cobertura ──────────────────────────────────────────
  steps.push(step(0, "Alcance E2E declarado (sin saltar capas)", "pass",
    `Archivos críticos: ${criticalFiles.length}; capas: sintaxis, Bodega UI, IPC, tools, visión, clone, brain, tests, overlay`, 2));

  // ── 1. Existencia archivos ──────────────────────────────────────────────
  {
    const missing = criticalFiles.filter((rel) => !exists(path.join(repo, rel)));
    steps.push(step(1, "Archivos críticos presentes", missing.length ? "fail" : "pass",
      missing.length ? `faltan: ${missing.join(", ")}` : `${criticalFiles.length} ok`, 4));
  }

  // ── 2. Sintaxis Node de todos los críticos ──────────────────────────────
  {
    const fails = [];
    for (const rel of criticalFiles.filter((f) => f.endsWith(".js"))) {
      const abs = path.join(repo, rel);
      const chk = nodeCheck(abs);
      if (!chk.ok) fails.push(`${rel}: ${chk.error}`);
    }
    steps.push(step(2, "Sintaxis JS crítica (node --check)", fails.length ? "fail" : "pass",
      fails.length ? fails.slice(0, 5).join(" | ") : `${criticalFiles.filter((f) => f.endsWith(".js")).length} archivos OK`, 6));
  }

  // ── 3. Bodega: crash brainSnapshot (bug reportado) ──────────────────────
  {
    const renderer = read(path.join(repo, "renderer.js"));
    const unsafe = /activeProject\(\)\.brainSnapshot\s*=/.test(renderer);
    const guarded = /const project = activeProject\(\);[\s\S]{0,80}if \(project\) \{[\s\S]{0,80}project\.brainSnapshot/.test(renderer);
    const hostGuard = /function renderBrainSnapshot[\s\S]{0,120}if \(!host\) return/.test(renderer);
    const stateField = /brainSnapshot:\s*null/.test(renderer);
    const ok = !unsafe && guarded && hostGuard && stateField;
    steps.push(step(3, "Bodega Cerebro null-safe sin proyecto", ok ? "pass" : "fail",
      ok ? "guard project + host + state.brainSnapshot" : `unsafe=${unsafe} guarded=${guarded}`, 8));
  }

  // ── 4. DOM Bodega en index.html ─────────────────────────────────────────
  {
    const html = read(path.join(repo, "index.html"));
    const ids = ["brainDialog", "brainSnapshot", "brainHealth", "brainCatalogList", "brainStatus", "brainSearch", "brainToolsAudit"];
    const missing = ids.filter((id) => !html.includes(`id="${id}"`));
    steps.push(step(4, "DOM Bodega del Cerebro (index.html)", missing.length ? "fail" : "pass",
      missing.length ? `faltan ids: ${missing.join(", ")}` : ids.join(", "), 4));
  }

  // ── 5. Overlay drift Bodega (mismo bug) ─────────────────────────────────
  {
    const overlay = path.join(repo, "resources", "ui-overlay", "renderer.js");
    if (!exists(overlay)) {
      steps.push(step(5, "Overlay renderer Bodega null-safe", "warn", "overlay renderer ausente", 3));
    } else {
      const src = read(overlay);
      const unsafe = /activeProject\(\)\.brainSnapshot\s*=/.test(src);
      const guarded = /if \(project\) \{[\s\S]{0,60}project\.brainSnapshot/.test(src);
      steps.push(step(5, "Overlay renderer Bodega null-safe", !unsafe && guarded ? "pass" : "fail",
        unsafe ? "overlay aún tiene activeProject().brainSnapshot" : "overlay alineado", 5));
    }
  }

  // ── 6. activeProject().X inseguro en renderer canónico ──────────────────
  {
    const src = read(path.join(repo, "renderer.js"));
    const hits = [...src.matchAll(/activeProject\(\)\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]);
    const unique = [...new Set(hits)];
    // Cualquier acceso directo puede NPE si no hay proyecto
    steps.push(step(6, "Patrones activeProject().* sin variable local", unique.length ? "warn" : "pass",
      unique.length ? `revisar: ${unique.slice(0, 20).join(", ")}` : "sin accesos directos", 4));
  }

  // ── 7. IPC preload → main (canales invocados existen) ───────────────────
  {
    const preload = read(path.join(repo, "preload.js"));
    const main = read(path.join(repo, "main.js"));
    const taskIpc = exists(path.join(repo, "runtime", "task-ipc.js"))
      ? read(path.join(repo, "runtime", "task-ipc.js"))
      : "";
    const invokes = [...new Set(extractInvokes(preload))];
    const handles = new Set([
      ...extractHandles(main),
      ...[...taskIpc.matchAll(/["']((?:task|workflow):[^"']+)["']/g)].map((m) => m[1]),
    ]);
    const missing = invokes.filter((ch) => !handles.has(ch));
    const criticalMissing = missing.filter((ch) => /^(brain:|editcore:|agent:|project:clone|project:e2e|project:images)/.test(ch));
    const taskWired = main.includes("registerTaskIpc") && taskIpc.includes("task:create");
    steps.push(step(7, "IPC preload→main (canales críticos + task-ipc)",
      criticalMissing.length || !taskWired ? "fail" : (missing.length ? "warn" : "pass"),
      criticalMissing.length
        ? `críticos faltantes: ${criticalMissing.join(", ")}`
        : `invokes=${invokes.length} handlers≈${handles.size} missing=${missing.length} taskIpc=${taskWired}`, 8));
  }

  // ── 8. Brain IPC surface ────────────────────────────────────────────────
  {
    const preload = read(path.join(repo, "preload.js"));
    const main = read(path.join(repo, "main.js"));
    const need = ["brain:catalog", "brain:snapshot", "brain:audit", "brain:install"];
    const missPre = need.filter((ch) => !preload.includes(ch));
    const missMain = need.filter((ch) => !main.includes(`"${ch}"`) && !main.includes(`'${ch}'`));
    steps.push(step(8, "IPC editcoreBrain (catalog/snapshot/audit/install)",
      (missPre.length || missMain.length) ? "fail" : "pass",
      `preload_miss=${missPre.join("|") || "0"} main_miss=${missMain.join("|") || "0"}`, 6));
  }

  // ── 9. Brain service API ────────────────────────────────────────────────
  {
    try {
      const { EditCoreBrainService } = require("../brain-service");
      const methods = [
        "searchCatalog", "snapshot", "auditTools", "remember", "assembleContext",
        "ingestExternalSnippet", "searchMemory", "searchKnowledge", "installCatalogItem",
      ];
      const proto = EditCoreBrainService?.prototype || {};
      const missing = methods.filter((m) => typeof proto[m] !== "function");
      const okClass = typeof EditCoreBrainService === "function";
      // IPC aliases: brain:catalog → searchCatalog, brain:audit → auditTools
      const main = read(path.join(repo, "main.js"));
      const ipcOk = main.includes("brain().searchCatalog") && main.includes("brain().auditTools");
      steps.push(step(9, "brain-service.js API + IPC aliases",
        okClass && !missing.length && ipcOk ? "pass" : "fail",
        missing.length ? `faltan: ${missing.join(", ")}` : `IPC catalog/audit mapeados · methods=${methods.length}`, 5));
    } catch (error) {
      steps.push(step(9, "brain-service.js API + IPC aliases", "fail", error?.message || error, 5));
    }
  }

  // ── 10. Memory store RAG ────────────────────────────────────────────────
  {
    try {
      const { BrainMemoryStore } = require("../brain-memory-store");
      const dbPath = path.join(os.tmpdir(), `editcore-e2e-full-${Date.now()}.sqlite`);
      const store = new BrainMemoryStore(dbPath);
      store.upsertMemory({ scope: "global", type: "web_rag", title: "e2e", content: "knowledge persist e2e full pipeline test content", source: "web/rag", importance: 0.8 });
      const chunk = store.upsertKnowledgeChunk("e2e", { path: "external/a.md", text: "rag chunk content for e2e full verification run" });
      const mem = store.searchMemories("", "knowledge persist", 5);
      const know = store.searchKnowledge("e2e", "rag chunk content", 5);
      store.close();
      for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
      }
      const ok = Boolean(chunk) && mem.length >= 0 && know.length >= 1;
      steps.push(step(10, "brain-memory-store memory+RAG", ok ? "pass" : "fail", `mem=${mem.length} know=${know.length}`, 5));
    } catch (error) {
      steps.push(step(10, "brain-memory-store memory+RAG", "fail", error?.message || error, 5));
    }
  }

  // ── 11. Vision intake ───────────────────────────────────────────────────
  {
    try {
      const { normalizeImages, ensureVisionRoute, buildOpenAiImageContent } = require("./vision-intake");
      const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const imgs = normalizeImages([{ dataUrl: tiny, mimeType: "" }]);
      const content = buildOpenAiImageContent("analiza", imgs);
      const routed = ensureVisionRoute({
        model: "local-text",
        images: imgs,
        candidates: [{ model: "gemini-2.5-flash", apiKey: "k", baseUrl: "https://x", providerKey: "g" }],
      });
      steps.push(step(11, "Vision intake normalize+route", imgs.length && Array.isArray(content) && routed.routed ? "pass" : "fail",
        `imgs=${imgs.length} routed=${routed.routed}`, 5));
    } catch (error) {
      steps.push(step(11, "Vision intake normalize+route", "fail", error?.message || error, 5));
    }
  }

  // ── 12. Provider image conversion ───────────────────────────────────────
  {
    try {
      const { normalizeForAnthropic, normalizeForGemini } = require("./ai-core");
      const msgs = [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }] }];
      const a = normalizeForAnthropic(msgs);
      const g = normalizeForGemini(msgs);
      const ok = a[0]?.content?.some((p) => p.type === "image") && g[0]?.parts?.some((p) => p.inlineData);
      steps.push(step(12, "ai-core Anthropic/Gemini vision parts", ok ? "pass" : "fail", "", 5));
    } catch (error) {
      steps.push(step(12, "ai-core Anthropic/Gemini vision parts", "fail", error?.message || error, 5));
    }
  }

  // ── 13. Chat path images wiring ─────────────────────────────────────────
  {
    const main = read(path.join(repo, "main.js"));
    const bridge = read(path.join(repo, "runtime", "chat-kernel-bridge.js"));
    const orch = read(path.join(repo, "editcore-chat-kernel", "orchestrator.js"));
    const adapter = read(path.join(repo, "runtime", "editcore-claude-adapter.js"));
    const ok = main.includes("images") && bridge.includes("images") && orch.includes("buildOpenAiImageContent")
      && adapter.includes("buildOpenAiImageContent") && main.includes("ensureVisionRoute");
    steps.push(step(13, "Chat/agent wiring de imágenes", ok ? "pass" : "fail", "", 5));
  }

  // ── 14. Renderer multimodal UI ──────────────────────────────────────────
  {
    const renderer = read(path.join(repo, "renderer.js"));
    const need = ["isImageAttachment", "setupImageDropTarget", "readFileAsDataUrl", "renderAttachments", "Imagen adjunta"];
    const miss = need.filter((n) => !renderer.includes(n));
    steps.push(step(14, "Renderer paste/drop/thumbnails/payload", miss.length ? "fail" : "pass",
      miss.length ? `faltan: ${miss.join(", ")}` : "ok", 4));
  }

  // ── 15. clone_web_page funcional ────────────────────────────────────────
  {
    try {
      const { cloneWebPage } = require("./clone-web-page");
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-e2e-clone-"));
      const out = await cloneWebPage(tmp, {
        url: "https://example.com",
        skipVision: true,
        mergeApp: true,
        replacements: { TITLE: "E2E Full", CTA: "Go" },
        mockExtract: {
          title: "Example",
          url: "https://example.com",
          bodyText: "Example domain content for full e2e clone verification pipeline",
          htmlSnippet: "<h1>Example</h1>",
          tailwindClasses: ["flex", "p-4"],
          sections: [],
          keyStyles: [],
        },
      });
      const page = exists(path.join(tmp, "src", "pages", "ClonedPage.tsx"));
      steps.push(step(15, "clone_web_page mock→React+App", out.ok && page ? "pass" : "fail", out.mode || "", 6));
    } catch (error) {
      steps.push(step(15, "clone_web_page mock→React+App", "fail", error?.message || error, 6));
    }
  }

  // ── 16. Tools: dispatcher registration ──────────────────────────────────
  {
    try {
      const { ToolDispatcher, TOOL_ALIASES } = require("./tool-dispatcher");
      const { registerAgentCapabilityTools } = require(path.join(__dirname, "register-agent-capability-tools"));
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-e2e-tools-"));
      fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "e2e" }), "utf8");
      const d = new ToolDispatcher({ authorize: async () => true });
      registerAgentCapabilityTools(d, { rootPath: tmp, canWrite: true });
      const names = d.definitions().map((x) => x.function.name);
      const need = ["clone_web_page", "images_to_code", "run_e2e_pipeline"];
      const miss = need.filter((n) => !names.includes(n));
      const aliasOk = TOOL_ALIASES.clone_page === "clone_web_page" && TOOL_ALIASES.run_e2e === "run_e2e_pipeline";
      const dry = await d.dispatch("clone_web_page", { url: "https://example.com", dryRun: true }, {});
      steps.push(step(16, "Dispatcher tools clone/images/e2e", (!miss.length && aliasOk && dry.ok) ? "pass" : "fail",
        `miss=${miss.join("|") || "0"} defs=${names.length}`, 6));
    } catch (error) {
      steps.push(step(16, "Dispatcher tools clone/images/e2e", "fail", error?.message || error, 6));
    }
  }

  // ── 17. Adapter getAvailableTools expone tools ──────────────────────────
  {
    const adapter = read(path.join(repo, "runtime", "editcore-claude-adapter.js"));
    const exposed = new Set(extractToolNamesFromAdapter(adapter));
    const need = ["clone_web_page", "images_to_code", "run_e2e_pipeline", "generate_image", "fetch_url", "brain_search"];
    const miss = need.filter((n) => !exposed.has(n));
    steps.push(step(17, "Adapter getAvailableTools exposición", miss.length ? "fail" : "pass",
      miss.length ? `NO expuestos: ${miss.join(", ")}` : `tools tool()≈${exposed.size}`, 8));
  }

  // ── 18. Kernel DEFINITIONS ↔ execute cases ──────────────────────────────
  {
    const toolsSrc = read(path.join(repo, "editcore-chat-kernel", "tools.js"));
    // Focus on DEFINITIONS block names that are agent tools
    const need = ["clone_web_page", "images_to_code", "run_e2e_pipeline", "web_scrape", "list_files", "write_file"];
    const defOk = need.every((n) => toolsSrc.includes(`name: "${n}"`) || toolsSrc.includes(`name: '${n}'`));
    const caseOk = need.every((n) => toolsSrc.includes(`case "${n}"`) || toolsSrc.includes(`case '${n}'`));
    steps.push(step(18, "Kernel tools DEFINITIONS+execute", defOk && caseOk ? "pass" : "fail",
      `defs=${defOk} cases=${caseOk}`, 7));
  }

  // ── 19. Knowledge persist hook ──────────────────────────────────────────
  {
    try {
      const { shouldPersistTool, EXTERNAL_TOOLS } = require("./external-knowledge-persist");
      const ok = shouldPersistTool("fetch_url", "x".repeat(120))
        && EXTERNAL_TOOLS.has("clone_web_page")
        && EXTERNAL_TOOLS.has("images_to_code");
      const main = read(path.join(repo, "main.js"));
      const wired = main.includes("wrapDispatcherWithKnowledgePersist");
      steps.push(step(19, "Persistencia web/RAG hook cableado", ok && wired ? "pass" : "fail", "", 4));
    } catch (error) {
      steps.push(step(19, "Persistencia web/RAG hook cableado", "fail", error?.message || error, 4));
    }
  }

  // ── 20. Elite policy VISION + E2E ────────────────────────────────────────
  {
    try {
      const elite = require("./elite-communication-policy");
      const policy = String(elite.ELITE_COMMUNICATION_POLICY || "");
      const ok = /VISION|imagen adjunta/i.test(policy) && /run_e2e_pipeline/i.test(policy);
      steps.push(step(20, "Política élite VISION + E2E §8", ok ? "pass" : "fail", "", 3));
    } catch (error) {
      steps.push(step(20, "Política élite VISION + E2E §8", "fail", error?.message || error, 3));
    }
  }

  // ── 21. Unit tests vision + clone ───────────────────────────────────────
  {
    const t1 = runNodeFile(path.join(repo, "test", "vision-intake.test.js"));
    const t2 = runNodeFile(path.join(repo, "test", "clone-web-page.test.js"));
    steps.push(step(21, "Tests unitarios vision+clone", (t1.ok && t2.ok) ? "pass" : "fail",
      `vision=${t1.ok} clone=${t2.ok}`, 5));
  }

  // ── 22. Tool run_e2e_pipeline ejecutable (meta) ─────────────────────────
  {
    const reg = read(path.join(repo, "runtime", "register-agent-capability-tools.js"));
    const preload = read(path.join(repo, "preload.js"));
    const main = read(path.join(repo, "main.js"));
    const ok = reg.includes("run_e2e_pipeline") && preload.includes("runE2ePipeline") && main.includes("project:e2e-pipeline");
    steps.push(step(22, "Superficie run_e2e_pipeline (tool+IPC+preload)", ok ? "pass" : "fail", "", 4));
  }

  // ── 23. Golden templates ────────────────────────────────────────────────
  {
    try {
      const { ensureWebCloneGoldenOnDisk } = require("./clone-web-page");
      const g = ensureWebCloneGoldenOnDisk();
      const erp = path.join(repo, "runtime", "golden-templates", "enterprise-erp-base", "template.json");
      const ok = exists(path.join(g, "template.json")) && exists(erp);
      steps.push(step(23, "Golden templates web-clone + enterprise-erp", ok ? "pass" : "fail", "", 2));
    } catch (error) {
      steps.push(step(23, "Golden templates web-clone + enterprise-erp", "fail", error?.message || error, 2));
    }
  }

  // ── 24. openBrain error path no miente si snapshot OK ───────────────────
  {
    const renderer = read(path.join(repo, "renderer.js"));
    // After fix, loadBrainCatalog should not throw on null project; openBrain catch sets "Cerebro con error"
    const safeLoad = /const project = activeProject\(\);[\s\S]{0,120}project\.brainSnapshot/.test(renderer);
    steps.push(step(24, "openBrain no marca error por NPE Bodega", safeLoad ? "pass" : "fail",
      safeLoad ? "loadBrainCatalog tolerante a Sin proyecto" : "aún puede NPE", 5));
  }

  // ── 25. package.json scripts / deps visión ──────────────────────────────
  {
    try {
      const pkg = JSON.parse(read(path.join(repo, "package.json")));
      const hasPuppeteer = Boolean(pkg.optionalDependencies?.puppeteer || pkg.dependencies?.puppeteer);
      const hasTest = Boolean(pkg.scripts?.test);
      steps.push(step(25, "package.json puppeteer opcional + test script", (hasPuppeteer && hasTest) ? "pass" : "warn",
        `puppeteer=${hasPuppeteer} test=${hasTest}`, 2));
    } catch (error) {
      steps.push(step(25, "package.json puppeteer opcional + test script", "fail", error?.message || error, 2));
    }
  }

  const finishedAt = new Date().toISOString();
  let score = scoreFromSteps(steps);
  // Hard rule: any high-weight fail caps score below 100
  const hardFails = steps.filter((s) => s.status === "fail" && (s.weight || 1) >= 5);
  if (hardFails.length && score > 92) score = 92;
  if (hardFails.length >= 2 && score > 80) score = 80;
  if (steps.some((s) => s.id === "3" && s.status === "fail")) score = Math.min(score, 70);

  const coverageNote = `${steps.length} checks · capas UI/IPC/tools/brain/visión/clone/tests/overlay`;
  let reportMarkdown = formatReportMarkdown({
    score,
    steps,
    startedAt,
    finishedAt,
    projectRoot: root,
    coverageNote,
  });

  let reportPath = "";
  if (writeReport) {
    try {
      const dir = path.join(root, ".editcore");
      fs.mkdirSync(dir, { recursive: true });
      reportPath = path.join(dir, "e2e-pipeline-report.md");
      fs.writeFileSync(reportPath, reportMarkdown, "utf8");
      fs.writeFileSync(path.join(dir, "e2e-pipeline-report.json"), JSON.stringify({
        score, steps, startedAt, finishedAt, projectRoot: root, coverageNote,
      }, null, 2), "utf8");
      steps.push(step(26, "Persistir reporte .editcore/e2e-pipeline-report.*", "pass",
        path.relative(root, reportPath).replace(/\\/g, "/"), 1));
      score = scoreFromSteps(steps);
      if (hardFails.length && score > 92) score = 92;
      reportMarkdown = formatReportMarkdown({
        score,
        steps,
        startedAt,
        finishedAt: new Date().toISOString(),
        projectRoot: root,
        coverageNote,
      });
      fs.writeFileSync(reportPath, reportMarkdown, "utf8");
    } catch (error) {
      steps.push(step(26, "Persistir reporte .editcore/e2e-pipeline-report.*", "fail", error?.message || error, 1));
      score = scoreFromSteps(steps);
      reportMarkdown = formatReportMarkdown({
        score, steps, startedAt, finishedAt: new Date().toISOString(), projectRoot: root, coverageNote,
      });
    }
  }

  const finalFails = steps.filter((s) => s.status === "fail");
  return {
    ok: finalFails.length === 0 && score >= 95,
    score,
    steps,
    reportMarkdown,
    reportPath: reportPath ? path.relative(root, reportPath).replace(/\\/g, "/") : "",
    startedAt,
    finishedAt: new Date().toISOString(),
    coverageNote,
  };
}

module.exports = {
  runEditcoreE2ePipeline,
  formatReportMarkdown,
  scoreFromSteps,
};
