"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildProjectIndex,
  searchProjectIndex,
  extractAtMentions,
  enrichPromptWithMentions,
} = require("../runtime/project-index");
const {
  registerMcpServer,
  mcpHealth,
  removeMcpServer,
} = require("../runtime/mcp-registry");
const { readPrivacyMode, setPrivacyMode, assertCloudAllowed } = require("../runtime/privacy-mode");
const { setYoloMode, isCommandAllowed } = require("../runtime/terminal-allowlist");
const { saveLastAgentRun, peekLastAgentRun } = require("../runtime/agent-run-checkpoint");

test("project index indexes and searches tokens", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-idx-"));
  fs.mkdirSync(path.join(root, "resources", "app", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "resources", "app", "runtime", "agent-run-checkpoint.js"), "function saveLastAgentRun() {}\n", "utf8");
  fs.writeFileSync(path.join(root, "readme.md"), "alphaWidget docs\n", "utf8");
  // ruido lejos de priority
  fs.mkdirSync(path.join(root, "other"), { recursive: true });
  for (let i = 0; i < 30; i++) {
    fs.writeFileSync(path.join(root, "other", `noise-${i}.js`), `const n${i}=1;\n`, "utf8");
  }
  const index = buildProjectIndex(root, { maxFiles: 50 });
  assert.ok(index.fileCount >= 2);
  const hits = searchProjectIndex(index, "agent-run-checkpoint", { limit: 5 });
  assert.ok(hits.some((h) => /agent-run-checkpoint\.js$/i.test(h.path)), JSON.stringify(hits));
});

test("@mentions extract and enrich", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-at-"));
  fs.mkdirSync(path.join(root, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(root, "resources", "app", "hello.js"), "module.exports = 1;\n", "utf8");
  const mentions = extractAtMentions("Revisa @resources/app/hello.js y @Files");
  assert.deepEqual(mentions.files, ["resources/app/hello.js"]);
  assert.ok(mentions.tags.includes("Files"));
  const enriched = enrichPromptWithMentions(root, "Explica @resources/app/hello.js");
  assert.match(enriched.prompt, /module\.exports = 1/);
  assert.deepEqual(enriched.injected, ["resources/app/hello.js"]);
});

test("@Docs @Folders @Web tags inject context", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-at2-"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "# Demo docs body\n", "utf8");
  fs.writeFileSync(path.join(root, "docs", "guide.md"), "guide content\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "a.js"), "export const a = 1;\n", "utf8");
  const mentions = extractAtMentions("Lee @Docs y @src y @Web https://example.com/x");
  assert.ok(mentions.tags.includes("Docs"));
  assert.ok(mentions.tags.includes("Web"));
  assert.ok(mentions.urls.some((u) => /example\.com/.test(u)));
  assert.ok(mentions.folders.includes("src"));
  const enriched = enrichPromptWithMentions(root, "Lee @Docs @src");
  assert.match(enriched.prompt, /Demo docs body|guide content/);
  assert.match(enriched.prompt, /@Folders src|dir |file a\.js/);
});

test("index includes symbols and schemas", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-idx2-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "supabase", "migrations"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "svc.js"), "export function doWork() { return 1; }\nexport class Worker {}\n", "utf8");
  fs.writeFileSync(path.join(root, "supabase", "migrations", "001_init.sql"), "create table t(id int);\n", "utf8");
  const index = buildProjectIndex(root, { maxFiles: 50 });
  assert.ok(index.symbolCount >= 1, `symbols=${index.symbolCount}`);
  assert.ok(index.schemaCount >= 1, `schemas=${index.schemaCount}`);
  const hits = searchProjectIndex(index, "doWork", { limit: 5 });
  assert.ok(hits.some((h) => /svc\.js$/i.test(h.path)), JSON.stringify(hits));
});

test("cursor rules load into project context", () => {
  const { loadProjectContext } = require("../runtime/context-store");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-rules-"));
  fs.mkdirSync(path.join(root, ".cursor", "rules"), { recursive: true });
  fs.writeFileSync(path.join(root, ".cursorrules"), "ROOT_RULE_ALPHA\n", "utf8");
  fs.writeFileSync(path.join(root, ".cursor", "rules", "backend.mdc"), "BACKEND_RULE_BETA\n", "utf8");
  const loaded = loadProjectContext(root);
  assert.ok(loaded.rules.some((r) => /ROOT_RULE_ALPHA/.test(r.content)));
  assert.ok(loaded.rules.some((r) => /BACKEND_RULE_BETA/.test(r.content)));
  assert.match(loaded.prompt, /BACKEND_RULE_BETA/);
});

