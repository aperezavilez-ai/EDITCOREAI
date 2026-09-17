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

function scanSkillDir(baseDir, scope = "builtin") {
  const skills = [];
  if (!baseDir || !fs.existsSync(baseDir)) return skills;

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      let skillFile = "";
      let slug = entry.name;
      if (entry.isDirectory()) {
        const candidate = path.join(baseDir, entry.name, "SKILL.md");
        const candidateLower = path.join(baseDir, entry.name, "skill.md");
        if (fs.existsSync(candidate)) skillFile = candidate;
        else if (fs.existsSync(candidateLower)) skillFile = candidateLower;
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name) && entry.name.toLowerCase() !== "readme.md") {
        skillFile = path.join(baseDir, entry.name);
        slug = entry.name.replace(/\.(md|markdown)$/i, "");
      }

      if (skillFile) {
        try {
          const raw = fs.readFileSync(skillFile, "utf8");
          const { metadata, body } = parseFrontmatter(raw);
          const name = metadata.name || slug;
          const description = metadata.description || body.slice(0, 160).replace(/\r?\n/g, " ");
          skills.push({
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
          });
        } catch { /* ignore bad skill file */ }
      }
    }
  } catch { /* ignore read errors */ }

  return skills;
}

function listAllSkills({ projectRoot = "", userDataPath = "" } = {}) {
  const config = getSkillsConfig(userDataPath);
  const disabledSet = new Set(config.disabled || []);

  const builtin = scanSkillDir(BUILTIN_SKILLS_DIR, "builtin");
  const globalDir = userDataPath ? path.join(userDataPath, "skills") : "";
  const userGlobal = scanSkillDir(globalDir, "global");
  const projectDir = projectRoot ? path.join(projectRoot, ".editcore", "skills") : "";
  const projectSkills = scanSkillDir(projectDir, "project");

  const skillMap = new Map();
  for (const s of [...builtin, ...userGlobal, ...projectSkills]) {
    s.enabled = !disabledSet.has(s.id) && !disabledSet.has(s.name);
    skillMap.set(s.name, s);
  }

  return Array.from(skillMap.values());
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

function matchSkillsForPrompt(userPrompt = "", allSkills = [], maxSkills = 3) {
  const query = String(userPrompt || "").toLowerCase();
  const queryTokens = query.split(/[^a-z0-9áéíóúñ_-]+/).filter((t) => t.length > 2);
  if (!queryTokens.length) return [];

  const scored = [];
  for (const skill of allSkills) {
    if (skill.enabled === false) continue;
    let score = 0;
    const nameLower = skill.name.toLowerCase();
    const descLower = (skill.description || "").toLowerCase();
    const catLower = (skill.category || "").toLowerCase();

    for (const token of queryTokens) {
      if (nameLower.includes(token)) score += 5;
      if (descLower.includes(token)) score += 2;
      if (catLower.includes(token)) score += 3;
    }

    if (score > 0) {
      scored.push({ skill, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSkills).map((item) => item.skill);
}

function assembleSkillsSystemPrompt(activeSkills = []) {
  if (!activeSkills || !activeSkills.length) return "";

  const sections = ["## Habilidades especializadas activas (Skills)"];
  for (const skill of activeSkills) {
    sections.push(`### Skill: ${skill.name}\n${skill.description}\n\n${skill.body || skill.raw}`);
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
  parseFrontmatter,
  stringifyFrontmatter,
  normalizeSkillSlug,
};
