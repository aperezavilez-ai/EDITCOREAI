/**
 * runtime/mention-parser.js
 * EditCoreAI - Sistema de Menciones Contextuales @ (@files, @folders, @docs) (Ciclo 33)
 */

const fs = require("fs");
const path = require("path");

const BUILTIN_MENTIONS = [
  { trigger: "@files", description: "Adjuntar archivos del proyecto", type: "file" },
  { trigger: "@folders", description: "Adjuntar estructura de directorios", type: "folder" },
  { trigger: "@docs", description: "Adjuntar documentación y directivas", type: "docs" },
  { trigger: "@git", description: "Adjuntar estado Git y commits recientes", type: "git" },
  { trigger: "@code", description: "Adjuntar bloque de código activo de Monaco", type: "code" },
  { trigger: "@terminal", description: "Adjuntar últimos logs de la consola", type: "terminal" },
];

class MentionParser {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Extrae todas las menciones presentes en un texto
   * @param {string} text - Texto del prompt del usuario
   * @returns {Array<Object>} Lista de menciones encontradas
   */
  extractMentions(text = "") {
    if (!text || typeof text !== "string") return [];

    const mentions = [];
    // Detecta patrones como @src/main.js, @docs/readme.md, @files, @folders, etc.
    const regex = /@([a-zA-Z0-9_\-./\\]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const raw = match[0];
      const target = match[1];
      const index = match.index;

      let type = "file";
      if (["files", "folders", "docs", "git", "code", "terminal"].includes(target.toLowerCase())) {
        type = "symbolic";
      } else if (target.endsWith("/") || target.endsWith("\\")) {
        type = "folder";
      }

      mentions.push({
        raw,
        target,
        type,
        index,
      });
    }

    return mentions;
  }

  /**
   * Provee sugerencias de autocompletado para el input al escribir @
   * @param {string} query - Texto tras el símbolo @
   * @param {Array<string>} workspaceFiles - Lista de rutas relativas del proyecto
   */
  suggestCompletions(query = "", workspaceFiles = []) {
    const q = (query || "").replace(/^@/, "").toLowerCase();

    const suggestions = [];

    // 1. Añadir sugerencias simbólicas integradas
    for (const b of BUILTIN_MENTIONS) {
      if (!q || b.trigger.toLowerCase().includes(q)) {
        suggestions.push({
          label: b.trigger,
          detail: b.description,
          insertText: b.trigger,
          type: b.type,
        });
      }
    }

    // 2. Añadir sugerencias de archivos del workspace
    if (Array.isArray(workspaceFiles)) {
      for (const file of workspaceFiles) {
        const norm = file.replace(/\\/g, "/");
        if (!q || norm.toLowerCase().includes(q)) {
          suggestions.push({
            label: `@${norm}`,
            detail: "Archivo del proyecto",
            insertText: `@${norm}`,
            type: "file",
          });
          if (suggestions.length >= 25) break;
        }
      }
    }

    return suggestions;
  }

  /**
   * Resuelve el contenido de las menciones referenciadas
   * @param {string} text - Texto del prompt
   * @param {string} projectRoot - Directorio raíz del proyecto
   */
  resolveMentions(text = "", projectRoot = "") {
    const mentions = this.extractMentions(text);
    const resolvedContexts = [];

    for (const m of mentions) {
      if (m.type === "symbolic") {
        resolvedContexts.push({
          mention: m.raw,
          type: "symbolic",
          content: `[Contexto simbólico activado para ${m.target}]`,
        });
        continue;
      }

      if (projectRoot) {
        const fullPath = path.resolve(projectRoot, m.target);
        if (fs.existsSync(fullPath)) {
          try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile()) {
              const fileContent = fs.readFileSync(fullPath, "utf-8");
              resolvedContexts.push({
                mention: m.raw,
                targetPath: m.target,
                type: "file",
                content: fileContent.slice(0, 10000), // Cap por archivo
              });
            } else if (stat.isDirectory()) {
              const entries = fs.readdirSync(fullPath).slice(0, 30);
              resolvedContexts.push({
                mention: m.raw,
                targetPath: m.target,
                type: "folder",
                content: `Contenido del directorio:\n${entries.join("\n")}`,
              });
            }
          } catch {
            // Ignorar fallos de lectura de archivos bloqueados
          }
        }
      }
    }

    return resolvedContexts;
  }

  /**
   * Construye el prompt final inyectando el contexto estructurado de las menciones
   */
  buildPromptWithMentions(text = "", projectRoot = "") {
    const contexts = this.resolveMentions(text, projectRoot);

    if (contexts.length === 0) {
      return text;
    }

    const contextBlocks = contexts.map((ctx) => {
      return `<!-- [ATTACHED_CONTEXT: ${ctx.mention}] -->\n\`\`\`\n${ctx.content}\n\`\`\``;
    });

    return `${text}\n\n## 📎 Contexto Adjunto vía @ Mentions:\n${contextBlocks.join("\n\n")}`;
  }
}

const mentionParserInstance = new MentionParser();

module.exports = {
  MentionParser,
  mentionParser: mentionParserInstance,
  BUILTIN_MENTIONS,
};
