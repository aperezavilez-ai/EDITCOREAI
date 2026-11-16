"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const gitManager = require("../runtime/git-manager");
const { isSecretPath } = require("../runtime/publish-pipeline");

function createTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-streamline-"));
  spawnSync("git", ["init"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "test@editcore.local"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "EditCore Streamline"], { cwd: dir });
  return dir;
}

test("publish-streamline: isSecretPath distingue .env real de .env.example y plantillas", () => {
  assert.equal(isSecretPath(".env"), true);
  assert.equal(isSecretPath(".env.local"), true);
  assert.equal(isSecretPath(".env.production"), true);
  assert.equal(isSecretPath("credentials.json"), true);
  assert.equal(isSecretPath("server.key"), true);

  // Plantillas de ejemplo permitidas
  assert.equal(isSecretPath(".env.example"), false);
  assert.equal(isSecretPath(".env.sample"), false);
  assert.equal(isSecretPath(".env.template"), false);
  assert.equal(isSecretPath(".env.dist"), false);
});

test("publish-streamline: stageFiles commitea .env.example pero bloquea .env", async () => {
  const repo = createTempRepo();
  try {
    fs.writeFileSync(path.join(repo, ".env"), "SECRET=super_secret\n");
    fs.writeFileSync(path.join(repo, ".env.example"), "SECRET=your_key_here\n");
    fs.writeFileSync(path.join(repo, "app.js"), "console.log('hello');\n");

    const stage = await gitManager.stageFiles([".env", ".env.example", "app.js"], repo);
    assert.equal(stage.ok, true);
    assert.ok(stage.blockedSecrets.includes(".env"));
    assert.ok(stage.staged.includes(".env.example"));
    assert.ok(stage.staged.includes("app.js"));

    const commit = await gitManager.commit("feat: plantilla de ejemplo", repo);
    assert.equal(commit.ok, true);

    const ls = spawnSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: repo, encoding: "utf8" });
    const committedFiles = ls.stdout.split(/\r?\n/).filter(Boolean);
    assert.ok(committedFiles.includes(".env.example"), ".env.example debe estar en el commit");
    assert.ok(committedFiles.includes("app.js"), "app.js debe estar en el commit");
    assert.ok(!committedFiles.includes(".env"), ".env real NUNCA debe estar en el commit");
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  }
});

test("publish-streamline: stageFiles descarta archivos internos de .editcore sin fallar", async () => {
  const repo = createTempRepo();
  try {
    const editcoreDir = path.join(repo, ".editcore");
    fs.mkdirSync(editcoreDir, { recursive: true });
    fs.writeFileSync(path.join(editcoreDir, "chats.json"), "{}\n");
    fs.writeFileSync(path.join(editcoreDir, "preview.log"), "preview started\n");
    fs.writeFileSync(path.join(repo, "index.html"), "<h1>Hola</h1>\n");

    // El agente pasa archivos de .editcore junto a un archivo real
    const stage = await gitManager.stageFiles([".editcore/chats.json", ".editcore/preview.log", "index.html"], repo);
    assert.equal(stage.ok, true);
    assert.ok(stage.staged.includes("index.html"));
    assert.ok(!stage.staged.includes(".editcore/chats.json"));
    assert.ok(!stage.staged.includes(".editcore/preview.log"));

    const commit = await gitManager.commit("feat: index agregado", repo);
    assert.equal(commit.ok, true);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  }
});

test("publish-streamline: commit en arbol limpio retorna noop exitoso sin romper el flujo", async () => {
  const repo = createTempRepo();
  try {
    fs.writeFileSync(path.join(repo, "README.md"), "# Test\n");
    await gitManager.stageFiles(["README.md"], repo);
    await gitManager.commit("init", repo);

    // Sin cambios adicionales
    const commitNoop = await gitManager.commit("sin cambios", repo);
    assert.equal(commitNoop.ok, true);
    assert.equal(commitNoop.noop, true);
    assert.match(commitNoop.message, /árbol de trabajo limpio/i);
  } finally {
    try { fs.rmSync(repo, { recursive: true, force: true }); } catch {}
  }
});
