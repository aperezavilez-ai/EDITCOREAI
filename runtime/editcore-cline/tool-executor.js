"use strict";

/**
 * EditCoreAI - Deterministic File & Tool Executor (Estilo Cline)
 * 
 * Implementa la lógica de ejecutores de Cline:
 * - Detección y normalización de saltos de línea (CRLF vs LF) para evitar inconsistencias de diff.
 * - replace_in_file con conteo exacto de ocurrencias (falla si hay 0 o >1 para evitar corrupciones).
 * - Generación de diff limpio visualizable por la UI.
 * - Interfaz unificada con las herramientas existentes de EditCoreAI.
 */

const fs = require("node:fs/promises");
const path = require("node:path");

function detectLineEnding(content = "") {
  const crlfIndex = content.indexOf("\r\n");
  return crlfIndex !== -1 ? "\r\n" : "\n";
}

function normalizeLineEndings(text = "", eol = "\n") {
  return text.replace(/\r\n|\n/g, eol);
}

function countOccurrences(content, needle) {
  if (!needle) return 0;
  return content.split(needle).length - 1;
}

function createLineDiff(oldContent, newContent, maxLines = 150) {
  const oldLines = oldContent.split(/\r\n|\n/);
  const newLines = newContent.split(/\r\n|\n/);

  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }

  const out = ["```diff"];
  for (let i = start; i < Math.min(oldEnd, start + maxLines); i++) {
    out.push(`-${i + 1}: ${oldLines[i]}`);
  }
  for (let i = start; i < Math.min(newEnd, start + maxLines); i++) {
    out.push(`+${i + 1}: ${newLines[i]}`);
  }
  out.push("```");
  return out.join("\n");
}

