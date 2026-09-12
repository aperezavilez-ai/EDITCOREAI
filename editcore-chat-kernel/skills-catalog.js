"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Catálogo dinámico de skills EditCore.
 * Localiza carpetas `skills` en la raíz de EDITCOREAI, en el kernel,
 * en brain-seed y en carpetas adyacentes al proyecto.
 */

const MANIFEST_NAMES = ["SKILL.md", "README.md", "CLAUDE.md", "mcp.json"];
const NESTED_SCAN_DIRS = [".claude", "plugins", "src"];
const MAX_SKILLS_IN_PROMPT = 4;
const MAX_SKILL_CHARS = 1600;
const MAX_PROMPT_CHARS = 7000;

/** IDs canónicos conocidos (compatibilidad / fallback de ranking). */
const SKILL_IDS = [
  "agent-model-selection",
  "as-browser-testing-with-devtools",
  "as-ci-cd-and-automation",
  "as-code-review-and-quality",
  "as-code-simplification",
  "as-debugging-and-error-recovery",
  "as-documentation-and-adrs",
  "as-frontend-ui-engineering",
  "as-git-workflow-and-versioning",
  "as-incremental-implementation",
  "as-observability-and-instrumentation",
  "as-performance-optimization",
  "as-planning-and-task-breakdown",
  "as-security-and-hardening",
  "as-spec-driven-development",
  "as-test-driven-development",
  "deep-project-analysis",
  "editcore-connect",
  "editcore-self-diagnostics",
  "ffmpeg",
  "frontend-design",
  "marketing-content-creator",
  "moviepy",
  "n8n-agents",
  "n8n-binary-and-data",
  "n8n-code-javascript",
  "n8n-code-python",
  "n8n-code-tool",
  "n8n-error-handling",
  "n8n-expression-syntax",
  "n8n-mcp-tools-expert",
  "n8n-multi-instance",
  "n8n-node-configuration",
  "n8n-self-hosting",
  "n8n-subworkflows",
  "n8n-validation-expert",
  "n8n-workflow-patterns",
  "playwright-recording",
  "ponytail",
  "ponytail-audit",
];

const KIND_KEYWORDS = {
  ANALYZE: ["analiza", "audit", "diagnost", "reporte", "hallazgo", "plan", "review"],
  EXECUTE: ["corrige", "arregla", "implementa", "crea", "build", "fix", "debug", "error"],
  GIT: ["git", "commit", "push", "branch", "merge"],
  DEPLOY: ["deploy", "vercel", "ci", "cd", "pipeline", "publica"],
  LIST: ["lista", "carpeta", "estructura", "archivos"],
  ASK: ["como", "cómo", "qué", "que", "donde", "dónde"],
};

const SKILL_KEYWORD_MAP = {
  "deep-project-analysis": ["analiza", "auditor", "diagnost", "proyecto", "reporte", "forense"],
  "as-planning-and-task-breakdown": ["plan", "tareas", "roadmap", "desglose"],
  "as-code-review-and-quality": ["review", "calidad", "revisa", "code review"],
  "as-incremental-implementation": ["implementa", "incremental", "feature", "crea", "añade", "agrega"],
  "as-debugging-and-error-recovery": ["error", "bug", "corrige", "arregla", "falla", "debug", "tsc", "build"],
  "as-code-simplification": ["simplifica", "refactor", "limpia"],
  "as-frontend-ui-engineering": ["ui", "ux", "frontend", "componente", "layout", "tailwind", "css", "diseño", "dashboard"],
  "frontend-design": ["diseño", "ui", "ux", "visual", "estilo", "animacion", "framer"],
  "as-git-workflow-and-versioning": ["git", "commit", "push", "branch"],
  "as-ci-cd-and-automation": ["deploy", "ci", "cd", "pipeline", "vercel", "github actions"],
  "as-security-and-hardening": ["seguridad", "auth", "login", "jwt", "rls", "token", "password"],
  "as-test-driven-development": ["test", "tdd", "jest", "vitest", "spec"],
  "as-spec-driven-development": ["spec", "requisito", "historia"],
  "as-performance-optimization": ["performance", "rendimiento", "optimiza", "lento"],
  "as-observability-and-instrumentation": ["log", "metric", "observabilidad", "telemetry"],
  "as-documentation-and-adrs": ["docs", "documenta", "adr", "readme"],
  "as-browser-testing-with-devtools": ["browser", "devtools", "preview", "playwright"],
  "playwright-recording": ["playwright", "e2e", "grabar"],
  "editcore-connect": ["conexion", "conectar", "supabase", "vercel", "gateway"],
  "editcore-self-diagnostics": ["editcore", "diagnostico", "self", "inspector"],
  "ffmpeg": ["ffmpeg", "video", "audio", "mp4"],
  "moviepy": ["moviepy", "video", "clip"],
  "marketing-content-creator": ["marketing", "copy", "contenido", "campaign"],
  "n8n-agents": ["n8n", "workflow", "agente"],
  "n8n-code-javascript": ["n8n", "javascript", "code node"],
  "n8n-code-python": ["n8n", "python"],
  "agent-model-selection": ["modelo", "model", "llm", "provider"],
  ponytail: ["ponytail", "deuda", "debt"],
  "ponytail-audit": ["ponytail", "audit"],
};

