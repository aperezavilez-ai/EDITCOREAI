"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PROGRAMAS_IA_ROOT = "D:\\PROGRAMAS IA\\";
const USER_DATA_DIR = require("electron").app?.getPath?.("userData") || path.join(process.cwd(), ".editcore");
const STATE_FILE = path.join(USER_DATA_DIR, "ecosystem-state.json");
const CACHE_TTL_MS = 5 * 60 * 1000;

const SKIP_DIRS = new Set([
  "node_modules", ".next", "dist", "build", "out",
  "coverage", "vendor", "target", ".output", ".svelte-kit", ".turbo",
  ".cache", ".vscode", ".idea", "__pycache__", "venv", ".venv",
]);

const SUPABASE_URL_VARIANTS = [
  "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL",
  "REACT_APP_SUPABASE_URL", "SUPABASE_URL",
];

const SUPABASE_KEY_VARIANTS = [
  "VITE_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY", "REACT_APP_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
];

function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value || null)).digest("hex");
}

function safeReadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

async function safeReadJsonAsync(filePath) {
  try { return JSON.parse(await fsp.readFile(filePath, "utf8")); } catch { return null; }
}

function readEnvLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const vars = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        vars[key] = value;
      }
    }
    return vars;
  } catch {
    return {};
  }
}

async function readEnvLinesAsync(filePath) {
  try {
    const content = await fsp.readFile(filePath, "utf8");
    const vars = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        vars[key] = value;
      }
    }
    return vars;
  } catch {
    return {};
  }
}

function extractSupabaseUrl(envVars) {
  for (const key of SUPABASE_URL_VARIANTS) {
    if (envVars[key]) return envVars[key];
  }
  return null;
}

function extractSupabaseKey(envVars) {
  for (const key of SUPABASE_KEY_VARIANTS) {
    if (envVars[key]) return envVars[key];
  }
  return null;
}

function readGitRemote(root) {
  try {
    const headPath = path.join(root, ".git", "HEAD");
    const head = fs.readFileSync(headPath, "utf8").trim();
    if (head.startsWith("ref: ")) {
      return { branch: head.slice(5), remote: null };
    }
    return { branch: "detached", remote: null };
  } catch {
    return { branch: null, remote: null };
  }
}

function readGitConfig(root) {
  const configPath = path.join(root, ".git", "config");
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const m = raw.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*(.+)/i);
    if (m) return m[1].trim();
  } catch {
    // ignore missing/corrupt config; hasGit is still meaningful
  }
  return null;
}

function parseGithubRemote(url) {
  if (!url) return null;
  let m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2], fullName: `${m[1]}/${m[2]}` };
  m = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2], fullName: `${m[1]}/${m[2]}` };
  return null;
}

function detectFrameworks(pkg, entries) {
  const frameworks = [];
  const languages = [];
  if (!pkg) return { frameworks, languages };

  const deps = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ]);
  if (deps.has("next")) frameworks.push("Next.js");
  if (deps.has("react")) frameworks.push("React");
  if (deps.has("vue")) frameworks.push("Vue");
  if (deps.has("svelte")) frameworks.push("Svelte");
  if (deps.has("electron")) frameworks.push("Electron");
  if (deps.has("express")) frameworks.push("Express");
  if (deps.has("fastify")) frameworks.push("Fastify");
  if (deps.has("fastapi")) frameworks.push("FastAPI");
  if (deps.has("django")) frameworks.push("Django");
  if (deps.has("flask")) frameworks.push("Flask");
  if (pkg.dependencies?.next || pkg.devDependencies?.next) frameworks.push("Next.js");

  const scripts = pkg.scripts || {};
  if (scripts.dev) frameworks.push("dev-server");
  if (scripts.start) frameworks.push("start-server");

  if (entries.includes("vite.config.js") || entries.includes("vite.config.ts")) frameworks.push("Vite");
  if (entries.includes("electron-builder.yml") || entries.includes("electron-builder.json")) frameworks.push("Electron");

  if (deps.has("typescript") || entries.includes("tsconfig.json")) languages.push("TypeScript");
  if (deps.has("tailwindcss")) frameworks.push("TailwindCSS");
  if (deps.has("@supabase/supabase-js")) frameworks.push("SupabaseClient");
  if (deps.has("prisma")) frameworks.push("Prisma");
  if (deps.has("drizzle-orm")) frameworks.push("DrizzleORM");

  if (entries.includes(".next")) frameworks.push("Next.js-built");
  if (entries.includes("src") && entries.includes("app")) frameworks.push("Next.js-AppRouter");
  if (entries.includes("src") && entries.includes("pages")) frameworks.push("Next.js-PagesRouter");
  if (entries.includes("supabase")) frameworks.push("SupabaseLocal");

  return { frameworks: [...new Set(frameworks)], languages: [...new Set(languages)] };
}

