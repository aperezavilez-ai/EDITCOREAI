/**
 * runtime/inline-edit-provider.js
 * EditCoreAI - Proveedor de Edición en Línea (Inline Edit & Diff Engine) (Ciclo 33)
 */

class InlineEditProvider {
  constructor(options = {}) {
    this.options = options;
    this.activeRequests = new Map();
  }

  /**
   * Crea una solicitud de edición en línea
   */
  createInlineEditRequest({ filePath = "", selection = null, originalText = "", prompt = "" } = {}) {
    const requestId = `inline_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const request = {
      requestId,
      filePath,
      selection,
      originalText: originalText || "",
      prompt: prompt || "",
      status: "pending",
      createdAt: new Date().toISOString(),
      diff: null,
      modifiedText: null,
    };

    this.activeRequests.set(requestId, request);
    return request;
  }

  /**
   * Calcula la diferencia línea por línea entre el texto original y el propuesto
   */
  computeInlineDiff(originalText = "", modifiedText = "") {
    const origLines = (originalText || "").split(/\r?\n/);
    const modLines = (modifiedText || "").split(/\r?\n/);

    const diffLines = [];
    const maxLen = Math.max(origLines.length, modLines.length);

    let origIdx = 0;
    let modIdx = 0;

    let addedCount = 0;
    let removedCount = 0;
    let unchangedCount = 0;

    while (origIdx < origLines.length || modIdx < modLines.length) {
      const origLine = origIdx < origLines.length ? origLines[origIdx] : null;
      const modLine = modIdx < modLines.length ? modLines[modIdx] : null;

      if (origLine === modLine) {
        diffLines.push({
          type: "same",
          lineOriginal: origIdx + 1,
          lineModified: modIdx + 1,
          text: origLine,
        });
        origIdx++;
        modIdx++;
        unchangedCount++;
      } else if (origLine !== null && modLine !== null) {
        // Línea modificada o reemplazada
        diffLines.push({
          type: "del",
          lineOriginal: origIdx + 1,
          text: origLine,
        });
        diffLines.push({
          type: "add",
          lineModified: modIdx + 1,
          text: modLine,
        });
        origIdx++;
        modIdx++;
        removedCount++;
        addedCount++;
      } else if (origLine !== null) {
        // Línea eliminada
        diffLines.push({
          type: "del",
          lineOriginal: origIdx + 1,
          text: origLine,
        });
        origIdx++;
        removedCount++;
      } else if (modLine !== null) {
        // Línea agregada
        diffLines.push({
          type: "add",
          lineModified: modIdx + 1,
          text: modLine,
        });
        modIdx++;
        addedCount++;
      }
    }

    return {
      hasChanges: addedCount > 0 || removedCount > 0,
      addedCount,
      removedCount,
      unchangedCount,
      lines: diffLines,
    };
  }

  /**
   * Aplica el parche aceptado devolviendo el texto final consolidado
   */
  applyPatch(originalText = "", diffOrModified = "") {
    if (typeof diffOrModified === "string") {
      return diffOrModified;
    }

    if (diffOrModified && Array.isArray(diffOrModified.lines)) {
      const resultLines = diffOrModified.lines
        .filter((l) => l.type === "same" || l.type === "add")
        .map((l) => l.text);
      return resultLines.join("\n");
    }

    return originalText;
  }

  /**
   * Construye el contenido del archivo completo reemplazando el rango de selección con la propuesta
   */
  buildModifiedFull(original = "", selection = {}, proposal = "") {
    const lines = String(original || "").split("\n");
    const startLine = Number(selection?.startLine || 1);
    const endLine = Number(selection?.endLine || startLine);
    const proposalLines = String(proposal || "").split("\n");

    if (!selection?.selectedText && !String(proposal || "").trim()) {
      return original;
    }
    if (!selection?.selectedText) {
      const insertAt = Math.max(0, startLine - 1);
      return [
        ...lines.slice(0, insertAt),
        ...proposalLines,
        ...lines.slice(insertAt),
      ].join("\n");
    }
    const beforeLines = lines.slice(0, Math.max(0, startLine - 1));
    const afterLines = lines.slice(Math.max(0, endLine));
    return [...beforeLines, ...proposalLines, ...afterLines].join("\n");
  }

  /**
   * Enriquece la instrucción con Grafo de Código AST y menciones tipo Cursor
   */
  async enrichInlineEditPrompt({ filePath = "", projectRoot = "", selection = "", instruction = "", language = "" } = {}) {
    const root = String(projectRoot || "").trim();
    const blocks = [];

    // 1. AST Code Graph para el archivo activo
    if (root && filePath) {
      try {
        const { buildProjectSymbolGraph } = require("./code-graph");
        const graph = buildProjectSymbolGraph(root, { maxFiles: 150 });
        const fileDeps = graph.getFileDependencies(filePath);
        if (fileDeps) {
          const expNames = (fileDeps.exports || []).map((e) => `${e.kind} ${e.name}`).slice(0, 10);
          const impNames = (fileDeps.imports || []).flatMap((i) => i.symbols.map((s) => s.name)).slice(0, 15);
          if (expNames.length || impNames.length) {
            blocks.push(
              `--- GRAFO DE CÓDIGO AST (Contexto de dependencias) ---\n`
              + (expNames.length ? `Símbolos definidos/exportados en este archivo: ${expNames.join(", ")}\n` : "")
              + (impNames.length ? `Símbolos importados disponibles: ${impNames.join(", ")}\n` : "")
            );
          }
        }
      } catch { /* resiliente */ }
    }

    // 2. Menciones explícitas en la instrucción (@file:, @symbol:, @problems, etc.)
    if (instruction && root) {
      try {
        const { extractMentions, resolveMentionsContext } = require("./at-mentions-resolver");
        const mentions = extractMentions(instruction);
        if (mentions.length > 0) {
          const resolved = await resolveMentionsContext(mentions, root, {
            activeSelection: selection,
          });
          if (resolved) blocks.push(resolved);
        }
      } catch { /* resiliente */ }
    }

    return blocks.filter(Boolean).join("\n\n");
  }

  /**
   * Valida sintácticamente la propuesta con TypeScript/JSX AST para evitar errores al aplicar
   */
  validateProposalSyntax(filePath = "", proposal = "", fullModified = "") {
    if (!filePath || !proposal) return { valid: true, ok: true };
    try {
      const { validateSyntax } = require("./syntax-validator");
      if (fullModified) {
        const fullCheck = validateSyntax(filePath, fullModified);
        if (!fullCheck.valid) {
          return { valid: false, ok: false, error: fullCheck.message, hint: fullCheck.hint };
        }
      }
      const snippetCheck = validateSyntax(filePath, proposal);
      if (!snippetCheck.valid) {
        return { valid: false, ok: false, error: snippetCheck.message, hint: snippetCheck.hint };
      }
    } catch { /* ignore */ }
    return { valid: true, ok: true };
  }

  /**
   * Genera heurísticamente una propuesta de código para Inline Edit si no hay conexión LLM
   */
  generateMockProposal(prompt = "", originalText = "") {
    const p = (prompt || "").toLowerCase();
    const orig = originalText || "";

    if (p.includes("try") || p.includes("catch") || p.includes("error")) {
      return `try {\n  ${orig.replace(/\n/g, "\n  ")}\n} catch (error) {\n  console.error("Error capturado:", error.message);\n}`;
    }

    if (p.includes("doc") || p.includes("comentar") || p.includes("jsdoc")) {
      return `/**\n * Función refactorizada según directiva: ${prompt}\n */\n${orig}`;
    }

    if (p.includes("async") || p.includes("promesa")) {
      return orig.replace(/function\s+/g, "async function ").replace(/=>/g, "async () =>");
    }

    // Por defecto, retorna el texto original con comentario de refactorización
    return `${orig}\n// Refactorizado: ${prompt}`;
  }
}

const inlineEditProviderInstance = new InlineEditProvider();

module.exports = {
  InlineEditProvider,
  inlineEditProvider: inlineEditProviderInstance,
};
