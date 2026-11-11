"use strict";

// [EDITCORE-INTEGRAL-B8] PUBLICACIÓN: una sola pila git, evidencia
// siempre, ningún éxito sin comprobar. Pruebas de COMPORTAMIENTO
// (patrón publicacion-verificada: deps/fetch/runner inyectados, sin
// red real; git real solo en repos temporales).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const gitManager = require("../runtime/git-manager");
const kernelTools = require("../editcore-chat-kernel/tools");
const { sshDeploy } = require("../runtime/ssh-deploy");
const { createCloudVaultBridge } = require("../runtime/cloud-vault-bridge");
const { deployOneClick } = require("../runtime/deploy-one-click");
const { publishProject, DEPLOY_EVIDENCE_LOG_CAP } = require("../runtime/publish-pipeline");
const { executeFullStackDeploy } = require("../runtime/fullstack-deploy");
const { formatExternalActionResult } = require("../editcore-chat-kernel/orchestrator");

function gitSync(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  return { code: r.status, stdout: String(r.stdout || "").trim(), stderr: String(r.stderr || "").trim() };
}

function initRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b8-"));
  gitSync(dir, ["init"]);
  gitSync(dir, ["config", "user.email", "test@editcore.local"]);
  gitSync(dir, ["config", "user.name", "EditCore Test"]);
  return dir;
}

// ---------- (1) git_commit del kernel: sin secretos, sin inyección ----------

