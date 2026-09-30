#!/usr/bin/env node
"use strict";

/**
 * Rotación automática de claves del Supabase self-hosted (stack de la CLI).
 *
 *   node scripts/supabase-rotate-keys.js --check     solo diagnostica (exit 2 si hay claves por defecto)
 *   node scripts/supabase-rotate-keys.js --dry-run   calcula el plan completo sin tocar nada
 *   node scripts/supabase-rotate-keys.js             rota, verifica, propaga y registra (idempotente)
 *
 * Opciones: --force (rota aunque ya no sean las por defecto), --workdir <ruta>,
 *           --no-vercel, --no-redeploy
 */

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const lib = require("./lib/supabase-keys");

const APP_ROOT = path.resolve(__dirname, "..");
const PROJECTS_ROOT = path.resolve(APP_ROOT, "..");
const BACKUP_ROOT = path.join(PROJECTS_ROOT, "Z RESPALDOS", "supabase-key-rotation");
const PUBLIC_URL = process.env.GAFCORE_SUPABASE_URL || "https://supabase.gafcore.com";
const PROXY_URL = process.env.GAFCORE_SUPABASE_LOCAL_URL || "http://127.0.0.1:54321";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "release", "android", "ios",
  "coverage", ".cache", ".turbo", ".output", ".expo", ".wrangler", "target", "vendor",
  "venv", ".venv", "__pycache__", "Z RESPALDOS", "snapshots", "models", ".svelte-kit", ".nuxt", ".temp",
]);
const SCAN_EXT = /\.(?:env|md|json|jsonc|toml|ts|tsx|js|jsx|mjs|cjs|yml|yaml|txt|html|ps1|py|sh|example|sample|template)$/i;
const MAX_SCAN_BYTES = 1_500_000;
const args = process.argv.slice(2);
const opts = {
  check: args.includes("--check"),
  dryRun: args.includes("--dry-run"),
  force: args.includes("--force"),
  vercel: !args.includes("--no-vercel"),
  redeploy: !args.includes("--no-redeploy"),
  workdir: (() => { const i = args.indexOf("--workdir"); return i >= 0 ? args[i + 1] : ""; })(),
};

const report = { startedAt: new Date().toISOString(), mode: opts.check ? "check" : opts.dryRun ? "dry-run" : "rotate", steps: [] };

function log(message, extra) {
  const line = `[supabase-rotate] ${message}`;
  console.log(line);
  report.steps.push(extra ? { at: new Date().toISOString(), message, ...extra } : { at: new Date().toISOString(), message });
}

function fingerprint(value) {
  return value ? lib.sha256(value).slice(0, 12) : "";
}

// ─── Procesos ──────────────────────────────────────────────────────────────

function run(cmd, cmdArgs, { env, timeoutMs = 120_000, cwd } = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    timeout: timeoutMs,
    windowsHide: true,
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "", error: res.error };
}

function resolveSupabaseExe() {
  if (process.env.SUPABASE_BIN && fs.existsSync(process.env.SUPABASE_BIN)) return process.env.SUPABASE_BIN;
  const found = run(process.platform === "win32" ? "where.exe" : "which", ["supabase"]).stdout
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const candidate of found) {
    if (/\.exe$/i.test(candidate) || (process.platform !== "win32" && fs.existsSync(candidate))) return candidate;
    const dir = path.dirname(candidate);
    for (const rel of [
      ["node_modules", "supabase", "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe"],
      ["node_modules", "supabase", "bin", "supabase.exe"],
    ]) {
      const exe = path.join(dir, ...rel);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return "";
}

let SUPABASE_EXE = "";
function supabase(cliArgs, runOpts) {
  if (!SUPABASE_EXE) throw new Error("No se encontró el ejecutable de la CLI de Supabase (define SUPABASE_BIN).");
  return run(SUPABASE_EXE, cliArgs, runOpts);
}

function docker(dockerArgs, runOpts) {
  return run("docker", dockerArgs, runOpts);
}

// ─── Stack ─────────────────────────────────────────────────────────────────

function detectStacks() {
  const res = docker([
    "ps", "--filter", "label=com.supabase.cli.project",
    "--format", "{{.Label \"com.supabase.cli.project\"}}|{{.Label \"com.supabase.cli.workdir\"}}|{{.Names}}|{{.Ports}}|{{.State}}",
  ]);
  if (res.status !== 0) throw new Error(`docker ps falló: ${res.stderr.trim() || res.error?.message}`);
  const stacks = new Map();
  for (const line of res.stdout.split(/\r?\n/).filter(Boolean)) {
    const [project, workdir, name, ports, state] = line.split("|");
    if (!stacks.has(project)) stacks.set(project, { project, workdir, containers: [], running: [], kongPort: null, dbContainer: "" });
    const stack = stacks.get(project);
    stack.containers.push(name);
    if (state === "running") stack.running.push(name);
    if (/^supabase_kong_/.test(name)) {
      const m = String(ports).match(/:(\d+)->8000\/tcp/);
      if (m) stack.kongPort = Number(m[1]);
    }
    if (/^supabase_db_/.test(name)) stack.dbContainer = name;
  }
  for (const stack of stacks.values()) if (!stack.workdir) stack.workdir = findWorkdirByProjectId(stack.project);
  return [...stacks.values()];
}

// Algunas versiones de la CLI no etiquetan el workdir: se busca el config.toml con ese project_id.
function findWorkdirByProjectId(project) {
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return ""; }
  for (const dir of dirs) {
    const config = path.join(PROJECTS_ROOT, dir.name, "supabase", "config.toml");
    try {
      const m = fs.readFileSync(config, "utf8").match(/^\s*project_id\s*=\s*"([^"]+)"/m);
      if (m && m[1] === project) return path.join(PROJECTS_ROOT, dir.name);
    } catch { /* sin config */ }
  }
  return "";
}

