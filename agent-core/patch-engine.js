"use strict";

const fs = require("node:fs");
const path = require("node:path");

class PatchEngine {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  /**
   * Simula el parche quirúrgico (Dry Run) y retorna el diff exacto
   */
  previewPatch(filePath, targetSnippet, replacementSnippet) {
    const absolutePath = path.resolve(this.projectRoot, filePath);
    if (!fs.existsSync(absolutePath)) {
      return { success: false, error: `El archivo ${filePath} no existe.` };
    }

    const originalContent = fs.readFileSync(absolutePath, "utf8");
    if (!originalContent.includes(targetSnippet)) {
      return { 
        success: false, 
        error: "El fragmento objetivo (targetSnippet) no se encontró exactamente en el archivo. Riesgo de ruptura." 
      };
    }

    const updatedContent = originalContent.replace(targetSnippet, replacementSnippet);
    return {
      success: true,
      filePath,
      original: targetSnippet,
      proposed: replacementSnippet,
      previewContent: updatedContent
    };
  }

  /**
   * Aplica el parche de manera definitiva tras tu aprobación
   */
  applyPatch(filePath, targetSnippet, replacementSnippet) {
    const analysis = this.previewPatch(filePath, targetSnippet, replacementSnippet);
    if (!analysis.success) {
      return analysis;
    }

    const absolutePath = path.resolve(this.projectRoot, filePath);
    fs.writeFileSync(absolutePath, analysis.previewContent, "utf8");

    return {
      success: true,
      message: `Parche quirúrgico aplicado exitosamente en ${filePath}`
    };
  }
}

module.exports = PatchEngine;