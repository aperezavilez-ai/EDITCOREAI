"use strict";

const path = require("path");
const fs = require("fs");

class AutoRulesEvolver {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.rulesFile = path.join(this.projectRoot, ".editcorerules");
  }

  /**
   * Analiza el banco de lecciones aprendidas y sintetiza reglas concretas en .editcorerules
   */
  evolveRulesFromLessons(lessons = []) {
    if (!Array.isArray(lessons) || lessons.length === 0) {
      return { ok: true, evolvedCount: 0 };
    }

    let existingRules = "";
    if (fs.existsSync(this.rulesFile)) {
      try {
        existingRules = fs.readFileSync(this.rulesFile, "utf8");
      } catch {
        existingRules = "";
      }
    }

    const newRuleEntries = [];

    for (const lesson of lessons) {
      const statement = lesson.correctBehavior || "";
      if (statement && !existingRules.includes(statement)) {
        newRuleEntries.push(`- ${statement}`);
      }
    }

    if (newRuleEntries.length === 0) {
      return { ok: true, evolvedCount: 0, message: "Todas las lecciones ya están reflejadas en las reglas." };
    }

    const updatedContent = existingRules
      ? `${existingRules.trim()}\n\n# Reglas aprendidas automáticamente de interacciones previas\n${newRuleEntries.join("\n")}\n`
      : `# Reglas de Desarrollo EditCoreAI\n\n# Reglas aprendidas automáticamente de interacciones previas\n${newRuleEntries.join("\n")}\n`;

    try {
      fs.writeFileSync(this.rulesFile, updatedContent, "utf8");
      return {
        ok: true,
        evolvedCount: newRuleEntries.length,
        addedRules: newRuleEntries,
        rulesFile: this.rulesFile,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = {
  AutoRulesEvolver,
};
