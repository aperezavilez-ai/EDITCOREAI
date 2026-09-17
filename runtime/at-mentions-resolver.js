"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

/**
 * Resuelve y formatea menciones de contexto rico tipo Cursor AI:
 * @file:path/to/file.js, @symbol:MyFunction, @problems, @git, @docs:query, @selection
 */

const MENTION_TYPES = [
  { prefix: "file", label: "Archivos del proyecto", icon: "📄" },
  { prefix: "symbol", label: "Símbolos / Funciones", icon: "⚡" },
  { prefix: "problems", label: "Errores y advertencias del editor", icon: "⚠️" },
  { prefix: "git", label: "Cambios y diff en Git", icon: "🌿" },
  { prefix: "docs", label: "Documentación del Cerebro", icon: "🧠" },
];

/**
 * Extrae menciones de un texto.
 * Soporta formato @prefix:query o @filename.ext
 */
function extractMentions(text = "") {
  const raw = String(text || "");
  const mentions = [];
  // 1. Menciones estructuradas: @file:..., @symbol:..., @git, @problems, @docs:...
  const structuredRegex = /@(file|symbol|problems|git|docs|selection)(?::([^\s,;]+))?/gi;
  let match;
  while ((match = structuredRegex.exec(raw)) !== null) {
    mentions.push({
      type: match[1].toLowerCase(),
      query: match[2] || "",
      raw: match[0],
      index: match.index,
    });
  }

  // 2. Menciones directas de archivo: @src/app.js o @index.ts
  const fileRegex = /@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]{1,10})/g;
  while ((match = fileRegex.exec(raw)) !== null) {
    const rawTarget = match[1];
    if (!["file:", "symbol:", "problems", "git", "docs:", "selection"].some((p) => match[0].toLowerCase().startsWith("@" + p))) {
      mentions.push({
        type: "file",
        query: rawTarget,
        raw: match[0],
        index: match.index,
      });
    }
  }

  return mentions;
}

/**
 * Busca candidatos para el menú emergente de autocompletado de @.
 */
function queryMentionCandidates(projectRoot = "", search = "") {
  const root = String(projectRoot || "").trim();
  const q = String(search || "").trim().toLowerCase();
  const candidates = [];

  // Categorías base si no hay prefijo o si coincide
  if (!q || "problems".startsWith(q)) {
    candidates.push({ type: "problems", label: "@problems", detail: "Errores y lints activos", insertText: "@problems" });
  }
  if (!q || "git".startsWith(q)) {
    candidates.push({ type: "git", label: "@git", detail: "Archivos modificados y diff actual", insertText: "@git" });
  }
  if (!q || "docs".startsWith(q)) {
    candidates.push({ type: "docs", label: "@docs", detail: "Buscar en Cerebro / Brain", insertText: "@docs:" });
  }

  // Búsqueda de archivos en el proyecto si hay raíz
  if (root && fs.existsSync(root)) {
    try {
      const fileQuery = q.startsWith("file:") ? q.slice(5) : q;
      const files = listProjectFilesFast(root, 40);
      for (const rel of files) {
        if (!fileQuery || rel.toLowerCase().includes(fileQuery)) {
          candidates.push({
            type: "file",
            label: `@file:${rel}`,
            detail: rel,
            insertText: `@file:${rel}`,
          });
        }
      }
    } catch { /* ignore */ }
  }

  return candidates.slice(0, 25);
}

function listProjectFilesFast(dir, max = 50, currentList = [], baseDir = dir) {
  if (currentList.length >= max) return currentList;
  const IGNORED = new Set([".git", ".editcore", ".cache", ".idea", ".vscode", "node_modules", ".next", "dist", "build", "coverage", ".turbo", ".vercel"]);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (currentList.length >= max) break;
      if (IGNORED.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      const rel = path.relative(baseDir, full).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        listProjectFilesFast(full, max, currentList, baseDir);
      } else if (ent.isFile()) {
        currentList.push(rel);
      }
    }
  } catch { /* ignore */ }
  return currentList;
}

/**
 * Resuelve el contenido real de cada mención en el proyecto.
 */