test("mcp registry writes project mcp.json", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-mcp-"));
  const entry = registerMcpServer(root, {
    name: "echo",
    command: "node",
    args: ["resources/app/test/fixtures/mcp-echo-server.js"],
  });
  assert.equal(entry.id, "echo");
  assert.ok(fs.existsSync(path.join(root, ".editcore", "mcp.json")));
  const health = mcpHealth(root, { userDataPath: path.join(root, "ud") });
  assert.equal(health.serverCount, 1);
  removeMcpServer(root, "echo");
  assert.equal(mcpHealth(root).serverCount, 0);
});

test("privacy mode blocks cloud", () => {
  const { privacyMode } = setPrivacyMode({}, true);
  assert.equal(readPrivacyMode({ privacyMode }).enabled, true);
  assert.equal(assertCloudAllowed(privacyMode, "openai").ok, false);
  assert.equal(assertCloudAllowed(privacyMode, "ollama").ok, true);
});

test("yolo allowlist gate", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-yolo-"));
  assert.equal(isCommandAllowed(root, "node --version").ok, true);
  assert.equal(isCommandAllowed(root, "my-custom-cli build").ok, false);
  setYoloMode(root, true);
  assert.equal(isCommandAllowed(root, "my-custom-cli build").ok, true);
});

test("checkpoint stores multi-step metadata", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-cp-ud-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "ec-cp-proj-"));
  const rel = "a.txt";
  fs.writeFileSync(path.join(project, rel), "x", "utf8");
  saveLastAgentRun(userData, project, {
    runId: "r1",
    task: "demo",
    files: [{ path: rel, action: "write_file", created: true }],
    steps: [
      { tool: "read_file", path: rel },
      { tool: "write_file", path: rel, summary: "ok" },
    ],
  });
  const peek = peekLastAgentRun(userData, project);
  assert.equal(peek.version, 2);
  assert.equal(peek.stepCount, 2);
  assert.match(peek.checkpointNote, /2 paso/);
});

test("hunk review can accept one and reject another", () => {
  const { parseUnifiedHunks, applyHunkDecisions } = require("../runtime/hunk-review");
  const { buildUnifiedDiff } = require("../runtime/diff-preview");
  const before = "a\nb\nc\nd\ne\nf\n";
  const after = "a\nB\nc\nd\nE\nf\n";
  const diff = buildUnifiedDiff("x.txt", before, after);
  const hunks = parseUnifiedHunks(diff);
  assert.ok(hunks.length >= 1);
  if (hunks.length === 1) {
    const out = applyHunkDecisions(before, hunks, { [hunks[0].id]: "accept" });
    assert.match(out, /B/);
  } else {
    const decisions = Object.fromEntries(hunks.map((h, i) => [h.id, i === 0 ? "accept" : "reject"]));
    const out = applyHunkDecisions(before, hunks, decisions);
    assert.match(out, /B/);
  }
});

test("scoped rules and workflow scaffold", () => {
  const { ensureWorkflowScaffold, loadScopedRules, listWorkflows } = require("../runtime/project-rules-workflows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-wf-"));
  ensureWorkflowScaffold(root);
  assert.ok(listWorkflows(root).length >= 1);
  const rules = loadScopedRules(root, "src/main.js");
  assert.ok(rules.some((r) => /src/.test(r.scope)));
});

test("propose_diff returns hunks", () => {
  const { proposeDiff, applyDiff } = require("../runtime/diff-preview");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-diff-"));
  fs.writeFileSync(path.join(root, "a.txt"), "one\ntwo\nthree\n", "utf8");
  const proposed = proposeDiff(root, { path: "a.txt", content: "one\nTWO\nthree\n" });
  assert.equal(proposed.ok, true);
  assert.ok(Array.isArray(proposed.hunks));
  assert.ok(proposed.hunks.length >= 1);
  const applied = applyDiff(root, { proposalId: proposed.proposalId }, {
    writeFile: (rel, content) => fs.writeFileSync(path.join(root, rel), content, "utf8"),
  });
  assert.equal(applied.ok, true);
  assert.match(fs.readFileSync(path.join(root, "a.txt"), "utf8"), /TWO/);
});

test("session export writes markdown", () => {
  const { exportSession } = require("../runtime/session-export");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-sess-"));
  const out = exportSession(root, {
    title: "Demo",
    messages: [{ role: "user", content: "hola" }, { role: "assistant", content: "mundo" }],
  });
  assert.equal(out.ok, true);
  assert.ok(fs.existsSync(path.join(root, out.path)));
  assert.match(fs.readFileSync(path.join(root, out.path), "utf8"), /hola/);
});

test("tdd cycle runs and reports", () => {
  const { runTddCycle, generateFixtureStub } = require("../runtime/tdd-cycle");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-tdd-"));
  fs.writeFileSync(path.join(root, "package.json"), "{\"name\":\"t\"}\n", "utf8");
  const fixture = generateFixtureStub({ name: "user", fields: ["id", "email"] });
  assert.match(fixture, /email/);
  // green path: phase green with passing test
  const out = runTddCycle(root, {
    phase: "green",
    testPath: "test/ok.test.js",
    testContent: "const test=require('node:test');const assert=require('node:assert');test('ok',()=>assert.equal(1,1));\n",
    command: "node --test test/ok.test.js",
    forceWriteTest: true,
  });
  assert.equal(out.passed, true);
  assert.equal(out.nextPhase, "refactor");
});

