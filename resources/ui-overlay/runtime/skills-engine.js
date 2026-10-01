"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BUILTIN_SKILLS_DIR = path.resolve(__dirname, "..", "brain-seed", "skills");

function parseFrontmatter(text = "") {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return {
      metadata: {},
      body: String(text || "").trim(),
    };
  }

  const rawMeta = match[1];
  const body = match[2].trim();
  const metadata = {};

  for (const line of rawMeta.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (val === "true") val = true;
      else if (val === "false") val = false;
      metadata[key] = val;
    }
  }

  return { metadata, body };
}

function stringifyFrontmatter(metadata = {}, body = "") {
  const lines = ["---"];
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === "string") {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "", body);
  return lines.join("\n");
}

function normalizeSkillSlug(name = "") {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "custom-skill";
}

function getSkillsConfig(userDataPath) {
  const configFile = path.join(userDataPath || "", "skills-config.json");
  try {
    if (fs.existsSync(configFile)) {
      return JSON.parse(fs.readFileSync(configFile, "utf8"));
    }
  } catch { /* ignore */ }
  return { disabled: [] };
}

function saveSkillsConfig(userDataPath, config = {}) {
  const configFile = path.join(userDataPath || "", "skills-config.json");
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), "utf8");
  } catch { /* ignore */ }
}

const NESTED_SKILL_MAX_DEPTH = 4;
const NESTED_SKILL_MAX_FILES = 200;
const NESTED_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "vendor"]);
const SKILL_BODY_MAX_CHARS = 8_000;

function skillFileIn(dir) {
  for (const name of ["SKILL.md", "skill.md"]) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

// Repos clonados (p. ej. anthropics/skills) guardan las skills en subcarpetas: <repo>/skills/<nombre>/SKILL.md.
function findNestedSkillFiles(dir, depth = 1, out = []) {
  if (depth > NESTED_SKILL_MAX_DEPTH || out.length >= NESTED_SKILL_MAX_FILES) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isDirectory() || NESTED_SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    const file = skillFileIn(child);
    if (file) out.push(file);
    else findNestedSkillFiles(child, depth + 1, out);
    if (out.length >= NESTED_SKILL_MAX_FILES) break;
  }
  return out;
}

function readSkillFile(skillFile, slug, scope) {
  const raw = fs.readFileSync(skillFile, "utf8");
  const { metadata, body } = parseFrontmatter(raw);
  const name = metadata.name || slug;
  const description = metadata.description || body.slice(0, 160).replace(/\r?\n/g, " ");
  return {
    id: `${scope}:${name}`,
    name,
    slug: normalizeSkillSlug(name),
    description,
    scope,
    filePath: skillFile,
    category: metadata.category || "general",
    homepage: metadata.homepage || "",
    body,
    raw,
  };
}

function scanSkillDir(baseDir, scope = "builtin") {
  const skills = [];
  if (!baseDir || !fs.existsSync(baseDir)) return skills;

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      const files = [];
      if (entry.isDirectory()) {
        const direct = skillFileIn(path.join(baseDir, entry.name));
        if (direct) files.push([direct, entry.name]);
        else if (scope !== "builtin") {
          for (const nested of findNestedSkillFiles(path.join(baseDir, entry.name))) {
            files.push([nested, path.basename(path.dirname(nested))]);
          }
        }
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name) && entry.name.toLowerCase() !== "readme.md") {
        files.push([path.join(baseDir, entry.name), entry.name.replace(/\.(md|markdown)$/i, "")]);
      }

      for (const [skillFile, slug] of files) {
        try { skills.push(readSkillFile(skillFile, slug, scope)); } catch { /* ignore bad skill file */ }
      }
    }
  } catch { /* ignore read errors */ }

  return skills;
}

function brainManifestPath(userDataPath = "") {
  return userDataPath ? path.join(userDataPath, "editcore-brain", "brain-store", "installed.json") : "";
}

let brainCache = { file: "", mtimeMs: 0, skills: [] };

// Skills de los repos instalados desde el panel Cerebro. El cuerpo se lee al activarlas (loadSkillBody).
function scanBrainStoreSkills(userDataPath = "") {
  const file = brainManifestPath(userDataPath);
  if (!file || !fs.existsSync(file)) return [];
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(file).mtimeMs; } catch { return []; }
  if (brainCache.file === file && brainCache.mtimeMs === mtimeMs) return brainCache.skills.map((s) => ({ ...s }));

  let items = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    items = Array.isArray(manifest?.items) ? manifest.items : [];
  } catch { return []; }

  const skills = [];
  for (const item of items) {
    const repo = String(item?.name || item?.id || "").trim();
    const installedPath = String(item?.installedPath || "").trim();
    if (!repo || !installedPath) continue;
    for (const s of Array.isArray(item.skills) ? item.skills : []) {
      const name = String(s?.name || "").trim();
      const rel = String(s?.relativePath || "").trim();
      if (!name || !rel) continue;
      skills.push({
        id: `brain:${repo}/${name}`,
        name,
        slug: normalizeSkillSlug(name),
        description: String(s.description || "").slice(0, 400),
        scope: "brain",
        filePath: path.join(installedPath, rel),
        category: repo,
        repo,
        homepage: String(item.url || ""),
      });
    }
  }
  brainCache = { file, mtimeMs, skills };
  return skills.map((s) => ({ ...s }));
}