// `supabase start -x` compara con el nombre corto de la imagen, no con los alias de la ayuda (`-x rest` no excluye nada).
const EXCLUDABLE = {
  rest: "postgrest", realtime: "realtime", storage: "storage-api", imgproxy: "imgproxy", inbucket: "mailpit",
  pg_meta: "postgres-meta", studio: "studio", edge_runtime: "edge-runtime", analytics: "logflare", vector: "vector",
  pooler: "supavisor",
};

/** PostgREST creado a mano con el nombre de la CLI: la CLI no lo gestiona y lleva el secreto JWT fijado. */
function detectManualRest(project) {
  const res = docker(["inspect", `supabase_rest_${project}`]);
  if (res.status !== 0) return null;
  const info = JSON.parse(res.stdout)[0];
  return info?.Config?.Labels?.["com.supabase.cli.project"] ? null : info;
}

function excludedServices(stack, manualRest) {
  const out = [];
  for (const [suffix, service] of Object.entries(EXCLUDABLE)) {
    const running = stack.running.includes(`supabase_${suffix}_${stack.project}`);
    if (!running || (suffix === "rest" && manualRest)) out.push("-x", service);
  }
  return out;
}

function recreateManualRest(info, jwtSecretValue, backupDir) {
  const name = info.Name.replace(/^\//, "");
  const network = info.HostConfig.NetworkMode;
  const envFile = path.join(backupDir, `.rest-env-${process.pid}`);
  const env = info.Config.Env.map((l) => (l.startsWith("PGRST_JWT_SECRET=") ? `PGRST_JWT_SECRET=${jwtSecretValue}` : l));
  fs.writeFileSync(envFile, env.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    const args = ["run", "-d", "--name", name, "--network", network, "--env-file", envFile];
    const aliases = info.NetworkSettings?.Networks?.[network]?.Aliases || [];
    for (const alias of aliases) if (alias !== name && !/^[0-9a-f]{12}$/.test(alias)) args.push("--network-alias", alias);
    if (info.Config.User) args.push("--user", info.Config.User);
    const restart = info.HostConfig.RestartPolicy?.Name;
    if (restart && restart !== "no") args.push("--restart", restart);
    for (const [containerPort, binds] of Object.entries(info.HostConfig.PortBindings || {})) {
      for (const b of binds || []) args.push("-p", `${b.HostIp ? `${b.HostIp}:` : ""}${b.HostPort}:${containerPort}`);
    }
    if (info.Config.Entrypoint?.length) args.push("--entrypoint", info.Config.Entrypoint[0]);
    args.push(info.Config.Image, ...(info.Config.Entrypoint?.slice(1) || []), ...(info.Config.Cmd || []));
    docker(["rm", "-f", name]);
    const res = docker(args, { timeoutMs: 300_000 });
    if (res.status !== 0) throw new Error(`No se pudo recrear ${name}: ${res.stderr.trim().slice(0, 300)}`);
  } finally {
    fs.rmSync(envFile, { force: true });
  }
}

function manualRestSecret(info) {
  const line = info.Config.Env.find((l) => l.startsWith("PGRST_JWT_SECRET="));
  return line ? line.slice("PGRST_JWT_SECRET=".length) : "";
}

function ensureGitignored(dir, entries) {
  const file = path.join(dir, ".gitignore");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const missing = entries.filter((e) => !lines.includes(e));
  if (missing.length) fs.writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`, "utf8");
}

function pickStack(stacks) {
  if (opts.workdir) {
    const want = path.resolve(opts.workdir).toLowerCase();
    const hit = stacks.find((s) => s.workdir && path.resolve(s.workdir).toLowerCase() === want);
    if (!hit) throw new Error(`No hay stack Supabase corriendo en ${opts.workdir}`);
    return hit;
  }
  if (stacks.length === 1) return stacks[0];
  if (!stacks.length) throw new Error("No hay ningún stack de la CLI de Supabase corriendo (supabase start).");
  throw new Error(`Hay varios stacks (${stacks.map((s) => s.project).join(", ")}); indica --workdir.`);
}

function readStatusKeys(workdir, env) {
  const res = supabase(["status", "-o", "env", "--workdir", workdir], { env, timeoutMs: 120_000 });
  const values = lib.parseEnvText(res.stdout);
  return {
    ok: res.status === 0 && Boolean(values.JWT_SECRET),
    keys: {
      JWT_SECRET: values.JWT_SECRET || "",
      ANON_KEY: values.ANON_KEY || "",
      SERVICE_ROLE_KEY: values.SERVICE_ROLE_KEY || "",
      PUBLISHABLE_KEY: values.PUBLISHABLE_KEY || "",
      SECRET_KEY: values.SECRET_KEY || "",
    },
    stderr: res.stderr,
  };
}

// ─── HTTP ──────────────────────────────────────────────────────────────────

function request(method, url, { headers = {}, body, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const client = u.protocol === "https:" ? https : http;
    const payload = body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body));
    const req = client.request(u, {
      method,
      headers: { ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}), ...headers },
      timeout: timeoutMs,
    }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* texto */ }
        resolve({ status: res.statusCode, json, text: data });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) => resolve({ status: 0, error: error.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function probeKey(baseUrl, key, route = "/auth/v1/health") {
  const res = await request("GET", `${baseUrl}${route}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  return res.status;
}

async function waitForKeys(baseUrl, newAnon, oldAnon, { attempts = 36, delayMs = 5000 } = {}) {
  let last = {};
  for (let i = 0; i < attempts; i += 1) {
    // /auth/v1/health es público en el Kong de la CLI; el rechazo de la clave vieja se comprueba en PostgREST (firma JWT).
    const [auth, restNew, restOld] = await Promise.all([
      probeKey(baseUrl, newAnon), probeKey(baseUrl, newAnon, "/rest/v1/"), probeKey(baseUrl, oldAnon, "/rest/v1/"),
    ]);
    last = { authNewKey: auth, restNewKey: restNew, restOldKey: restOld };
    if (auth === 200 && restNew === 200 && restOld === 401) return { ok: true, ...last };
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, ...last };
}

// ─── Archivos ──────────────────────────────────────────────────────────────

function* walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full, depth + 1);
    } else if (entry.isFile()) {
      if (SCAN_EXT.test(entry.name) || /^\.env(\.|$)/i.test(entry.name) || entry.name === ".cursorrules") yield full;
    }
  }
}

