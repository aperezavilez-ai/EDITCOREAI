"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROADMAP_VERSION = "1.0";
const ROADMAP_FILE = ".editcore/roadmap.json";
const CONNECTIONS_FILE = ".editcore/connections.json";
const AUDIT_FILE = ".editcore/audit.jsonl";

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function appendJsonl(filePath, record) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function nowISO() {
  return new Date().toISOString();
}

function createDefaultRoadmap(projectName, projectRoot) {
  const pkg = readJson(path.join(projectRoot, "package.json")) || {};
  return {
    version: ROADMAP_VERSION,
    project: {
      name: projectName,
      description: pkg.description || "",
      stack: [],
      status: "planning",
      createdAt: nowISO(),
      lastModified: nowISO(),
    },
    connections: {
      github: { repo: null, branch: "main", remoteUrl: null, hasLocalGit: false, lastPush: null },
      vercel: { projectId: null, projectName: null, liveUrl: null, linked: false, lastDeploy: null },
      supabase: { url: null, projectRef: null, hasMigrations: false, lastMigration: null },
      server: { host: null, path: null, linked: false },
    },
    deployment: {
      pipeline: "vercel",
      lastDeploy: { timestamp: null, type: null, status: null, url: null },
    },
    history: [],
    issues: [],
    editcore: {
      lastScanned: nowISO(),
      analysis: {
        frameworks: [],
        languages: [],
        packageManager: "",
        entryPoints: [],
      },
    },
  };
}

function enrichRoadmapWithAnalysis(roadmap, analysis) {
  if (!analysis) return roadmap;
  roadmap.editcore = roadmap.editcore || {};
  roadmap.editcore.lastScanned = nowISO();
  roadmap.editcore.analysis = {
    frameworks: analysis.frameworks || [],
    languages: analysis.languages || [],
    packageManager: analysis.packageManager || "",
    entryPoints: analysis.entryPoints || [],
  };
  roadmap.project.stack = [...new Set([...(roadmap.project.stack || []), ...(analysis.frameworks || [])])];
  return roadmap;
}

function enrichRoadmapWithGit(roadmap, projectRoot) {
  try {
    const gitDir = path.join(projectRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      roadmap.connections.github.hasLocalGit = false;
      return roadmap;
    }
    roadmap.connections.github.hasLocalGit = true;

    const configPath = path.join(gitDir, "config");
    const configRaw = fs.readFileSync(configPath, "utf8");
    const m = configRaw.match(/\[remote\s+"origin"\][^\[]*url\s*=\s*(.+)/i);
    if (m) {
      const url = m[1].trim();
      roadmap.connections.github.remoteUrl = url;
      const parsed = parseGithubRemote(url);
      if (parsed) roadmap.connections.github.repo = parsed.fullName;
    }

    const headPath = path.join(gitDir, "HEAD");
    const head = fs.readFileSync(headPath, "utf8").trim();
    if (head.startsWith("ref: ")) {
      roadmap.connections.github.branch = head.slice(5);
    }
  } catch {}
  return roadmap;
}

function parseGithubRemote(url) {
  if (!url) return null;
  let m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2], fullName: `${m[1]}/${m[2]}` };
  m = url.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2], fullName: `${m[1]}/${m[2]}` };
  return null;
}

function enrichRoadmapWithVercel(roadmap, projectRoot) {
  try {
    const vercelDir = path.join(projectRoot, ".vercel");
    if (!fs.existsSync(vercelDir)) {
      roadmap.connections.vercel.linked = false;
      return roadmap;
    }
    const projectJson = readJson(path.join(vercelDir, "project.json"));
    if (projectJson) {
      roadmap.connections.vercel.linked = true;
      roadmap.connections.vercel.projectId = projectJson.projectId;
      roadmap.connections.vercel.projectName = projectJson.projectName || projectJson.orgId;
    }
  } catch {}
  return roadmap;
}

function enrichRoadmapWithSupabase(roadmap, projectRoot) {
  const envFiles = [".env.local", ".env.production", ".env.development", ".env"];
  const SUPABASE_URL_VARIANTS = [
    "VITE_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL",
    "REACT_APP_SUPABASE_URL", "SUPABASE_URL",
  ];

  for (const envFile of envFiles) {
    const envPath = path.join(projectRoot, envFile);
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (SUPABASE_URL_VARIANTS.includes(key) && value) {
        roadmap.connections.supabase.url = value;
      }
    }
  }

  // Detectar supabase/ dir y migraciones
  const supabaseDir = path.join(projectRoot, "supabase");
  if (fs.existsSync(supabaseDir)) {
    roadmap.connections.supabase.hasMigrations = true;
    const migrationsDir = path.join(supabaseDir, "migrations");
    if (fs.existsSync(migrationsDir)) {
      try {
        const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
        if (files.length > 0) {
          const latest = files[files.length - 1];
          roadmap.connections.supabase.lastMigration = nowISO();
        }
      } catch {}
    }
  }
  return roadmap;
}

