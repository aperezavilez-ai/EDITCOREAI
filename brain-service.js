// EDITCOREAI Brain Service
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { projectId, projectStorageRoot } = require("./project-storage");
const { resolveInside } = require("./project-path-policy");
const { BrainMemoryStore } = require("./brain-memory-store");
const { enrichAgentInventory } = require("./runtime/jarvis-port");

const execFileAsync = promisify(execFile);
const SKIP_DIRS = new Set([".git", ".next", "node_modules", "dist", "build", "coverage", "release", "out"]);
const TEXT_EXTENSIONS = new Set([".c",".cpp",".cs",".css",".go",".h",".html",".java",".js",".json",".jsx",".md",".php",".py",".rb",".rs",".sql",".svelte",".ts",".tsx",".vue",".yaml",".yml"]);
const PROJECT_MEMORY_FILES = [
  ".editcore/context.md",
  ".editcore/rules.md",
  ".editcore/memory.md",
  ".editcore/connections.json",
  "AGENTS.md",
  "CLAUDE.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
];
const MAX_INDEX_FILES = 4000;
const MAX_INDEX_CHUNKS = 12000;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_CONTEXT_CHARS = 18_000;
const SKIP_SCAN = new Set([...SKIP_DIRS, ".cache", ".venv", "__pycache__", "target", "tmp", "vendor"]);
const SENSITIVE_FILE_NAMES = new Set([".env",".npmrc",".pypirc",".netrc","api-keys.json","credentials.json","secrets.json","id_rsa","id_ed25519"]);
const SENSITIVE_PATTERNS = [
  /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|secret|password|passwd|pwd|token)\b\s*[:=]\s*["']?[^\s"',;]+["']?/gi,
  /\bbearer\s+[a-z0-9._-]+/gi,
  /\bsk-[a-z0-9_-]{10,}/gi,
  /\bgh[pousr]_[a-z0-9]{20,}/gi,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

function normalizeText(v) { return String(v||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,""); }
function tokens(v) { return [...new Set(normalizeText(v).split(/[^a-z0-9_.-]+/).filter(t=>t.length>2))]; }

function redact(value, limit = 4000) {
  let out = String(value || "");
  for (const p of SENSITIVE_PATTERNS) out = out.replace(p, "[REDACTED]");
  out = out.replace(/((?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s/]+@/gi, "$1[REDACTED]@");
  return out.slice(0, limit);
}

function redactDeep(v, depth = 0) {
  if (typeof v === "string") return redact(v);
  if (depth >= 5 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 1000).map(e => redactDeep(e, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, e]) => [k, redactDeep(e, depth + 1)]));
}

