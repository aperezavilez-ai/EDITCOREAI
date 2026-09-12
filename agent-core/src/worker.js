"use strict";

const { runLlmToolLoop, synthesizeFromEvidence } = require("./llm-loop");

const MUTATION_TOOLS = ["write_file", "replace_in_file", "delete_file", "apply_diff"];

function normalizePath(p = "") {
  return String(p || "").replace(/\\/g, "/");
}

function isVerificationPassed(result) {
  if (result == null) return false;
  if (typeof result === "string") return true;
  if (result.diagnostic === true) return result.passed === true;
  if (Number.isFinite(Number(result.exitCode))) return Number(result.exitCode) === 0;
  if (typeof result.passed === "boolean") return result.passed;
  return true;
}

function verificationOutput(result) {
  if (typeof result === "string") return result.slice(0, 4000);
  if (result?.output) return String(result.output).slice(0, 4000);
  if (result?.summary) return String(result.summary).slice(0, 4000);
  try { return JSON.stringify(result).slice(0, 4000); } catch { return String(result); }
}

/**
 * Resuelve replace de etiquetas HTML/MD: cambia el contenido interno de <h1>…</h1>.
 */
function stripReadLinePrefixes(content = "") {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\|\s?/, ""))
    .join("\n");
}

async function resolveTagSwapReplace(execute, toolInput = {}) {
  const tag = String(toolInput.tagSwap?.tag || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const newInner = String(toolInput.tagSwap?.newText || toolInput.newText || "").trim();
  const path = normalizePath(toolInput.path || "");
  if (!tag || !newInner || !path) {
    throw new Error("tagSwap incompleto (path/tag/newText).");
  }
  const read = await execute("read_file", { path, startLine: 1, endLine: 400 });
  const raw = typeof read === "string"
    ? read
    : String(read?.content || read?.text || read?.output || "");
  const content = stripReadLinePrefixes(raw);
  if (!content.trim()) throw new Error(`No se pudo leer ${path} para tagSwap.`);

  const re = new RegExp(`<(${tag})(\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, "i");
  const match = content.match(re);
  if (!match) throw new Error(`No se encontro <${tag}> en ${path}.`);

  const attrs = match[2] || "";
  const oldText = match[0];
  const newText = `<${tag}${attrs}>${newInner}</${tag}>`;
  const { tagSwap, ...rest } = toolInput;
  return { ...rest, path, oldText, newText };
}

function formatEvidenceFromSteps(steps = []) {
  const ok = steps.filter((s) => s.ok === true);
  const failed = steps.filter((s) => s.ok === false);
  const lines = [
    "## Evidencia de correccion",
    "",
    `- tools OK: ${ok.length} | fallidas: ${failed.length}`,
  ];
  for (const s of ok) {
    const p = normalizePath(s.input?.path || s.result?.path || "");
    if (s.name === "write_file") {
      lines.push(`- write_file OK: \`${p}\`${s.result?.bytes != null ? ` (${s.result.bytes} bytes)` : ""}`);
    } else if (s.name === "replace_in_file") {
      lines.push(`- replace_in_file OK: \`${p}\``);
    } else if (s.name === "delete_file") {
      lines.push(`- delete_file OK: \`${p}\``);
    } else if (s.name === "read_file") {
      lines.push(`- read_file OK: \`${p}\``);
    } else if (s.name === "run_command") {
      const passed = isVerificationPassed(s.result);
      lines.push(`- run_command ${passed ? "PASO" : "FALLO"}: \`${String(s.input?.command || "").slice(0, 120)}\``);
    } else {
      lines.push(`- ${s.name} OK${p ? `: \`${p}\`` : ""}`);
    }
  }
  for (const s of failed.slice(0, 8)) {
    const p = normalizePath(s.input?.path || "");
    lines.push(`- FALLO ${s.name}${p ? ` \`${p}\`` : ""}: ${s.error || "error"}`);
  }
  return lines.join("\n");
}

/**
 * Worker: ejecuta pasos del plan + sintesis LLM anclada a evidencia.
 */
async function runPlan(plan, input = {}) {
  const tools = input.tools;
  if (!tools?.execute) {
    throw new Error("Agent Core requiere tools.execute inyectado por EDITCOREAI.");
  }

  const steps = [];
  const maxSteps = Math.max(1, Number(input.maxSteps) || 36);
  input.onProgress?.({ phase: "model", text: `Agent Core · modo ${plan.mode}` });

  if (plan.needsConcreteChange) {
    return {
      steps: [],
      plan,
      finalText: [
        "## Resultado",
        "",
        "Recibi PROCEDE, pero no hay un cambio concreto en el mensaje.",
        "No inventare correcciones de comentarios ni tocare el runtime.",
        "",
        "Indica path + cambio (crear archivo, replace_in_file con oldText/newText, o borrar archivo) y escribe PROCEDE.",
      ].join("\n"),
      providerCalls: 0,
      llmSkipped: true,
    };
  }

  const createSpec = plan.createSpec || null;
  const replaceSpecs = Array.isArray(plan.replaceSpecs) && plan.replaceSpecs.length
    ? plan.replaceSpecs
    : (plan.replaceSpec ? [plan.replaceSpec] : []);
  const deleteSpec = plan.deleteSpec || null;
  const lockedPaths = new Set(
    [
      createSpec?.path,
      deleteSpec?.path,
      ...replaceSpecs.map((s) => s.path),
    ].filter(Boolean).map(normalizePath),
  );
  let allowWrite = plan.allowMutation === true && input.allowWrite !== false && plan.mode !== "diagnose";
  if ((createSpec || replaceSpecs.length || deleteSpec) && plan.mode === "execute") {
    allowWrite = true;
  }

  const lockedExecute = async (name, toolInput = {}) => {
    if (lockedPaths.size && MUTATION_TOOLS.includes(name)) {
      const target = normalizePath(toolInput.path || "");
      if (!lockedPaths.has(target)) {
        throw new Error(`Bloqueado: solo se permiten mutar: ${[...lockedPaths].join(", ")}`);
      }
    }
    if (lockedPaths.size && name === "read_file") {
      const target = normalizePath(toolInput.path || "");
      if (target && !lockedPaths.has(target)) {
        throw new Error(`Bloqueado: en este pedido solo se leen: ${[...lockedPaths].join(", ")}`);
      }
    }
    return tools.execute(name, toolInput);
  };

  for (const item of plan.steps || []) {
    if (input.signal?.aborted) break;
    if (steps.length >= maxSteps) break;

    if (item.type === "tool" && item.tool) {
      if (MUTATION_TOOLS.includes(item.tool) && !allowWrite) {
        steps.push({
          name: item.tool,
          input: item.input || {},
          ok: false,
          error: "Escritura bloqueada en este modo.",
          index: steps.length,
        });
        continue;
      }

      const candidates = [item.input?.path, ...(item.fallbackPaths || [])].filter(Boolean);
      let ok = false;
      let lastError = null;
      const pathsToTry = candidates.length ? candidates : [undefined];

      for (const pathCandidate of pathsToTry) {
        let toolInput = pathCandidate != null
          ? { ...(item.input || {}), path: pathCandidate }
          : { ...(item.input || {}) };

        // "cambia el h1 a X": leer archivo y resolver oldText/newText del tag
        if (item.tool === "replace_in_file" && toolInput.tagSwap?.tag) {
          try {
            const resolved = await resolveTagSwapReplace(lockedExecute, toolInput);
            toolInput = resolved;
          } catch (resolveErr) {
            lastError = resolveErr;
            continue;
          }
        }

        input.onProgress?.({
          phase: "tool",
          stage: "running",
          name: item.tool,
          input: toolInput,
          index: steps.length,
        });
        try {
          const result = await lockedExecute(item.tool, toolInput);
          const step = {
            name: item.tool,
            input: toolInput,
            result,
            ok: true,
            index: steps.length,
          };
          steps.push(step);
          input.onProgress?.({
            phase: "tool",
            stage: "done",
            name: item.tool,
            input: toolInput,
            result,
            ok: true,
            index: steps.length - 1,
          });
          ok = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      // Swap/replace: si el archivo no existe, crear con newText.
      if (!ok && item.tool === "replace_in_file" && item.createIfMissing === true && allowWrite) {
        const missing = /no encontrado|ENOENT|does not exist|no existe/i.test(String(lastError?.message || lastError || ""));
        const noOld = /oldText no existe|oldText missing/i.test(String(lastError?.message || lastError || ""));
        if (missing || noOld) {
          const path = normalizePath(item.input?.path || "");
          const content = String(item.input?.newText || "");
          try {
            const result = await lockedExecute("write_file", { path, content });
            steps.push({
              name: "write_file",
              input: { path, content },
              result,
              ok: true,
              index: steps.length,
              note: missing ? "Creado porque no existia" : "Reescrito tras oldText ausente",
            });
            ok = true;
            lastError = null;
          } catch (writeErr) {
            lastError = writeErr;
          }
        }
      }

      if (!ok) {
        const optionalMiss = item.optional === true
          && item.tool === "read_file"
          && /no encontrado|ENOENT|does not exist|no existe/i.test(String(lastError?.message || lastError || ""));
        steps.push({
          name: item.tool,
          input: item.input || {},
          ok: optionalMiss ? true : false,
          optionalMiss: optionalMiss || undefined,
          error: optionalMiss ? undefined : String(lastError?.message || lastError || "tool failed"),
          result: optionalMiss ? { path: item.input?.path, missing: true, note: "Archivo aun no existe; se creara al mutar." } : undefined,
          index: steps.length,
        });
        input.onProgress?.({
          phase: "tool",
          stage: optionalMiss ? "done" : "failed",
          name: item.tool,
          input: item.input || {},
          ok: optionalMiss,
          index: steps.length - 1,
        });
      }
      continue;
    }

    if (item.type === "mutate" || item.type === "report" || item.type === "verify") {
      continue;
    }
  }

  if (plan.mode === "execute" && createSpec) {
    const wrote = steps.find((s) => s.name === "write_file" && s.ok);
    const writeFail = steps.find((s) => s.name === "write_file" && !s.ok);
    const readBack = steps.find((s) => s.name === "read_file" && s.ok
      && normalizePath(s.input?.path) === normalizePath(createSpec.path));

    if (wrote) {
      const body = String(readBack?.result?.content || createSpec.content || "").trim();
      return {
        steps,
        plan,
        finalText: [
          "## Resultado",
          "",
          `Archivo creado/actualizado: \`${createSpec.path}\``,
          "",
          "Contenido verificado:",
          "```",
          body,
          "```",
          "",
          formatEvidenceFromSteps(steps),
        ].join("\n"),
        providerCalls: 0,
        llmSkipped: true,
      };
    }

    return {
      steps,
      plan,
      finalText: [
        "## Resultado",
        "",
        `No pude crear \`${createSpec.path}\`.`,
        writeFail ? `Error: ${writeFail.error}` : "write_file no se ejecuto.",
        "",
        formatEvidenceFromSteps(steps),
      ].join("\n"),
      providerCalls: 0,
      llmSkipped: true,
    };
  }

  if (plan.mode === "execute" && deleteSpec) {
    const deleted = steps.find((s) => s.name === "delete_file" && s.ok);
    const deleteFail = steps.find((s) => s.name === "delete_file" && !s.ok);
    if (deleted) {
      return {
        steps,
        plan,
        finalText: [
          "## Resultado",
          "",
          `Archivo borrado: \`${deleteSpec.path}\``,
          "",
          formatEvidenceFromSteps(steps),
        ].join("\n"),
        providerCalls: 0,
        llmSkipped: true,
      };
    }
    return {
      steps,
      plan,
      finalText: [
        "## Resultado",
        "",
        `No pude borrar \`${deleteSpec.path}\`.`,
        deleteFail ? `Error: ${deleteFail.error}` : "delete_file no se ejecuto.",
        "",
        formatEvidenceFromSteps(steps),
      ].join("\n"),
      providerCalls: 0,
      llmSkipped: true,
    };
  }

  if (plan.mode === "execute" && replaceSpecs.length) {
    const mutated = steps.filter((s) => ["replace_in_file", "write_file"].includes(s.name) && s.ok);
    const replaceFails = steps.filter((s) => s.name === "replace_in_file" && !s.ok);
    if (mutated.length >= replaceSpecs.length) {
      const paths = [...new Set(replaceSpecs.map((s) => s.path))];
      let verifyNote = "";
      const verifyStep = steps.find((s) => s.name === "run_command");
      if (verifyStep?.ok) {
        verifyNote = isVerificationPassed(verifyStep.result)
          ? `\nVerificacion PASO: \`${verifyStep.input?.command}\``
          : `\nVerificacion FALLO: \`${verifyStep.input?.command}\``;
      }
      return {
        steps,
        plan,
        finalText: [
          "## Resultado",
          "",
          `Mutaciones aplicadas: ${mutated.length} en ${paths.length} archivo(s).`,
          ...paths.map((p) => `- \`${p}\``),
          verifyNote,
          "",
          formatEvidenceFromSteps(steps),
        ].join("\n"),
        providerCalls: 0,
        llmSkipped: true,
      };
    }
    return {
      steps,
      plan,
      finalText: [
        "## Resultado",
        "",
        `Replace incompleto: ${mutated.length}/${replaceSpecs.length} OK.`,
        ...replaceFails.map((s) => `- ${normalizePath(s.input?.path)}: ${s.error}`),
        "",
        formatEvidenceFromSteps(steps),
      ].join("\n"),
      providerCalls: 0,
      llmSkipped: true,
    };
  }

  const seedOk = steps.filter((s) => s.ok === true).length;
  const seedReadsOk = steps.filter((s) => s.name === "read_file" && s.ok === true).length;
  const deepDiagnose = plan.mode === "diagnose" && (
    /\b(forense|exhaustiv|profund|carpeta\s+por\s+carpeta|hallazgos)\b/i.test(String(input.prompt || ""))
    || input.analysisMode === true
  );

  // list/explain: sintetizar sobre semilla esta OK.
  // diagnose: NUNCA cerrar solo con semilla (producia "sin defectos" con 4 archivos).
  if ((plan.mode === "list" || plan.mode === "explain") && seedOk > 0) {
    const synth = await synthesizeFromEvidence(input, {
      mode: plan.mode,
      seedSteps: steps,
    });
    return {
      steps,
      plan,
      finalText: synth.finalText || "",
      providerCalls: Number(synth.providerCalls || 0),
      llmSkipped: synth.skipped === true,
      synthError: synth.error || "",
    };
  }

  let providerCalls = 0;
  let finalText = "";
  let llmSkipped = false;

  const llm = await runLlmToolLoop({
    ...input,
    tools: { execute: lockedExecute },
  }, {
    mode: plan.mode,
    allowWrite,
    seedSteps: steps,
    maxIterations: plan.mode === "execute" ? 12 : (plan.mode === "diagnose" ? (deepDiagnose ? 20 : 12) : 4),
  });
  providerCalls += Number(llm.providerCalls || 0);
  finalText = llm.finalText || "";
  llmSkipped = llm.skipped === true;
  let allSteps = llm.steps || steps;

  const readsAfter = allSteps.filter((s) => s.name === "read_file" && s.ok === true).length;
  if (plan.mode === "diagnose" && (!String(finalText || "").trim() || readsAfter < Math.max(4, seedReadsOk))) {
    const synth = await synthesizeFromEvidence(input, {
      mode: "diagnose",
      seedSteps: allSteps,
    });
    providerCalls += Number(synth.providerCalls || 0);
    if (String(synth.finalText || "").trim()) finalText = synth.finalText;
  }

  // Semana 2: verificar + reintentar reparacion si el comando falla.
  const verifyCommand = plan.verifyCommand || null;
  if (plan.mode === "execute" && verifyCommand && allowWrite && !llmSkipped) {
    const maxRepairs = 2;
    for (let round = 0; round <= maxRepairs; round += 1) {
      if (input.signal?.aborted) break;
      input.onProgress?.({
        phase: "tool",
        stage: "running",
        name: "run_command",
        input: { command: verifyCommand },
        text: `Verificacion (${round + 1}/${maxRepairs + 1}): ${verifyCommand}`,
      });
      try {
        const result = await lockedExecute("run_command", { command: verifyCommand });
        const passed = isVerificationPassed(result);
        allSteps.push({
          name: "run_command",
          input: { command: verifyCommand },
          result,
          ok: true,
          index: allSteps.length,
          verifyPassed: passed,
        });
        if (passed) {
          finalText = [
            finalText || "Cambios aplicados.",
            "",
            `Verificacion PASO: \`${verifyCommand}\``,
            "",
            formatEvidenceFromSteps(allSteps),
          ].join("\n");
          break;
        }
        if (round >= maxRepairs) {
          finalText = [
            finalText || "Hubo mutaciones, pero la verificacion sigue fallando.",
            "",
            `Verificacion FALLO tras ${maxRepairs + 1} intentos: \`${verifyCommand}\``,
            "",
            "```",
            verificationOutput(result),
            "```",
            "",
            formatEvidenceFromSteps(allSteps),
          ].join("\n");
          break;
        }
        const repair = await runLlmToolLoop({
          ...input,
          tools: { execute: lockedExecute },
        }, {
          mode: "execute",
          allowWrite: true,
          seedSteps: allSteps,
          maxIterations: 8,
          repairHint: [
            `El comando \`${verifyCommand}\` FALLO.`,
            "Corrige el codigo con replace_in_file (oldText exacto desde lecturas).",
            "Salida:",
            verificationOutput(result),
          ].join("\n"),
        });
        providerCalls += Number(repair.providerCalls || 0);
        allSteps = repair.steps || allSteps;
        if (repair.finalText) finalText = repair.finalText;
      } catch (error) {
        allSteps.push({
          name: "run_command",
          input: { command: verifyCommand },
          ok: false,
          error: String(error?.message || error),
          index: allSteps.length,
        });
        finalText = [
          finalText || "No se pudo ejecutar la verificacion.",
          "",
          `Error run_command: ${error?.message || error}`,
          "",
          formatEvidenceFromSteps(allSteps),
        ].join("\n");
        break;
      }
    }
  } else if (plan.mode === "execute" && plan.freeFormFix && finalText && !/## Evidencia de correccion/i.test(finalText)) {
    finalText = [finalText, "", formatEvidenceFromSteps(allSteps)].join("\n");
  }

  return {
    steps: allSteps,
    plan,
    finalText,
    providerCalls,
    llmSkipped,
  };
}

module.exports = {
  runPlan,
  formatEvidenceFromSteps,
  isVerificationPassed,
  MUTATION_TOOLS,
};