test("migration batch checkpoint and rollback", () => {
  const { runMigrationBatch, rollbackMigrationBatch } = require("../runtime/migration-playbooks");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-migb-"));
  fs.writeFileSync(path.join(root, "a.txt"), "old\n", "utf8");
  const run = runMigrationBatch(root, {
    batch: [{ path: "a.txt", content: "new\n" }, { path: "b.txt", content: "created\n" }],
  });
  assert.equal(run.ok, true);
  assert.match(fs.readFileSync(path.join(root, "a.txt"), "utf8"), /new/);
  const rb = rollbackMigrationBatch(root, run.runId);
  assert.equal(rb.ok, true);
  assert.match(fs.readFileSync(path.join(root, "a.txt"), "utf8"), /old/);
  assert.equal(fs.existsSync(path.join(root, "b.txt")), false);
});

test("mcp registry allows multiple servers", () => {
  const { registerMcpServer, mcpHealth } = require("../runtime/mcp-registry");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-mcp2-"));
  registerMcpServer(root, {
    name: "echo1",
    command: "node",
    args: ["resources/app/test/fixtures/mcp-echo-server.js"],
  });
  registerMcpServer(root, {
    name: "http-demo",
    transport: "http",
    url: "http://127.0.0.1:9/mcp",
  });
  const health = mcpHealth(root);
  assert.ok(health.serverCount >= 2);
});


test("migration playbook writes checklist", () => {
  const { applyMigrationPlaybook, listMigrationPlaybooks } = require("../runtime/migration-playbooks");
  assert.ok(listMigrationPlaybooks().length >= 2);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-mig-"));
  const out = applyMigrationPlaybook(root, "js-to-ts");
  assert.equal(out.ok, true);
  assert.ok(fs.existsSync(path.join(root, "tsconfig.json")));
});

test("log tail reads preview log", () => {
  const { appendPreviewLog, tailLog } = require("../runtime/log-tail");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-log-"));
  appendPreviewLog(root, "line-one\nline-two\n");
  const out = tailLog(root, { maxLines: 10 });
  assert.equal(out.ok, true);
  assert.match(out.content, /line-two/);
});

test("dead code audit returns structure", () => {
  const { auditDeadCode } = require("../runtime/dead-code-audit");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-dead-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "orphan.js"), "export function neverUsed(){return 1}\n", "utf8");
  fs.writeFileSync(path.join(root, "src", "main.js"), "export function main(){return 2}\n", "utf8");
  const out = auditDeadCode(root, { limit: 20 });
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.orphanExports));
});

test("workflow run executes read_file step", () => {
  const { ensureWorkflowScaffold, runWorkflow } = require("../runtime/project-rules-workflows");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-wfrun-"));
  fs.writeFileSync(path.join(root, "package.json"), "{\"name\":\"demo\"}\n", "utf8");
  ensureWorkflowScaffold(root);
  const out = runWorkflow(root, "smoke-verify", {
    runCommand: () => ({ ok: true, code: 0, stdout: "v20\n", stderr: "" }),
  });
  assert.equal(out.ok, true);
  assert.ok(out.results.some((r) => r.type === "read_file" && r.ok));
});

test("docker compose resolves file after playbook", () => {
  const { applyDockerPlaybook, resolveComposeFile } = require("../runtime/docker-playbooks");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-dcrun-"));
  applyDockerPlaybook(root, "node");
  assert.ok(resolveComposeFile(root));
});

test("project chat store survives save/load/merge", () => {
  const {
    saveProjectChats,
    loadProjectChats,
    mergeProjectChatState,
  } = require("../runtime/project-chat-store");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-chats-"));
  const saved = saveProjectChats(root, {
    activeChatId: "c1",
    chats: [{
      id: "c1",
      title: "Trabajo",
      messages: [
        { role: "user", content: "hola durable" },
        { role: "assistant", content: "respuesta guardada" },
      ],
      updatedAt: Date.now(),
    }],
  });
  assert.equal(saved.ok, true);
  assert.ok(fs.existsSync(path.join(root, ".editcore", "chats.json")));
  const loaded = loadProjectChats(root);
  assert.match(loaded.chats[0].messages[0].content, /hola durable/);
  const merged = mergeProjectChatState(
    { id: "p1", chats: [{ id: "c1", messages: [{ role: "user", content: "corto" }], updatedAt: 1 }] },
    loaded,
  );
  assert.match(merged.chats[0].messages[1].content, /respuesta guardada/);
});


