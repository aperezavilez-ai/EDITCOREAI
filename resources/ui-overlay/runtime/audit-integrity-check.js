/**
 * audit-integrity-check.js
 * Verificador de integridad para el sistema de auditoría de EDITCOREAI
 * Creado desde análisis forense de componentes runtime
 */

const fs = require('fs');
const path = require('path');

class AuditIntegrityCheck {
  constructor() {
    this.componentsToCheck = [
      'editcore-claude-adapter.js',
      'intent-orchestrator.js',
      'evidence-grounding.js',
      'action-registry.js'
    ];
    this.runtimePath = __dirname;
  }

  /**
   * Verifica que todos los componentes críticos existan
   */
  checkComponentsExist() {
    const results = [];
    for (const component of this.componentsToCheck) {
      const fullPath = path.join(this.runtimePath, component);
      const exists = fs.existsSync(fullPath);
      results.push({
        component,
        exists,
        path: fullPath
      });
    }
    return results;
  }

  /**
   * Verifica funciones críticas en editcore-claude-adapter
   */
  checkAdapterFunctions() {
    const adapterPath = path.join(this.runtimePath, 'editcore-claude-adapter.js');
    if (!fs.existsSync(adapterPath)) {
      return { error: 'Adapter not found' };
    }

    const content = fs.readFileSync(adapterPath, 'utf8');
    const requiredFunctions = [
      'narrationClaimsMissingTools',
      'narrationAsksUserForRoadmap',
      'narrationFingerprint',
      'reportBlocksRepetition'
    ];

    const found = {};
    for (const fn of requiredFunctions) {
      found[fn] = content.includes(`function ${fn}(`);
    }
    return found;
  }

  /**
   * Ejecuta todas las verificaciones
   */
  runFullCheck() {
    return {
      timestamp: new Date().toISOString(),
      componentsExist: this.checkComponentsExist(),
      adapterFunctions: this.checkAdapterFunctions()
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AuditIntegrityCheck };
}

// Ejecución directa
if (require.main === module) {
  const checker = new AuditIntegrityCheck();
  const results = checker.runFullCheck();
  console.log(JSON.stringify(results, null, 2));
}
