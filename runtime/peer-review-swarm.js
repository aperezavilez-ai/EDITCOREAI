/**
 * EditCoreAI - Peer Review Swarm (Cycle 29)
 * Automated secondary validation agent that audits Multi-File Composer
 * atomic patches before they are committed to disk.
 */

class PeerReviewSwarm {
  constructor() {
    this.customRules = new Map();
    this.initBuiltinRules();
  }

  initBuiltinRules() {
    // 1. Bracket & Syntax Balance Check
    this.registerReviewRule("bracket-balance", (filePath, originalCode, modifiedCode) => {
      const issues = [];
      const ext = (filePath.split(".").pop() || "").toLowerCase();
      if (["js", "ts", "jsx", "tsx", "json", "css", "html", "vue"].includes(ext)) {
        const countChars = (str, char) => (str.match(new RegExp("\\" + char, "g")) || []).length;
        const openBraces = countChars(modifiedCode, "{");
        const closeBraces = countChars(modifiedCode, "}");
        const openParens = countChars(modifiedCode, "(");
        const closeParens = countChars(modifiedCode, ")");
        const openBrackets = countChars(modifiedCode, "[");
        const closeBrackets = countChars(modifiedCode, "]");

        if (openBraces !== closeBraces && Math.abs(openBraces - closeBraces) > 1) {
          issues.push({
            rule: "bracket-balance",
            severity: "error",
            message: `Desbalance severo de llaves {} (${openBraces} abiertas vs ${closeBraces} cerradas)`,
          });
        }
        if (openParens !== closeParens && Math.abs(openParens - closeParens) > 1) {
          issues.push({
            rule: "bracket-balance",
            severity: "warning",
            message: `Desbalance de paréntesis () (${openParens} abiertas vs ${closeParens} cerradas)`,
          });
        }
        if (openBrackets !== closeBrackets && Math.abs(openBrackets - closeBrackets) > 1) {
          issues.push({
            rule: "bracket-balance",
            severity: "warning",
            message: `Desbalance de corchetes [] (${openBrackets} abiertas vs ${closeBrackets} cerradas)`,
          });
        }
      }
      return issues;
    });

    // 2. High-Risk / Destructive Pattern Check
    this.registerReviewRule("destructive-patterns", (filePath, originalCode, modifiedCode) => {
      const issues = [];
      const highRiskPatterns = [
        { pattern: /rm\s+-rf\s+[\/\\]/i, message: "Comando destructivo rm -rf en raíz detectado" },
        { pattern: /child_process.*exec\s*\(\s*["'`]rm\s+/i, message: "Llamada de shell destructiva detectada" },
        { pattern: /eval\s*\(\s*req(?:uest)?\./i, message: "Posible ejecución arbitraria de código con eval() no sanitizado" },
        { pattern: /process\.exit\s*\(\s*1\s*\)/i, severity: "info", message: "Terminación forzada de proceso (process.exit)" },
      ];

      for (const item of highRiskPatterns) {
        if (item.pattern.test(modifiedCode)) {
          issues.push({
            rule: "destructive-patterns",
            severity: item.severity || "error",
            message: item.message,
          });
        }
      }
      return issues;
    });

    // 3. Destructive Deletion Check (Truncation Protection)
    this.registerReviewRule("truncation-guard", (filePath, originalCode, modifiedCode) => {
      const issues = [];
      const origLen = String(originalCode || "").trim().length;
      const modLen = String(modifiedCode || "").trim().length;

      if (origLen > 500 && modLen < 50) {
        issues.push({
          rule: "truncation-guard",
          severity: "warning",
          message: `El parche reduce el archivo de ${origLen} caracteres a solo ${modLen} (posible borrado accidental)`,
        });
      }
      return issues;
    });

    // 4. JSON Syntax Check
    this.registerReviewRule("json-syntax", (filePath, originalCode, modifiedCode) => {
      const issues = [];
      const ext = (filePath.split(".").pop() || "").toLowerCase();
      if (ext === "json") {
        try {
          JSON.parse(modifiedCode);
        } catch (err) {
          issues.push({
            rule: "json-syntax",
            severity: "error",
            message: `JSON inválido generado: ${err.message}`,
          });
        }
      }
      return issues;
    });
  }

  registerReviewRule(ruleName, validatorFn) {
    if (!ruleName || typeof validatorFn !== "function") return;
    this.customRules.set(ruleName, validatorFn);
  }

  getBuiltinRules() {
    return Array.from(this.customRules.keys());
  }

  reviewFileChange(filePath, originalCode = "", modifiedCode = "", options = {}) {
    const issues = [];
    for (const [ruleName, validator] of this.customRules.entries()) {
      try {
        const ruleIssues = validator(filePath, originalCode, modifiedCode, options);
        if (Array.isArray(ruleIssues) && ruleIssues.length > 0) {
          issues.push(...ruleIssues);
        }
      } catch (err) {
        issues.push({
          rule: ruleName,
          severity: "warning",
          message: `Error ejecutando regla ${ruleName}: ${err.message}`,
        });
      }
    }

    const hasErrors = issues.some((i) => i.severity === "error");
    const warningsCount = issues.filter((i) => i.severity === "warning").length;
    const score = Math.max(0, 100 - (hasErrors ? 50 : 0) - warningsCount * 10);

    return {
      filePath,
      approved: !hasErrors && (options.strict ? warningsCount === 0 : true),
      score,
      issues,
      diffSummary: `+${(modifiedCode.match(/\n/g) || []).length} lines`,
    };
  }

  auditPatches(patches = [], options = {}) {
    if (!Array.isArray(patches) || patches.length === 0) {
      return {
        approved: true,
        score: 100,
        issues: [],
        summary: "No hay parches para auditar",
        fileReports: [],
      };
    }

    const fileReports = [];
    let totalScore = 0;
    const allIssues = [];

    for (const patch of patches) {
      const filePath = patch.filePath || patch.path || "unknown";
      const originalCode = patch.originalCode || patch.original || "";
      const modifiedCode = patch.modifiedCode || patch.content || patch.code || "";

      const report = this.reviewFileChange(filePath, originalCode, modifiedCode, options);
      fileReports.push(report);
      totalScore += report.score;
      allIssues.push(...report.issues.map((i) => ({ ...i, file: filePath })));
    }

    const avgScore = Math.round(totalScore / patches.length);
    const hasCriticalErrors = allIssues.some((i) => i.severity === "error");
    const approved = !hasCriticalErrors && avgScore >= (options.minScore || 60);

    return {
      approved,
      score: avgScore,
      totalFiles: patches.length,
      issues: allIssues,
      summary: approved
        ? `Auditoría completada exitosamente (${avgScore}/100) en ${patches.length} archivos.`
        : `Revisión detectó ${allIssues.length} problemas en los parches propuestos.`,
      fileReports,
    };
  }
}

const peerReviewSwarm = new PeerReviewSwarm();

module.exports = {
  PeerReviewSwarm,
  peerReviewSwarm,
};