function scanRoots() {
  const roots = [PROJECTS_ROOT];
  for (const name of ["editcoreai", "EditCoreAI", "EDITCOREAI"]) {
    const dir = path.join(process.env.APPDATA || "", name);
    if (process.env.APPDATA && fs.existsSync(dir) && !roots.some((r) => r.toLowerCase() === dir.toLowerCase())) roots.push(dir);
  }
  return roots;
}

function resolveRipgrep() {
  const candidates = [process.env.RG_BIN];
  const where = run("where.exe", ["rg"], { timeoutMs: 10_000 });
  if (where.status === 0) candidates.push(...where.stdout.split(/\r?\n/));
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "cursor", "resources", "app", "node_modules", "@vscode", "ripgrep", "bin", "rg.exe"));
  }
  return candidates.map((c) => String(c || "").trim()).find((c) => c && fs.existsSync(c)) || "";
}

// Las claves van en un archivo temporal (-f) para no exponerlas en la línea de comandos.
function ripgrepCandidates(root, needles) {
  const rg = resolveRipgrep();
  if (!rg) return null;
  const patternFile = path.join(os.tmpdir(), `sb-rotate-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(patternFile, needles.join("\n"), { encoding: "utf8", mode: 0o600 });
  try {
    const globs = [...SKIP_DIRS].flatMap((d) => ["-g", `!**/${d}/**`]);
    const res = run(rg, ["-l", "-F", "--hidden", "--no-ignore", "--no-messages", "--max-filesize", "1500K",
      "--max-depth", "8", ...globs, "-f", patternFile, root], { timeoutMs: 900_000 });
    if (res.status !== 0 && res.status !== 1) return null;
    return res.stdout.split(/\r?\n/).filter(Boolean).filter((f) => {
      const name = path.basename(f);
      return SCAN_EXT.test(name) || /^\.env(\.|$)/i.test(name) || name === ".cursorrules";
    });
  } finally {
    try { fs.unlinkSync(patternFile); } catch { /* temporal */ }
  }
}