function loadSkillBody(skill = {}) {
  let body = String(skill.body || skill.raw || "");
  if (!body && skill.filePath) {
    try { body = parseFrontmatter(fs.readFileSync(skill.filePath, "utf8")).body; } catch { body = ""; }
  }
  if (body.length > SKILL_BODY_MAX_CHARS) body = `${body.slice(0, SKILL_BODY_MAX_CHARS)}\n…[skill recortada; archivo completo: ${skill.filePath || skill.name}]`;
  return body;
}

function listAllSkills({ projectRoot = "", userDataPath = "" } = {}) {
  const config = getSkillsConfig(userDataPath);
  const disabledSet = new Set(config.disabled || []);

  const builtin = scanSkillDir(BUILTIN_SKILLS_DIR, "builtin");
  const globalDir = userDataPath ? path.join(userDataPath, "skills") : "";
  const userGlobal = scanSkillDir(globalDir, "global");
  const projectDir = projectRoot ? path.join(projectRoot, ".editcore", "skills") : "";
  const projectSkills = scanSkillDir(projectDir, "project");
  const brainSkills = scanBrainStoreSkills(userDataPath);

  const skillMap = new Map();
  for (const s of [...brainSkills, ...builtin, ...userGlobal, ...projectSkills]) {
    s.enabled = !disabledSet.has(s.id) && !disabledSet.has(s.name);
    skillMap.set(s.name, s);
  }

  const values = Array.from(skillMap.values());
  return [...values.filter((s) => s.scope !== "brain"), ...values.filter((s) => s.scope === "brain")];
}

function saveSkill({
  name = "",
  description = "",
  category = "general",
  content = "",
  scope = "global",
  projectRoot = "",
  userDataPath = "",
} = {}) {
  const cleanName = normalizeSkillSlug(name);
  if (!cleanName) throw new Error("Nombre de habilidad inválido.");

  let targetDir = "";
  if (scope === "project" && projectRoot) {
    targetDir = path.join(projectRoot, ".editcore", "skills", cleanName);
  } else {
    if (!userDataPath) throw new Error("userDataPath es requerido para habilidades globales.");
    targetDir = path.join(userDataPath, "skills", cleanName);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, "SKILL.md");

  const existingParsed = parseFrontmatter(content);
  const metadata = {
    name: cleanName,
    description: description || existingParsed.metadata.description || `${cleanName} skill`,
    category: category || existingParsed.metadata.category || "general",
    ...(existingParsed.metadata || {}),
  };
  metadata.name = cleanName;
  if (description) metadata.description = description;

  const finalContent = stringifyFrontmatter(metadata, existingParsed.body || content);
  fs.writeFileSync(targetFile, finalContent, "utf8");

  return {
    ok: true,
    id: `${scope}:${cleanName}`,
    name: cleanName,
    filePath: targetFile,
    scope,
  };
}

function deleteSkill({ name = "", scope = "global", projectRoot = "", userDataPath = "" } = {}) {
  if (scope === "brain") return { ok: false, error: "Las skills del Cerebro se quitan desinstalando su repositorio en el panel Cerebro. Puedes desactivarla aquí." };
  const cleanName = normalizeSkillSlug(name);
  let targetDir = "";
  if (scope === "project" && projectRoot) {
    targetDir = path.join(projectRoot, ".editcore", "skills", cleanName);
  } else if (userDataPath) {
    targetDir = path.join(userDataPath, "skills", cleanName);
  }

  if (targetDir && fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    return { ok: true, deleted: cleanName };
  }

  return { ok: false, error: "Habilidad no encontrada o protegida (builtin)." };
}

function toggleSkill({ id = "", name = "", enabled = true, userDataPath = "" } = {}) {
  const config = getSkillsConfig(userDataPath);
  const disabledSet = new Set(config.disabled || []);
  const key = id || name;

  if (enabled) {
    disabledSet.delete(key);
    if (name) disabledSet.delete(name);
  } else {
    disabledSet.add(key);
  }

  config.disabled = Array.from(disabledSet);
  saveSkillsConfig(userDataPath, config);
  return { ok: true, id: key, enabled };
}