function scanProject(root) {
  const name = path.basename(root);
  const entries = [];
  let pkg = null;
  let vercelProject = null;
  let supabaseInfo = null;
  let envSupabaseUrl = null;
  let envSupabaseKey = null;
  let hasGit = false;
  let hasVercelDir = false;
  let hasVercelConfig = false;
  let hasSupabaseDir = false;

  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      entries.push(entry.name);
      if (entry.name === ".git") hasGit = true;
      if (entry.name === ".vercel") hasVercelDir = true;
      if (entry.name === "vercel.json" || entry.name === "vercel.config.json") hasVercelConfig = true;
      if (entry.name === "supabase") hasSupabaseDir = true;
    }
  } catch {
    return null;
  }

  if (entries.includes("package.json")) {
    pkg = safeReadJson(path.join(root, "package.json"));
  }

  if (hasVercelDir) {
    const projectJson = safeReadJson(path.join(root, ".vercel", "project.json"));
    vercelProject = projectJson || { linked: true };
  }
  if (hasVercelConfig && !vercelProject) {
    vercelProject = { linked: true, configFile: "vercel.json" };
  }

  const envFiles = [".env.local", ".env.production", ".env.development", ".env"];
  for (const envFile of envFiles) {
    const envPath = path.join(root, envFile);
    if (fs.existsSync(envPath)) {
      const envVars = readEnvLines(envPath);
      if (!envSupabaseUrl) envSupabaseUrl = extractSupabaseUrl(envVars);
      if (!envSupabaseKey) envSupabaseKey = extractSupabaseKey(envVars);
      if (envSupabaseUrl && envSupabaseKey) break;
    }
  }

  if (hasSupabaseDir || envSupabaseUrl) {
    supabaseInfo = {
      hasLocalDir: hasSupabaseDir,
      url: envSupabaseUrl,
      hasKey: !!envSupabaseKey,
    };
  }

  const gitInfo = readGitRemote(root);
  const remoteUrl = readGitConfig(root);
  const githubInfo = parseGithubRemote(remoteUrl);
  const { frameworks, languages } = detectFrameworks(pkg, entries);

  const roadmapPath = path.join(root, ".editcore", "roadmap.json");
  const roadmapMdPath = path.join(root, "ROADMAP.md");
  let roadmap = null;
  if (fs.existsSync(roadmapPath)) {
    roadmap = safeReadJson(roadmapPath);
  } else if (fs.existsSync(roadmapMdPath)) {
    roadmap = { source: "ROADMAP.md", exists: true };
  }

  return {
    name,
    path: root,
    hasGit,
    hasVercelDir,
    hasVercelConfig,
    hasSupabaseDir,
    frameworks,
    languages,
    vercel: vercelProject ? { linked: true, ...vercelProject } : null,
    supabase: supabaseInfo,
    supabaseUrl: envSupabaseUrl,
    git: gitInfo,
    github: githubInfo,
    remoteUrl,
    roadmap,
    hasRoadmap: !!roadmap,
    isProject: true,
  };
}