function planFileChanges(oldKeys, newKeys) {
  const needles = lib.KEY_KINDS.map((k) => oldKeys[k]).filter(Boolean);
  const plan = [];
  let scanned = 0;
  for (const root of scanRoots()) {
    for (const file of ripgrepCandidates(root, needles) || walk(root)) {
      let stat;
      try { stat = fs.statSync(file); } catch { continue; }
      if (stat.size > MAX_SCAN_BYTES) continue;
      scanned += 1;
      let text;
      try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
      if (!needles.some((n) => text.includes(n))) continue;
      const docMode = lib.isDocFile(file);
      const result = lib.replaceKeysInText(text, oldKeys, newKeys, { docMode });
      if (!result.changed) continue;
      const rel = path.relative(PROJECTS_ROOT, file);
      const project = rel.startsWith("..") ? path.basename(root) : rel.split(path.sep)[0];
      const sensitiveInCode = !docMode && !/(^|[\\/])\.env/i.test(file)
        && (result.hits.SERVICE_ROLE_KEY || result.hits.SECRET_KEY);
      plan.push({ file, project, docMode, hits: result.hits, sensitiveInCode: Boolean(sensitiveInCode) });
    }
  }
  return { plan, scanned };
}

function backupFile(file, backupDir) {
  const rel = file.replace(/^([A-Za-z]):/, "$1").replace(/^[\\/]+/, "");
  const dest = path.join(backupDir, "files", rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

function applyFileChanges(plan, oldKeys, newKeys, backupDir) {
  const results = [];
  for (const item of plan) {
    try {
      const raw = fs.readFileSync(item.file, "utf8");
      const bom = raw.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
      const { text } = lib.replaceKeysInText(raw.replace(/^\ufeff/, ""), oldKeys, newKeys, { docMode: item.docMode });
      backupFile(item.file, backupDir);
      fs.writeFileSync(item.file, bom + text, "utf8");
      results.push({ file: item.file, ok: true });
    } catch (error) {
      results.push({ file: item.file, ok: false, error: error.message });
    }
  }
  return results;
}

// ─── Vercel ────────────────────────────────────────────────────────────────

function readVercelToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const candidates = [
    path.join(process.env.APPDATA || "", "com.vercel.cli", "Data", "auth.json"),
    path.join(process.env.APPDATA || "", "xdg.data", "com.vercel.cli", "auth.json"),
    path.join(process.env.LOCALAPPDATA || "", "com.vercel.cli", "Data", "auth.json"),
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".config", "vercel", "auth.json"),
  ];
  for (const file of candidates) {
    try {
      const token = JSON.parse(fs.readFileSync(file, "utf8")).token;
      if (token) return token;
    } catch { /* siguiente */ }
  }
  return "";
}

async function vercelTokenValid(token) {
  if (!token) return false;
  const res = await request("GET", "https://api.vercel.com/v2/user", { headers: { authorization: `Bearer ${token}` } });
  return res.status === 200;
}