function parseLearnPrompt(promptText = "") {
  const text = String(promptText || "").trim();
  const learnPattern = /^(?:aprende\s+(?:este|esta|un|una)?\s*(?:skill|habilidad|skills|habilidades)|registra\s+(?:este|esta|un|una)?\s*(?:skill|habilidad)|crea\s+(?:este|esta|un|una)?\s*(?:skill|habilidad)|guardar?\s+(?:este|esta|un|una)?\s*(?:skill|habilidad)|nuevo\s+skill|nueva\s+habilidad|\/learn)\s*[:\-\n\s]?\s*([\s\S]*)$/i;
  const match = text.match(learnPattern);
  if (!match) return null;

  const rawBody = match[1].trim();
  if (!rawBody) return null;

  const parsed = parseFrontmatter(rawBody);
  let name = parsed.metadata.name || "";
  let description = parsed.metadata.description || "";
  let category = parsed.metadata.category || "custom";

  if (!name) {
    const titleMatch = rawBody.match(/^#\s+(.+)$/m);
    if (titleMatch) name = normalizeSkillSlug(titleMatch[1]);
    else name = "habilidad-personalizada-" + Date.now().toString(36);
  }

  if (!description) {
    const firstParagraph = (parsed.body || rawBody)
      .split(/\n\s*\n/)[0]
      .replace(/^#+.*$/gm, "")
      .trim();
    description = firstParagraph.slice(0, 240) || `Habilidad ${name}`;
  }

  return {
    isLearn: true,
    name: normalizeSkillSlug(name),
    description,
    category,
    content: rawBody,
  };
}

const MATCH_STOPWORDS = new Set([
  "que", "con", "los", "las", "una", "uno", "unos", "unas", "por", "para", "del", "como", "este", "esta",
  "estos", "esto", "eso", "esa", "ese", "mas", "sin", "sus", "hay", "muy", "todo", "toda", "todos", "pero",
  "cual", "donde", "cuando", "porque", "quiero", "necesito", "puedes", "puede", "hacer", "haz", "dame",
  "tengo", "tiene", "tienes", "mis", "algo", "bien", "genera", "generar", "crea", "crear", "hazme", "manda",
  "mande", "revisa", "revisar", "ayuda", "ayudame", "the", "and", "for", "with", "you", "your", "that",
  "this", "from", "are", "use", "using", "when",
]);
const BRAIN_MIN_SCORE = 7;

function spacedWords(text = "") {
  const words = String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter(Boolean);
  return ` ${words.join(" ")} `;
}

// Palabras de 3 letras (api, seo, pdf) deben coincidir enteras; las más largas valen como prefijo de palabra.
function hasWord(spaced, token) {
  return token.length >= 4 ? spaced.includes(` ${token}`) : spaced.includes(` ${token} `);
}

function matchSkillsForPrompt(userPrompt = "", allSkills = [], maxSkills = 3) {
  const queryTokens = [...new Set(spacedWords(userPrompt).trim().split(" "))]
    .filter((t) => t.length > 2 && !MATCH_STOPWORDS.has(t));
  if (!queryTokens.length) return [];

  const scored = [];
  for (const skill of allSkills) {
    if (skill.enabled === false) continue;
    let score = 0;
    const name = spacedWords(skill.name);
    const desc = spacedWords(skill.description);
    const cat = spacedWords(skill.category);

    for (const token of queryTokens) {
      if (hasWord(name, token)) score += 5;
      if (hasWord(desc, token)) score += 2;
      if (hasWord(cat, token)) score += 3;
    }

    const minScore = skill.scope === "brain" ? BRAIN_MIN_SCORE : 1;
    if (score >= minScore) {
      scored.push({ skill, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || (a.skill.scope === "brain") - (b.skill.scope === "brain"));
  return scored.slice(0, maxSkills).map((item) => item.skill);
}

function assembleSkillsSystemPrompt(activeSkills = []) {
  if (!activeSkills || !activeSkills.length) return "";

  const sections = ["## Habilidades especializadas activas (Skills)"];
  for (const skill of activeSkills) {
    const origin = skill.scope === "brain" && skill.repo ? ` (repo ${skill.repo})` : "";
    sections.push(`### Skill: ${skill.name}${origin}\n${skill.description}\n\n${loadSkillBody(skill)}`);
  }
  return sections.join("\n\n");
}

module.exports = {
  listAllSkills,
  saveSkill,
  deleteSkill,
  toggleSkill,
  parseLearnPrompt,
  matchSkillsForPrompt,
  assembleSkillsSystemPrompt,
  loadSkillBody,
  scanBrainStoreSkills,
  scanSkillDir,
  parseFrontmatter,
  stringifyFrontmatter,
  normalizeSkillSlug,
};
