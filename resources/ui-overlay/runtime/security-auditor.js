"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Security Auditor & Predictive Refactorer (Ciclo 28)
 * Realiza análisis estático de vulnerabilidades, fuga de credenciales,
 * inyecciones y refactorización predictiva con generación de parches seguros.
 */
class SecurityAuditor {
  constructor(options = {}) {
    this.options = options;
    this.rules = [
      {
        id: "SEC001_HARDCODED_SECRET",
        name: "Hardcoded API Key or Secret",
        severity: "CRITICAL",
        regex: /(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|token|bearer|password|passwd|pwd)\s*[:=]\s*["']([A-Za-z0-9_\-\.]{16,})["']/i,
        category: "Secrets",
        recommendation: "Mueve el secreto a variables de entorno (.env) y utiliza process.env.",
      },
      {
        id: "SEC002_UNSAFE_EVAL",
        name: "Unsafe Dynamic Code Execution (eval)",
        severity: "HIGH",
        regex: /\b(?:eval|Function)\s*\([^)]+\)/g,
        category: "Code Injection",
        recommendation: "Evita el uso de eval() o new Function(). Utiliza parseo seguro JSON o mapeos de funciones.",
      },
      {
        id: "SEC003_COMMAND_INJECTION",
        name: "Potential Command Injection in child_process",
        severity: "HIGH",
        regex: /\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/g,
        category: "Command Injection",
        recommendation: "Usa execFile o spawn con argumentos parametrizados en lugar de interpolar cadenas en exec/execSync.",
      },
      {
        id: "SEC004_PATH_TRAVERSAL",
        name: "Unsanitized Path Traversal Risk",
        severity: "MEDIUM",
        regex: /\bpath\.(?:join|resolve)\s*\([^)]*(?:req\.|params\.|query\.|input\.)/g,
        category: "Path Traversal",
        recommendation: "Valida y sanitiza las rutas relativas usando path.normalize y verificando que permanezcan dentro del directorio raíz.",
      },
      {
        id: "SEC005_SQL_INJECTION",
        name: "Raw SQL String Concatenation",
        severity: "HIGH",
        regex: /\b(?:query|execute)\s*\(\s*`\s*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*\$\{/i,
        category: "SQL Injection",
        recommendation: "Utiliza consultas preparadas con marcadores de posición ($1, ?) en lugar de interpolación de variables.",
      },
      {
        id: "SEC006_INSECURE_RANDOM",
        name: "Cryptographically Insecure Random Generator",
        severity: "LOW",
        regex: /\bMath\.random\s*\(\s*\)/g,
        category: "Cryptography",
        recommendation: "Para tokens o identificadores seguros, utiliza crypto.randomUUID() o crypto.randomBytes().",
      },
    ];

    this.refactorRules = [
      {
        id: "REF001_VAR_DECLARATION",
        name: "Legacy 'var' declaration",
        severity: "SUGGESTION",
        regex: /\bvar\s+([a-zA-Z_$][0-9a-zA-Z_$]*)\s*=/g,
        fix: (content) => content.replace(/\bvar\s+/g, "const "),
        description: "Reemplaza declaraciones 'var' obsoletas por 'const' o 'let' con ámbito de bloque.",
      },
      {
        id: "REF002_CONSOLE_LEAK",
        name: "Console logging in production",
        severity: "SUGGESTION",
        regex: /\bconsole\.(?:log|debug|info)\s*\([^)]*\);?/g,
        fix: (content) => content.replace(/\s*console\.(?:log|debug|info)\s*\([^)]*\);?/g, ""),
        description: "Elimina console.log innecesarios para depuración en código de producción.",
      },
      {
        id: "REF003_ASYNC_NO_AWAIT",
        name: "Redundant async without await",
        severity: "SUGGESTION",
        check: (content) => /async\s+function[^{]*\{[^}]*\}/.test(content) && !/\bawait\b/.test(content),
        description: "La función declarada como async no utiliza await dentro de su cuerpo.",
      }
    ];
  }

  /**
   * Analiza el contenido de un archivo en busca de vulnerabilidades y sugerencias.
   */
  scanContent(content = "", filePath = "unknown.js") {
    const issues = [];
    const lines = content.split(/\r?\n/);

    // 1. Escaneo de vulnerabilidades de seguridad
    for (const rule of this.rules) {
      lines.forEach((lineText, lineIdx) => {
        if (rule.regex.test(lineText)) {
          issues.push({
            id: rule.id,
            name: rule.name,
            severity: rule.severity,
            category: rule.category,
            file: filePath,
            line: lineIdx + 1,
            codeSnippet: lineText.trim(),
            recommendation: rule.recommendation,
          });
        }
      });
    }

    // 2. Escaneo de refactorizaciones predictivas
    const refactorSuggestions = [];
    for (const rRule of this.refactorRules) {
      if (rRule.regex) {
        lines.forEach((lineText, lineIdx) => {
          if (rRule.regex.test(lineText)) {
            refactorSuggestions.push({
              id: rRule.id,
              name: rRule.name,
              file: filePath,
              line: lineIdx + 1,
              description: rRule.description,
              canAutoFix: typeof rRule.fix === "function",
            });
          }
        });
      }
    }

    const score = this._calculateSecurityScore(issues);

    return {
      file: filePath,
      totalIssues: issues.length,
      issues,
      refactorSuggestions,
      score,
      grade: this._scoreToGrade(score),
    };
  }

  /**
   * Escanea un archivo en el disco.
   */
  scanFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return { error: `File not found: ${filePath}`, issues: [] };
    }
    const content = fs.readFileSync(filePath, "utf8");
    return this.scanContent(content, filePath);
  }

  /**
   * Escanea recursivamente un directorio / workspace.
   */
  scanWorkspace(workspaceRoot, options = {}) {
    const root = path.resolve(workspaceRoot);
    const maxFiles = options.maxFiles || 250;
    const extensions = options.extensions || [".js", ".ts", ".jsx", ".tsx", ".json", ".html", ".vue", ".php", ".py"];
    const excludeDirs = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".nuxt"]);

    const allFiles = [];
    const walk = (dir) => {
      if (allFiles.length >= maxFiles) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!excludeDirs.has(entry.name)) {
            walk(path.join(dir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            allFiles.push(path.join(dir, entry.name));
            if (allFiles.length >= maxFiles) break;
          }
        }
      }
    };

    walk(root);

    const fileReports = [];
    let allIssues = [];
    let allRefactors = [];

    for (const f of allFiles) {
      try {
        const report = this.scanFile(f);
        if (report.issues && report.issues.length > 0) {
          allIssues.push(...report.issues);
        }
        if (report.refactorSuggestions && report.refactorSuggestions.length > 0) {
          allRefactors.push(...report.refactorSuggestions);
        }
        fileReports.push({
          file: path.relative(root, f),
          issuesCount: (report.issues || []).length,
          score: report.score,
          grade: report.grade,
        });
      } catch (err) {
        // Skip unreadable files
      }
    }

    const overallScore = this._calculateSecurityScore(allIssues);

    return {
      workspace: root,
      scannedFilesCount: allFiles.length,
      totalIssues: allIssues.length,
      totalRefactorSuggestions: allRefactors.length,
      issues: allIssues,
      refactorSuggestions: allRefactors,
      score: overallScore,
      grade: this._scoreToGrade(overallScore),
      fileReports: fileReports.filter(r => r.issuesCount > 0),
    };
  }

  /**
   * Genera un plan de refactorización automática para un archivo.
   */
  predictRefactor(filePath) {
    if (!fs.existsSync(filePath)) {
      return { error: `File not found: ${filePath}` };
    }
    const originalContent = fs.readFileSync(filePath, "utf8");
    let refactoredContent = originalContent;

    const appliedFixes = [];
    for (const rRule of this.refactorRules) {
      if (typeof rRule.fix === "function") {
        const before = refactoredContent;
        refactoredContent = rRule.fix(refactoredContent);
        if (before !== refactoredContent) {
          appliedFixes.push({
            id: rRule.id,
            name: rRule.name,
          });
        }
      }
    }

    const hasChanges = originalContent !== refactoredContent;

    return {
      filePath,
      hasChanges,
      appliedFixes,
      originalContent,
      refactoredContent: hasChanges ? refactoredContent : null,
    };
  }

  /**
   * Aplica directamente la refactorización a un archivo.
   */
  applyRefactor(filePath) {
    const plan = this.predictRefactor(filePath);
    if (!plan.hasChanges) {
      return { ok: true, changed: false, message: "No refactoring needed" };
    }
    fs.writeFileSync(filePath, plan.refactoredContent, "utf8");
    return {
      ok: true,
      changed: true,
      appliedFixes: plan.appliedFixes,
      filePath,
    };
  }

  _calculateSecurityScore(issues = []) {
    let penalty = 0;
    for (const iss of issues) {
      if (iss.severity === "CRITICAL") penalty += 25;
      else if (iss.severity === "HIGH") penalty += 15;
      else if (iss.severity === "MEDIUM") penalty += 8;
      else penalty += 3;
    }
    return Math.max(0, Math.min(100, 100 - penalty));
  }

  _scoreToGrade(score) {
    if (score >= 95) return "A+";
    if (score >= 85) return "A";
    if (score >= 70) return "B";
    if (score >= 50) return "C";
    return "F";
  }
}

const securityAuditorInstance = new SecurityAuditor();

module.exports = {
  SecurityAuditor,
  securityAuditor: securityAuditorInstance,
};
