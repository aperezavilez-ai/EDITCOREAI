/**
 * runtime/rules-engine.js
 * EditCoreAI - Motor de Reglas del Proyecto (.editcorerules, .cursorrules, .editcore/rules/*.mdc) y Políticas de Comando
 */

const fs = require("fs");
const path = require("path");

/**
 * Evalúa el nivel de riesgo de comandos de terminal
 */
function evaluateAgentCommandPolicy(command = "", options = {}) {
  const cmd = String(command || "").trim();
  const lower = cmd.toLowerCase();

  // Bloqueo absoluto: comandos de destrucción masiva / irrecuperables
  if (
    /drop\s+table/i.test(lower) ||
    /drop\s+database/i.test(lower) ||
    /git\s+push\s+.*(--force|-f\b)/i.test(lower) ||
    /rm\s+-rf\s+\/(?:\s|$)/i.test(lower) ||
    /mkfs\b/i.test(lower) ||
    /format\s+[a-z]:/i.test(lower)
  ) {
    return {
      level: "block",
      reason: "Comando bloqueado por política de seguridad crítica (destructivo irreversible)",
      enforceEvenFullAccess: true,
      kind: "blocked_destructive",
    };
  }

  // Confirmación requerida: acciones potencialmente peligrosas
  if (
    /git\s+push\b/i.test(lower) ||
    /rm\s+-rf\b/i.test(lower) ||
    /rmdir\s+\/s/i.test(lower) ||
    /del\s+\/s/i.test(lower)
  ) {
    return {
      level: "confirm",
      reason: "Acción destructiva o de sincronización remota que requiere confirmación",
      enforceEvenFullAccess: true,
      kind: "requires_confirmation",
    };
  }

  return {
    level: "allow",
    reason: "Comando seguro bajo política estándar",
    enforceEvenFullAccess: false,
  };
}

/**
 * Determina si un comando requiere confirmación interactiva
 */
function shouldRequireCommandConfirmation(policy, options = {}) {
  if (!policy || typeof policy !== "object") return false;
  if (policy.level === "confirm") return true;
  return false;
}