test("B8 git_commit del kernel: el .env NO entra en el commit y el mensaje con comillas/% no inyecta", async () => {
  const repo = initRepo();
  fs.writeFileSync(path.join(repo, ".env"), "SECRET=1\n");
  fs.writeFileSync(path.join(repo, "app.js"), "console.log(1)\n");
  const message = 'fix: mensaje con "comillas" y %PATH% y $(whoami)';
  const res = await kernelTools.gitCommit(repo, { message });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok((res.blockedSecrets || []).includes(".env"), "el .env se declara bloqueado");
  const tree = gitSync(repo, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout.split("\n");
  assert.ok(tree.includes("app.js"), "el archivo normal sí se commitea");
  assert.ok(!tree.includes(".env"), "el .env NO está en el commit");
  const subject = gitSync(repo, ["log", "-1", "--pretty=%s"]).stdout;
  assert.equal(subject, message, "el mensaje llega literal vía -F, sin romper ni inyectar");
  fs.rmSync(repo, { recursive: true, force: true });
});

test("B8 git-manager: stageFiles con lista explícita también filtra secretos", async () => {
  const repo = initRepo();
  fs.writeFileSync(path.join(repo, "credentials.json"), "{}\n");
  fs.writeFileSync(path.join(repo, "ok.txt"), "ok\n");
  const stage = await gitManager.stageFiles(["credentials.json", "ok.txt"], repo);
  assert.equal(stage.ok, true);
  assert.deepEqual(stage.blockedSecrets, ["credentials.json"]);
  assert.deepEqual(stage.staged, ["ok.txt"]);
  const commit = await gitManager.commit("solo ok", repo);
  assert.equal(commit.ok, true);
  const tree = gitSync(repo, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout;
  assert.ok(!tree.includes("credentials.json"));
  fs.rmSync(repo, { recursive: true, force: true });
});

// ---------- (6) lock transitorio: el retry lo supera sin borrar el lock ----------

test("B8 git commit con index.lock transitorio: el retry de lock lo supera (el lock lo libera otro, nunca nosotros)", async () => {
  const repo = initRepo();
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  const stage = await gitManager.stageFiles(["a.txt"], repo);
  assert.equal(stage.ok, true);
  const lockPath = path.join(repo, ".git", "index.lock");
  fs.writeFileSync(lockPath, "");
  // El «otro proceso» libera su lock a los ~300 ms; el retry (1.5 s) entra
  // después. [EDITCORE-INTEGRAL-B8] En Windows, borrar un archivo recién
  // creado puede fallar en silencio (el antivirus/indexador lo retiene un
  // instante) y la primera versión de esta prueba tragaba ese error: el
  // lock quedaba puesto y los 3 intentos del producto chocaban con él. La
  // liberación ahora reintenta cada 100 ms hasta que el archivo desaparece
  // de verdad, con presupuesto de 2.5 s (dentro de la ventana de reintentos
  // del producto: 2 × 1.5 s). El producto no se toca: jamás borra el lock.
  const releaseStart = Date.now();
  let releaseInterval = null;
  const releaseTimer = setTimeout(() => {
    const tryRelease = () => {
      try { fs.unlinkSync(lockPath); } catch { /* retenido un instante más */ }
      if (!fs.existsSync(lockPath) || Date.now() - releaseStart > 2500) clearInterval(releaseInterval);
    };
    releaseInterval = setInterval(tryRelease, 100);
    tryRelease();
  }, 300);
  try {
    const res = await gitManager.commit("con lock transitorio", repo);
    assert.equal(res.ok, true, res.message || "");
    assert.equal(gitSync(repo, ["log", "-1", "--pretty=%s"]).stdout, "con lock transitorio");
  } finally {
    clearTimeout(releaseTimer);
    if (releaseInterval) clearInterval(releaseInterval);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---------- (2) ssh_deploy: ok sale del pull/restart reales + humo ----------

function fakeSsh({ pullOk = true, restartOk = true, calls = [] } = {}) {
  return async (_connections, command) => {
    calls.push(command);
    if (String(command).includes("git pull")) {
      return pullOk ? { ok: true, code: 0, stdout: "Already up to date.", stderr: "" } : { ok: false, code: 1, stdout: "", stderr: "error: merge conflict", message: "error: merge conflict" };
    }
    return restartOk ? { ok: true, code: 0, stdout: "restarted", stderr: "" } : { ok: false, code: 1, stdout: "", stderr: "pm2: app not found", message: "pm2: app not found" };
  };
}
const sshConn = { serverHost: "root@1.2.3.4", serverKeyPath: "/tmp/x", customServerUrl: "https://app.example.com" };
const smokeDeps = (status) => ({ fetchImpl: async () => ({ status }), sleepImpl: async () => {} });

test("B8 sshDeploy: pull que falla ⇒ ok:false y el restart ni se intenta", async () => {
  const calls = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b8-ssh-"));
  const res = await sshDeploy(root, sshConn, { deps: { runSshImpl: fakeSsh({ pullOk: false, calls }), ...smokeDeps(200) } });
  assert.equal(res.ok, false);
  assert.equal(res.step, "pull");
  assert.equal(calls.length, 1, "sin restart tras un pull fallido");
  fs.rmSync(root, { recursive: true, force: true });
});

test("B8 sshDeploy: pull+restart OK + humo 200 ⇒ ok:true verificado, con humo registrado", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b8-ssh-"));
  const res = await sshDeploy(root, sshConn, { deps: { runSshImpl: fakeSsh({}), ...smokeDeps(200) } });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.verified, true);
  assert.equal(res.smoke[0].status, 200);
  fs.rmSync(root, { recursive: true, force: true });
});

test("B8 sshDeploy: humo 500 ⇒ ok:false (caído); humo 404 ⇒ ok:false no verificado; sin URL ⇒ «sin humo» declarado", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b8-ssh-"));
  const down = await sshDeploy(root, sshConn, { deps: { runSshImpl: fakeSsh({}), ...smokeDeps(500) } });
  assert.equal(down.ok, false);
  assert.equal(down.productionDown, true);
  const nv = await sshDeploy(root, sshConn, { deps: { runSshImpl: fakeSsh({}), ...smokeDeps(404) } });
  assert.equal(nv.ok, false);
  assert.equal(nv.smokeNotVerified, true);
  const noUrl = await sshDeploy(root, { serverHost: "root@1.2.3.4", serverKeyPath: "/tmp/x" }, { deps: { runSshImpl: fakeSsh({}), ...smokeDeps(200) } });
  assert.equal(noUrl.ok, false);
  assert.equal(noUrl.smokeSkipped, true);
  assert.match(noUrl.message, /sin humo: no hay URL/);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- (3) bóveda: ok refleja el deploy real; URL vieja nunca como nueva ----------

function tmpProjectWithOldInfra() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b8-vault-"));
  fs.writeFileSync(path.join(root, "project-infra.json"), JSON.stringify({ liveUrl: "https://old.vercel.app", vercelUrl: "https://old.vercel.app" }));
  return root;
}
function makeBridge(deployImpl) {
  return createCloudVaultBridge({
    getConnections: () => ({ vercelToken: "tok-test", githubToken: "tok-test" }),
    connectProjectImpl: async () => ({ vercel: { projectId: "prj_1", name: "demo", url: "https://old.vercel.app" } }),
    syncEnvToVercelImpl: async () => ({ ok: true, projectId: "prj_1" }),
    deployOneClickImpl: deployImpl,
  });
}

test("B8 deployVercel de la bóveda: deploy fallido ⇒ ok:false y la liveUrl escrita NO es la vieja", async () => {
  const root = tmpProjectWithOldInfra();
  const bridge = makeBridge(async () => ({ ok: false, message: "token expirado" }));
  const res = await bridge.deployVercel(root, {});
  assert.equal(res.ok, false);
  assert.equal(res.deployed, false);
  assert.equal(res.liveUrl, "");
  assert.equal(res.previousUrl, "https://old.vercel.app", "la anterior viaja como dato, no como logro");
  const infra = JSON.parse(fs.readFileSync(path.join(root, "project-infra.json"), "utf8"));
  assert.notEqual(infra.liveUrl, "https://old.vercel.app", "la infra no queda contaminada con la liveUrl vieja");
  fs.rmSync(root, { recursive: true, force: true });
});

test("B8 deployVercel de la bóveda: deploy bueno ⇒ ok:true y URL nueva en resultado e infra", async () => {
  const root = tmpProjectWithOldInfra();
  const bridge = makeBridge(async () => ({ ok: true, verified: true, url: "https://new.vercel.app", smoke: [{ url: "https://new.vercel.app", status: 200 }] }));
  const res = await bridge.deployVercel(root, {});
  assert.equal(res.ok, true);
  assert.equal(res.liveUrl, "https://new.vercel.app");
  const infra = JSON.parse(fs.readFileSync(path.join(root, "project-infra.json"), "utf8"));
  assert.equal(infra.liveUrl, "https://new.vercel.app");
  fs.rmSync(root, { recursive: true, force: true });
});

test("B8 deployGithub de la bóveda: push fallido ⇒ ok:false (antes ok:true con pushed:false enterrado)", async () => {
  const root = tmpProjectWithOldInfra();
  const bridge = createCloudVaultBridge({
    getConnections: () => ({ githubToken: "tok-test" }),
    connectProjectImpl: async () => ({ github: { remoteUrl: "https://github.com/x/demo.git", fullName: "x/demo" } }),
    publishProjectImpl: async () => ({ ok: false, message: "push rechazado" }),
  });
  const res = await bridge.deployGithub(root, {});
  assert.equal(res.ok, false);
  assert.equal(res.pushed, false);
  assert.match(res.message, /push/i);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- (4) humo de deployOneClick: responde ≠ verificado ----------

function tmpVercelProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b8-humo-"));
  fs.mkdirSync(path.join(root, ".vercel"), { recursive: true });
  fs.writeFileSync(path.join(root, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_test", orgId: "team_test", projectName: "demo-app" }));
  fs.writeFileSync(path.join(root, "vercel.json"), "{}\n");
  return root;
}
function deployDeps(smokeStatus) {
  return {
    runProcessImpl: async () => ({ code: 0, stdout: "Production: https://demo-app.vercel.app\n", stderr: "" }),
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      if (String(url).startsWith("https://demo-app.vercel.app")) return { status: smokeStatus };
      if (String(url).includes("api.vercel.com")) return { ok: false, status: 403, json: async () => ({}) };
      throw new Error(`fetch inesperado: ${url}`);
    },
  };
}

test("B8 humo: 404 en ruta principal ⇒ NO verificado con causa, y NO productionDown", async () => {
  const root = tmpVercelProject();
  const res = await deployOneClick(root, { provider: "vercel", production: true }, { connections: { vercelToken: "tok" }, deps: deployDeps(404) });
  assert.equal(res.ok, true, "el deploy terminó: no es un fallo de publicación");
  assert.equal(res.verified, false);
  assert.equal(res.smokeNotVerified, true);
  assert.match(res.smokeCause, /404.*no es la app/);
  assert.equal(res.productionDown, undefined);
  assert.equal(res.publishFailed, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test("B8 humo: 401 igual (no verificado); 200 verificado; 500 = el camino de fallo de siempre", async () => {
  const root = tmpVercelProject();
  const r401 = await deployOneClick(root, { provider: "vercel", production: true }, { connections: { vercelToken: "tok" }, deps: deployDeps(401) });
  assert.equal(r401.smokeNotVerified, true);
  assert.equal(r401.verified, false);
  assert.equal(r401.productionDown, undefined);
  const r200 = await deployOneClick(root, { provider: "vercel", production: true }, { connections: { vercelToken: "tok" }, deps: deployDeps(200) });
  assert.equal(r200.ok, true);
  assert.equal(r200.verified, true);
  const r500 = await deployOneClick(root, { provider: "vercel", production: true }, { connections: { vercelToken: "tok" }, deps: deployDeps(500) });
  assert.equal(r500.ok, false);
  assert.equal(r500.productionDown, true);
  assert.equal(r500.publishFailed, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("B8 deploy_one_click: el viejo {target:'vercel'} se traduce (compatibilidad) y production llega", async () => {
  const root = tmpVercelProject();
  let seenArgs = null;
  const deps = deployDeps(200);
  const origRun = deps.runProcessImpl;
  deps.runProcessImpl = async (...a) => { seenArgs = a[1]; return origRun(...a); };
  const res = await deployOneClick(root, { target: "vercel" }, { connections: { vercelToken: "tok" }, deps });
  assert.equal(res.provider, "vercel");
  assert.equal(res.ok, true);
  assert.ok(seenArgs.includes("--prod"), "target sin production ⇒ producción por defecto, como antes");
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------- (5) publish_project: URL en la raíz + evidencia acotada en el step ----------

test("B8 publish_project: la raíz trae la url, el step conserva smoke/logs con su tope y el formateador la muestra", async () => {
  const repo = initRepo();
  fs.writeFileSync(path.join(repo, "index.html"), "<h1>hola</h1>\n");
  const longLogs = `linea de log\n${"x".repeat(5000)}`;
  const result = await publishProject(repo, {
    mode: "project",
    connections: {},
    deploy: true,
    supabasePush: false,
    skipPush: true,
    preCheck: false,
    rollbackOnDeployFail: false,
    commitMessage: "chore: b8 publish",
    deployOneClickImpl: async () => ({
      ok: true, provider: "vercel", url: "https://new.vercel.app",
      message: "Deploy OK", output: "salida del CLI",
      smoke: [{ url: "https://new.vercel.app", status: 200 }],
      logs: longLogs,
    }),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.url, "https://new.vercel.app", "url en la RAÍZ del resultado");
  const step = result.steps.find((s) => s.step === "deploy_one_click");
  assert.equal(step.url, "https://new.vercel.app");
  assert.deepEqual(step.smoke, [{ url: "https://new.vercel.app", status: 200 }]);
  assert.ok(typeof step.logs === "string" && step.logs.length <= DEPLOY_EVIDENCE_LOG_CAP, `logs del step acotados a su tope (${DEPLOY_EVIDENCE_LOG_CAP})`);
  const text = formatExternalActionResult("publish_project", result);
  assert.match(text, /https:\/\/new\.vercel\.app/, "formatExternalActionResult (exportada) muestra la URL");
  fs.rmSync(repo, { recursive: true, force: true });
});

// ---------- fullstack: la URL vieja no se presenta como recién publicada ----------

test("B8 fullstack update con skipDeploy: liveUrl del resultado vacía y la anterior solo como dato", async () => {
  const root = tmpProjectWithOldInfra();
  const res = await executeFullStackDeploy(root, { githubToken: "tok" }, {
    mode: "update",
    skipDeploy: true,
    deps: {
      publishProjectImpl: async () => ({
        ok: true, branch: "main", sha: "abc1234", message: "Push OK",
        steps: [
          { step: "git_commit", ok: true, committed: true },
          { step: "deploy_one_click", ok: true, skipped: true, url: "" },
        ],
      }),
    },
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.deployed, false);
  assert.equal(res.liveUrl, "", "sin URL nueva: la del resultado NO es la vieja");
  assert.equal(res.previousLiveUrl, "https://old.vercel.app");
  assert.doesNotMatch(res.message, /Publicado: https:\/\/old/);
  assert.match(res.message, /no se presenta como recién publicada/);
  const liveStage = res.stages.find((s) => s.id === "live");
  assert.notEqual(liveStage.status, "done");
  fs.rmSync(root, { recursive: true, force: true });
});

test("B8 fullstack con URL nueva: se presenta la nueva", async () => {
  const root = tmpProjectWithOldInfra();
  const res = await executeFullStackDeploy(root, { githubToken: "tok" }, {
    mode: "update",
    deps: {
      publishProjectImpl: async () => ({
        ok: true, branch: "main", sha: "abc1234", message: "Push/deploy OK",
        steps: [{ step: "deploy_one_click", ok: true, url: "https://new.vercel.app" }],
      }),
    },
  });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.deployed, true);
  assert.equal(res.liveUrl, "https://new.vercel.app");
  fs.rmSync(root, { recursive: true, force: true });
});
