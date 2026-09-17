"use strict";

const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const { CURSOR_ICONS } = require("./cursor-icons");

const VOICE_COMMAND_MAP = [
  {
    intent: "run_tests",
    keywords: [/\b(ejecut(?:a|ar)?|corr(?:e|er)?)\s+(?:los\s+)?tests?\b/i, /\bpruebas\s+unitarias\b/i],
    action: "run_command",
    payload: { command: "npm test" },
  },
  {
    intent: "build_project",
    keywords: [/\b(compil(?:a|ar)?|constru(?:ye|ir)?|build)\b/i],
    action: "run_command",
    payload: { command: "npm run build" },
  },
  {
    intent: "rollback",
    keywords: [/\b(deshac(?:er)?|revert(?:ir)?|rollback|vuelve\s+atr[aá]s)\b/i],
    action: "rollback_last_session",
  },
  {
    intent: "auto_fix",
    keywords: [/\b(arregl(?:a|ar)?|correg(?:ir|e)?|fix)\s+(?:los\s+)?errores\b/i],
    action: "trigger_auto_fix",
  },
  {
    intent: "git_commit",
    keywords: [/\b(guard(?:a|ar)?|commit(?:ear)?)\s+(?:los\s+)?cambios\b/i],
    action: "git_commit_auto",
  },
];

class MultimodalVoiceCanvas extends EventEmitter {
  constructor(options = {}) {
    super();
    this.projectRoot = options.projectRoot || process.cwd();
    this.isListening = false;
  }

  /**
   * Prepara una imagen o mockup para conversión a código (Image-to-Code)
   */
  processImageForCodeGeneration(imageSource = "", { language = "tsx", framework = "tailwind" } = {}) {
    if (!imageSource) throw new Error("Fuente de imagen requerida");

    let isBase64 = false;
    let isPath = false;
    let mimeType = "image/png";

    if (imageSource.startsWith("data:image/")) {
      isBase64 = true;
      const match = imageSource.match(/^data:(image\/[a-zA-Z+]+);base64,/);
      if (match) mimeType = match[1];
    } else if (fs.existsSync(imageSource)) {
      isPath = true;
      const ext = path.extname(imageSource).toLowerCase();
      if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
      else if (ext === ".svg") mimeType = "image/svg+xml";
      else if (ext === ".webp") mimeType = "image/webp";
    }

    const promptTemplate = [
      "Eres un desarrollador Frontend experto en Pixel-Perfect Design.",
      `Convierte este diseño visual adjunto en código limpio y modular en ${language.toUpperCase()} utilizando ${framework.toUpperCase()}.`,
      "Directivas:",
      "1. Respeta fielmente los espaciados, tipografías, colores, bordes redondeados y sombras observados en la imagen.",
      "2. Usa componentes funcionales modernos de React con hooks.",
      "3. Añade accesibilidad (ARIA tags) y diseño responsive para móvil y escritorio.",
      "4. Devuelve el código completo sin omitir secciones con comentarios.",
    ].join("\n");

    return {
      ok: true,
      mimeType,
      isBase64,
      isPath,
      promptTemplate,
      sourceExcerpt: imageSource.slice(0, 80),
    };
  }

  /**
   * Interpreta transcripciones de voz y extrae la intención o acción inmediata
   */
  interpretVoiceTranscript(transcript = "") {
    const raw = String(transcript).trim();
    if (!raw) return { intent: "empty", action: null, prompt: "" };

    for (const rule of VOICE_COMMAND_MAP) {
      for (const kw of rule.keywords) {
        if (kw.test(raw)) {
          return {
            intent: rule.intent,
            action: rule.action,
            payload: rule.payload || {},
            matchedPhrase: raw,
            isDirectCommand: true,
          };
        }
      }
    }

    return {
      intent: "general_ai_prompt",
      action: "prompt_agent",
      prompt: raw,
      isDirectCommand: false,
    };
  }

  /**
   * Retorna el HTML del botón de micrófono con icono vectorial Cursor
   */
  renderMicButtonHTML({ isActive = false, buttonId = "editcore-voice-btn" } = {}) {
    const icon = isActive ? CURSOR_ICONS.micActive : CURSOR_ICONS.mic;
    return `
      <button type="button" id="${buttonId}" class="ec-voice-trigger-btn ${isActive ? 'active' : ''}" 
        title="${isActive ? 'Detener dictado por voz' : 'Dictar instrucción a EditCoreAI'}"
        style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:${isActive ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)'};border:1px solid ${isActive ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.1)'};color:${isActive ? '#ef4444' : '#cbd5e1'};cursor:pointer;transition:all 0.15s ease;">
        ${icon}
      </button>
    `.trim();
  }
}

module.exports = {
  MultimodalVoiceCanvas,
  VOICE_COMMAND_MAP,
};
