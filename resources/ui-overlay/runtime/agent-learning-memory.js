"use strict";

const fs = require("fs");
const path = require("path");

class AgentLearningMemory {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.memoryDir = path.join(this.projectRoot, ".editcore", "memory");
    this.lessonsFile = path.join(this.memoryDir, "learned_lessons.json");
    this.preferencesFile = path.join(this.memoryDir, "user_preferences.json");
    this.lessons = [];
    this.preferences = {};
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.memoryDir)) {
        fs.mkdirSync(this.memoryDir, { recursive: true });
      }
      this.load();
    } catch {
      // Non-fatal
    }
  }

  load() {
    if (fs.existsSync(this.lessonsFile)) {
      try {
        this.lessons = JSON.parse(fs.readFileSync(this.lessonsFile, "utf8"));
      } catch {
        this.lessons = [];
      }
    }
    if (fs.existsSync(this.preferencesFile)) {
      try {
        this.preferences = JSON.parse(fs.readFileSync(this.preferencesFile, "utf8"));
      } catch {
        this.preferences = {};
      }
    }
  }

  save() {
    try {
      fs.writeFileSync(this.lessonsFile, JSON.stringify(this.lessons, null, 2), "utf8");
      fs.writeFileSync(this.preferencesFile, JSON.stringify(this.preferences, null, 2), "utf8");
    } catch {
      // Non-fatal
    }
  }

  /**
   * Aprende y almacena una nueva lección o corrección del usuario
   */
  recordLesson({ topic = "general", mistakeOrContext = "", correctBehavior = "", source = "user_correction" } = {}) {
    const lesson = {
      id: `lsn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      topic,
      mistakeOrContext,
      correctBehavior,
      source,
    };

    this.lessons.unshift(lesson);
    if (this.lessons.length > 100) this.lessons.pop();
    this.save();
    return lesson;
  }

  /**
   * Detecta automáticamente si el usuario está corrigiendo a la IA
   */
  detectAndAbsorbCorrection(userPrompt = "", lastAssistantMessage = "") {
    const raw = String(userPrompt).trim();
    const isCorrection = /\b(?:no\s+(?:era|as[ií]|lo\s+hagas|pongas)|te\s+dije\s+que|recuerda\s+que|en\s+lugar\s+de\s+\w+\s+usa|debe\s+ser\s+con|preferimos|siempre\s+usa)\b/i.test(raw);

    if (isCorrection && raw.length > 10) {
      return this.recordLesson({
        topic: "user_style_or_rule",
        mistakeOrContext: lastAssistantMessage ? lastAssistantMessage.slice(0, 150) : "Interacción previa",
        correctBehavior: raw,
        source: "auto_absorbed_from_chat",
      });
    }

    return null;
  }

  /**
   * Actualiza una preferencia del usuario
   */
  setPreference(key, value) {
    this.preferences[key] = value;
    this.save();
    return this.preferences;
  }

  /**
   * Genera el bloque de contexto de memoria aprendida para el prompt de sistema
   */
  formatMemoryPromptBlock(maxItems = 5) {
    if (this.lessons.length === 0 && Object.keys(this.preferences).length === 0) {
      return "";
    }

    const lines = [
      "==================== BANCO DE MEMORIA Y LECCIONES APRENDIDAS ====================",
      "Has aprendido las siguientes lecciones en este proyecto (aplícalas estrictamente):",
    ];

    const recentLessons = this.lessons.slice(0, maxItems);
    for (const [idx, item] of recentLessons.entries()) {
      lines.push(`${idx + 1}. [${item.topic.toUpperCase()}]: ${item.correctBehavior}`);
    }

    if (Object.keys(this.preferences).length > 0) {
      lines.push("\nPreferencias del usuario registradas:");
      for (const [k, v] of Object.entries(this.preferences)) {
        lines.push(`- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }

    lines.push("==================================================================================");
    return lines.join("\n");
  }
}

module.exports = {
  AgentLearningMemory,
};