// Sin sesión válida no se puede propagar a Vercel; al rotar se abre el login de la CLI una vez.
async function ensureVercelSession({ allowLogin }) {
  let token = readVercelToken();
  if (await vercelTokenValid(token)) return { token, status: "ok" };
  if (!allowLogin) return { token: "", status: token ? "caducada" : "sin_sesion" };
  const cli = path.join(APP_ROOT, "node_modules", "vercel", "dist", "vc.js");
  if (!fs.existsSync(cli)) return { token: "", status: "sin_cli" };
  log("La sesión de Vercel caducó: se abre `vercel login` (autoriza en el navegador)…");
  spawnSync(process.execPath, [cli, "login"], { stdio: "inherit", timeout: 600_000, windowsHide: false });
  // La CLI puede terminar de escribir auth.json unos segundos después de anunciar el login.
  for (let i = 0; i < 12; i += 1) {
    token = readVercelToken();
    if (await vercelTokenValid(token)) return { token, status: "renovada" };
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { token: "", status: "login_fallido" };
}

function linkedVercelProjects() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(PROJECTS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const dir of dirs) {
    const file = path.join(PROJECTS_ROOT, dir.name, ".vercel", "project.json");
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (json.projectId) out.push({ folder: dir.name, projectId: json.projectId, orgId: json.orgId || "", name: json.projectName || dir.name });
    } catch { /* sin enlace */ }
  }
  return out;
}

function teamQuery(orgId) {
  return String(orgId).startsWith("team_") ? `teamId=${encodeURIComponent(orgId)}` : "";
}

async function planVercel(token, oldKeys) {
  const oldToKind = new Map(lib.KEY_KINDS.filter((k) => oldKeys[k]).map((k) => [oldKeys[k], k]));
  const plans = [];
  for (const project of linkedVercelProjects()) {
    const q = teamQuery(project.orgId);
    const res = await request("GET", `https://api.vercel.com/v10/projects/${project.projectId}/env?decrypt=true${q ? `&${q}` : ""}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) {
      plans.push({ ...project, error: `HTTP ${res.status}`, updates: [], unverifiable: [] });
      continue;
    }
    const updates = [];
    const unverifiable = [];
    for (const env of res.json?.envs || []) {
      const kind = oldToKind.get(env.value);
      if (kind) updates.push({ id: env.id, key: env.key, kind, target: env.target });
      else if (/SUPABASE.*(?:ANON|SERVICE_ROLE|PUBLISHABLE|SECRET)_KEY$/i.test(env.key) && !env.value) {
        unverifiable.push(env.key);
      }
    }
    plans.push({ ...project, updates, unverifiable });
  }
  return plans;
}

async function applyVercel(token, plans, newKeys) {
  const results = [];
  for (const project of plans) {
    if (!project.updates?.length) continue;
    const q = teamQuery(project.orgId);
    const updated = [];
    for (const u of project.updates) {
      const res = await request("PATCH", `https://api.vercel.com/v9/projects/${project.projectId}/env/${u.id}${q ? `?${q}` : ""}`, {
        headers: { authorization: `Bearer ${token}` },
        body: { value: newKeys[u.kind] },
      });
      updated.push({ key: u.key, ok: res.status === 200, status: res.status });
    }
    let redeploy = null;
    if (opts.redeploy && updated.some((u) => u.ok)) {
      const list = await request("GET", `https://api.vercel.com/v6/deployments?projectId=${project.projectId}&target=production&state=READY&limit=1${q ? `&${q}` : ""}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const last = list.json?.deployments?.[0];
      if (last?.uid) {
        const dep = await request("POST", `https://api.vercel.com/v13/deployments${q ? `?${q}` : ""}`, {
          headers: { authorization: `Bearer ${token}` },
          body: { name: project.name, deploymentId: last.uid, target: "production" },
        });
        redeploy = { ok: dep.status === 200 || dep.status === 201, status: dep.status, url: dep.json?.url || "" };
      } else {
        redeploy = { ok: false, status: list.status, error: "sin despliegue de producción previo" };
      }
    }
    results.push({ project: project.name, folder: project.folder, updated, redeploy });
  }
  return results;
}

// ─── Registro ──────────────────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
}

