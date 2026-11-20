"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { validateSyntax } = require("./syntax-validator");

/**
 * EditCoreAI - Background Test Guardian & Auto-Fixer
 * Autonomous background tester that validates syntax and executes targeted unit tests
 * when code is modified, providing instant root-cause diagnostics and 1-click auto-fix plans.
 */

class TestGuardian {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
    this.timeoutMs = options.timeoutMs || 15000;
  }

  setProjectRoot(root) {
    if (root) this.projectRoot = path.resolve(root);
  }

  /**
   * Encuentra los archivos de prueba relacionados con los archivos modificados.
   */
  findRelevantTests(changedFiles = []) {
    const list = Array.isArray(changedFiles) ? changedFiles : [changedFiles];
    const relevant = new Set();
    const projectRoot = this.projectRoot;

    for (const file of list) {
      if (!file) continue;
      const clean = String(file).replace(/\\/g, "/").replace(/^\/+/, "");
      
      // Si el archivo modificado ya es un test, él mismo es el target
      if (/\.(?:test|spec)\.[a-z0-9]+$/i.test(clean)) {
        relevant.add(clean);
        continue;
      }

      const basename = path.basename(clean, path.extname(clean));
      const candidates = [
        `test/${basename}.test.js`,
        `test/${basename}.test.ts`,
        `test/${basename}.spec.js`,
        `test/${basename}.spec.ts`,
        `tests/${basename}.test.js`,
        `tests/${basename}.spec.js`,
        `__tests__/${basename}.test.js`,
        `__tests__/${basename}.test.ts`,
        `${path.dirname(clean)}/${basename}.test.js`,
        `${path.dirname(clean)}/${basename}.test.ts`,
        `${path.dirname(clean)}/${basename}.spec.js`,
        `${path.dirname(clean)}/${basename}.spec.ts`,
      ];

      for (const cand of candidates) {
        const fullCand = path.join(projectRoot, cand);
        if (fs.existsSync(fullCand) && fs.statSync(fullCand).isFile()) {
          relevant.add(cand.replace(/\\/g, "/"));
        }
      }
    }

    // Si no encontró específicos y hay carpeta test/, incluir los primeros 3 tests
    if (relevant.size === 0) {
      const testDir = path.join(projectRoot, "test");
      if (fs.existsSync(testDir) && fs.statSync(testDir).isDirectory()) {
        try {
          const files = fs.readdirSync(testDir)
            .filter((f) => /\.(?:test|spec)\.[a-z0-9]+$/i.test(f))
            .slice(0, 3)
            .map((f) => `test/${f}`);
          for (const f of files) relevant.add(f);
        } catch { /* ignore */ }
      }
    }

    return Array.from(relevant);
  }

  /**
   * Valida sintaxis estática de un archivo en memoria o disco.
   */
  diagnoseFile(filePath, content = null) {
    const rel = String(filePath || "").replace(/\\/g, "/");
    let text = content;
    if (text == null) {
      const full = path.isAbsolute(rel) ? rel : path.join(this.projectRoot, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        try {
          text = fs.readFileSync(full, "utf8");
        } catch (err) {
          return { ok: false, valid: false, message: `No se pudo leer ${rel}: ${err.message}` };
        }
      } else {
        return { ok: true, valid: true };
      }
    }

    try {
      const res = validateSyntax(rel, text);
      return {
        ok: res.valid !== false && res.ok !== false,
        valid: res.valid !== false && res.ok !== false,
        file: rel,
        line: res.line || 1,
        message: res.message || "",
        hint: res.hint || "",
        type: res.type || "SyntaxCheck",
      };
    } catch (err) {
      return { ok: false, valid: false, file: rel, message: err?.message || String(err) };
    }
  }

  /**
   * Ejecuta pruebas focalizadas en un subproceso con timeout.
   */
  async runTargetedTests(targetTestFiles = []) {
    const files = (Array.isArray(targetTestFiles) ? targetTestFiles : [targetTestFiles])
      .map((f) => String(f || "").trim())
      .filter(Boolean);

    if (!files.length) {
      return { ok: true, skipped: true, note: "No se encontraron archivos de prueba aplicables." };
    }

    return new Promise((resolve) => {
      const args = ["--test", ...files];
      const cleanEnv = { ...process.env, NODE_ENV: "test" };
      for (const k of Object.keys(cleanEnv)) {
        if (k.startsWith("NODE_TEST_")) {
          delete cleanEnv[k];
        }
      }

      const child = spawn(process.execPath, args, {
        cwd: this.projectRoot,
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
      }, this.timeoutMs);

      child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

      child.on("close", (code) => {
        clearTimeout(timer);
        const combined = `${stdout}\n${stderr}`;
        const hasFailures = code !== 0 || /✖|failing tests:|AssertionError/i.test(combined);

        const failureDetails = [];
        const lines = combined.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (/✖\s+(.+)/.test(l) || /AssertionError/.test(l)) {
            const contextLines = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 8)).join("\n");
            failureDetails.push(contextLines);
            i += 4;
          }
        }

        resolve({
          ok: !hasFailures && !killed,
          exitCode: code,
          timedOut: killed,
          files,
          stdout: stdout.slice(-2000),
          stderr: stderr.slice(-1000),
          failureDetails: failureDetails.slice(0, 5),
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error: err.message,
          files,
        });
      });
    });
  }

  /**
   * Inspección general de salud tras mutaciones: verifica sintaxis y ejecuta tests.
   */
  async inspectHealth(changedFiles = []) {
    const files = Array.isArray(changedFiles) ? changedFiles : [changedFiles];
    const syntaxErrors = [];

    // 1. Verificar sintaxis estática de cada archivo modificado
    for (const f of files) {
      const res = this.diagnoseFile(f);
      if (!res.ok) {
        syntaxErrors.push(res);
      }
    }

    // 2. Si hay errores de sintaxis, no tiene sentido correr los tests: retornar inmediato
    if (syntaxErrors.length > 0) {
      return {
        ok: false,
        hasFailures: true,
        type: "syntax",
        syntaxErrors,
        testFailures: [],
        suggestedAction: "auto-fix",
      };
    }

    // 3. Buscar y ejecutar tests relacionados
    const relevantTests = this.findRelevantTests(files);
    if (!relevantTests.length) {
      return {
        ok: true,
        hasFailures: false,
        syntaxErrors: [],
        testFailures: [],
        note: "Sintaxis válida; sin tests específicos vinculados.",
      };
    }

    const testRun = await this.runTargetedTests(relevantTests);
    if (!testRun.ok) {
      return {
        ok: false,
        hasFailures: true,
        type: "test",
        syntaxErrors: [],
        testFailures: testRun.failureDetails.length ? testRun.failureDetails : [testRun.stderr || testRun.stdout],
        filesTested: relevantTests,
        suggestedAction: "auto-fix",
      };
    }

    return {
      ok: true,
      hasFailures: false,
      syntaxErrors: [],
      testFailures: [],
      filesTested: relevantTests,
      suggestedAction: "ok",
    };
  }

  /**
   * Genera el prompt estructurado para la auto-reparación asistida por IA.
   */
  generateAutoFixPrompt(healthReport) {
    if (!healthReport || healthReport.ok) return null;

    const parts = [
      "## Diagnóstico del Background Test Guardian (Auto-Fixer)",
      "Se detectaron fallos inmediatos tras las modificaciones recientes:",
    ];

    if (healthReport.syntaxErrors?.length > 0) {
      parts.push("\n### Errores de Sintaxis Detectados:");
      for (const err of healthReport.syntaxErrors) {
        parts.push(`- **${err.file}:${err.line}**: ${err.message}`);
        if (err.hint) parts.push(`  *Pista:* ${err.hint}`);
      }
    }

    if (healthReport.testFailures?.length > 0) {
      parts.push("\n### Pruebas Unitarias Rotas:");
      for (const fail of healthReport.testFailures) {
        parts.push("```\n" + fail.trim() + "\n```");
      }
    }

    parts.push("\n### Instrucción de Reparación:");
    parts.push("Analiza el fallo exacto arriba, determina la causa raíz y aplica la corrección mínima y precisa con `replace_in_file`.");

    return parts.join("\n");
  }
}

const testGuardian = new TestGuardian();

module.exports = {
  TestGuardian,
  testGuardian,
};
