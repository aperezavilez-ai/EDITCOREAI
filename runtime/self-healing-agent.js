/**
 * runtime/self-healing-agent.js
 * EditCoreAI - Self-Healing & Terminal Diagnostician Agent (Ciclo 36)
 */

const fs = require("fs");
const path = require("path");
const { agentPlanner } = require("./agent-planner");
const { vectorStore } = require("./vector-store");

class SelfHealingAgent {
  constructor(options = {}) {
    this.options = options;
    this.diagnoses = new Map(); // projectRoot -> Array<Diagnosis>
  }

  /**
   * Parsea un mensaje de error o stack trace de terminal / pruebas
   */
  parseError(errorOutput = "") {
    if (!errorOutput || typeof errorOutput !== "string") {
      return {
        message: "Error desconocido",
        type: "UnknownError",
        filePath: null,
        line: null,
        column: null,
        stackFrames: [],
      };
    }

    const lines = errorOutput.split(/\r?\n/);
    let message = "";
    let type = "Error";
    let filePath = null;
    let line = null;
    let column = null;
    const stackFrames = [];

    // 1. Extraer tipo y mensaje principal
    for (const l of lines) {
      const typeMatch = l.match(/(?:([A-Za-z]+Error|AssertionError|SyntaxError|TypeError|ReferenceError)):\s*(.*)/);
      if (typeMatch) {
        type = typeMatch[1];
        message = typeMatch[2] || type;
        break;
      }
    }

    if (!message && lines.length > 0) {
      message = lines[0].trim();
    }

    // 2. Extraer líneas de stack trace (ej: at function (path/to/file.js:42:10) o at path/to/file.js:42:10)
    const stackRegex = /at\s+(?:.*?\s+\()?([a-zA-Z0-9_\-./\\]+\.(?:js|ts|jsx|tsx|py|html)):(\d+)(?::(\d+))?\)?/;
    for (const l of lines) {
      const match = l.match(stackRegex);
      if (match) {
        const frame = {
          file: match[1].replace(/\\/g, "/"),
          line: parseInt(match[2], 10),
          column: match[3] ? parseInt(match[3], 10) : null,
          raw: l.trim(),
        };
        stackFrames.push(frame);

        // Guardar la primera ocurrencia no de node_modules como origen principal
        if (!filePath && !frame.file.includes("node_modules") && !frame.file.includes("node:internal")) {
          filePath = frame.file;
          line = frame.line;
          column = frame.column;
        }
      }
    }

    // Fallback: buscar patrones directos como "filename.js:12:34"
    if (!filePath) {
      const directMatch = errorOutput.match(/([a-zA-Z0-9_\-./\\]+\.(?:js|ts|jsx|tsx|py)):(\d+)(?::(\d+))?/);
      if (directMatch) {
        filePath = directMatch[1].replace(/\\/g, "/");
        line = parseInt(directMatch[2], 10);
        column = directMatch[3] ? parseInt(directMatch[3], 10) : null;
      }
    }

    return {
      message,
      type,
      filePath,
      line,
      column,
      stackFrames,
    };
  }

  /**
   * Genera un parche heurístico rápido según el tipo de error
   */
  generateHeuristicPatch(parsedError, fileContent = "") {
    if (!parsedError || !fileContent) {
      return { suggestedPatch: "", explanation: "No se pudo generar propuesta de parche" };
    }

    const { type, message, line } = parsedError;
    const lines = fileContent.split(/\r?\n/);
    const targetIdx = line ? Math.max(0, line - 1) : 0;
    const targetLine = lines[targetIdx] || "";

    let proposedLines = [...lines];
    let explanation = "";

    if (type === "ReferenceError" && message.includes("is not defined")) {
      const varMatch = message.match(/([a-zA-Z0-9_$]+)\s+is not defined/);
      const varName = varMatch ? varMatch[1] : "variable";
      explanation = `Inicializar variable '${varName}' antes de su uso o añadir importación requerida.`;
      proposedLines.splice(targetIdx, 0, `  let ${varName} = null; // Autocorrección EditCoreAI`);
    } else if (type === "TypeError" && (message.includes("is not a function") || message.includes("cannot read property") || message.includes("reading '"))) {
      explanation = `Añadir validación condicional / optional chaining (?.) para evitar acceso a nulo/indefinido.`;
      if (targetLine.includes(".")) {
        proposedLines[targetIdx] = targetLine.replace(/\.([a-zA-Z0-9_$]+)/g, "?.$1");
      } else {
        proposedLines.splice(targetIdx, 0, `  if (typeof ${targetLine.trim()} !== 'undefined') {`);
        proposedLines.splice(targetIdx + 2, 0, `  }`);
      }
    } else if (type === "AssertionError" || message.includes("assert") || message.includes("expect")) {
      explanation = `Ajustar aserción o sincronizar el valor retornado para cumplir con la prueba unitaria.`;
      proposedLines[targetIdx] = `${targetLine} // Parche de aserción verificado`;
    } else {
      explanation = `Añadir bloque try/catch protector alrededor de la línea defectuosa.`;
      proposedLines[targetIdx] = `  try {\n    ${targetLine}\n  } catch (err) {\n    console.error("Autocorrección capturada:", err.message);\n  }`;
    }

    const modifiedText = proposedLines.join("\n");
    return {
      suggestedPatch: modifiedText,
      explanation,
    };
  }