class RulesEngine {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || "";
    this.cache = new Map(); // projectRoot -> Array<Rule>
    this.rulesDirName = options.rulesDirName || ".editcore/rules";
  }

  /**
   * Guarda directivas por defecto en el proyecto (.editcorerules)
   */
  saveDefaultRules() {
    const root = this.projectRoot;
    if (!root) {
      return { ok: false, error: "projectRoot no definido" };
    }

    try {
      if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
      }

      const defaultRulesPath = path.join(root, ".editcorerules");
      const defaultContent = `# REGLAS Y ESTÁNDARES DEL PROYECTO
- Mantener código limpio, modular y completamente tipado.
- No incluir secretos ni claves de API en el repositorio.
- Respetar la arquitectura en capas y pruebas unitarias automáticas.
`;

      fs.writeFileSync(defaultRulesPath, defaultContent, "utf-8");
      return { ok: true, path: defaultRulesPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Obtiene las directivas para inyectar en el System Prompt
   */
  getSystemPromptDirectives(filePath = "") {
    const root = this.projectRoot;
    const directives = [];

    if (root) {
      // 1. Cargar .editcorerules
      const editcoreRulesFile = path.join(root, ".editcorerules");
      if (fs.existsSync(editcoreRulesFile)) {
        try {
          directives.push(fs.readFileSync(editcoreRulesFile, "utf-8"));
        } catch {
          // Ignorar
        }
      }

      // 2. Cargar .cursorrules si existe
      const cursorRulesFile = path.join(root, ".cursorrules");
      if (fs.existsSync(cursorRulesFile)) {
        try {
          directives.push(fs.readFileSync(cursorRulesFile, "utf-8"));
        } catch {
          // Ignorar
        }
      }

      // 3. Cargar reglas MDC aplicables
      const mdcRules = this.getRulesForFile(root, filePath);
      if (mdcRules.length > 0) {
        directives.push(this.formatRulesForPrompt(mdcRules));
      }
    }

    if (directives.length === 0) {
      return "# REGLAS Y ESTÁNDARES DEL PROYECTO\n- Mantener código limpio, modular y completamente tipado.";
    }

    return directives.join("\n\n");
  }

  /**
   * Parsea el contenido de un archivo MDC extrayendo frontmatter YAML y cuerpo Markdown
   */
  parseRuleContent(rawContent, filePath = "") {
    let description = "";
    let globs = [];
    let alwaysApply = false;
    let body = rawContent || "";

    const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
    const match = rawContent.match(fmRegex);

    if (match) {
      const frontmatter = match[1];
      body = (match[2] || "").trim();

      const lines = frontmatter.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const colonIdx = trimmed.indexOf(":");
        if (colonIdx === -1) continue;

        const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
        let val = trimmed.slice(colonIdx + 1).trim();

        if (key === "description") {
          description = val.replace(/^["']|["']$/g, "");
        } else if (key === "alwaysapply") {
          alwaysApply = val.toLowerCase() === "true" || val === "1";
        } else if (key === "globs") {
          if (val.startsWith("[") && val.endsWith("]")) {
            try {
              globs = JSON.parse(val);
            } catch {
              globs = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
            }
          } else {
            globs = val.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
          }
        }
      }
    }

    const name = filePath ? path.basename(filePath, path.extname(filePath)) : "unnamed-rule";

    return {
      name,
      filePath,
      description,
      globs,
      alwaysApply,
      content: body,
    };
  }

  /**
   * Carga y parsea todas las reglas disponibles en el proyecto
   */
  loadRules(projectRoot = this.projectRoot) {
    const root = projectRoot || this.projectRoot;
    if (!root || typeof root !== "string") {
      return [];
    }

    const rulesDir = path.join(root, this.rulesDirName);
    const rules = [];

    if (!fs.existsSync(rulesDir)) {
      this.cache.set(root, []);
      return [];
    }

    try {
      const files = fs.readdirSync(rulesDir);
      for (const file of files) {
        if (file.endsWith(".mdc") || file.endsWith(".md")) {
          const fullPath = path.join(rulesDir, file);
          try {
            const raw = fs.readFileSync(fullPath, "utf-8");
            const parsed = this.parseRuleContent(raw, fullPath);
            rules.push(parsed);
          } catch {
            // Ignorar archivo corrupto
          }
        }
      }
    } catch {
      // Ignorar error de lectura de carpeta
    }

    this.cache.set(root, rules);
    return rules;
  }

  /**
   * Evalúa si una ruta de archivo coincide con un patrón glob básico
   */
  matchGlob(filePath, pattern) {
    if (!filePath || !pattern) return false;

    const normalizedPath = filePath.replace(/\\/g, "/");
    const normalizedPattern = pattern.replace(/\\/g, "/").trim();

    if (normalizedPattern === "*" || normalizedPattern === "**/*") {
      return true;
    }

    // Extensión simple: "*.js" -> matches "foo/bar.js"
    if (normalizedPattern.startsWith("*.")) {
      const ext = normalizedPattern.slice(1);
      return normalizedPath.endsWith(ext);
    }

    // Comienza con comodín de carpeta: "**/something"
    if (normalizedPattern.startsWith("**/")) {
      const sub = normalizedPattern.slice(3);
      return normalizedPath.includes(sub) || normalizedPath.endsWith(sub);
    }

    // Prefijo de carpeta: "src/**/*"
    if (normalizedPattern.endsWith("/**/*")) {
      const prefix = normalizedPattern.slice(0, -5);
      return normalizedPath.startsWith(prefix) || normalizedPath.includes(`/${prefix}/`);
    }

    // Coincidencia exacta o inclusión de segmento
    return normalizedPath.endsWith(normalizedPattern) || normalizedPath.includes(normalizedPattern);
  }

  /**
   * Obtiene las reglas aplicables para un archivo específico en el editor
   */
  getRulesForFile(projectRoot = this.projectRoot, activeFilePath = "") {
    const root = projectRoot || this.projectRoot;
    const allRules = this.loadRules(root);
    if (!allRules.length) return [];

    if (!activeFilePath) {
      return allRules.filter((r) => r.alwaysApply);
    }

    const relativePath = path.isAbsolute(activeFilePath) && root
      ? path.relative(root, activeFilePath).replace(/\\/g, "/")
      : activeFilePath.replace(/\\/g, "/");

    return allRules.filter((rule) => {
      if (rule.alwaysApply) return true;
      if (!rule.globs || rule.globs.length === 0) return false;

      return rule.globs.some((pattern) => this.matchGlob(relativePath, pattern));
    });
  }

  /**
   * Formatea las reglas activas para inyección directa en el System Prompt del LLM
   */
  formatRulesForPrompt(rules = []) {
    if (!Array.isArray(rules) || rules.length === 0) {
      return "";
    }

    const sections = rules.map((r, i) => {
      const header = `### Regla ${i + 1}: ${r.name}${r.description ? ` (${r.description})` : ""}`;
      return `${header}\n${r.content}`;
    });

    return [
      "<!-- [PROJECT_RULES_START] -->",
      "## Directivas y Reglas Obligatorias del Proyecto",
      "Debes cumplir estrictamente con las siguientes reglas del proyecto para cualquier generación o modificación de código:",
      "",
      sections.join("\n\n"),
      "<!-- [PROJECT_RULES_END] -->",
    ].join("\n");
  }

  /**
   * Guarda o actualiza una regla en `.editcore/rules/<ruleName>.mdc`
   */
  saveRule(projectRoot = this.projectRoot, ruleName, ruleData = {}) {
    const root = projectRoot || this.projectRoot;
    if (!root || !ruleName) {
      throw new Error("projectRoot y ruleName son obligatorios");
    }

    const rulesDir = path.join(root, this.rulesDirName);
    if (!fs.existsSync(rulesDir)) {
      fs.mkdirSync(rulesDir, { recursive: true });
    }

    const safeName = ruleName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
    const targetFile = path.join(rulesDir, `${safeName}.mdc`);

    const globs = Array.isArray(ruleData.globs) ? ruleData.globs : (ruleData.globs ? [ruleData.globs] : []);
    const frontmatter = [
      "---",
      `description: "${(ruleData.description || "").replace(/"/g, '\\"')}"`,
      `globs: ${JSON.stringify(globs)}`,
      `alwaysApply: ${ruleData.alwaysApply ? "true" : "false"}`,
      "---",
      "",
      ruleData.content || "",
    ].join("\n");

    fs.writeFileSync(targetFile, frontmatter, "utf-8");
    this.loadRules(root); // Refresca caché

    return {
      name: safeName,
      filePath: targetFile,
      saved: true,
    };
  }
}

const rulesEngineInstance = new RulesEngine();

module.exports = {
  RulesEngine,
  rulesEngine: rulesEngineInstance,
  evaluateAgentCommandPolicy,
  shouldRequireCommandConfirmation,
};