function safeId(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`; }
function assertRoot(root) {
  if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Abre un proyecto para usar el cerebro.");
  return path.resolve(root);
}

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.promises.readFile(filePath, "utf8")); } catch { return fallback; }
}
async function writeJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
async function readJsonLines(filePath, limit = 100) {
  try {
    const lines = (await fs.promises.readFile(filePath, "utf8")).split(/\r?\n/).filter(Boolean).slice(-limit);
    return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } catch { return []; }
}
async function appendJsonLine(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function scoreText(text, queryTokens) {
  const h = normalizeText(text); let s = 0;
  for (const t of queryTokens) if (h.includes(t)) s += t.length > 5 ? 4 : 2;
  return s;
}

function requestsFrontendWork(query) {
  return /\b(?:ui|ux|frontend|interfaz|visual|diseñ[oa]|pagina|página|web|app|saas|dashboard|landing|formulario|modal|menu|menú|boton|botón|responsive|movil|móvil|desktop|estilo|css|tailwind|shadcn|componente|layout|crea(?:r)? proyecto)\b/i.test(String(query || ""));
}

function normalizeManifest(m) {
  return { version: 1, updatedAt: m?.updatedAt || new Date(0).toISOString(), items: Array.isArray(m?.items) ? m.items : [] };
}
function mergeItems(...groups) {
  const map = new Map();
  for (const g of groups) for (const it of normalizeManifest(g).items) { if (it?.id) map.set(it.id, { ...map.get(it.id), ...it }); }
  return [...map.values()].sort((a, b) => String(a.name||a.id).localeCompare(String(b.name||b.id)));
}
function repoSegment(item = {}) {
  const m = String(item.url||"").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  const owner = item.owner || m?.[1] || "unknown";
  const repo = item.repo || m?.[2] || item.id || "repo";
  return `${String(owner).replace(/[^a-z0-9._-]/gi,"-")}__${String(repo).replace(/[^a-z0-9._-]/gi,"-")}`.slice(0,190);
}
function parseGithubRepoUrl(value) {
  const raw = String(value || "").trim();
  const m = raw.match(/^https:\/\/github\.com\/([a-z0-9_.-]+)\/([a-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  const owner = m[1].replace(/[^a-z0-9_.-]/gi, "-");
  const repo = m[2].replace(/[^a-z0-9_.-]/gi, "-").replace(/\.git$/i, "");
  if (!owner || !repo || owner === "." || repo === ".") return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

function knowledgeRelations(chunks = []) {
  const paths = new Set(chunks.map((chunk) => String(chunk.path || "").replace(/\\/g, "/")));
  const relations = [];
  const seen = new Set();
  const resolveImport = (fromPath, specifier) => {
    if (!specifier.startsWith(".")) return `dependency:${specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/")}`;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
    return [base, `${base}.js`, `${base}.ts`, `${base}.jsx`, `${base}.tsx`, `${base}/index.js`, `${base}/index.ts`, `${base}/index.jsx`, `${base}/index.tsx`].find((candidate) => paths.has(candidate)) || base;
  };
  for (const chunk of chunks) {
    const fromId = String(chunk.path || "").replace(/\\/g, "/");
    const source = String(chunk.text || "");
    const matches = [
      ...source.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g),
      ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g),
    ];
    for (const match of matches) {
      const toId = resolveImport(fromId, match[1]);
      const key = `${fromId}|${toId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      relations.push({ fromId, toId, type: toId.startsWith("dependency:") ? "depends_on" : "imports", evidence: match[0].slice(0, 300) });
    }
  }
  return relations.slice(0, 20_000);
}
function sameInstallTarget(a = {}, b = {}) {
  const aUrl = parseGithubRepoUrl(a.url)?.url.toLowerCase();
  const bUrl = parseGithubRepoUrl(b.url)?.url.toLowerCase();
  if (aUrl && bUrl && aUrl === bUrl) return true;
  if (!a.installedPath || !b.installedPath) return false;
  return path.resolve(a.installedPath).toLowerCase() === path.resolve(b.installedPath).toLowerCase();
}
function normalizeSkillPath(filePath, installPath) {
  const rel = path.relative(installPath, filePath).replace(/\\/g,"/");
  return rel && !rel.startsWith("..") ? rel : "";
}

class EditCoreBrainService {
  constructor({ catalogPath, userDataPath, legacyPaths = [], legacyTextPaths = [], sharedSkillPaths = [] }) {
    this.catalogPath = catalogPath;
    this.userDataPath = userDataPath;
    this.legacyPaths = legacyPaths;
    this.legacyTextPaths = legacyTextPaths;
    this.sharedSkillPaths = sharedSkillPaths;
    this.catalogCache = undefined;
    this.indexLocks = new Map();
    this.memoryStore = new BrainMemoryStore(path.join(this.userDataPath, "editcore-brain", "memory.sqlite"));
  }

  globalStorePath() { return path.join(this.userDataPath, "editcore-brain", "global-memory.json"); }
  globalBrainRoot() { return path.join(this.userDataPath, "editcore-brain", "brain-store"); }
  globalManifestPath() { return path.join(this.globalBrainRoot(), "installed.json"); }
  projectStoreRoot(ws) { return projectStorageRoot(this.userDataPath, assertRoot(ws)); }
  projectBrainRoot(ws) { return path.join(this.projectStoreRoot(ws), "brain"); }
  projectKnowledgeRoot(ws) { return path.join(this.projectStoreRoot(ws), "knowledge"); }
  legacyWorkspaceManifestPath(ws) { return resolveInside(ws, ".editcore/brain/installed.json"); }

  async readGlobalManifest() { return normalizeManifest(await readJson(this.globalManifestPath(), { version:1, updatedAt:new Date(0).toISOString(), items:[] })); }
  async readWorkspaceManifest(ws) { if(!ws) return normalizeManifest(); return normalizeManifest(await readJson(this.legacyWorkspaceManifestPath(ws), { version:1, updatedAt:new Date(0).toISOString(), items:[] })); }

  async writeGlobalManifest(items) {
    const manifest = { version:1, updatedAt:new Date().toISOString(), items:mergeItems({ items }) };
    await writeJson(this.globalManifestPath(), manifest);
    return manifest;
  }

  async readInstalledItems(ws) {
    const global = await this.readGlobalManifest();
    const workspace = ws ? await this.readWorkspaceManifest(ws) : normalizeManifest();
    return mergeItems(workspace, global);
  }

  async getCatalog() {
    if (this.catalogCache) return this.catalogCache;
    const catalog = await readJson(this.catalogPath, { version:1, items:[] });
    if (!Array.isArray(catalog.items)) throw new Error("Catálogo de la Bodega no válido.");
    this.catalogCache = catalog;
    return catalog;
  }

  async searchCatalog(query = "", limit = 30) {
    const catalog = await this.getCatalog();
    const qt = tokens(query);
    return catalog.items.map(it => ({
      ...it,
      score: qt.length ? scoreText([it.name,it.description,it.type,...(it.categories||[]),...(it.tags||[])].join(" "),qt) : (it.status==="verified"?3:1)
    })).filter(it=>it.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,Math.max(1,Math.min(100,Number(limit)||30)));
  }

  parseSkillFrontmatter(raw) {
    const m = String(raw||"").match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const readValue = (key) => {
      const lines = m[1].split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const found = lines[i].match(new RegExp(`^${key}:\\s*(.*)\\s*$`));
        if (!found) continue;
        const value = found[1].trim();
        if (value === ">" || value === "|") {
          const block = [];
          for (let j = i + 1; j < lines.length; j++) {
            if (/^[a-zA-Z0-9_-]+:\s*/.test(lines[j])) break;
            if (lines[j].trim()) block.push(lines[j].trim());
          }
          return value === ">" ? block.join(" ") : block.join("\n");
        }
        return value.replace(/^["']|["']$/g, "");
      }
      return undefined;
    };
    return {
      name: readValue("name"),
      description: readValue("description"),
    };
  }

  async readSkillFile(filePath, source) {
    try {
      const raw = await fs.promises.readFile(filePath, "utf8");
      const meta = this.parseSkillFrontmatter(raw);
      if (meta.name) return [{ name: meta.name, description: meta.description || "", source, filePath }];
    } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    return [];
  }

  async scanSkills(directory, source) {
    if (!directory) return [];
    let entries; try { entries = await fs.promises.readdir(directory,{withFileTypes:true}); } catch { return []; }
    const skills = [];
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_SCAN.has(e.name)) continue;
      const fp = path.join(directory, e.name, "SKILL.md");
      skills.push(...await this.readSkillFile(fp, source));
    }
    return skills;
  }

  async scanPackagedSkills(directory, source) {
    if (!directory) return [];
    let entries; try { entries = await fs.promises.readdir(directory,{withFileTypes:true}); } catch { return []; }
    const skills = [];
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_SCAN.has(e.name)) continue;
      skills.push(...await this.readSkillFile(path.join(directory, e.name, "skill", "SKILL.md"), source));
    }
    return skills;
  }

  async discoverItemSkills(item) {
    const ip = item.installedPath||""; if(!ip||!fs.existsSync(ip)) return [];
    const skills = [];
    const rootSkill = path.join(ip,"SKILL.md");
    skills.push(...await this.readSkillFile(rootSkill, "brain"));
    skills.push(...await this.scanSkills(path.join(ip,"skills"),"brain"));
    try {
      const cats=(await fs.promises.readdir(path.join(ip,"skills"),{withFileTypes:true})).filter(e=>e.isDirectory());
      for(const cat of cats) skills.push(...await this.scanSkills(path.join(ip,"skills",cat.name),"brain"));
    } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    skills.push(...await this.scanSkills(ip,"brain"), ...await this.scanPackagedSkills(ip,"brain"), ...await this.scanSkills(path.join(ip,"agent_skills"),"brain"));
    try {
      for(const f of await fs.promises.readdir(path.join(ip,"agents"))) {
        if(!f.endsWith(".md")) continue;
        const fp=path.join(ip,"agents",f);
        try { const raw=await fs.promises.readFile(fp,"utf8"); const meta=this.parseSkillFrontmatter(raw); const name=meta.name||path.basename(f,".md"); skills.push({name:`agent:${name}`,description:meta.description||`Agente ${name}.`,source:"brain-agent",filePath:fp}); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
      }
    } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    const byName=new Map(); for(const s of skills) byName.set(s.name,s); return [...byName.values()];
  }

  installedSkillsFromManifest(item) {
    if (!Array.isArray(item?.skills)) return [];
    return item.skills.flatMap(skill => {
      const rel=String(skill.relativePath||"").replace(/\\/g,"/");
      if(!skill.name||!rel||rel.startsWith("..")) return [];
      return [{name:skill.name,description:skill.description||`${item.name}.`,source:skill.source||"brain",filePath:path.join(item.installedPath,rel)}];
    });
  }

  async listSkills(root) {
    const ws = root ? assertRoot(root) : "";
    const workspace = ws ? await this.scanSkills(resolveInside(ws,".editcore/skills"),"workspace") : [];
    const installedItems = await this.readInstalledItems(ws);
    const brainSkills = [];
    for (const item of installedItems) {
      if (item?.disabled || item?.status === "invalid" || item?.status === "needs_review") continue;
      if(Array.isArray(item.skills)) { brainSkills.push(...this.installedSkillsFromManifest(item)); continue; }
      brainSkills.push(...await this.discoverItemSkills(item));
    }
    for (const sharedPath of this.sharedSkillPaths) {
      brainSkills.push(...await this.scanSkills(sharedPath, "editcore"));
    }
    const byName=new Map();
    for(const s of brainSkills) byName.set(s.name,s);
    for(const s of workspace) byName.set(s.name,s);
    return [...byName.values()];
  }

  detectedFilesFor(installPath) {
    if (!installPath || !fs.existsSync(installPath)) return [];
    const detected = ["SKILL.md","package.json","README.md","skills","agent_skills","agents"]
      .filter(p=>fs.existsSync(path.join(installPath,p)));
    try {
      for (const e of fs.readdirSync(installPath, { withFileTypes: true })) {
        if (!e.isDirectory() || SKIP_SCAN.has(e.name)) continue;
        const rel = path.join(e.name, "skill", "SKILL.md");
        if (fs.existsSync(path.join(installPath, rel))) detected.push(rel.replace(/\\/g, "/"));
      }
    } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    return detected;
  }

  async auditInstalledItem(item, source = "global") {
    const installedPath = String(item?.installedPath || "");
    const exists = Boolean(installedPath && fs.existsSync(installedPath));
    const detectedFiles = this.detectedFilesFor(installedPath);
    const discovered = exists ? await this.discoverItemSkills(item) : [];
    const manifestSkills = exists ? this.installedSkillsFromManifest(item).filter(skill=>fs.existsSync(skill.filePath)) : [];
    const byName = new Map();
    for (const skill of [...manifestSkills, ...discovered]) byName.set(skill.name, skill);
    const skills = [...byName.values()];
    let status = "active";
    let reason = `${skills.length} skill(s) detectadas`;
    if (item?.disabled) { status = "disabled"; reason = item.auditReason || "Deshabilitada"; }
    else if (!exists) { status = "missing"; reason = "No existe la carpeta instalada"; }
    else if (!skills.length) { status = "needs_review"; reason = "No se detecto SKILL.md ni agente compatible"; }
    return {
      id: item?.id,
      name: item?.name || item?.id || "Tool sin nombre",
      type: item?.type || "repo",
      source,
      installedPath,
      exists,
      detectedFiles,
      skillCount: skills.length,
      skills: skills.map(s=>({ name:s.name, description:s.description || "", source:s.source || "brain" })),
      status,
      reason,
    };
  }

  async auditTools(root = "", options = {}) {
    const ws = root ? assertRoot(root) : "";
    const [globalManifest, workspaceManifest] = await Promise.all([
      this.readGlobalManifest(),
      ws ? this.readWorkspaceManifest(ws) : Promise.resolve(normalizeManifest()),
    ]);
    const globalAudits = [];
    for (const item of globalManifest.items) globalAudits.push(await this.auditInstalledItem(item, "global"));
    const workspaceAudits = [];
    for (const item of workspaceManifest.items) workspaceAudits.push(await this.auditInstalledItem(item, "workspace"));

    let repairedCount = 0;
    if (options.repair === true && globalAudits.length) {
      const byId = new Map(globalAudits.map(a=>[a.id,a]));
      const nextItems = globalManifest.items.map(item => {
        const audit = byId.get(item.id);
        if (!audit) return item;
        const unusable = audit.status === "missing" || audit.status === "needs_review";
        const next = {
          ...item,
          status: unusable ? audit.status : "active",
          disabled: unusable,
          auditReason: audit.reason,
          lastAuditedAt: new Date().toISOString(),
        };
        if (unusable !== Boolean(item.disabled) || item.status !== next.status) repairedCount++;
        return next;
      });
      await this.writeGlobalManifest(nextItems);
    }

    const sharedSkills = [];
    for (const sharedPath of this.sharedSkillPaths) sharedSkills.push(...await this.scanSkills(sharedPath, "editcore"));
    const workspaceSkills = ws ? await this.scanSkills(resolveInside(ws,".editcore/skills"),"workspace") : [];
    const installed = [...globalAudits, ...workspaceAudits];
    return {
      ready: true,
      sharedSkillCount: sharedSkills.length,
      workspaceSkillCount: workspaceSkills.length,
      installed,
      activeInstalledCount: installed.filter(a=>a.status === "active").length,
      invalidInstalledCount: installed.filter(a=>a.status === "missing" || a.status === "needs_review").length,
      disabledInstalledCount: installed.filter(a=>a.status === "disabled").length,
      repairedCount,
    };
  }

  async readSkill(root, name) {
    return (await this.readSkillForAgent(root, name)).content;
  }

  async readSkillForAgent(root, name) {
    const requested = String(name || "").trim().toLowerCase();
    const skill = (await this.listSkills(root)).find(item => String(item.name || "").toLowerCase() === requested);
    if (!skill) throw new Error(`Skill no encontrada: ${name}`);
    const content = redact(await fs.promises.readFile(skill.filePath, "utf8"), 30_000);
    return {
      name: skill.name,
      description: redact(skill.description || "", 1000),
      source: skill.source || "brain",
      content,
    };
  }

  async agentInventory(root = "", query = "", limit = 50) {
    const ws = root ? assertRoot(root) : "";
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    const queryTokens = tokens(query);
    const [skills, installed, catalog] = await Promise.all([
      this.listSkills(ws),
      this.readInstalledItems(ws),
      query ? this.searchCatalog(query, Math.min(12, safeLimit)) : Promise.resolve([]),
    ]);
    const rankedSkills = skills.map(skill => ({
      name: skill.name,
      description: redact(skill.description || "", 500),
      source: skill.source || "brain",
      score: queryTokens.length ? scoreText(`${skill.name} ${skill.description}`, queryTokens) : 0,
    })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return enrichAgentInventory({
      skills: rankedSkills.slice(0, safeLimit).map(({ score, ...skill }) => skill),
      installed: installed.slice(0, safeLimit).map(item => ({
        id: item.id,
        name: item.name || item.id,
        type: item.type || "repo",
        detectedType: item.detectedType || "",
        status: item.status || (item.disabled ? "disabled" : "active"),
        skills: Array.isArray(item.skills) ? item.skills.map(skill => skill.name).filter(Boolean).slice(0, 30) : [],
      })),
      catalog: catalog.map(item => ({ id: item.id, name: item.name, type: item.type, description: redact(item.description || "", 500) })),
    });
  }

  async searchForAgent(root, query, options = {}) {
    const ws = assertRoot(root);
    const value = String(query || "").trim();
    if (!value) throw new Error("La consulta del Cerebro esta vacia.");
    const scope = ["all", "memory", "code", "catalog"].includes(String(options.scope || "")) ? String(options.scope) : "all";
    const limit = Math.max(1, Math.min(20, Number(options.limit) || 8));
    let index = null;
    if (scope === "all" || scope === "code") index = await this.indexProject(ws, {}).catch(() => null);
    const [memory, knowledge, catalog] = await Promise.all([
      scope === "all" || scope === "memory" ? this.searchMemory(ws, value, limit) : Promise.resolve([]),
      scope === "all" || scope === "code" ? this.searchKnowledge(ws, value, limit) : Promise.resolve([]),
      scope === "all" || scope === "catalog" ? this.searchCatalog(value, limit) : Promise.resolve([]),
    ]);
    return {
      query: redact(value, 500),
      scope,
      index: index ? { backend: index.backend, mode: index.mode, totalFiles: index.totalFiles, totalChunks: index.totalChunks, lastIndexedAt: index.lastIndexedAt } : null,
      memory: memory.map(item => ({ id: item.id, type: item.type, title: item.title, content: redact(item.content || item.summary || "", 2500), source: item.source, score: item.score })),
      knowledge: knowledge.map(item => ({ id: item.id, path: item.path, line: item.line, text: redact(item.text || "", 2500), source: item.source, score: item.score })),
      catalog: catalog.map(item => ({ id: item.id, name: item.name, type: item.type, description: redact(item.description || "", 800) })),
    };
  }

  async migrateGlobalMemory() {
    const markerPath = path.join(this.userDataPath,"editcore-brain","migration.json");
    const existing = await readJson(markerPath, null);
    if (existing?.version===1) return existing;
    const target = await readJson(this.globalStorePath(), { version:1, entries:[], updatedAt:new Date().toISOString() });
    const seen = new Set((target.entries||[]).map(e=>e.id));
    let imported = 0;
    for (const candidate of this.legacyPaths) {
      if(!candidate||!fs.existsSync(candidate)) continue;
      const source = await readJson(candidate, null);
      if(!source) continue;
      const rows = Array.isArray(source) ? source : Array.isArray(source.entries) ? source.entries : [];
      for (const entry of rows) {
        const id = String(entry.id||safeId("legacy"));
        if(seen.has(id)) continue;
        seen.add(id);
        target.entries.push({ ...redactDeep(entry), id, title:redact(entry.title||entry.type||"Memoria",160), content:redact(entry.content||entry.text||"",4000), migratedFrom:candidate });
        imported++;
      }
    }
    for (const candidate of this.legacyTextPaths) {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const content = redact(await fs.promises.readFile(candidate, "utf8"), 12000);
      if (!content.trim()) continue;
      const id = `legacy-text-${crypto.createHash("sha256").update(candidate).digest("hex").slice(0, 16)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      target.entries.push({ id, type: "editcore-memory", title: "Memoria compartida de EDITCOREAI", content, migratedFrom: candidate });
      imported++;
    }
    target.entries = target.entries.slice(0,1000);
    target.updatedAt = new Date().toISOString();
    await writeJson(this.globalStorePath(), target);
    const marker = { version:1, migratedAt:new Date().toISOString(), imported };
    await writeJson(markerPath, marker);
    return marker;
  }

  async loadGlobalStore() {
    await this.migrateGlobalMemory();
    return readJson(this.globalStorePath(), { version:1, entries:[], updatedAt:new Date().toISOString() });
  }

  async saveGlobalMemory({ type="preference", title, content, projectPath, projectName }) {
    const store = await this.loadGlobalStore();
    const now = new Date().toISOString();
    const entry = { id:safeId("mem"), type, title:redact(title,160), content:redact(content,4000), tags:[], projectPath, projectName, createdAt:now, updatedAt:now };
    store.entries.unshift(entry);
    store.entries = store.entries.slice(0,1000);
    store.updatedAt = now;
    await writeJson(this.globalStorePath(), store);
    return this.memoryStore.upsertMemory({ ...entry, scope:"global", source:"global", importance:0.7 });
  }

  async remember(root, input = {}) {
    const scope = input.scope==="global"||!root ? "global" : "project";
    const title = String(input.title||"Memoria EDITCOREAI").trim();
    const content = String(input.content||"").trim();
    if(!content) throw new Error("Escribe el contenido que EDITCOREAI debe recordar.");
    if(scope==="global") return this.saveGlobalMemory({ type:input.type||"preference", title, content, projectPath:root||undefined, projectName:root?path.basename(root):undefined });
    const ws = assertRoot(root);
    const brainRoot = this.projectBrainRoot(ws);
    const indexPath = path.join(brainRoot, "memory-index.json");
    const index = await readJson(indexPath, { version:1, entries:[] });
    const now = new Date().toISOString();
    const entry = { id:safeId("tech"), timestamp:now, type:input.type||"decision", title:redact(title,160), summary:redact(content,4000), metadata:{ source:"editcore-desktop" } };
    const fileName = `${now.slice(0,10)}-${entry.id.slice(-8)}.json`;
    await writeJson(path.join(brainRoot, "entries", fileName), entry);
    index.entries.unshift({ id:entry.id, file:`entries/${fileName}`, timestamp:now, title:entry.title, type:entry.type });
    index.entries = index.entries.slice(0,500);
    await writeJson(indexPath, index);
    return this.memoryStore.upsertMemory({ id:entry.id, scope:"project", projectId:projectId(ws), type:entry.type, title:entry.title, content:entry.summary, source:"tech", updatedAt:now, importance:Number(input.importance)||0.65 });
  }

  async forget(root, id) {
    const targetId = String(id||""); if(!targetId) return false;
    const removedFromDatabase = this.memoryStore.removeMemory(targetId);
    const global = await this.loadGlobalStore();
    const before = global.entries.length;
    global.entries = global.entries.filter(e=>e.id!==targetId);
    if(global.entries.length!==before) { await writeJson(this.globalStorePath(),global); return true; }
    if(!root) return removedFromDatabase;
    const ws = assertRoot(root);
    const brainRoot = this.projectBrainRoot(ws);
    const indexPath = path.join(brainRoot, "memory-index.json");
    const index = await readJson(indexPath, { version:1, entries:[] });
    const found = index.entries.find(e=>e.id===targetId);
    if(!found) return removedFromDatabase;
    index.entries = index.entries.filter(e=>e.id!==targetId);
    await writeJson(indexPath, index);
    try { await fs.promises.rm(path.join(brainRoot, found.file || ""), { force:true }); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    return true;
  }

  async collectMemory(root) {
    const records = [];
    const global = await this.loadGlobalStore();
    for (const entry of (global.entries||[]).slice(0,200)) records.push({ id:entry.id, type:entry.type, title:entry.title, content:entry.content, source:"global", timestamp:entry.updatedAt||entry.createdAt });
    if(!root) return records;
    const ws = assertRoot(root);
    for (const rel of PROJECT_MEMORY_FILES) {
      const fp = resolveInside(ws, rel);
      try { const content=(await fs.promises.readFile(fp,"utf8")).trim(); if(content) records.push({ id:`project-${rel}`, type:"architecture", title:rel, content:redact(content,12_000), source:"project", timestamp:(await fs.promises.stat(fp)).mtime.toISOString() }); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    }
    // Tech memory
    const brainRoot = this.projectBrainRoot(ws);
    const techIndex = await readJson(path.join(brainRoot, "memory-index.json"), { entries:[] });
    for (const item of (techIndex.entries||[]).slice(0,200)) {
      try { const entry=await readJson(path.join(brainRoot, item.file || ""),null); if(entry) records.push({ id:entry.id, type:entry.type, title:redact(entry.title,160), content:redact(entry.summary,4000), source:"tech", timestamp:entry.timestamp }); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    }
    // EDITCOREAI compatibility — also read .editcore tech-memory
    const ecTechIndex = await readJson(resolveInside(ws,".editcore/tech-memory/index.json"), { entries:[] });
    for (const item of (ecTechIndex.entries||[]).slice(0,100)) {
      try { const entry=await readJson(resolveInside(ws,path.join(".editcore","tech-memory",String(item.file||""))),null); if(entry) records.push({ id:entry.id, type:entry.type, title:redact(entry.title,160), content:redact(entry.summary,4000), source:"editcore-tech", timestamp:entry.timestamp }); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    }
    const conversations = await readJson(resolveInside(ws,".editcore/knowledge/conversations/index.json"), []);
    for (const e of conversations.slice(0,50)) records.push({ id:e.id, type:"conversation", title:`Conversación ${e.importance||""}`.trim(), content:redact(e.summary,4000), source:"conversation", timestamp:e.at });
    const changes = await readJsonLines(resolveInside(ws,".editcore/knowledge/changes.jsonl"),50);
    for (const e of changes) records.push({ id:e.id, type:"code_change", title:redact(e.what||"Cambio",160), content:redact([e.why,e.summary,...(e.files||[])].filter(Boolean).join("\n"),4000), source:"change", timestamp:e.at });
    return records;
  }

  async searchMemory(root, query, limit = 20) {
    const records = await this.collectMemory(root);
    const pid = root ? projectId(assertRoot(root)) : "";
    for (const record of records) {
      this.memoryStore.upsertMemory({
        id: record.id, scope: record.source === "global" ? "global" : "project", projectId: pid,
        type: record.type, title: record.title, content: record.content, source: record.source,
        updatedAt: record.timestamp, importance: ["architecture", "decision", "preference"].includes(record.type) ? 0.8 : 0.55,
      });
    }
    return this.memoryStore.searchMemories(pid, query, limit);
  }

  async walkProject(root) {
    const files = [];
    const walk = async (dir) => {
      if(files.length>=MAX_INDEX_FILES) return;
      let entries; try { entries=await fs.promises.readdir(dir,{withFileTypes:true}); } catch { return; }
      for (const e of entries) {
        if(files.length>=MAX_INDEX_FILES) break;
        if(e.isSymbolicLink()) continue;
        const abs = path.join(dir, e.name);
        if(e.isDirectory()) { if(SKIP_DIRS.has(e.name)||e.name===".editcore"||e.name===".editcore") continue; await walk(abs); continue; }
        const ln = e.name.toLowerCase();
        if(SENSITIVE_FILE_NAMES.has(ln)||ln.startsWith(".env.")||/^service-account.*\.json$/.test(ln)) continue;
        if(!TEXT_EXTENSIONS.has(path.extname(e.name).toLowerCase())) continue;
        try { const stat=await fs.promises.stat(abs); if(stat.isFile()&&stat.size<=MAX_FILE_BYTES) files.push({ absolute:abs, relative:path.relative(root,abs).replace(/\\/g,"/"), fingerprint:`${stat.mtimeMs}:${stat.size}` }); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
      }
    };
    await walk(root); return files;
  }

  chunkFile(relative, content) {
    const chunks=[], lines=content.split(/\r?\n/);
    let startLine=1, buffer=[], length=0;
    const flush=()=>{ if(!buffer.length) return; const text=buffer.join("\n").trim(); if(text) chunks.push({ id:crypto.createHash("sha1").update(`${relative}:${startLine}:${text}`).digest("hex").slice(0,20), path:relative, line:startLine, text:text.slice(0,1800) }); const overlap=buffer.slice(-4); startLine+=Math.max(1,buffer.length-overlap.length); buffer=overlap; length=overlap.join("\n").length; };
    for(const line of lines) { if(length+line.length>1500&&buffer.length) flush(); buffer.push(line); length+=line.length+1; }
    flush(); return chunks;
  }

  async indexProject(root, options = {}) {
    const ws = assertRoot(root);
    if(this.indexLocks.has(ws)) return this.indexLocks.get(ws);
    const task = this._indexUnlocked(ws, options).finally(()=>this.indexLocks.delete(ws));
    this.indexLocks.set(ws, task); return task;
  }

  async _indexUnlocked(ws, options) {
    const startedAt = Date.now();
    const knowledgeRoot = this.projectKnowledgeRoot(ws);
    const metaPath = path.join(knowledgeRoot, "index-meta.json");
    const indexPath = path.join(knowledgeRoot, "local-index.json");
    const previous = await readJson(metaPath, null);
    const files = await this.walkProject(ws);
    const fingerprints = Object.fromEntries(files.map(f=>[f.relative,f.fingerprint]));
    const databaseReady = this.memoryStore.stats(projectId(ws)).knowledgeChunks > 0;
    if(!options.force&&databaseReady&&previous&&JSON.stringify(previous.fileHashes||{})===JSON.stringify(fingerprints)&&fs.existsSync(indexPath)) return { ...previous, changedFiles:0, durationMs:Date.now()-startedAt, mode:"cached" };
    const chunks=[];
    for(const file of files) {
      if(chunks.length>=MAX_INDEX_CHUNKS) break;
      try { const content=redact(await fs.promises.readFile(file.absolute,"utf8"),MAX_FILE_BYTES); chunks.push(...this.chunkFile(file.relative,content).slice(0,MAX_INDEX_CHUNKS-chunks.length)); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    }
    await writeJson(indexPath, { version:1, chunks });
    const relations = knowledgeRelations(chunks);
    this.memoryStore.replaceKnowledge(projectId(ws), chunks, relations);
    const changedFiles = files.filter(f=>previous?.fileHashes?.[f.relative]!==f.fingerprint).length;
    const meta = { version:2, backend:"sqlite-fts5", workspaceId:projectId(ws), lastIndexedAt:new Date().toISOString(), fileHashes:fingerprints, totalFiles:files.length, totalChunks:chunks.length, totalRelations:relations.length, changedFiles, durationMs:Date.now()-startedAt, mode:previous?"incremental":"full" };
    await writeJson(metaPath, meta);
    return meta;
  }

  async searchKnowledge(root, query, limit = 12) {
    if(!root) return [];
    const ws = assertRoot(root);
    const knowledgeRoot = this.projectKnowledgeRoot(ws);
    const metaPath = path.join(knowledgeRoot, "index-meta.json");
    if(!fs.existsSync(metaPath)) return [];
    const databaseResults = this.memoryStore.searchKnowledge(projectId(ws), query, limit);
    if (databaseResults.length) return databaseResults;
    const index = await readJson(path.join(knowledgeRoot, "local-index.json"),{ chunks:[] });
    const qt = tokens(query);
    return (index.chunks||[]).map(c=>({...c, source:"local_rag", score:scoreText(`${c.path}\n${c.text}`,qt)}))
      .filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path))
      .slice(0,Math.max(1,Math.min(50,Number(limit)||12)));
  }

  relatedKnowledge(root, nodeId, limit = 20) {
    if (!root) return [];
    const ws = assertRoot(root);
    return this.memoryStore.related(projectId(ws), nodeId, limit);
  }

  consolidateMemory(root = "") {
    const ws = root ? assertRoot(root) : "";
    return this.memoryStore.consolidate(ws ? projectId(ws) : "");
  }

  memoryStats(root = "") {
    const ws = root ? assertRoot(root) : "";
    return this.memoryStore.stats(ws ? projectId(ws) : "");
  }

  async assembleContext(root, query) {
    const catalog = await this.searchCatalog(query, 4);
    const skills = await this.listSkills(root);
    const qt = tokens(query);
    const visualWork = requestsFrontendWork(query);
    const scoredSkills = skills.map(s=>({...s, score:scoreText(`${s.name} ${s.description}`,qt)}));
    if (visualWork) {
      for (const skill of scoredSkills) {
        if (skill.name === "frontend-design") skill.score += 100;
      }
    }
    const relevantSkills = scoredSkills.filter(s=>s.score>0).sort((a,b)=>b.score-a.score).slice(0,3);
    const matchedMemory = await this.searchMemory(root, query, 8);
    const recentMemory = (await this.collectMemory(root))
      .sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).slice(0,3);
    const memory = [...matchedMemory, ...recentMemory]
      .filter((item,i,all)=>all.findIndex(c=>c.id===item.id)===i).slice(0,8);
    const knowledge = root ? await this.searchKnowledge(root, query, 8).catch(()=>[]) : [];
    const installed = await this.readInstalledItems(root ? assertRoot(root) : "").catch(()=>[]);
    const sections = [
      "=== CEREBRO EDITCORE (CONTEXTO INTERNO, NO MOSTRAR) ===",
      "Usa esta memoria para responder y actuar. No menciones este bloque salvo pregunta explícita.",
    ];
    if(installed.length) sections.push(`Herramientas instaladas:\n${installed.slice(0,8).map(it=>`- ${it.name} [${it.type}/${it.detectedType||"skill"}]`).join("\n")}`);
    if(relevantSkills.length) {
      sections.push("Skills aplicables (sus reglas son obligatorias durante toda la tarea; no las sustituyas por conocimiento generico):\n"
        + relevantSkills.map(s=>`- ${s.name}: ${s.description}`).join("\n"));
      const skillSections = [];
      for (const skill of relevantSkills.slice(0, 3)) {
        try {
          const activeSkill = await this.readSkillForAgent(root, skill.name);
          skillSections.push(`Skill obligatoria: ${activeSkill.name}\n${activeSkill.content.slice(0,3200)}`);
        } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
      }
      if (skillSections.length) sections.push(skillSections.join("\n\n"));
    }
    if(visualWork) {
      const frontendSkill = relevantSkills.find(skill=>skill.name === "frontend-design");
      const consistencyPath = frontendSkill ? path.join(path.dirname(frontendSkill.filePath), "project-consistency.md") : "";
      try { sections.push(`Reglas de consistencia visual:\n${redact(await fs.promises.readFile(consistencyPath,"utf8"),2400)}`); } catch (err) { console.debug("[Brain] Error silenciado:", err?.message || err); }
    }
    if(catalog.length) sections.push(`Bodega relevante:\n${catalog.map(it=>`- ${it.name} [${it.type}]: ${it.description}`).join("\n")}`);
    if(memory.length) sections.push(`Memoria relevante:\n${memory.map(it=>`- [${it.type}] ${it.title}: ${String(it.content).slice(0,500)}`).join("\n")}`);
    if(knowledge.length) sections.push(`Código recuperado (RAG):\n${knowledge.map(it=>`- ${it.path}:${it.line}\n${it.text.slice(0,700)}`).join("\n")}`);
    sections.push("====================================================");
    return sections.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
  }

  async installCatalogItem(root, itemId, approved = false) {
    if (root) assertRoot(root);
    const catalog = await this.getCatalog();
    const item = catalog.items.find(c=>c.id===itemId);
    if(!item) throw new Error("Elemento de la Bodega no encontrado.");
    if(item.riskLevel==="critical") throw new Error("Este elemento está bloqueado por riesgo crítico.");
    if(item.requiresApproval&&!approved) throw new Error("La instalación requiere aprobación explícita.");
    if(!parseGithubRepoUrl(item.url)) throw new Error("La Bodega solo instala repositorios GitHub HTTPS verificados.");
    const installPath = path.join(this.globalBrainRoot(),"repos",repoSegment(item));
    await fs.promises.mkdir(path.dirname(installPath),{ recursive:true });
    let cloned = false;
    if(!fs.existsSync(installPath)) {
      await execFileAsync("git",["clone","--depth","1",item.url,installPath],{ windowsHide:true, timeout:120_000, maxBuffer:4*1024*1024 });
      cloned = true;
    }
    const manifest = await this.readGlobalManifest();
    const installed = { id:item.id, name:item.name, type:item.type, url:item.url, installedAt:new Date().toISOString(), installedPath:installPath };
    const detectedFiles = this.detectedFilesFor(installPath);
    installed.detectedType = detectedFiles.some(file => file.endsWith("SKILL.md")) ? "codex-skill" : `${item.type}-candidate`;
    installed.detectedFiles = detectedFiles;
    installed.skills = (await this.discoverItemSkills(installed)).flatMap(skill=>{ const rel=normalizeSkillPath(skill.filePath,installPath); if(!skill.name||!rel) return []; return [{name:skill.name,description:skill.description||`${item.name}.`,source:skill.source||"brain",relativePath:rel}]; });
    installed.status = installed.skills.length ? "active" : "needs_review";
    installed.disabled = !installed.skills.length;
    installed.auditReason = installed.skills.length ? `${installed.skills.length} skill(s) detectadas` : "No se detecto SKILL.md ni agente compatible";
    const keptItems = manifest.items.filter(existing => existing.id === installed.id || !sameInstallTarget(existing, installed));
    await this.writeGlobalManifest(mergeItems({ items: keptItems },{ items:[installed] }));
    return { item:installed, cloned };
  }

  async installRepo(root, repoUrl, approved = false) {
    if (!approved) throw new Error("La instalacion requiere aprobacion explicita.");
    if (root) assertRoot(root);
    const parsed = parseGithubRepoUrl(repoUrl);
    if (!parsed) throw new Error("Pega un link HTTPS valido de GitHub, por ejemplo https://github.com/owner/repo");
    const item = { id:`repo:${parsed.owner}/${parsed.repo}`, name:parsed.repo, type:"repo", url:parsed.url, owner:parsed.owner, repo:parsed.repo };
    const installPath = path.join(this.globalBrainRoot(),"repos",repoSegment(item));
    await fs.promises.mkdir(path.dirname(installPath),{ recursive:true });
    let cloned = false;
    let updated = false;
    if (!fs.existsSync(installPath)) {
      await execFileAsync("git",["clone","--depth","1",parsed.url,installPath],{ windowsHide:true, timeout:120_000, maxBuffer:4*1024*1024 });
      cloned = true;
    } else if (fs.existsSync(path.join(installPath,".git"))) {
      await execFileAsync("git",["-C",installPath,"pull","--ff-only"],{ windowsHide:true, timeout:120_000, maxBuffer:4*1024*1024 });
      updated = true;
    }
    const manifest = await this.readGlobalManifest();
    const previous = manifest.items.find(it=>it.id===item.id) || {};
    const detectedFiles = this.detectedFilesFor(installPath);
    const installed = {
      ...previous,
      ...item,
      installedAt: previous.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      installedPath: installPath,
      detectedType: detectedFiles.includes("SKILL.md") ? "codex-skill" : "repo-candidate",
      detectedFiles,
    };
    installed.skills = (await this.discoverItemSkills(installed)).flatMap(skill=>{ const rel=normalizeSkillPath(skill.filePath,installPath); if(!skill.name||!rel) return []; return [{name:skill.name,description:skill.description||`${item.name}.`,source:skill.source||"brain",relativePath:rel}]; });
    installed.status = installed.skills.length ? "active" : "needs_review";
    installed.disabled = !installed.skills.length;
    installed.auditReason = installed.skills.length ? `${installed.skills.length} skill(s) detectadas` : "Repo clonado, pero no trae SKILL.md ni agente compatible";
    const keptItems = manifest.items.filter(existing => existing.id === installed.id || !sameInstallTarget(existing, installed));
    await this.writeGlobalManifest(mergeItems({ items: keptItems },{ items:[installed] }));
    return { item:installed, cloned, updated, status:installed.status, skillCount:installed.skills.length };
  }

  async snapshot(root) {
    const ws = root ? assertRoot(root) : "";
    await this.migrateGlobalMemory();
    const [catalog, memory, skills, installed] = await Promise.all([
      this.getCatalog(),
      this.collectMemory(ws),
      this.listSkills(ws),
      this.readInstalledItems(ws),
    ]);
    const index = ws ? await readJson(path.join(this.projectKnowledgeRoot(ws), "index-meta.json"),null) : null;
    return {
      project: ws ? { id:projectId(ws), name:path.basename(ws), path:ws } : null,
      catalogCount: catalog.items.length,
      skillCount: skills.length,
      installed,
      memory: this.memoryStats(ws),
      memoryCount: memory.length,
      recentMemory: memory.sort((a,b)=>String(b.timestamp||"").localeCompare(String(a.timestamp||""))).slice(0,20),
      index: index ? {
        backend:index.backend||"local-json",
        totalFiles:index.totalFiles||0,
        totalChunks:index.totalChunks||0,
        totalRelations:index.totalRelations||0,
        lastIndexedAt:index.lastIndexedAt,
        mode:index.mode,
      } : null,
      ready: true,
    };
  }
}

module.exports = { EditCoreBrainService, redact, tokens };