function writeReport(dir) {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  const md = [
    `# Rotación de claves Supabase — ${report.startedAt}`,
    "",
    `- Modo: ${report.mode}`,
    `- Resultado: ${report.result || "?"}`,
    report.stack ? `- Stack: ${report.stack.project} (${report.stack.workdir}), Kong :${report.stack.kongPort}` : "",
    report.defaultsDetected ? `- Claves por defecto detectadas: ${report.defaultsDetected.join(", ") || "ninguna"}` : "",
    report.fingerprints ? `- Huella nueva (sha256, 12): jwt ${report.fingerprints.new.JWT_SECRET}, anon ${report.fingerprints.new.ANON_KEY}` : "",
    report.verify ? `- Verificación: ${JSON.stringify(report.verify)}` : "",
    "",
    "## Archivos",
    ...(report.files || []).map((f) => `- ${f.ok === false ? "ERROR " : ""}${f.file}${f.docMode ? " (doc: claves sensibles como referencia)" : ""}${f.sensitiveInCode ? " ⚠ clave sensible en código" : ""}`),
    "",
    "## Vercel",
    report.vercelSession ? `- Sesión: ${report.vercelSession}` : "",
    ...(report.vercel || []).map((v) => `- ${v.project || v.name}: ${JSON.stringify(v.updated || v.updates || v.error || [])}${v.redeploy ? ` redeploy=${JSON.stringify(v.redeploy)}` : ""}`),
    "",
    "## Pasos",
    ...report.steps.map((s) => `- ${s.at} ${s.message}`),
  ].filter((l) => l !== "").join("\n");
  fs.writeFileSync(path.join(dir, "REPORTE.md"), md + "\n", "utf8");
  fs.mkdirSync(BACKUP_ROOT, { recursive: true });
  fs.appendFileSync(path.join(BACKUP_ROOT, "historial.jsonl"), JSON.stringify({
    at: report.finishedAt, mode: report.mode, result: report.result, stack: report.stack?.project,
    files: (report.files || []).length, dir,
  }) + "\n", "utf8");
}

// ─── Flujo principal ───────────────────────────────────────────────────────

// Kong puede estar publicado en otro puerto que el de config.toml (p. ej. detrás del proxy del watchdog).
function pinApiPort(toml, kongPort) {
  const configured = lib.readTomlNumber(toml, "api", "port") || 54321;
  return kongPort && kongPort !== configured ? lib.upsertTomlField(toml, "api", "port", String(kongPort)) : toml;
}

// El health check de la CLI aborta y para todo si storage/studio tardan (disco lento); la salud real la comprueba waitForKeys.
function startArgs(stack, excluded) {
  return ["start", "--workdir", stack.workdir, ...excluded, "--ignore-health-check"];
}

function restoreOrRemove(backupFile, target) {
  if (fs.existsSync(backupFile)) fs.copyFileSync(backupFile, target);
  else fs.rmSync(target, { force: true });
}

async function rollback(stack, backupDir, excluded, manualRest) {
  log("Revirtiendo configuración de Supabase…");
  const sbDir = path.join(stack.workdir, "supabase");
  const configPath = path.join(sbDir, "config.toml");
  fs.writeFileSync(configPath, pinApiPort(fs.readFileSync(path.join(backupDir, "config.toml"), "utf8"), stack.kongPort), "utf8");
  restoreOrRemove(path.join(backupDir, "supabase.env"), path.join(sbDir, ".env"));
  restoreOrRemove(path.join(backupDir, "signing_keys.json"), path.join(sbDir, "signing_keys.json"));
  supabase(["stop", "--workdir", stack.workdir], { timeoutMs: 300_000 });
  const start = supabase(startArgs(stack, excluded), { timeoutMs: 1_800_000 });
  log(`Rollback: supabase start exit ${start.status}`);
  if (manualRest) {
    try {
      recreateManualRest(manualRest, manualRestSecret(manualRest), backupDir);
      log("Rollback: PostgREST manual restaurado.");
    } catch (error) {
      log(`Rollback: ${error.message}`);
    }
  }
}