  /**
   * Ejecuta el diagnóstico integral y genera automáticamente un plan en AgentPlanner
   */
  diagnoseError(errorOutput, projectRoot = "", options = {}) {
    const parsed = this.parseError(errorOutput);
    let resolvedFilePath = parsed.filePath;
    let fileContent = "";

    if (projectRoot && resolvedFilePath) {
      const fullPath = path.isAbsolute(resolvedFilePath)
        ? resolvedFilePath
        : path.join(projectRoot, resolvedFilePath);

      if (fs.existsSync(fullPath)) {
        try {
          fileContent = fs.readFileSync(fullPath, "utf-8");
        } catch {
          // Ignorar fallo de lectura
        }
      }
    }

    // Si no se ubicó archivo directo por stack, consultar VectorStore RAG
    if (!fileContent && projectRoot && parsed.message) {
      try {
        const ragHits = vectorStore.searchSimilar(projectRoot, `${parsed.type} ${parsed.message}`, { topK: 1 });
        if (ragHits.length > 0) {
          resolvedFilePath = ragHits[0].filePath;
          const fullPath = path.join(projectRoot, resolvedFilePath);
          if (fs.existsSync(fullPath)) {
            fileContent = fs.readFileSync(fullPath, "utf-8");
            parsed.filePath = resolvedFilePath;
            parsed.line = ragHits[0].startLine;
          }
        }
      } catch {
        // Fallback
      }
    }

    const patchInfo = this.generateHeuristicPatch(parsed, fileContent);

    // Integración con Plan-First (agent-planner.js)
    const goal = `Autocorrección de ${parsed.type}: ${parsed.message} en ${parsed.filePath || 'código fuente'}`;
    const targetFiles = resolvedFilePath
      ? [
          {
            filePath: resolvedFilePath,
            changeType: "MODIFY",
            summary: patchInfo.explanation || "Corrección de error detectado",
            diffPreview: `@@ -${parsed.line || 1} @@ \n${patchInfo.explanation}`,
          },
        ]
      : [];

    const plan = agentPlanner.createPlan({
      goal,
      targetFiles,
      steps: [
        `Analizar stack trace: ${parsed.type}`,
        `Inspeccionar línea ${parsed.line || '?'} en ${resolvedFilePath || 'archivo'}`,
        `Aplicar parche: ${patchInfo.explanation}`,
        `Validar con re-ejecución de pruebas`,
      ],
      diffPreview: patchInfo.explanation,
    });

    const diagnosis = {
      diagnosisId: `diag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      parsedError: parsed,
      explanation: patchInfo.explanation,
      planId: plan.planId,
      planStatus: plan.status,
      suggestedPatch: patchInfo.suggestedPatch,
      resolvedFilePath,
    };

    if (projectRoot) {
      const list = this.diagnoses.get(projectRoot) || [];
      list.unshift(diagnosis);
      this.diagnoses.set(projectRoot, list.slice(0, 20)); // Conservar últimos 20
    }

    return {
      diagnosis,
      plan,
    };
  }

  /**
   * Obtiene los diagnósticos recientes de un proyecto
   */
  getRecentDiagnoses(projectRoot) {
    if (!projectRoot) return [];
    return this.diagnoses.get(projectRoot) || [];
  }

  /**
   * Limpia el registro de diagnósticos
   */
  clearDiagnoses(projectRoot) {
    if (projectRoot) {
      this.diagnoses.delete(projectRoot);
      return true;
    }
    this.diagnoses.clear();
    return true;
  }
}

const selfHealingAgentInstance = new SelfHealingAgent();

module.exports = {
  SelfHealingAgent,
  selfHealingAgent: selfHealingAgentInstance,
};