function uniquePaths(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = String(item || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Localiza carpetas `skills` en EDITCOREAI, kernel, brain-seed y adyacentes.
 */
function resolveSkillsRoots(projectRoot) {
  const kernelRoot = path.resolve(__dirname);
  const editcoreRoot = path.resolve(__dirname, "..");
  const project = projectRoot ? path.resolve(projectRoot) : "";
  const parentOfEditcore = path.dirname(editcoreRoot);
  const parentOfProject = project ? path.dirname(project) : "";

  const candidates = [
    path.join(kernelRoot, "skills"),
    path.join(editcoreRoot, "skills"),
    path.join(editcoreRoot, "brain-seed", "skills"),
    path.join(editcoreRoot, ".claude", "skills"),
    path.join(editcoreRoot, "plugins", "skills"),
    project ? path.join(project, "skills") : null,
    project ? path.join(project, "brain-seed", "skills") : null,
    project ? path.join(project, ".claude", "skills") : null,
    parentOfEditcore ? path.join(parentOfEditcore, "skills") : null,
    parentOfEditcore ? path.join(parentOfEditcore, "EDITCOREAI", "skills") : null,
    parentOfEditcore ? path.join(parentOfEditcore, "EDITCOREAI", "editcore-chat-kernel", "skills") : null,
    parentOfEditcore ? path.join(parentOfEditcore, "EDITCOREAI", "brain-seed", "skills") : null,
    parentOfProject ? path.join(parentOfProject, "skills") : null,
  ].filter(Boolean);

  return uniquePaths(candidates).filter((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Escanea manifiestos válidos en la raíz del skill y en subcarpetas
 * `.claude/`, `plugins/` o `src/` (recursivo acotado).
 */
function findSkillManifest(skillDir, depth = 0) {
  const root = path.resolve(skillDir || "");
  if (!root || !fs.existsSync(root)) return null;

  try {
    if (!fs.statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }

  for (const name of MANIFEST_NAMES) {
    const direct = path.join(root, name);
    if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
      return { path: direct, name, skillDir: root };
    }
  }

  if (depth >= 3) return null;

  for (const nested of NESTED_SCAN_DIRS) {
    const nestedDir = path.join(root, nested);
    if (!fs.existsSync(nestedDir)) continue;
    try {
      if (!fs.statSync(nestedDir).isDirectory()) continue;
    } catch {
      continue;
    }

    for (const name of MANIFEST_NAMES) {
      const nestedFile = path.join(nestedDir, name);
      if (fs.existsSync(nestedFile) && fs.statSync(nestedFile).isFile()) {
        return { path: nestedFile, name, skillDir: root };
      }
    }

    // Recurse into one more level inside nested dirs (e.g. .claude/skills/foo)
    let entries = [];
    try {
      entries = fs.readdirSync(nestedDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const found = findSkillManifest(path.join(nestedDir, ent.name), depth + 1);
      if (found) return found;
    }
  }

  // Último recurso: un nivel de subcarpetas genéricas (sin bajar demasiado)
  if (depth === 0) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (["node_modules", ".git", "dist", "build"].includes(ent.name)) continue;
      if (NESTED_SCAN_DIRS.includes(ent.name)) continue;
      const found = findSkillManifest(path.join(root, ent.name), depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function listSkillDirsInRoot(skillsRoot) {
  let entries = [];
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({
      id: e.name,
      dir: path.join(skillsRoot, e.name),
      root: skillsRoot,
    }));
}

/**
 * Skills locales con manifiesto válido. Descarta carpetas sin SKILL.md/README/CLAUDE/mcp.json.
 */
function getValidLocalSkills(projectRoot) {
  const roots = resolveSkillsRoots(projectRoot);
  const byId = new Map();

  for (const root of roots) {
    for (const item of listSkillDirsInRoot(root)) {
      const manifest = findSkillManifest(item.dir);
      if (!manifest) continue;
      const prev = byId.get(item.id);
      // Preferir kernel / editcore-chat-kernel sobre copias más lejanas
      const preferKernel = String(item.root).toLowerCase().includes("editcore-chat-kernel");
      if (!prev || (preferKernel && !String(prev.root).toLowerCase().includes("editcore-chat-kernel"))) {
        byId.set(item.id, {
          id: item.id,
          dir: item.dir,
          root: item.root,
          manifestPath: manifest.path,
          manifestName: manifest.name,
        });
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function scoreSkill(skill, message, kind) {
  const text = String(message || "").toLowerCase();
  const id = String(skill.id || "").toLowerCase();
  let score = 0;

  const mapped = SKILL_KEYWORD_MAP[skill.id] || SKILL_KEYWORD_MAP[id] || [];
  for (const kw of mapped) {
    if (kw && text.includes(String(kw).toLowerCase())) score += 3;
  }

  // tokens del id
  for (const token of id.split(/[-_]/g)) {
    if (token.length >= 3 && text.includes(token)) score += 1;
  }

  const kindHints = KIND_KEYWORDS[kind] || [];
  for (const kw of kindHints) {
    if (mapped.some((m) => String(m).toLowerCase().includes(kw))) score += 1;
  }

  // Preferencias por kind (boost suave si está en el set clásico)
  const preferred = pickSkillsForKind(kind);
  if (preferred.includes(skill.id)) score += 2;

  return score;
}

function pickSkillsForKind(kind) {
  if (kind === "ANALYZE") return ["deep-project-analysis", "as-planning-and-task-breakdown", "as-code-review-and-quality"];
  if (kind === "EXECUTE") return ["as-incremental-implementation", "as-debugging-and-error-recovery", "as-code-simplification", "as-frontend-ui-engineering"];
  if (kind === "GIT") return ["as-git-workflow-and-versioning"];
  if (kind === "DEPLOY") return ["as-ci-cd-and-automation"];
  if (kind === "LIST" || kind === "ASK") return ["deep-project-analysis"];
  return [];
}

function loadManifestBody(manifestPath, maxChars = MAX_SKILL_CHARS) {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    if (String(manifestPath).toLowerCase().endsWith("mcp.json")) {
      return raw.slice(0, Math.min(maxChars, 800));
    }
    return raw.slice(0, maxChars);
  } catch {
    return "";
  }
}

/**
 * Inyecta hasta 4 skills válidas y relevantes.
 * Firma compatible: skillsPrompt(projectRoot, kind)
 * Extendida: skillsPrompt(projectRoot, kind, messageOrOpts)
 */
function skillsPrompt(projectRoot, kind, messageOrOpts) {
  const message = typeof messageOrOpts === "string"
    ? messageOrOpts
    : String(messageOrOpts?.message || messageOrOpts?.prompt || "");

  const valid = getValidLocalSkills(projectRoot);
  if (!valid.length) {
    return [
      "SKILLS: no se detectaron skills con manifiesto válido (SKILL.md / README.md / CLAUDE.md / mcp.json).",
      "Se omite inyección de skills para evitar errores de contexto.",
    ].join("\n");
  }

  const ranked = valid
    .map((skill) => ({ skill, score: scoreSkill(skill, message, kind) }))
    .sort((a, b) => b.score - a.score || a.skill.id.localeCompare(b.skill.id));

  let selected = ranked.filter((r) => r.score > 0).slice(0, MAX_SKILLS_IN_PROMPT).map((r) => r.skill);

  // Si el mensaje no aporta keywords, caer a preferidos por kind (solo si existen en disco)
  if (!selected.length) {
    const preferred = pickSkillsForKind(kind);
    selected = preferred
      .map((id) => valid.find((s) => s.id === id))
      .filter(Boolean)
      .slice(0, MAX_SKILLS_IN_PROMPT);
  }

  // Último fallback: primeras skills válidas
  if (!selected.length) {
    selected = valid.slice(0, Math.min(2, MAX_SKILLS_IN_PROMPT));
  }

  const blocks = selected.map((skill) => {
    const body = loadManifestBody(skill.manifestPath);
    if (!body) return null;
    return `SKILL ${skill.id} (${skill.manifestName}):\n${body}`;
  }).filter(Boolean);

  const availableIds = valid.map((s) => s.id);
  const prompt = [
    `SKILLS VÁLIDAS EN DISCO (${availableIds.length}): ${availableIds.join(", ")}`,
    `Inyectadas (${selected.length}/${MAX_SKILLS_IN_PROMPT}) por relevancia al mensaje. Carpetas sin manifiesto se descartan.`,
    blocks.join("\n\n"),
  ].join("\n\n");

  return prompt.slice(0, MAX_PROMPT_CHARS);
}

module.exports = {
  SKILL_IDS,
  MANIFEST_NAMES,
  findSkillManifest,
  getValidLocalSkills,
  resolveSkillsRoots,
  pickSkillsForKind,
  skillsPrompt,
  // compat
  loadSkillBody: (projectRoot, id, maxChars = MAX_SKILL_CHARS) => {
    const hit = getValidLocalSkills(projectRoot).find((s) => s.id === id);
    if (!hit) return { id, available: false, body: "" };
    return { id, available: true, body: loadManifestBody(hit.manifestPath, maxChars) };
  },
};
