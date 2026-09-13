"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  collectSiblingReadRoots,
  resolveAccessibleTarget,
} = require("../project-path-policy");
const { formatWorkspaceSiblingMap, listWorkspaceSiblings } = require("../runtime/workspace-siblings");
const { assertProbeUrl, probeEndpoint } = require("../runtime/probe-endpoint");
const { formatJarvisContextForPrompt, ROADMAP_FIRST_RULE } = require("../runtime/jarvis-port");
const { defaultChatSystemPrompt } = require("../runtime/elite-communication-policy");

test("manifest exists and prompt ingests roadmap-first + manifest", () => {
  const manifest = path.join(__dirname, "..", "EDITCORE-MANIFEST.md");
  assert.ok(fs.existsSync(manifest));
  assert.match(ROADMAP_FIRST_RULE, /EDITCORE-MANIFEST/);
  assert.match(defaultChatSystemPrompt(), /ROADMAP-FIRST|session-state/i);
  assert.match(defaultChatSystemPrompt(), /SECUENCIA OPERAR|safeStorage|project-infra/i);
  const { OPERATE_SEQUENCE_RULE } = require("../runtime/jarvis-port");
  assert.match(OPERATE_SEQUENCE_RULE, /BÓVEDA|project-infra|deploy_github/i);
  const ctx = formatJarvisContextForPrompt(__dirname + "/..");
  assert.match(ctx, /EDITCORE-MANIFEST|ROADMAP-FIRST/);
  assert.match(ctx, /SECUENCIA OPERAR/);
});

test("publicar/deploy escala a agente y no es chat narrativo", () => {
  const ProjectAnalysis = require("../project-analysis");
  assert.equal(ProjectAnalysis.isCloudOperateRequest("publica en vercel"), true);
  assert.equal(ProjectAnalysis.isCloudOperateRequest("haz deploy"), true);
  assert.equal(ProjectAnalysis.isChangeRequest("publica el proyecto"), true);
  const mode = ProjectAnalysis.resolveExecutionMode("publica en vercel", {
    requestedAgent: false,
    projectOpen: true,
  });
  assert.equal(mode.autoEscalatedAgent, true);
  assert.equal(mode.isAgent, true);
});

test("sibling read roots allow parent workspace", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-sib-"));
  const parent = path.join(dir, "PROGRAMAS");
  const a = path.join(parent, "APP_A");
  const b = path.join(parent, "APP_B");
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(b, "secret-config.js"), "module.exports={ok:1}\n");
  const roots = collectSiblingReadRoots(a);
  assert.ok(roots.some((r) => r.toLowerCase() === parent.toLowerCase()));
  const hit = resolveAccessibleTarget(a, "../APP_B/secret-config.js", { allowedRoots: roots });
  assert.equal(hit.outsidePrimary, true);
  assert.ok(fs.existsSync(hit.absolute));
  const byName = resolveAccessibleTarget(a, "APP_B/secret-config.js", { allowedRoots: roots });
  assert.ok(byName.absolute.endsWith("secret-config.js"));
  const map = listWorkspaceSiblings(a);
  assert.ok(map.siblings.some((s) => s.name === "APP_B"));
  assert.match(formatWorkspaceSiblingMap(a), /WORKSPACE SIBLINGS/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("probe_endpoint rejects non-local hosts", () => {
  assert.throws(() => assertProbeUrl("https://evil.example.com/x"), /no permitido/i);
  assert.ok(assertProbeUrl("http://127.0.0.1:8080/api/health"));
});

test("probe_endpoint times out gracefully on closed port", async () => {
  const result = await probeEndpoint({ url: "http://127.0.0.1:59999/health", timeoutMs: 1200 });
  assert.equal(result.ok, false);
  assert.ok(result.error || result.status === 0);
});
