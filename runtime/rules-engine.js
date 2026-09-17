"use strict";

const path = require("path");
const fs = require("fs");

const RULE_FILENAMES = [
  ".editcorerules",
  ".cursorrules",
  ".windsurfrules",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
];

class RulesEngine {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.rules = [];
  }

  /**
   * Carga todas las reglas presentes en el directorio del proyecto
   */
  loadProjectRules() {
    this.rules = [];

    for (const filename of RULE_FILENAMES) {
      const fullPath = path.join(this.projectRoot, filename);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, "utf8").trim();
          if (content) {
            this.rules.push({
              sourceFile: filename,
              fullPath,
              content,
              sizeBytes: Buffer.byteLength(content, "utf8"),
            });
          }
        } catch (err) {
          // Ignore read error
        }
      }
    }

    return this.rules;
  }

  /**
   * Formatea las reglas del proyecto como directivas del sistema para el LLM
   */
  getSystemPromptDirectives() {
    if (this.rules.length === 0) {
      this.loadProjectRules();
    }

    if (this.rules.length === 0) return "";

    const sections = this.rules.map((r) => {
      return `### Reglas del Proyecto (Origen: ${r.sourceFile})\n${r.content}`;
    });

    return [
      "==================== REGLAS Y ESTÁNDARES DEL PROYECTO ====================",
      "Debes cumplir ESTRICTAMENTE las siguientes reglas configuradas en este repositorio:",
      "",
      ...sections,
      "==========================================================================",
    ].join("\n");
  }

  /**
   * Crea o actualiza un archivo .editcorerules en el proyecto
   */
  saveDefaultRules(rulesContent) {
    const defaultContent = rulesContent || [
      "# Reglas de Desarrollo EditCoreAI",
      "- Mantener código limpio, modular y completamente tipado con TypeScript.",
      "- No eliminar ni debilitar pruebas unitarias existentes.",
      "- Usar Tailwind CSS para diseño moderno y consistente.",
      "- Verificar siempre que no queden errores de compilación o linter tras cada cambio.",
    ].join("\n");

    const targetFile = path.join(this.projectRoot, ".editcorerules");
    fs.writeFileSync(targetFile, defaultContent, "utf8");
    this.loadProjectRules();

    return { ok: true, file: targetFile, rulesCount: this.rules.length };
  }
}

module.exports = {
  RulesEngine,
  RULE_FILENAMES,
};