function sanitizeWindowsCommand(command) {
  let cmd = String(command || "").trim();
  cmd = cmd.replace(/^cd\s+(?:"[^"]+"|\S+)\s*(?:&&|;)\s*/i, "");
  cmd = cmd.replace(/\s*2>&1\s*\|\s*(?:tail|head)(?:\s+-\d+)?/gi, "");
  cmd = cmd.replace(/\s*\|\s*(?:tail|head)(?:\s+-\d+)?/gi, "");
  return cmd;
}

class EditCoreClineTools {
  constructor(projectRoot, existingToolExecutor = null) {
    this.projectRoot = path.resolve(projectRoot || process.cwd());
    this.existingToolExecutor = existingToolExecutor;
  }

  resolvePath(relOrAbsPath) {
    if (!relOrAbsPath) return this.projectRoot;
    if (typeof relOrAbsPath !== "string") return this.projectRoot;
    const clean = relOrAbsPath.trim();
    if (!clean || clean === "." || clean === "./" || clean === ".\\") return this.projectRoot;
    if (path.isAbsolute(clean)) return path.normalize(clean);
    return path.resolve(this.projectRoot, clean);
  }

  resolveFilePath(filePath) {
    if (!filePath || typeof filePath !== "string") {
      throw new Error("Ruta de archivo no especificada o inválida.");
    }
    const clean = filePath.trim();
    if (!clean || clean === "." || clean === "./" || clean === ".\\") {
      throw new Error(`Ruta de archivo inválida: '${filePath}'. Debes especificar un archivo concreto con su nombre y extensión.`);
    }
    const resolved = this.resolvePath(clean);
    if (resolved === this.projectRoot) {
      throw new Error(`Ruta inválida: '${filePath}' apunta a la raíz del proyecto, no a un archivo.`);
    }
    return resolved;
  }

  async readFile(filePath, startLine = null, endLine = null) {
    const fullPath = this.resolveFilePath(filePath);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        throw new Error(`'${filePath}' es un directorio, no un archivo. Usa 'list_files' para explorar su contenido.`);
      }
    } catch (err) {
      if (err.code === "ENOENT") throw new Error(`El archivo '${filePath}' no existe.`);
      throw err;
    }

    const ext = path.extname(fullPath).toLowerCase();
    if ([".pdf", ".docx", ".xlsx", ".xls", ".xlsm"].includes(ext)) {
      try {
        const { extractDocumentFromBuffer } = require("../../document-attachments");
        const buffer = await fs.readFile(fullPath);
        const extracted = await extractDocumentFromBuffer(path.basename(fullPath), buffer);
        if (extracted.supported && extracted.text) {
          const lines = extracted.text.split(/\r?\n/);
          return {
            ok: true,
            path: filePath,
            format: extracted.format,
            totalLines: lines.length,
            content: extracted.text.slice(0, 50_000),
            truncated: extracted.truncated || extracted.text.length > 50_000
          };
        }
      } catch (docErr) {
        throw new Error(`No se pudo extraer contenido del documento '${filePath}': ${docErr.message}`);
      }
    }

    const content = await fs.readFile(fullPath, "utf-8");
    const lines = content.split(/\r\n|\n/);

    if (startLine != null && endLine != null) {
      const s = Math.max(1, Number(startLine));
      const e = Math.min(lines.length, Number(endLine));
      return {
        ok: true,
        path: filePath,
        startLine: s,
        endLine: e,
        totalLines: lines.length,
        content: lines.slice(s - 1, e).join("\n")
      };
    }

    return {
      ok: true,
      path: filePath,
      totalLines: lines.length,
      content: content.slice(0, 50_000)
    };
  }

  async writeFile(filePath, content) {
    const fullPath = this.resolveFilePath(filePath);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        throw new Error(`No se puede escribir en '${filePath}': es un directorio existente. Debes especificar un nombre de archivo.`);
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const eol = detectLineEnding(content);
    const normalized = normalizeLineEndings(content, eol);
    await fs.writeFile(fullPath, normalized, "utf-8");
    return {
      ok: true,
      path: filePath,
      message: `Archivo escrito exitosamente en ${filePath}`
    };
  }

  async replaceInFile(filePath, oldText, newText) {
    const fullPath = this.resolveFilePath(filePath);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      throw new Error(`El archivo '${filePath}' no existe.`);
    }
    if (stat.isDirectory()) {
      throw new Error(`'${filePath}' es un directorio, no un archivo.`);
    }

    let content;
    try {
      content = await fs.readFile(fullPath, "utf-8");
    } catch (err) {
      throw new Error(`No se pudo leer el archivo '${filePath}': ${err.message}`);
    }

    const eol = detectLineEnding(content);
    const normOld = normalizeLineEndings(oldText, eol);
    const normNew = normalizeLineEndings(newText ?? "", eol);

    const occurrences = countOccurrences(content, normOld);
    if (occurrences === 0) {
      throw new Error(`Texto no encontrado en '${filePath}'. Asegúrate de que 'old_text' coincida exactamente caracter por caracter incluyendo sangrías.`);
    }
    if (occurrences > 1) {
      throw new Error(`Se encontraron ${occurrences} ocurrencias de 'old_text' en '${filePath}'. Proporciona un bloque más grande con más contexto para asegurar unicidad.`);
    }

    const updated = content.replace(normOld, () => normNew);
    await fs.writeFile(fullPath, updated, "utf-8");
    const diff = createLineDiff(content, updated);

    return {
      ok: true,
      path: filePath,
      diff,
      message: `Modificación aplicada correctamente en ${filePath}`
    };
  }

  async listFiles(dirPath = ".") {
    const fullPath = this.resolvePath(dirPath);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return {
        ok: true,
        path: dirPath,
        entries: entries.slice(0, 100).map((e) => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        })),
      };
    } catch (err) {
      return { ok: false, path: dirPath, error: err.message };
    }
  }

  async runCommand(command) {
    const { exec } = require("node:child_process");
    const rawCmd = String(command || "").trim();
    const sanitizedCmd = process.platform === "win32"
      ? sanitizeWindowsCommand(rawCmd)
      : rawCmd;

    return new Promise((resolve) => {
      exec(sanitizedCmd, {
        cwd: this.projectRoot,
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      }, (error, stdout, stderr) => {
        const outStr = (stdout || "").slice(-4000);
        const errStr = (stderr || "").slice(-2000);
        const combined = (outStr + (errStr ? "\n" + errStr : "")).trim();
        const errMsg = error ? (errStr || error.message || "Command failed") : "";
        resolve({
          ok: !error,
          stdout: outStr,
          stderr: errStr,
          output: combined || (error ? errMsg : "Comando ejecutado exitosamente"),
          error: errMsg,
          exitCode: error ? (error.code || 1) : 0,
          command: sanitizedCmd,
        });
      });
    });
  }

  async execute(name, args, helpers = {}) {
    try {
      switch (name) {
        case "read_file":
          return await this.readFile(args.path, args.startLine, args.endLine);

        case "write_file":
        case "write_to_file":
          return await this.writeFile(args.path, args.content);

        case "replace_in_file":
          return await this.replaceInFile(args.path, args.oldText || args.old_text, args.newText || args.new_text);

        case "list_files":
          return await this.listFiles(args.path || ".");

        case "run_command":
        case "execute_command":
          return await this.runCommand(args.command);

        case "create_pdf": {
          const { createPdf } = require("../document-writer");
          const fullPath = this.resolveFilePath(args.path);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          const res = await createPdf(args.content, fullPath, {
            title: args.title,
            author: args.author,
            align: args.align
          });
          return { ok: true, path: args.path, size: res.size, message: `PDF creado exitosamente en ${args.path}` };
        }

        case "create_word": {
          const { createWord } = require("../document-writer");
          const fullPath = this.resolveFilePath(args.path);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          const res = await createWord(args.content, fullPath, { title: args.title });
          return { ok: true, path: args.path, size: res.size, message: `Documento Word (.docx) creado exitosamente en ${args.path}` };
        }

        case "create_excel": {
          const { createExcel } = require("../document-writer");
          const fullPath = this.resolveFilePath(args.path);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          const res = await createExcel(args.data, fullPath, { sheetName: args.sheetName });
          return { ok: true, path: args.path, size: res.size, message: `Archivo Excel (.xlsx) creado exitosamente en ${args.path}` };
        }

        default:
          if (this.existingToolExecutor && typeof this.existingToolExecutor.execute === "function") {
            return await this.existingToolExecutor.execute(name, args, this.projectRoot, true, helpers);
          }
          throw new Error(`Herramienta '${name}' no reconocida en EditCoreAI`);
      }
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  getDefinitions() {
    return [
      {
        type: "function",
        function: {
          name: "read_file",
          description: "Lee el contenido de un archivo del proyecto.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo (relativa o absoluta)." },
              startLine: { type: "number", description: "Línea inicial (opcional)." },
              endLine: { type: "number", description: "Línea final (opcional)." }
            },
            required: ["path"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "write_file",
          description: "Crea o sobrescribe un archivo completo en el disco.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo." },
              content: { type: "string", description: "Contenido completo del archivo." }
            },
            required: ["path", "content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "replace_in_file",
          description: "Reemplaza quirúrgicamente un bloque de texto exacto dentro de un archivo existente.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo." },
              old_text: { type: "string", description: "Texto exacto existente que se va a reemplazar." },
              new_text: { type: "string", description: "Nuevo texto de reemplazo." }
            },
            required: ["path", "old_text", "new_text"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "run_command",
          description: "Ejecuta un comando en la terminal del proyecto (npm, git, npx, etc.).",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Comando a ejecutar en la terminal." }
            },
            required: ["command"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "list_files",
          description: "Lista archivos y carpetas del proyecto.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Directorio a listar (por defecto '.')." }
            }
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_pdf",
          description: "Crea un documento PDF profesional con texto estructurado, títulos y listas.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo PDF a generar (ej. 'docs/informe.pdf')." },
              content: { type: "string", description: "Contenido de texto o párrafos a incluir en el PDF." },
              title: { type: "string", description: "Título del documento (opcional)." }
            },
            required: ["path", "content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_word",
          description: "Crea un documento de Microsoft Word (.docx) con formato profesional.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo Word a generar (ej. 'docs/informe.docx')." },
              content: { type: "string", description: "Contenido del documento de texto." },
              title: { type: "string", description: "Título principal del documento (opcional)." }
            },
            required: ["path", "content"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "create_excel",
          description: "Crea una hoja de cálculo Excel (.xlsx) con datos tabulares.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Ruta del archivo Excel a generar (ej. 'datos/tabla.xlsx')." },
              data: {
                type: "array",
                description: "Array de filas o array de objetos para las columnas de la hoja.",
                items: { type: "object" }
              },
              sheetName: { type: "string", description: "Nombre de la hoja de cálculo (opcional)." }
            },
            required: ["path", "data"]
          }
        }
      }
    ];
  }
}

module.exports = {
  EditCoreClineTools,
  detectLineEnding,
  normalizeLineEndings,
  createLineDiff
};