function enrichRoadmapWithConnections(roadmap, projectRoot) {
  const connPath = path.join(projectRoot, CONNECTIONS_FILE);
  const conn = readJson(connPath);
  if (conn) {
    if (conn.github?.repo) roadmap.connections.github.repo = conn.github.repo;
    if (conn.vercel?.projectId) roadmap.connections.vercel.projectId = conn.vercel.projectId;
    if (conn.supabase?.url) roadmap.connections.supabase.url = conn.supabase.url;
  }
  return roadmap;
}

class RoadmapSync {
  constructor() {}

  load(projectRoot) {
    const roadmapPath = path.join(projectRoot, ROADMAP_FILE);
    return readJson(roadmapPath);
  }

  loadOrCreate(projectRoot) {
    const projectName = path.basename(projectRoot);
    const existing = this.load(projectRoot);
    if (existing) return existing;
    const roadmap = createDefaultRoadmap(projectName, projectRoot);
    this.save(projectRoot, roadmap);
    return roadmap;
  }

  save(projectRoot, roadmap) {
    const roadmapPath = path.join(projectRoot, ROADMAP_FILE);
    writeJson(roadmapPath, roadmap);
  }

  async sync(projectRoot, analysis = null) {
    const projectName = path.basename(projectRoot);
    let roadmap = this.loadOrCreate(projectRoot);

    // Actualizar analisis
    if (analysis) {
      roadmap = enrichRoadmapWithAnalysis(roadmap, analysis);
    }

    // Actualizar conexiones
    roadmap = enrichRoadmapWithGit(roadmap, projectRoot);
    roadmap = enrichRoadmapWithVercel(roadmap, projectRoot);
    roadmap = enrichRoadmapWithSupabase(roadmap, projectRoot);
    roadmap = enrichRoadmapWithConnections(roadmap, projectRoot);

    // Actualizar timestamp
    roadmap.project.lastModified = nowISO();

    this.save(projectRoot, roadmap);
    return roadmap;
  }

  recordAction(projectRoot, action, details, by = "editcore") {
    const roadmap = this.loadOrCreate(projectRoot);
    roadmap.history.push({
      date: nowISO(),
      action,
      details,
      by,
    });
    this.save(projectRoot, roadmap);
    return roadmap;
  }

  recordIssue(projectRoot, description, status = "open") {
    const roadmap = this.loadOrCreate(projectRoot);
    roadmap.issues.push({
      date: nowISO(),
      description,
      status,
      resolution: null,
    });
    this.save(projectRoot, roadmap);
    return roadmap;
  }

  resolveIssue(projectRoot, index, resolution) {
    const roadmap = this.loadOrCreate(projectRoot);
    if (roadmap.issues[index]) {
      roadmap.issues[index].status = "resolved";
      roadmap.issues[index].resolution = resolution;
      this.save(projectRoot, roadmap);
    }
    return roadmap;
  }

  recordDeploy(projectRoot, { type, status, url }) {
    const roadmap = this.loadOrCreate(projectRoot);
    roadmap.deployment.lastDeploy = {
      timestamp: nowISO(),
      type,
      status,
      url,
    };
    roadmap.history.push({
      date: nowISO(),
      action: "deployed",
      details: `${type}: ${status}${url ? ` - ${url}` : ""}`,
      by: "editcore",
    });
    this.save(projectRoot, roadmap);
    return roadmap;
  }

  recordGitPush(projectRoot, { branch, commit, message }) {
    const roadmap = this.loadOrCreate(projectRoot);
    roadmap.connections.github.lastPush = nowISO();
    roadmap.history.push({
      date: nowISO(),
      action: "modified",
      details: `git push ${branch} (${commit?.slice(0, 7)}): ${message}`,
      by: "editcore",
    });
    this.save(projectRoot, roadmap);
    return roadmap;
  }

  recordVercelDeploy(projectRoot, { projectId, url }) {
    const roadmap = this.loadOrCreate(projectRoot);
    roadmap.connections.vercel.lastDeploy = nowISO();
    roadmap.connections.vercel.liveUrl = url;
    roadmap.connections.vercel.linked = true;
    roadmap.history.push({
      date: nowISO(),
      action: "deployed",
      details: `Vercel deploy: ${url || projectId}`,
      by: "editcore",
    });
    this.save(projectRoot, roadmap);
    return roadmap;
  }

  recordSupabaseMigration(projectRoot, { migrationName, url }) {
    const roadmap = this.loadOrCreate(projectRoot);
    roadmap.connections.supabase.lastMigration = nowISO();
    roadmap.history.push({
      date: nowISO(),
      action: "migrated",
      details: `Supabase migration: ${migrationName}`,
      by: "editcore",
    });
    this.save(projectRoot, roadmap);
    return roadmap;
  }

  appendAudit(projectRoot, record) {
    const auditPath = path.join(projectRoot, AUDIT_FILE);
    appendJsonl(auditPath, {
      timestamp: nowISO(),
      ...record,
    });
  }
}

function createRoadmapSync() {
  return new RoadmapSync();
}

module.exports = { RoadmapSync, createRoadmapSync, ROADMAP_VERSION, ROADMAP_FILE };
