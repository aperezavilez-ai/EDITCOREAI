"use strict";

const vm = require("vm");
const path = require("path");

/**
 * Validador de sintaxis rápido para el ciclo de auto-verificación (Self-Healing)
 * inspirado en DeepSeek Harness.
 */
function validateSyntax(filePath, content) {
  if (!content || typeof content !== "string") {
    return { ok: true, valid: true };
  }
  const ext = path.extname(filePath || "").toLowerCase();

  // 1. JavaScript / CJS / MJS
  if (ext === ".js" || ext === ".cjs" || ext === ".mjs") {
    try {
      new vm.Script(content, {
        filename: path.basename(filePath),
        displayErrors: false,
      });
      return { ok: true, valid: true };
    } catch (err) {
      const lineMatch = err.stack?.match(/:(\d+)(?::(\d+))?/);
      const line = lineMatch ? Number(lineMatch[1]) : (err.lineNumber || 1);
      return {
        ok: false,
        valid: false,
        type: "JavaScript SyntaxError",
        line,
        message: err.message,
        hint: `Error de sintaxis en línea ${line}: ${err.message}. Usa replace_in_file para corregir el error antes de finalizar.`,
      };
    }
  }

  // 2. JSON
  if (ext === ".json") {
    try {
      JSON.parse(content);
      return { ok: true, valid: true };
    } catch (err) {
      return {
        ok: false,
        valid: false,
        type: "JSON ParseError",
        message: err.message,
        hint: `JSON inválido: ${err.message}. Corrige la coma faltante o comillas.`,
      };
    }
  }

  // 3. Verificación básica de balance de llaves/corchetes en TS / JSX
  if (ext === ".ts" || ext === ".tsx" || ext === ".jsx") {
    let openBraces = 0;
    let openParens = 0;
    let inString = false;
    let stringChar = "";
    let inBlockComment = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const next = content[i + 1];

      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (!inString && char === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (!inString && char === "/" && next === "/") {
        const eol = content.indexOf("\n", i);
        i = eol === -1 ? content.length : eol;
        continue;
      }
      if (!inString && (char === '"' || char === "'" || char === "`")) {
        inString = true;
        stringChar = char;
        continue;
      }
      if (inString && char === stringChar && content[i - 1] !== "\\") {
        inString = false;
        continue;
      }
      if (!inString) {
        if (char === "{") openBraces++;
        else if (char === "}") openBraces--;
        else if (char === "(") openParens++;
        else if (char === ")") openParens--;
      }
    }

    if (openBraces !== 0 || openParens !== 0) {
      return {
        ok: false,
        valid: false,
        type: "Unbalanced Block / Parens",
        message: `Desbalance de delimitadores: ${openBraces !== 0 ? `llaves { (${openBraces})` : ""} ${openParens !== 0 ? `paréntesis ( (${openParens})` : ""}`,
        hint: "Verifica que todas las funciones, bloques y paréntesis estén correctamente cerrados.",
      };
    }
  }

  return { ok: true, valid: true };
}

/**
 * Compactador de salida de comandos estilo DeepSeek Harness
 * Preserva encabezados, líneas de error/stacktraces y pie de salida, colapsando ruido intermedio.
 */
function compactCommandOutput(output, maxChars = 3500) {
  const text = String(output || "");
  if (text.length <= maxChars) return text;

  const lines = text.split(/\r?\n/);
  if (lines.length <= 30) {
    return text.slice(0, maxChars) + "\n…[salida recortada]";
  }

  const headLines = lines.slice(0, 8);
  const tailLines = lines.slice(-12);
  const middleLines = lines.slice(8, -12);

  const errorLines = middleLines.filter((l) =>
    /error|fail|exception|fatal|warn|traceback|syntaxerror|typeerror|enoent|econnrefused/i.test(l)
  ).slice(0, 15);

  const collapsedCount = middleLines.length - errorLines.length;
  const blocks = [
    headLines.join("\n"),
    `\n[Harness: ${collapsedCount} líneas intermedias colapsadas; preservando ${errorLines.length} líneas de diagnóstico]`,
  ];
  if (errorLines.length > 0) {
    blocks.push(errorLines.join("\n"));
  }
  blocks.push(tailLines.join("\n"));

  let result = blocks.join("\n");
  if (result.length > maxChars) {
    // Si aún excede, conservar solo diagnóstico y cola
    result = [...errorLines, ...tailLines].join("\n").slice(0, maxChars) + "\n…[compactado por harness]";
  }
  return result;
}

module.exports = {
  validateSyntax,
  compactCommandOutput,
};
