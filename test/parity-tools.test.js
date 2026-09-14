"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { planDiagnostics, queuePostWriteDiagnostics } = require("../runtime/post-write-diagnostics");
const { listTools, invokeTool } = require("../runtime/mcp-bridge");
const { isAllowedBrowserUrl: browserAllowed } = require("../runtime/browser-inspector");
const { searchLocalFiles } = require("../runtime/unified-search");
const { resolveUnifiedAgentPlan, MODES } = require("../runtime/intent-orchestrator");
const { loadProjectContext } = require("../runtime/context-store");

test("planDiagnostics no rompe sin package.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-diag-"));
  try {
    const plan = planDiagnostics(dir, ["src/a.ts"]);
    assert.equal(plan.skipped, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("planDiagnostics elige lint/typecheck si existen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-diag2-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      scripts: { lint: "eslint .", "typecheck": "tsc -p ." },
    }));
    const plan = planDiagnostics(dir, ["src/a.ts"]);
    assert.equal(plan.skipped, false);
    assert.ok(plan.commands.some((item) => /lint|typecheck/i.test(item.script)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("queuePostWriteDiagnostics nunca lanza", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-diag3-"));
  try {
    assert.equal(queuePostWriteDiagnostics(dir, "a.ts", {
      runCommand: async () => { throw new Error("boom"); },
      onResult: () => {},
    }), true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP sin servidores queda idle automatico (no pide copiar ejemplo)", async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mcp-ud-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mcp-proj-"));
  try {
    const listed = await listTools(dir, { userDataPath: userData });
    assert.equal(listed.available, false);
    assert.equal(listed.idle, true);
    assert.equal(listed.bridgeReady, true);
    assert.match(listed.message, /automatico|sin servidores/i);
    assert.ok(fs.existsSync(path.join(userData, "mcp.json")));
    const invoked = await invokeTool(dir, { serverId: "x", tool: "y" }, { userDataPath: userData });
    assert.equal(invoked.ok, false);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("MCP stdio real lista e invoca echo", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mcp-live-"));
  const { closeSessionsForProject } = require("../runtime/mcp-bridge");
  try {
    fs.mkdirSync(path.join(dir, ".editcore"), { recursive: true });
    const serverPath = path.join(__dirname, "fixtures", "mcp-echo-server.js");
    fs.writeFileSync(path.join(dir, ".editcore", "mcp.json"), JSON.stringify({
      enabled: true,
      servers: [{
        id: "echo",
        name: "Echo",
        transport: "stdio",
        command: process.execPath,
        args: [serverPath],
        allowedTools: ["echo"],
      }],
    }));
    const listed = await listTools(dir);
    assert.equal(listed.available, true);
    assert.equal(listed.bridgeReady, true);
    assert.ok(listed.tools.some((tool) => tool.name === "echo" && tool.live === true));
    const invoked = await invokeTool(dir, {
      serverId: "echo",
      tool: "echo",
      arguments: { text: "hola" },
    });
    assert.equal(invoked.ok, true);
    assert.match(JSON.stringify(invoked.result || {}), /echo:hola/);
  } finally {
    closeSessionsForProject(dir);
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows puede retener el handle del hijo MCP un instante.
    }
  }
});

test("greenfield premium menciona lovable-web e inspect_browser", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "CREA EL PROYECTO AHORA una app web profesional con UI pulida",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "full",
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.match(plan.runProfile.orchestrationBlock, /lovable-web|frontend-design|inspect_browser/i);
});

test("inspect_browser solo permite localhost", () => {
  assert.equal(browserAllowed("http://127.0.0.1:5173/", "http://127.0.0.1:5173/"), true);
  assert.equal(browserAllowed("https://evil.example/", "http://127.0.0.1:5173/"), false);
});

test("search local encuentra texto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-search-"));
  try {
    fs.writeFileSync(path.join(dir, "hello.js"), "const MARKER_EDITCORE = 1;\n");
    const hits = searchLocalFiles(dir, "MARKER_EDITCORE");
    assert.ok(hits.length >= 1);
    assert.match(hits[0].path, /hello\.js/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("update-check usa repo por defecto y compara semver", async () => {
  const { compareSemver, resolveUpdateRepo, checkForUpdates } = require("../runtime/update-check");
  assert.equal(compareSemver("2.2.15", "2.2.14"), 1);
  assert.equal(compareSemver("2.2.14", "2.2.14"), 0);
  assert.equal(resolveUpdateRepo({ packageJson: {}, env: {} }), "aperezavilez-ai/EDITCOREAI");
  assert.equal(resolveUpdateRepo({ packageJson: {}, env: { EDITCORE_GITHUB_REPO: "acme/editcore" } }), "acme/editcore");
  const current = await checkForUpdates({
    currentVersion: "2.5.7",
    packageJson: {},
    env: {},
    fetchImpl: async () => ({
      status: 200,
      json: {
        tag_name: "v2.5.7",
        html_url: "https://github.com/aperezavilez-ai/EDITCOREAI/releases/tag/v2.5.7",
        assets: [],
      },
    }),
  });
  assert.equal(current.idle, undefined);
  assert.equal(current.available, false);
  assert.equal(current.configured, true);
  assert.match(current.message, /al dia/i);
  assert.equal(current.status, "upToDate");
  assert.equal(current.checkFailed, false);
  const fake = await checkForUpdates({
    currentVersion: "2.2.14",
    packageJson: {},
    env: { EDITCORE_GITHUB_REPO: "acme/editcore" },
    fetchImpl: async () => ({
      status: 200,
      json: {
        tag_name: "v2.2.15",
        html_url: "https://github.com/acme/editcore/releases/tag/v2.2.15",
        assets: [{ name: "EDITCOREAI-Setup.exe", browser_download_url: "https://example.com/setup.exe" }],
      },
    }),
  });
  assert.equal(fake.available, true);
  assert.equal(fake.latestVersion, "2.2.15");
  assert.equal(fake.status, "updateAvailable");
  const failed = await checkForUpdates({
    currentVersion: "2.5.7",
    packageJson: {},
    env: {},
    fetchImpl: async () => ({ status: 500, json: null }),
  });
  assert.equal(failed.available, false);
  assert.equal(failed.checkFailed, true);
  assert.equal(failed.status, "checkFailed");
  assert.doesNotMatch(failed.message, /al dia/i);
  const noReleases = await checkForUpdates({
    currentVersion: "2.5.7",
    packageJson: {},
    env: {},
    fetchImpl: async () => ({ status: 404, json: null }),
  });
  assert.equal(noReleases.status, "noReleases");
  assert.equal(noReleases.checkFailed, false);
});

test("diff propose/apply y embeddings locales", async () => {
  const { buildUnifiedDiff, proposeDiff, applyDiff } = require("../runtime/diff-preview");
  const { embedText, cosineSimilarity } = require("../runtime/local-embeddings");
  const { buildLiveTodosFromSteps } = require("../runtime/agent-plan-view");
  const { deployOneClick } = require("../runtime/deploy-one-click");

  const diff = buildUnifiedDiff("a.js", "const a = 1;\n", "const a = 2;\n");
  assert.match(diff, /--- a\/a\.js/);
  assert.match(diff, /\+const a = 2/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-diff-"));
  try {
    fs.writeFileSync(path.join(dir, "x.txt"), "hola\n");
    const proposed = proposeDiff(dir, { path: "x.txt", content: "adios\n" });
    assert.ok(proposed.proposalId);
    assert.match(proposed.diff, /\+adios/);
    const applied = applyDiff(dir, { proposalId: proposed.proposalId }, {
      writeFile: (rel, content) => fs.writeFileSync(path.join(dir, rel), content),
    });
    assert.equal(applied.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, "x.txt"), "utf8"), "adios\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const a = embedText("invoice billing total calculator");
  const b = embedText("billing invoice totals");
  const c = embedText("purple galaxy nebula");
  assert.ok(cosineSimilarity(a, b) > cosineSimilarity(a, c));

  const todos = buildLiveTodosFromSteps([
    { name: "write_file", ok: true, input: { path: "src/main.jsx" } },
    { name: "write_file", ok: true, input: { path: "ROADMAP.md" } },
    { name: "inspect_preview", ok: true },
  ], "- Paso uno\n- Paso dos");
  assert.ok(todos.some((item) => item.id === "mutate" && item.status === "done"));
  assert.ok(todos.some((item) => item.id === "roadmap" && item.status === "done"));
  assert.equal(todos.some((item) => item.id === "deploy"), false);

  const deploy = await deployOneClick(os.tmpdir(), { provider: "vercel" }, { connections: {} });
  assert.equal(deploy.available, false);
  assert.match(deploy.message, /Vercel no configurado/i);
});

test("CHAT sigue sin tools nuevas; EXECUTE las incluye", () => {
  const chat = resolveUnifiedAgentPlan({
    prompt: "hola como estas",
    requestedAgent: false,
    projectOpen: true,
    allowWrite: true,
  });
  assert.deepEqual(chat.allowedTools, []);

  const execute = resolveUnifiedAgentPlan({
    prompt: "procede",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    planAuthorizedExecution: true,
  });
  assert.equal(execute.mode, MODES.EXECUTE);
  for (const tool of [
    "search", "run_diagnostics", "mcp_list_tools", "inspect_browser", "browser_interact",
    "semantic_search", "run_parallel_explore", "run_subagent", "generate_image", "generate_video",
    "propose_diff", "apply_diff", "deploy_one_click",
    "publish_project", "connect_project", "assess_project_connections",
    "provision_project", "project_health", "sync_vercel_env", "supabase_manage", "ssh_deploy",
    "create_supabase_project", "onboard_project",
  ]) {
    assert.ok(execute.allowedTools.includes(tool), tool);
  }
});

test("auto-fix construye prompt solo si diagnostico falla", () => {
  const { buildAutoFixPrompt, nextAutoFixState } = require("../runtime/auto-fix-loop");
  assert.equal(buildAutoFixPrompt({ skipped: true }), "");
  assert.equal(buildAutoFixPrompt({ passed: true, results: [] }), "");
  const prompt = buildAutoFixPrompt({
    passed: false,
    results: [{ ok: false, command: "npm run lint", stderr: "error TS2322: Type 'x'" }],
  }, 1, 3);
  assert.match(prompt, /AUTO-FIX/);
  assert.match(prompt, /TS2322/);
  const exhausted = nextAutoFixState({ cycles: 3 }, {
    passed: false,
    results: [{ ok: false, command: "npm run lint", stderr: "fail" }],
  }, 3);
  assert.equal(exhausted.exhausted, true);
  assert.equal(exhausted.triggered, false);
});

test("browser_interact bloquea URLs remotas", async () => {
  const { browserInteract, isAllowedBrowserUrl } = require("../runtime/browser-interact");
  assert.equal(isAllowedBrowserUrl("http://127.0.0.1:5173/"), true);
  assert.equal(isAllowedBrowserUrl("https://evil.example/"), false);
  await assert.rejects(
    () => browserInteract({ action: "dom", url: "https://evil.example/" }, {
      BrowserWindow: class {},
      startProjectPreview: async () => ({ available: true, url: "http://127.0.0.1:5173/" }),
      rootPath: "D:/tmp",
      senderId: 1,
    }),
    /bloqueada|localhost/i
  );
});

test("semantic_search local encuentra token", async () => {
  const { semanticSearch } = require("../runtime/semantic-index");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sem-"));
  try {
    fs.writeFileSync(path.join(dir, "billing.js"), "// invoice billing total calculator\nfunction calc() { return 42; }\n");
    const result = await semanticSearch(dir, "invoice billing total");
    assert.ok(result.local.length >= 1);
    assert.match(result.local[0].path, /billing\.js/);
    assert.equal(result.qdrant.available, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("generate_image sin config no rompe", async () => {
  const { generateImage } = require("../runtime/image-gen");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-img-"));
  try {
    const result = await generateImage(dir, { prompt: "logo azul" });
    assert.equal(result.available, false);
    assert.equal(result.ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("run_parallel_explore fusiona evidencia solo lectura", async () => {
  const { runParallelExplore, runSubagent } = require("../runtime/subagent-runner");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-par-"));
  try {
    fs.writeFileSync(path.join(dir, "auth.js"), "export function loginUser() {}\n");
    const result = await runParallelExplore(dir, { query: "loginUser auth" });
    assert.equal(result.write, false);
    assert.ok(result.agents.length >= 2);
    const writer = await runSubagent(dir, { role: "implementer", query: "x" });
    assert.equal(writer.ok, false);
    assert.match(String(writer.message || ""), /patches/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lovable one-shot activa pipeline y tools", () => {
  const plan = resolveUnifiedAgentPlan({
    prompt: "CREA EL PROYECTO AHORA una landing moderna de reservas con UI pulida",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
    permissionMode: "default",
  });
  assert.equal(plan.mode, MODES.EXECUTE);
  assert.equal(plan.greenfieldCreate, true);
  assert.equal(plan.lovableOneShot, true);
  assert.match(plan.runProfile.orchestrationBlock, /PIPELINE LOVABLE ONE-SHOT/i);
  assert.match(plan.runProfile.orchestrationBlock, /CHECKLIST DE CIERRE/i);
  assert.ok(plan.allowedTools.includes("inspect_browser"));
  assert.ok(plan.allowedTools.includes("generate_image"));
});

test("oneshot checklist exige preview e inspeccion", () => {
  const { evaluateOneShotFromSteps, buildOneShotGatePrompt } = require("../runtime/oneshot-gate");
  const incomplete = evaluateOneShotFromSteps([
    { name: "write_file", ok: true, input: { path: "index.html" } },
  ]);
  assert.equal(incomplete.ok, false);
  assert.match(buildOneShotGatePrompt(incomplete), /ONE-SHOT/);
  const complete = evaluateOneShotFromSteps([
    { name: "write_file", ok: true, input: { path: "index.html" } },
    { name: "create_project", ok: true, input: { name: "app" } },
    { name: "run_command", ok: true, input: { command: "npm install" } },
    {
      name: "inspect_preview",
      ok: true,
      result: { diagnostics: { horizontalOverflow: false, bodyTextLength: 200 } },
    },
  ]);
  assert.equal(complete.ok, true);
});

test("memoria de proyecto local sin deps de pago", () => {
  const {
    rememberProjectEvent,
    loadProjectMemory,
    formatMemoryForPrompt,
  } = require("../runtime/project-memory");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-mem-"));
  try {
    rememberProjectEvent(dir, {
      task: "Crear landing",
      summary: "Landing lista",
      files: ["src/App.tsx"],
      stack: ["react"],
      decision: "usar vite",
    });
    const memory = loadProjectMemory(dir);
    assert.match(memory.summary, /Landing/);
    assert.ok(memory.recentFiles.includes("src/App.tsx"));
    assert.match(formatMemoryForPrompt(memory), /MEMORIA LOCAL/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("implementer acotado escribe max patches y bloquea secretos", async () => {
  const { runSubagent } = require("../runtime/subagent-runner");
  const { isBlockedPath } = require("../runtime/bounded-implementer");
  assert.equal(isBlockedPath(".env"), true);
  assert.equal(isBlockedPath("src/App.tsx"), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-impl-"));
  try {
    const result = await runSubagent(dir, {
      role: "implementer",
      patches: [{ path: "hello.txt", content: "hola" }],
    }, {
      applyWrite: async (rel, content) => {
        fs.writeFileSync(path.join(dir, rel), content);
      },
    });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(path.join(dir, "hello.txt"), "utf8"), "hola");
    const blocked = await runSubagent(dir, {
      role: "implementer",
      patches: [{ path: ".env", content: "SECRET=1" }],
    }, {
      applyWrite: async () => { throw new Error("no deberia"); },
    });
    assert.equal(blocked.applied[0].ok, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ventanas: slots estables hasta 4", () => {
  const { MAX_WINDOWS, allocateWindowSlot, canOpenWindow } = require("../runtime/window-slots");
  assert.equal(MAX_WINDOWS, 4);
  assert.equal(allocateWindowSlot([]), "main");
  assert.equal(allocateWindowSlot(["main"]), "window-2");
  assert.equal(allocateWindowSlot(["main", "window-2", "window-3", "window-4"]), null);
  assert.equal(canOpenWindow(4), false);
  assert.equal(canOpenWindow(3), true);
});

test("context-store carga .editcore/rules", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rules-"));
  try {
    fs.mkdirSync(path.join(dir, ".editcore", "rules"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".editcore", "rules", "ui.md"), "Usa shadcn y mobile-first.");
    const loaded = loadProjectContext(dir);
    assert.ok(loaded.rules.some((item) => item.name.includes("ui.md")));
    assert.match(loaded.prompt, /shadcn/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("publish-pipeline excluye secretos y resuelve ASAR relativo", () => {
  const { isSecretPath, resolveEditCoreAsarPaths, findGitRoot } = require("../runtime/publish-pipeline");
  assert.equal(isSecretPath(".env"), true);
  assert.equal(isSecretPath(".env.local"), true);
  assert.equal(isSecretPath("src/app.js"), false);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-asar-"));
  try {
    const resources = path.join(tmp, "resources");
    const appDir = path.join(resources, "app");
    fs.mkdirSync(appDir, { recursive: true });
    const info = resolveEditCoreAsarPaths(appDir);
    assert.equal(info.packCwd, resources);
    assert.deepEqual(info.packArgs, ["asar", "pack", "app", "app.asar"]);
    assert.equal(info.asarPath, path.join(resources, "app.asar"));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.equal(typeof findGitRoot(__dirname), "string");
});

test("publishProject falla limpio sin git", async () => {
  const { publishProject } = require("../runtime/publish-pipeline");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-pub-"));
  try {
    const result = await publishProject(dir, { deploy: false, skipPush: true, supabasePush: false });
    assert.equal(result.ok, false);
    assert.match(result.message, /git/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("project-connect escribe .env.local gitignored y manifest", async () => {
  const { writeLocalEnv, writeProjectLinkManifest, assessProjectConnections } = require("../runtime/project-connect");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-conn-"));
  try {
    const env = writeLocalEnv(dir, { SUPABASE_URL: "https://example.test", SUPABASE_ANON_KEY: "test-key" });
    assert.equal(env.ok, true);
    assert.ok(fs.existsSync(path.join(dir, ".env.local")));
    assert.match(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), /\.env\.local/);
    const manifest = writeProjectLinkManifest(dir, {
      github: { remoteUrl: "https://github.com/acme/demo.git" },
      supabase: { url: "https://example.test" },
    });
    assert.equal(manifest.ok, true);
    const assessment = await assessProjectConnections(dir, {
      githubToken: "ghp_x",
      vercelToken: "v_x",
      selfSupabaseUrl: "https://example.test",
      selfSupabaseKey: "key",
    });
    assert.equal(assessment.connections.github.configured, true);
    assert.equal(assessment.connections.selfsupabase.configured, true);
    assert.ok(assessment.missing.includes("git_repo"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("project-audit escribe eventos jsonl", () => {
  const { appendAuditEvent, readAuditEvents } = require("../runtime/project-audit");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-audit-"));
  try {
    appendAuditEvent(dir, { action: "publish", ok: true, branch: "main", sha: "abc123" });
    const events = readAuditEvents(dir, { limit: 5 });
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "publish");
    assert.equal(events[0].branch, "main");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("vercel-env-sync parsea env sin tokens reservados", () => {
  const { parseEnvFile } = require("../runtime/vercel-env-sync");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-env-"));
  try {
    fs.writeFileSync(path.join(dir, ".env.local"), "VITE_API=https://x.test\nVERCEL_TOKEN=secret\nFOO=bar\n");
    const vars = parseEnvFile(path.join(dir, ".env.local"));
    assert.equal(vars.FOO, "bar");
    assert.equal(vars.VERCEL_TOKEN, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("supabase-manager lista migraciones locales", () => {
  const { listLocalMigrations } = require("../runtime/supabase-manager");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sb-"));
  try {
    const mig = path.join(dir, "supabase", "migrations");
    fs.mkdirSync(mig, { recursive: true });
    fs.writeFileSync(path.join(mig, "001_init.sql"), "select 1;");
    const list = listLocalMigrations(dir);
    assert.equal(list.length, 1);
    assert.match(list[0], /001_init\.sql/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("project-maintainer health detecta sin git", async () => {
  const { checkProjectHealth } = require("../runtime/project-maintainer");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-health-"));
  try {
    const health = await checkProjectHealth(dir, {});
    assert.equal(health.ok, false);
    assert.ok(health.issues.includes("sin_git"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("maintenance scheduler config normaliza intervalo", () => {
  const { getSchedulerConfig, setSchedulerConfig } = require("../runtime/maintenance-scheduler");
  const store = {};
  const read = () => store;
  const write = (v) => Object.assign(store, v);
  setSchedulerConfig(read, write, { intervalHours: 999, enabled: false });
  const cfg = getSchedulerConfig(read);
  assert.equal(cfg.intervalHours, 168);
  assert.equal(cfg.enabled, false);
});

test("supabase provision bootstrap crea migracion", () => {
  const { bootstrapSupabaseFolder } = require("../runtime/supabase-provision");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-sbprov-"));
  try {
    const boot = bootstrapSupabaseFolder(dir, { projectName: "demo" });
    assert.equal(boot.ok, true);
    assert.ok(fs.existsSync(path.join(dir, "supabase", "migrations", "00000000000000_editcore_init.sql")));
    assert.ok(fs.existsSync(path.join(dir, "supabase", "config.toml")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("project onboarding detecta package manager", () => {
  const { detectPackageManager } = require("../runtime/project-onboarding");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-onboard-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), "{}", "utf8");
    assert.equal(detectPackageManager(dir), "npm");
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n", "utf8");
    assert.equal(detectPackageManager(dir), "pnpm");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("isProjectOnboardingRequest detecta conectar servicios", () => {
  const ProjectAnalysis = require("../project-analysis");
  assert.equal(ProjectAnalysis.isProjectOnboardingRequest("aplica dependencias y conecta github vercel supabase gafcore"), true);
  assert.equal(ProjectAnalysis.isProjectOnboardingRequest("solo crea el readme"), false);
});

test("plan creacion+conexion prioriza greenfield con onboard al final", () => {
  const { resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");
  const plan = resolveUnifiedAgentPlan({
    prompt: "crea el proyecto y conecta github vercel supabase gafcore",
    requestedAgent: true,
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.greenfieldCreate, true);
  assert.equal(plan.projectOnboarding, false);
  assert.ok(plan.allowedTools.includes("onboard_project"));
});

test("adapter expone herramientas operador con allowWrite", () => {
  const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");
  const adapter = new EditCoreClaudeAdapter({ maxIterations: 4, tokenBudget: 10_000, logger: { log() {}, warn() {}, error() {} } });
  const names = adapter.getAvailableTools({ allowWrite: true }).map((item) => item.function.name);
  for (const toolName of [
    "onboard_project", "publish_project", "connect_project", "provision_project", "create_supabase_project",
  ]) {
    assert.ok(names.includes(toolName), `falta ${toolName} en adapter`);
  }
});

test("modo cursor activo con agente y acceso completo", () => {
  const { resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");
  const { isCursorParityActive, CURSOR_PARITY_ALLOWLIST } = require("../runtime/cursor-parity");
  assert.equal(isCursorParityActive({ isAgent: true, permissionFull: true, permissionReadonly: false }), true);
  const plan = resolveUnifiedAgentPlan({
    prompt: "investiga y corrige el error de build",
    requestedAgent: true,
    projectOpen: true,
    permissionMode: "full",
    allowWrite: true,
    cursorParityEnabled: true,
  });
  assert.equal(plan.cursorParityMode, true);
  assert.ok(plan.allowedTools.includes("onboard_project"));
  assert.ok(CURSOR_PARITY_ALLOWLIST.includes("run_parallel_explore"));
  assert.match(plan.runProfile.orchestrationBlock, /CREA[\s\S]*leelo[\s\S]*ACTUALIZA/i);
  assert.match(plan.runProfile.orchestrationBlock, /PROHIBIDO pedirlo al usuario/i);
  assert.match(plan.runProfile.statusLabel, /Ejecutando|Creando|Conectando|Explorando|Pensando/i);
  assert.doesNotMatch(plan.runProfile.statusLabel, /cursor/i);
});

test("cierra tras verificar si no pidieron publicar", () => {
  const { shouldCloseAfterVerifiedWork, isOperatorPublishRequest } = require("../runtime/cursor-parity");
  const steps = [
    { name: "write_file", ok: true, input: { path: "src/main.jsx" } },
    { name: "run_command", ok: true, input: { command: "npm run build" } },
  ];
  assert.equal(shouldCloseAfterVerifiedWork({
    prompt: "personaliza la lista de tareas y verifica con npm run build",
    allowWrite: true,
    analysisMode: false,
    steps,
  }), true);
  assert.equal(shouldCloseAfterVerifiedWork({
    prompt: "publica en vercel",
    allowWrite: true,
    steps,
  }), false);
  assert.equal(isOperatorPublishRequest("conecta github vercel supabase"), true);
  assert.equal(shouldCloseAfterVerifiedWork({
    prompt: "personaliza la app",
    allowWrite: true,
    steps: [{ name: "write_file", ok: true, input: { path: "ROADMAP.md" } }, { name: "run_command", ok: true, input: { command: "npm install" } }],
  }), false);
});

test("roadmap se crea, se lee y se actualiza al cerrar cambios", () => {
  const {
    ensureProjectRoadmap,
    syncProjectRoadmap,
    readRoadmap,
    formatRoadmapForPrompt,
  } = require("../runtime/project-roadmap");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-roadmap-"));
  try {
    const created = ensureProjectRoadmap(dir, { task: "crear lista de tareas" });
    assert.equal(created.created, true);
    assert.ok(fs.existsSync(path.join(dir, "ROADMAP.md")));
    const loaded = readRoadmap(dir);
    assert.match(loaded.content, /crear lista de tareas/i);
    assert.match(formatRoadmapForPrompt(dir), /YA CARGADO/i);
    const updated = syncProjectRoadmap(dir, {
      task: "lista de tareas",
      files: ["src/main.jsx", "src/styles.css"],
      status: "Cambios cerrados",
      verified: ["npm run build"],
      nextAction: "Partir de este ROADMAP",
    });
    assert.equal(updated.updated, true);
    assert.match(updated.content, /src\/main\.jsx/);
    assert.match(updated.content, /npm run build/);
    const again = ensureProjectRoadmap(dir, { task: "otra" });
    assert.equal(again.created, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("roadmap se genera al analizar el disco, no como stub vacio", () => {
  const { ensureProjectRoadmap, isStubRoadmap } = require("../runtime/project-roadmap");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-roadmap-scan-"));
  try {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name: "pekin-palace",
      scripts: { dev: "vite", build: "vite build" },
    }));
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Pekin</title>");
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "app.js"), "export {};\n");
    fs.writeFileSync(path.join(dir, "ROADMAP.md"), "# Stub\n\n## Estado\n- Fase: scaffold inicial\n\n## Mapa\n- README.md\n");
    const created = ensureProjectRoadmap(dir, { task: "analiza el proyecto" });
    assert.equal(created.scanned, true);
    assert.match(created.content, /index\.html/);
    assert.match(created.content, /package\.json/);
    assert.match(created.content, /src\/app\.js|src\//);
    assert.equal(isStubRoadmap(created.content), false);
    assert.doesNotMatch(created.content, /scaffold inicial/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("context-store incluye ROADMAP.md como punto de partida", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-roadmap-ctx-"));
  try {
    fs.writeFileSync(path.join(dir, "ROADMAP.md"), "# Demo — ROADMAP\n\n## Mapa\n- src/main.jsx\n");
    const loaded = loadProjectContext(dir);
    assert.match(loaded.prompt, /ROADMAP/);
    assert.match(loaded.prompt, /no reexplorar/i);
    assert.match(loaded.roadmap, /src\/main\.jsx/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("preview ignora aviso CSP de Electron", () => {
  function normalizePreviewConsoleMessage(message = "") {
    return String(message || "").replace(/%c/g, "").replace(/\s+/g, " ").trim();
  }
  function isIgnorablePreviewConsoleMessage(message = "") {
    const text = normalizePreviewConsoleMessage(message).toLowerCase();
    if (!text) return true;
    return /electron security warning/.test(text)
      || /insecure content-security-policy/.test(text);
  }
  const electronWarn = "%cElectron Security Warning (Insecure Content-Security-Policy)%c font-weight: bold; This renderer process has either no Content Security Policy";
  assert.equal(isIgnorablePreviewConsoleMessage(electronWarn), true);
  assert.equal(isIgnorablePreviewConsoleMessage("TypeError: Cannot read properties of undefined"), false);
});

test("preload.js parsea sin errores de sintaxis", () => {
  const { execFileSync } = require("node:child_process");
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, ["--check", path.join(__dirname, "..", "preload.js")], { stdio: "pipe" });
  });
});