async function scanProjectAsync(root) {
  const name = path.basename(root);
  let entries = [];
  let pkg = null;
  let vercelProject = null;
  let supabaseInfo = null;
  let envSupabaseUrl = null;
  let envSupabaseKey = null;
  let hasGit = false;
  let hasVercelDir = false;
  let hasVercelConfig = false;
  let hasSupabaseDir = false;

  try {
    const dirents = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of dirents) {
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      entries.push(entry.name);
      if (entry.name === ".git") hasGit = true;
      if (entry.name === ".vercel") hasVercelDir = true;
      if (entry.name === "vercel.json" || entry.name === "vercel.config.json") hasVercelConfig = true;
      if (entry.name === "supabase") hasSupabaseDir = true;
    }
  } catch {
    return null;
  }

  if (entries.includes("package.json")) {
    pkg = await safeReadJsonAsync(path.join(root, "package.json"));
  }

  if (hasVercelDir) {
    const projectJson = await safeReadJsonAsync(path.join(root, ".vercel", "project.json"));
    vercelProject = projectJson || { linked: true };
  }
  if (hasVercelConfig && !vercelProject) {
    vercelProject = { linked: true, configFile: "vercel.json" };
  }

  const envFiles = [".env.local", ".env.production", ".env.development", ".env"];
  for (const envFile of envFiles) {
    const envPath = path.join(root, envFile);
    try {
      const stat = await fsp.stat(envPath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const envVars = await readEnvLinesAsync(envPath);
    if (!envSupabaseUrl) envSupabaseUrl = extractSupabaseUrl(envVars);
    if (!envSupabaseKey) envSupabaseKey = extractSupabaseKey(envVars);
    if (envSupabaseUrl && envSupabaseKey) break;
  }

  if (hasSupabaseDir || envSupabaseUrl) {
    supabaseInfo = {
      hasLocalDir: hasSupabaseDir,
      url: envSupabaseUrl,
      hasKey: !!envSupabaseKey,
    };
  }

  const gitInfo = readGitRemote(root);
  const remoteUrl = readGitConfig(root);
  const githubInfo = parseGithubRemote(remoteUrl);
  const { frameworks, languages } = detectFrameworks(pkg, entries);

  const roadmapPath = path.join(root, ".editcore", "roadmap.json");
  const roadmapMdPath = path.join(root, "ROADMAP.md");
  let roadmap = null;
  try {
    const stat = await fsp.stat(roadmapPath);
    if (stat.isFile()) roadmap = await safeReadJsonAsync(roadmapPath);
  } catch {
    try {
      const statMd = await fsp.stat(roadmapMdPath);
      if (statMd.isFile()) roadmap = { source: "ROADMAP.md", exists: true };
    } catch {
      // no roadmap
    }
  }

  return {
    name,
    path: root,
    hasGit,
    hasVercelDir,
    hasVercelConfig,
    hasSupabaseDir,
    frameworks,
    languages,
    vercel: vercelProject ? { linked: true, ...vercelProject } : null,
    supabase: supabaseInfo,
    supabaseUrl: envSupabaseUrl,
    git: gitInfo,
    github: githubInfo,
    remoteUrl,
    roadmap,
    hasRoadmap: !!roadmap,
    isProject: true,
  };
}

function scanAllProjects(rootDir) {
  const results = [];
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return results;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const projectPath = path.join(rootDir, entry.name);
    const project = scanProject(projectPath);
    if (project) results.push(project);
  }
  return results.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

async function scanAllProjectsAsync(rootDir) {
  const results = [];
  if (!await existsAsync(rootDir) || !(await fsp.stat(rootDir)).isDirectory()) return results;
  const entries = await fsp.readdir(rootDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map((entry) => path.join(rootDir, entry.name));

  const projects = await Promise.all(dirs.map((projectPath) => scanProjectAsync(projectPath)));
  for (const project of projects) {
    if (project) results.push(project);
  }
  return results.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
}

function buildSignature(projects) {
  const data = projects.map(p => [p.name, p.path, p.hasGit ? "1" : "0", p.remoteUrl || "", p.hasVercelDir ? "1" : "0", p.hasVercelConfig ? "1" : "0", p.hasSupabaseDir ? "1" : "0", p.supabaseUrl || "", p.roadmap ? "1" : "0"]);
  return digest(data);
}

function exists(filePath) {
  try { return fs.existsSync(filePath); } catch { return false; }
}

async function existsAsync(filePath) {
  try { return !!(await fsp.stat(filePath)); } catch { return false; }
}

function readState() {
  try { return safeReadJson(STATE_FILE) || { projects: [], connections: {}, lastScan: null }; }
  catch { return { projects: [], connections: {}, lastScan: null }; }
}

function writeState(state) {
  try {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

async function writeStateAsync(state) {
  try {
    await fsp.mkdir(USER_DATA_DIR, { recursive: true });
    await fsp.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

class EcosystemScanner {
  constructor() { this.cache = new Map(); }

  scan(rootDir = PROGRAMAS_IA_ROOT, { force = false } = {}) {
    const root = path.resolve(rootDir);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return { error: `Directorio no existe: ${root}`, projects: [] };
    }

    const projects = scanAllProjects(root);
    const signature = buildSignature(projects);
    const now = new Date().toISOString();

    const cached = this.cache.get("ecosystem");
    if (!force && cached && cached.signature === signature && cached.timestamp) {
      const age = Date.now() - new Date(cached.timestamp).getTime();
      if (age < 60000) {
        return { ...cached.value, cacheHit: true };
      }
    }

    const state = readState();
    const value = {
      projects,
      total: projects.length,
      withGit: projects.filter(p => p.hasGit).length,
      withVercel: projects.filter(p => p.hasVercelDir || p.hasVercelConfig).length,
      withSupabase: projects.filter(p => p.hasSupabaseDir || p.supabaseUrl).length,
      withRoadmap: projects.filter(p => p.hasRoadmap).length,
      withGithub: projects.filter(p => p.github).length,
      signature,
      scannedAt: now,
      cacheHit: false,
      root,
    };

    this.cache.set("ecosystem", { signature, timestamp: now, value });
    state.projects = projects;
    state.lastScan = now;
    state.signature = signature;
    writeState(state);

    return value;
  }

  async scanAsync(rootDir = PROGRAMAS_IA_ROOT, { force = false } = {}) {
    const root = path.resolve(rootDir);
    if (!await existsAsync(root) || !(await fsp.stat(root)).isDirectory()) {
      return { error: `Directorio no existe: ${root}`, projects: [] };
    }

    const projects = await scanAllProjectsAsync(root);
    const signature = buildSignature(projects);
    const now = new Date().toISOString();

    const cached = this.cache.get("ecosystem");
    if (!force && cached && cached.signature === signature && cached.timestamp) {
      const age = Date.now() - new Date(cached.timestamp).getTime();
      if (age < 60000) {
        return { ...cached.value, cacheHit: true };
      }
    }

    const state = readState();
    const value = {
      projects,
      total: projects.length,
      withGit: projects.filter(p => p.hasGit).length,
      withVercel: projects.filter(p => p.hasVercelDir || p.hasVercelConfig).length,
      withSupabase: projects.filter(p => p.hasSupabaseDir || p.supabaseUrl).length,
      withRoadmap: projects.filter(p => p.hasRoadmap).length,
      withGithub: projects.filter(p => p.github).length,
      signature,
      scannedAt: now,
      cacheHit: false,
      root,
    };

    this.cache.set("ecosystem", { signature, timestamp: now, value });
    state.projects = projects;
    state.lastScan = now;
    state.signature = signature;
    await writeStateAsync(state);

    return value;
  }

  getProject(projectName, rootDir = PROGRAMAS_IA_ROOT) {
    const root = path.resolve(rootDir);
    const projectPath = path.join(root, projectName);
    if (!fs.existsSync(projectPath)) return null;
    return scanProject(projectPath);
  }

  async getProjectAsync(projectName, rootDir = PROGRAMAS_IA_ROOT) {
    const root = path.resolve(rootDir);
    const projectPath = path.join(root, projectName);
    if (!await existsAsync(projectPath)) return null;
    return scanProjectAsync(projectPath);
  }

  refresh() {
    this.cache.delete("ecosystem");
    return this.scan(PROGRAMAS_IA_ROOT, { force: true });
  }

  async refreshAsync() {
    this.cache.delete("ecosystem");
    return this.scanAsync(PROGRAMAS_IA_ROOT, { force: true });
  }
}

module.exports = {
  EcosystemScanner,
  PROGRAMAS_IA_ROOT,
  SKIP_DIRS,
  scanAllProjects,
  scanAllProjectsAsync,
  scanProject,
  scanProjectAsync,
  buildSignature,
  readState,
  writeState,
  exists,
  existsAsync,
};