async function main() {
  SUPABASE_EXE = resolveSupabaseExe();
  const stack = pickStack(detectStacks());
  if (!stack.workdir) throw new Error(`No se pudo determinar la carpeta del stack ${stack.project}; indica --workdir.`);
  report.stack = { project: stack.project, workdir: stack.workdir, kongPort: stack.kongPort };
  log(`Stack ${stack.project} en ${stack.workdir} (Kong :${stack.kongPort || "?"})`);

  const status = readStatusKeys(stack.workdir);
  if (!status.ok) throw new Error(`supabase status falló: ${status.stderr.trim().slice(0, 300)}`);
  const oldKeys = status.keys;
  const defaults = lib.detectDefaultKeys(oldKeys);
  report.defaultsDetected = defaults;
  log(defaults.length ? `Claves por defecto públicas: ${defaults.join(", ")}` : "Las claves actuales no son las por defecto.");

  if (opts.check) {
    report.result = defaults.length ? "INSEGURO" : "OK";
    process.exitCode = defaults.length ? 2 : 0;
    return;
  }
  if (!defaults.length && !opts.force) {
    report.result = "SIN_CAMBIOS";
    log("Nada que rotar (usa --force para rotar igualmente).");
    return;
  }

  const newKeys = lib.generateKeySet({ projectRef: stack.project });
  report.fingerprints = {
    old: Object.fromEntries(Object.entries(oldKeys).map(([k, v]) => [k, fingerprint(v)])),
    new: Object.fromEntries(Object.entries(newKeys).map(([k, v]) => [k, fingerprint(v)])),
  };

  const linked = opts.vercel ? linkedVercelProjects() : [];
  const session = linked.length ? await ensureVercelSession({ allowLogin: !opts.dryRun }) : { token: "", status: "no_aplica" };
  const token = session.token;
  report.vercelSession = session.status;
  let vercelPlan = [];
  if (token) {
    vercelPlan = await planVercel(token, oldKeys);
    const n = vercelPlan.reduce((acc, p) => acc + (p.updates?.length || 0), 0);
    const failed = vercelPlan.filter((p) => p.error);
    log(`Vercel: ${vercelPlan.length} proyectos enlazados, ${n} variables a actualizar${failed.length ? `, ${failed.length} sin acceso` : ""}.`);
  } else if (linked.length) {
    log(`Vercel: ${linked.length} proyectos enlazados pero la sesión no es válida (${session.status}).`);
  }
  report.vercel = vercelPlan.map((p) => ({ name: p.name, folder: p.folder, updates: p.updates?.map((u) => ({ key: u.key, kind: u.kind, target: u.target })), unverifiable: p.unverifiable, error: p.error }));
  report.vercelPlan = report.vercel;

  const vercelBlocked = linked.length > 0 && (!token || vercelPlan.some((p) => /HTTP 40[13]/.test(p.error || "")));
  if (vercelBlocked && !opts.dryRun) {
    throw new Error("Sin acceso a Vercel: rotar ahora rompería las apps desplegadas. Nada fue modificado. Ejecuta `npx vercel login` o usa --no-vercel.");
  }
  if (vercelBlocked) log("Al rotar se pedirá `vercel login` antes de tocar nada.");

  log("Buscando archivos con las claves actuales (puede tardar varios minutos)…");
  const { plan, scanned } = planFileChanges(oldKeys, newKeys);
  log(`Escaneados ${scanned} archivos; ${plan.length} contienen claves a actualizar.`);
  report.files = plan.map((p) => ({ file: p.file, project: p.project, docMode: p.docMode, hits: p.hits, sensitiveInCode: p.sensitiveInCode }));

  const manualRest = detectManualRest(stack.project);
  const excluded = excludedServices(stack, manualRest);
  report.stack.excluded = excluded.filter((a) => a !== "-x");
  report.stack.manualRest = Boolean(manualRest);
  log(`Servicios a excluir en el reinicio: ${report.stack.excluded.join(", ") || "ninguno"}${manualRest ? " (PostgREST manual se recreará con el secreto nuevo)" : ""}.`);

  const runDir = path.join(BACKUP_ROOT, `${timestamp()}${opts.dryRun ? "-dry-run" : ""}`);
  if (opts.dryRun) {
    report.result = "PLAN";
    writeReport(runDir);
    log(`Plan guardado en ${runDir}`);
    return;
  }

  const backupDir = path.join(runDir, "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const sbDir = path.join(stack.workdir, "supabase");
  const configPath = path.join(sbDir, "config.toml");
  const envPath = path.join(sbDir, ".env");
  fs.copyFileSync(configPath, path.join(backupDir, "config.toml"));
  if (fs.existsSync(envPath)) fs.copyFileSync(envPath, path.join(backupDir, "supabase.env"));

  log("Respaldando la base de datos (pg_dumpall)…");
  const dumpPath = path.join(backupDir, "db-dumpall.sql");
  const fd = fs.openSync(dumpPath, "w");
  const dump = spawnSync("docker", ["exec", stack.dbContainer, "pg_dumpall", "-U", "postgres"], {
    stdio: ["ignore", fd, "pipe"], timeout: 1_800_000, windowsHide: true, encoding: "utf8",
  });
  fs.closeSync(fd);
  const dumpSize = fs.statSync(dumpPath).size;
  if (dump.status !== 0 || dumpSize === 0) throw new Error(`pg_dumpall falló: ${String(dump.stderr || dump.error?.message || "").trim().slice(0, 300)}`);
  log(`Dump guardado (${Math.round(dumpSize / 1024)} KB).`);

  if (manualRest) fs.writeFileSync(path.join(backupDir, "rest-container.json"), JSON.stringify(manualRest, null, 2), "utf8");

  const signingPath = path.join(sbDir, "signing_keys.json");
  if (fs.existsSync(signingPath)) fs.copyFileSync(signingPath, path.join(backupDir, "signing_keys.json"));
  const signingKey = lib.generateSigningKey();
  report.fingerprints.new.SIGNING_KID = signingKey.kid;

  let verify = null;
  let keysApplied = false;
  try {
    const toml = pinApiPort(lib.applyAuthKeyConfig(fs.readFileSync(configPath, "utf8"), { signingKeysPath: "./signing_keys.json" }), stack.kongPort);
    fs.writeFileSync(configPath, toml, "utf8");
    fs.writeFileSync(signingPath, JSON.stringify([signingKey], null, 2), { encoding: "utf8", mode: 0o600 });
    const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    fs.writeFileSync(envPath, lib.upsertEnvText(envText, Object.fromEntries(
      Object.entries(lib.CONFIG_ENV_NAMES).map(([kind, name]) => [name, newKeys[kind]]),
    )), "utf8");
    ensureGitignored(sbDir, [".env", "signing_keys.json"]);

    log(`Reiniciando Supabase (excluidos: ${report.stack.excluded.join(", ") || "ninguno"})…`);
    const stop = supabase(["stop", "--workdir", stack.workdir], { timeoutMs: 300_000 });
    log(`supabase stop exit ${stop.status}`);
    const start = supabase(startArgs(stack, excluded), { timeoutMs: 1_800_000 });
    log(`supabase start exit ${start.status}${start.status === 0 ? "" : ` — ${start.stderr.trim().split(/\r?\n/).slice(-3).join(" | ")}`}`);

    if (start.status === 0 && manualRest) {
      recreateManualRest(manualRest, lib.buildRestJwks(newKeys.JWT_SECRET, [signingKey]), backupDir);
      log("PostgREST manual recreado con el secreto nuevo.");
    }

    const after = readStatusKeys(stack.workdir);
    keysApplied = start.status === 0 && Object.keys(newKeys).every((k) => after.keys[k] === newKeys[k]);
    const directUrl = `http://127.0.0.1:${stack.kongPort || 54321}`;
    if (keysApplied) {
      verify = { direct: await waitForKeys(directUrl, newKeys.ANON_KEY, oldKeys.ANON_KEY) };
      verify.proxy = await waitForKeys(PROXY_URL, newKeys.ANON_KEY, oldKeys.ANON_KEY, { attempts: 12 });
      verify.public = await waitForKeys(PUBLIC_URL, newKeys.ANON_KEY, oldKeys.ANON_KEY, { attempts: 12 });
    }
  } catch (error) {
    log(`Error durante el reinicio: ${error.message}`);
  }
  report.verify = { keysApplied, ...verify };

  if (!keysApplied || !verify?.direct.ok) {
    report.result = "FALLO_REVERTIDO";
    log(`Verificación fallida: ${JSON.stringify(report.verify)}`);
    await rollback(stack, backupDir, excluded, manualRest);
    writeReport(runDir);
    process.exitCode = 1;
    return;
  }
  log(`Verificado: clave nueva aceptada y vieja rechazada (directo${verify.proxy.ok ? ", proxy" : ""}${verify.public.ok ? ", público" : ""}).`);

  log("Actualizando archivos de los proyectos…");
  const fileResults = applyFileChanges(plan, oldKeys, newKeys, backupDir);
  report.files = report.files.map((f) => ({ ...f, ...(fileResults.find((r) => r.file === f.file) || {}) }));
  log(`${fileResults.filter((r) => r.ok).length}/${fileResults.length} archivos actualizados.`);

  if (token && vercelPlan.length) {
    log("Actualizando variables de Vercel…");
    report.vercel = await applyVercel(token, vercelPlan, newKeys);
    log(`Vercel: ${report.vercel.length} proyectos actualizados.`);
  }

  report.result = verify.public.ok ? "OK" : "OK_LOCAL";
  writeReport(runDir);
  log(`Registro completo en ${runDir}`);
}

if (require.main === module) {
  main().catch((error) => {
    report.result = "ERROR";
    log(`Error: ${error.message}`);
    try { writeReport(path.join(BACKUP_ROOT, `${timestamp()}-error`)); } catch { /* sin registro */ }
    process.exitCode = 1;
  });
}

module.exports = { detectStacks, detectManualRest, excludedServices, recreateManualRest, manualRestSecret, pinApiPort };