async function resolveMentionsContext(mentions = [], projectRoot = "", options = {}) {
  if (!Array.isArray(mentions) || !mentions.length) return "";
  const root = String(projectRoot || "").trim();
  const blocks = [];

  for (const item of mentions) {
    switch (item.type) {
      case "file": {
        if (!root) break;
        const targetPath = path.isAbsolute(item.query) ? item.query : path.resolve(root, item.query);
        try {
          if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
            const content = fs.readFileSync(targetPath, "utf8");
            const rel = path.relative(root, targetPath).replace(/\\/g, "/");
            const snippet = content.length > 6000 ? `${content.slice(0, 6000)}\n...[truncado por tamaño]` : content;
            blocks.push(`### [Contexto @file: ${rel}]\n\`\`\`\n${snippet}\n\`\`\``);
          } else {
            blocks.push(`### [Contexto @file: ${item.query}]\n(Archivo no encontrado en el proyecto activo)`);
          }
        } catch (e) {
          blocks.push(`### [Contexto @file: ${item.query}]\nError al leer: ${e.message}`);
        }
        break;
      }

      case "git": {
        if (!root) break;
        try {
          const status = execSync("git status --short", { cwd: root, encoding: "utf8", timeout: 3000 }).trim();
          const diff = execSync("git diff -U2 --no-color", { cwd: root, encoding: "utf8", timeout: 4000 }).trim();
          const diffSnippet = diff.length > 5000 ? `${diff.slice(0, 5000)}\n...[diff truncado]` : (diff || "(Sin cambios en diff de git)");
          blocks.push(`### [Contexto @git]\n**Estado:**\n\`\`\`\n${status || "(Árbol de trabajo limpio)"}\n\`\`\`\n**Diff:**\n\`\`\`diff\n${diffSnippet}\n\`\`\``);
        } catch {
          blocks.push(`### [Contexto @git]\n(Git no disponible o repositorio no inicializado)`);
        }
        break;
      }

      case "problems": {
        const markers = Array.isArray(options.markers) ? options.markers : [];
        if (markers.length) {
          const summary = markers.map((m) => `- [${m.severity || "Error"}] ${m.resource || ""}:${m.startLineNumber || 1} — ${m.message}`).join("\n");
          blocks.push(`### [Contexto @problems (Linter / Diagnósticos)]\n${summary}`);
        } else {
          blocks.push(`### [Contexto @problems]\n(No hay errores de sintaxis ni problemas detectados en el editor activo)`);
        }
        break;
      }

      case "symbol": {
        if (!root || !item.query) break;
        try {
          const found = searchSymbolInProject(root, item.query);
          if (found) {
            blocks.push(`### [Contexto @symbol: ${item.query} en ${found.file}:${found.line}]\n\`\`\`\n${found.code}\n\`\`\``);
          } else {
            blocks.push(`### [Contexto @symbol: ${item.query}]\n(Símbolo no localizado en los archivos principales)`);
          }
        } catch { /* ignore */ }
        break;
      }

      case "docs": {
        const query = item.query || "general";
        blocks.push(`### [Contexto @docs: ${query}]\nBuscando referencias en el Cerebro para: "${query}"`);
        break;
      }

      case "selection": {
        const sel = String(options.activeSelection || "").trim();
        if (sel) {
          blocks.push(`### [Contexto @selection (Código seleccionado en editor)]\n\`\`\`\n${sel}\n\`\`\``);
        }
        break;
      }
    }
  }

  if (!blocks.length) return "";
  return [
    "---",
    "CONTEXTO EXPLÍCITO FIJADO POR EL USUARIO (VÍA @MENCIONES TIPO CURSOR):",
    ...blocks,
    "---",
  ].join("\n\n");
}

function searchSymbolInProject(root, symbolName) {
  const files = listProjectFilesFast(root, 30);
  const regex = new RegExp(`(?:function|class|const|let|var|type|interface|enum)\\s+${symbolName}\\b`, "i");
  for (const rel of files) {
    if (!/\.(js|ts|jsx|tsx|py|php|go|rs|java)$/i.test(rel)) continue;
    try {
      const full = path.join(root, rel);
      const lines = fs.readFileSync(full, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 15);
          return {
            file: rel,
            line: i + 1,
            code: lines.slice(start, end).join("\n"),
          };
        }
      }
    } catch { /* ignore */ }
  }
  return null;
}

module.exports = {
  MENTION_TYPES,
  extractMentions,
  queryMentionCandidates,
  resolveMentionsContext,
};
