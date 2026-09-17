"use strict";

const path = require("path");
const fs = require("fs");

/**
 * Patrones de error comunes en Node.js, Vite, TypeScript, Python, etc.
 */
const ERROR_PATTERNS = [
  {
    type: "MISSING_MODULE",
    regex: /(?:Cannot find module ['"]([^'"]+)['"]|Error: Cannot find package ['"]([^'"]+)['"]|Module not found: Can't resolve ['"]([^'"]+)['"]|ModuleNotFoundError: No module named ['"]([^'"]+)['"])/i,
    extract: (match) => ({
      moduleName: match[1] || match[2] || match[3] || match[4],
      action: "npm_install",
    }),
  },
  {
    type: "SYNTAX_OR_TYPE_ERROR",
    regex: /(?:([a-zA-Z0-9_.\-\\/]+(?:\.ts|\.tsx|\.js|\.jsx|\.py|\.vue|\.svelte)):(\d+):(\d+)(?::\s*error TS(\d+))?)/i,
    extract: (match) => ({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      code: match[4] || null,
      action: "edit_file",
    }),
  },
  {
    type: "TEST_FAILURE",
    regex: /(?:FAIL|✕|✖)\s+([a-zA-Z0-9_.\-\\/]+\.(?:test|spec)\.[a-z]+)/i,
    extract: (match) => ({
      testFile: match[1],
      action: "fix_test_or_code",
    }),
  },
  {
    type: "PORT_IN_USE",
    regex: /(?:EADDRINUSE.*:(\d+)|Port (\d+) is already in use)/i,
    extract: (match) => ({
      port: match[1] || match[2],
      action: "kill_port_process",
    }),
  },
];

class AutoHealingInterceptor {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.history = [];
    this.maxHistory = 50;
  }

  /**
   * Analiza un bloque de salida de terminal (stdout/stderr)
   * @param {string} output
   * @param {object} [context]
   * @returns {object|null}
   */
  analyzeOutput(output = "", context = {}) {
    if (!output || typeof output !== "string") return null;

    const findings = [];
    const lines = output.split(/\r?\n/);

    for (const patternDef of ERROR_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(patternDef.regex);
        if (match) {
          const details = patternDef.extract(match);
          findings.push({
            type: patternDef.type,
            lineContent: line.trim(),
            lineIndex: i,
            ...details,
          });
        }
      }
    }

    if (findings.length === 0) return null;

    const topFinding = findings[0];
    const proposal = this.generateHealingProposal(topFinding, context);

    const record = {
      timestamp: Date.now(),
      finding: topFinding,
      allFindings: findings,
      proposal,
      context,
    };

    this.history.push(record);
    if (this.history.length > this.maxHistory) this.history.shift();

    return record;
  }

  generateHealingProposal(finding, context = {}) {
    switch (finding.type) {
      case "MISSING_MODULE": {
        const mod = finding.moduleName;
        const isDev = /(?:types|eslint|vite|webpack|tailwind|postcss|jest|vitest|ts-node)/i.test(mod);
        const command = isDev ? `npm install -D ${mod}` : `npm install ${mod}`;
        return {
          title: `Instalar dependencia faltante: ${mod}`,
          description: `Se detectó que el módulo "${mod}" no está instalado en el proyecto.`,
          autoExecutable: true,
          suggestedCommand: command,
          fixType: "install_dependency",
        };
      }
      case "SYNTAX_OR_TYPE_ERROR": {
        return {
          title: `Corregir error de código en ${finding.file}:${finding.line}`,
          description: `Error detectado en ${finding.file} línea ${finding.line}.`,
          autoExecutable: false,
          file: finding.file,
          line: finding.line,
          promptSuggestion: `Corrige el error de sintaxis/tipo en el archivo ${finding.file} en la línea ${finding.line}: "${finding.lineContent}"`,
          fixType: "patch_code",
        };
      }
      case "TEST_FAILURE": {
        return {
          title: `Reparar prueba fallida: ${finding.testFile}`,
          description: `La suite de pruebas ${finding.testFile} no pasó la verificación.`,
          autoExecutable: false,
          testFile: finding.testFile,
          promptSuggestion: `Analiza y repara la falla en la prueba ${finding.testFile}. Ajusta el código de producción sin debilitar los asserts.`,
          fixType: "test_repair",
        };
      }
      case "PORT_IN_USE": {
        return {
          title: `Liberar puerto en uso: ${finding.port}`,
          description: `El puerto ${finding.port} está ocupado por otro proceso.`,
          autoExecutable: true,
          suggestedCommand: process.platform === "win32"
            ? `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${finding.port}).OwningProcess -Force`
            : `npx kill-port ${finding.port}`,
          fixType: "kill_port",
        };
      }
      default:
        return {
          title: "Diagnóstico de error detectado",
          description: finding.lineContent || "Error no tipificado en la consola",
          autoExecutable: false,
          fixType: "general_fix",
        };
    }
  }

  getHistory() {
    return this.history;
  }

  clearHistory() {
    this.history = [];
  }
}

module.exports = {
  AutoHealingInterceptor,
  ERROR_PATTERNS,
};
