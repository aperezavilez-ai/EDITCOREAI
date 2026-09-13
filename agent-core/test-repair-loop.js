"use strict";

const { execSync } = require("node:child_process");

class TestRepairLoop {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  /**
   * Ejecuta la suite de pruebas del proyecto y detecta fallos
   */
  runVerification(testCommand = "npm test") {
    try {
      const output = execSync(testCommand, {
        cwd: this.projectRoot,
        encoding: "utf8",
        timeout: 60000
      });
      return {
        success: true,
        output,
        message: "Verificación superada con éxito."
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        stdout: err.stdout || "",
        stderr: err.stderr || "",
        message: "La verificación falló. Se requiere ciclo de auto-corrección."
      };
    }
  }

  /**
   * Diagnostica el error y genera el contexto de reparación para el OODA
   */
  buildRepairContext(verificationResult) {
    if (verificationResult.success) return null;
    
    return {
      errorSummary: verificationResult.stderr.slice(-1000) || verificationResult.error,
      action: "Analiza el stack trace anterior, localiza el archivo defectuoso mediante el índice semántico y aplica un parche correctivo con el PatchEngine."
    };
  }
}

module.exports = TestRepairLoop;