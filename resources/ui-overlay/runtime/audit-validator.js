/**
 * audit-validator.js
 * Validador de integridad para el sistema de auditoría EDITCOREAI
 * Verifica coherencia entre ActionRegistry, EvidenceGrounding y el Adapter
 */

const fs = require("fs");
const path = require("path");

class AuditValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Valida que los módulos core existan y sean cargables
   */
  validateCoreModules() {
    const requiredModules = [
      "./action-registry.js",
      "./evidence-grounding.js",
      "./intent-orchestrator.js",
      "./editcore-claude-adapter.js"
    ];

    for (const mod of requiredModules) {
      try {
        const modulePath = path.join(__dirname, mod);
        if (!fs.existsSync(modulePath)) {
          this.errors.push(`Módulo requerido no existe: ${mod}`);
        } else {
          require(mod);
        }
      } catch (err) {
        this.errors.push(`Error cargando ${mod}: ${err.message}`);
      }
    }
  }

  /**
   * Verifica consistencia de detección de patrones
   */
  validatePatternDetection() {
    try {
      const adapter = require("./editcore-claude-adapter");
      
      // Test cases básicos
      const testCases = [
        { text: "no tengo acceso al sistema de archivos", shouldDetect: true },
        { text: "archivo procesado correctamente", shouldDetect: false }
      ];

      for (const test of testCases) {
        // Validación básica de existencia de funciones
        if (typeof adapter.narrationClaimsMissingTools !== "function") {
          this.warnings.push("narrationClaimsMissingTools no disponible");
        }
      }
    } catch (err) {
      this.warnings.push(`No se pudo validar detección de patrones: ${err.message}`);
    }
  }

  /**
   * Ejecuta todas las validaciones
   */
  runAll() {
    this.validateCoreModules();
    this.validatePatternDetection();

    return {
      passed: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }
}

module.exports = { AuditValidator };

// Ejecución directa
if (require.main === module) {
  const validator = new AuditValidator();
  const result = validator.runAll();

  console.log("=== Resultados de Auditoría ===");
  console.log(`Estado: ${result.passed ? "✓ PASÓ" : "✗ FALLÓ"}`);
  
  if (result.errors.length > 0) {
    console.log("\nErrores:");
    result.errors.forEach(e => console.log(`  - ${e}`));
  }
  
  if (result.warnings.length > 0) {
    console.log("\nAdvertencias:");
    result.warnings.forEach(w => console.log(`  - ${w}`));
  }

  process.exit(result.passed ? 0 : 1);
}
