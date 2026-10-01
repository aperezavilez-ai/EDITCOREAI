"use strict";

function entryName(entry) {
  return String(entry?.name || entry?.path || "").replace(/\\/g, "/").split("/").pop() || "";
}

function formatList(step) {
  const listedPath = String(step.input?.path || ".").replace(/\\/g, "/") || ".";
  const entries = Array.isArray(step.result)
    ? step.result
    : (step.result?.entries || []);
  const lines = entries.slice(0, 120).map((e) => {
    const name = entryName(e);
    if (!name) return null;
    const isDir = e?.kind === "directory" || e?.isDirectory === true;
    return `- ${isDir ? "📁" : "📄"} ${name}${isDir ? "/" : ""}`;
  }).filter(Boolean);
  return [
    `## Archivos en \`${listedPath}\``,
    "",
    ...(lines.length ? lines : ["- (sin entradas visibles)"]),
    "",
  ];
}

function extractHeaderComment(content = "") {
  const block = String(content).match(/\/\*\*([\s\S]*?)\*\//);
  if (!block) return "";
  return block[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line && !/^@\w+/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExports(content = "") {
  const m = String(content).match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
  if (!m) return [];
  return [...m[1].matchAll(/([A-Za-z_][\w]*)\s*(?:,|$)/g)].map((x) => x[1]).slice(0, 12);
}

function explainFile(step) {
  const filePath = String(step.result?.path || step.input?.path || "").replace(/\\/g, "/");
  const base = filePath.split("/").pop() || filePath;
  const content = String(step.result?.content || "");
  const lines = [`## Qué hace \`${base}\``, ""];
  const windows = Array.isArray(step.result?.windows) ? step.result.windows.length : 0;
  if (windows > 1) lines.push(`Evidencia en ${windows} ventanas de lectura.`);

  const header = extractHeaderComment(content);
  if (header) lines.push(header);

  const coreSymbols = [...new Set(
    [...content.matchAll(/\b(tryRunAgentCore|isAgentCoreEnabled|isLegacyAgentForced|loadAgentCore|resolveCoreRoot|runAgent)\b/g)]
      .map((m) => m[1]),
  )];
  if (/agent-core-bridge/i.test(content) || coreSymbols.length) {
    lines.push(
      `Integracion Agent Core detectada${/agent-core-bridge/i.test(content) ? " (importa `agent-core-bridge`)" : ""}`
      + (coreSymbols.length ? `: ${coreSymbols.map((n) => `\`${n}\``).join(", ")}.` : "."),
    );
  }

  const classMatch = content.match(/class\s+(\w+)/);
  const fnMatches = [...content.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]).slice(0, 8);
  const exports = extractExports(content);
  if (classMatch) lines.push(`Define la clase \`${classMatch[1]}\`.`);
  if (fnMatches.length) lines.push(`Funciones principales: ${fnMatches.map((n) => `\`${n}\``).join(", ")}.`);
  if (exports.length) lines.push(`Exporta: ${exports.map((n) => `\`${n}\``).join(", ")}.`);
  if (!header && !classMatch && !fnMatches.length && !exports.length && !coreSymbols.length) {
    const preview = content.trim().split(/\r?\n/).slice(0, 3).join(" ").slice(0, 240);
    lines.push(preview
      ? `Archivo leido. Inicio: ${preview}`
      : "Lectura sin contenido util.");
  }
  lines.push("");
  return lines;
}

function isUngroundedModelText(text = "") {
  const t = String(text || "");
  return /window\.agentBridge|contextBridge|agent:command|proceso de renderizado|IPC de Electron/i.test(t);
}

function hasFalseTruncationClaim(text = "", steps = []) {
  const t = String(text || "")
    .replace(/PACK_TRUNCATED(?:_FOR_MODEL)?/gi, "")
    .replace(/CORTE_PRESUPUESTO/gi, "")
    .replace(/TOOL_PARTIAL_READ/gi, "")
    .replace(/truncad\w*\s+(?:por|para)\s+(?:el\s+)?(?:modelo|empaquetad\w*|presupuesto)/gi, "")
    .replace(/no\s+(?:implica|significa|es|esta)\s+[^\n.]{0,100}(?:truncad\w*|incomplet\w*|roto|corrupto)/gi, "")
    .replace(/\(\s*no\s+implica[^)]{0,80}\)/gi, "");
  const claimsFileBroken = (
    /(?:archivo|main\.js).{0,100}(?:esta(?:\s+\w+){0,3}\s+)?(?:truncad\w*|incomplet\w*|roto|corrupto)/i.test(t)
    || /(?:truncad\w*|incomplet\w*|sintaxis incompleta|a mitad de l[ií]nea).{0,100}main\.js/i.test(t)
    || /URGENTE:\s*Completar la l[ií]nea/i.test(t)
    || /require\s+(?:sin cerrar|incomplet)|deployOneClick[^\n]{0,80}incomplet/i.test(t)
    || /punto de falla cr[ií]tico[^\n]{0,120}main\.js/i.test(t)
    || /main\.js[^\n]{0,120}error de sintaxis/i.test(t)
  );
  if (!claimsFileBroken) return false;
  const okReads = steps.filter((s) => s.name === "read_file" && s.ok === true);
  return okReads.some((s) => /main\.js/i.test(String(s.result?.path || s.input?.path || "")));
}

function scrubFalseTruncationClaims(text = "") {
  let out = String(text || "");
  out = out.replace(/^[^\n]*(?:URGENTE:[^\n]*main\.js|main\.js[^\n]*(?:truncad|sintaxis incompleta|archivo incompleto)|deployOneClick[^\n]*require[^\n]*incomplet)[^\n]*$/gim, "");
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

function mergeReadStepsByPath(steps = []) {
  const map = new Map();
  for (const step of steps) {
    if (step?.name !== "read_file" || step.ok !== true) continue;
    const p = String(step.result?.path || step.input?.path || "").replace(/\\/g, "/");
    if (!p) continue;
    const start = Number(step.result?.startLine || step.input?.startLine || 1);
    const end = Number(step.result?.endLine || step.input?.endLine || 0);
    const chunk = String(step.result?.content || "");
    const marker = end
      ? `\n\n/* --- ventana L${start}-${end} --- */\n`
      : (map.has(p) ? "\n\n/* --- ventana adicional --- */\n" : "");

    if (!map.has(p)) {
      map.set(p, {
        name: "read_file",
        ok: true,
        input: { ...(step.input || {}), path: p },
        result: {
          ...(step.result || {}),
          path: p,
          content: chunk,
          windows: [{ start, end, bytes: chunk.length }],
        },
      });
    } else {
      const cur = map.get(p);
      cur.result.content = `${cur.result.content}${marker}${chunk}`;
      cur.result.windows = [...(cur.result.windows || []), { start, end, bytes: chunk.length }];
      cur.result.truncated = true;
      cur.result.totalLines = Math.max(
        Number(cur.result.totalLines || 0),
        Number(step.result?.totalLines || 0),
      );
    }
  }
  return [...map.values()];
}

function diagnoseReport(steps, projectRoot = "") {
  const reads = mergeReadStepsByPath(steps);
  const failed = steps.filter((s) => s.ok === false);
  const uniqueFiles = reads.map((s) => String(s.result?.path || s.input?.path || "").replace(/\\/g, "/"));
  const uniqueFails = [...new Set(
    failed.map((s) => {
      const p = String(s.input?.path || "").replace(/\\/g, "/");
      return `${s.name}${p ? ` ${p}` : ""}: ${s.error || "error"}`;
    }),
  )];

  const summaries = [];
  for (const step of reads) {
    summaries.push(...explainFile(step));
  }

  const incompleteFiles = uniqueFiles.length < 8;
  let incompleteScaffold = false;
  try {
    const { isScaffoldIncomplete } = require("../../runtime/scaffold-state");
    incompleteScaffold = isScaffoldIncomplete(projectRoot, { entryCount: uniqueFiles.length });
  } catch {
    incompleteScaffold = false;
  }
  const incomplete = incompleteFiles || incompleteScaffold;
  return [
    "## Qué sí funcionó",
    "",
    `- Proyecto: \`${projectRoot || "proyecto"}\`.`,
    `- Archivos leidos (${uniqueFiles.length}): ${uniqueFiles.length ? uniqueFiles.map((f) => `\`${f}\``).join(", ") : "ninguno"}.`,
    "",
    "## Resumen por archivo",
    "",
    ...(summaries.length ? summaries : ["- Sin contenido para resumir.", ""]),
    "## Qué falló / hallazgos",
    "",
    ...(uniqueFails.length
      ? uniqueFails.map((f) => `- ${f}`)
      : incomplete
        ? [
          `- ANALISIS INCOMPLETO: solo ${uniqueFiles.length} archivo(s) leidos.`,
          "- NO concluir 'sin defectos'. Escribe CONTINUA para seguir leyendo codigo real.",
          "- PROHIBIDO inventar hallazgos; tampoco inventes que no hay bugs.",
        ]
        : [
          "- No hubo fallos de tools, pero tampoco se extrajeron defectos concretos del modelo.",
          "- Escribe CONTINUA pidiendo hallazgos por archivo (bug + impacto + fix).",
        ]),
    "",
    "## Evidencia",
    "",
    ...reads.map((s) => {
      const p = String(s.result?.path || "").replace(/\\/g, "/");
      const wins = Array.isArray(s.result?.windows) ? s.result.windows.length : 1;
      return `- read_file OK: \`${p}\`${wins > 1 ? ` (${wins} ventanas)` : ""}`;
    }),
    uniqueFiles.length ? "" : "- Sin lecturas exitosas.",
    "",
    "## Cómo lo corregiré",
    "",
    incomplete
      ? "1. CONTINUA el analisis hasta cubrir rutas criticas.\n2. Luego entrega hallazgos concretos y pide PROCEDE."
      : "1. Con CONTINUA, fuerza hallazgos concretos por archivo ya leido.\n2. PROCEDE solo cuando haya defectos reales.",
    "",
    incomplete ? "Estado: incompleto (falta evidencia)." : "Estado: evidencia parcial; faltan hallazgos accionables.",
  ].join("\n");
}

function isMetaVerification(text = "") {
  return /Verificacion completada con evidencia real/i.test(String(text || ""));
}

function hasMutation(steps = []) {
  return steps.some((s) => [
    "write_file", "replace_in_file", "delete_file", "apply_diff",
    "write_external_file", "git_clone", "install_skill", "run_shell",
  ].includes(s.name) && s.ok === true);
}

function formatExecuteEvidence(steps = []) {
  const ok = (steps || []).filter((s) => s.ok === true);
  const failed = (steps || []).filter((s) => s.ok === false);
  const lines = [
    "## Evidencia de correccion",
    "",
    `- tools OK: ${ok.length} | fallidas: ${failed.length}`,
  ];
  for (const s of ok) {
    const p = String(s.input?.path || s.result?.path || "").replace(/\\/g, "/");
    if (["write_file", "replace_in_file", "delete_file", "read_file", "read_external_file", "write_external_file"].includes(s.name) && p) {
      lines.push(`- ${s.name} OK: \`${p}\``);
    } else if (s.name === "web_search") {
      lines.push(`- web_search OK: "${s.input?.query}" (${s.result?.count ?? "?"} resultados)`);
    } else if (s.name === "git_clone") {
      lines.push(`- git_clone OK: ${s.input?.url} → \`${s.input?.targetDir}\``);
    } else if (s.name === "run_shell") {
      lines.push(`- run_shell OK: \`${String(s.input?.command || "").slice(0, 100)}\``);
    } else if (s.name === "install_skill") {
      lines.push(`- install_skill OK: "${s.input?.skillName}"`);
    } else {
      lines.push(`- ${s.name} OK${p ? `: \`${p}\`` : ""}`);
    }
  }
  for (const s of failed.slice(0, 8)) {
    const p = String(s.input?.path || "").replace(/\\/g, "/");
    lines.push(`- FALLO ${s.name}${p ? ` \`${p}\`` : ""}: ${s.error || "error"}`);
  }
  return lines.join("\n");
}

function claimsFakeMutation(text = "", mutatedPaths = []) {
  const t = String(text || "");
  if (!/(correccion(?:es)? aplicada|modificaciones? aplicadas|ambos? archivos? modificados|Evidencia de correccion|Estado:\s*✅\s*Correcciones)/i.test(t)) {
    return false;
  }
  if (mutatedPaths.length) return false;
  return true;
}

/**
 * v0.4.1 — Formato enriquecido de resultados de tools extendidas.
 * SIEMPRE devuelve la evidencia real de las tools, en markdown rico.
 */
function formatResearchEvidence(steps = []) {
  const lines = [];
  let any = false;

  for (const s of steps) {
    if (!s.ok) continue;
    any = true;

    if (s.name === "web_search") {
      lines.push(`## 🌐 Búsqueda: "${s.input?.query || ""}"`);
      lines.push("");
      lines.push(`*Fuente: \`${s.result?.source || "n/a"}\` · ${s.result?.count ?? 0} resultados*`);
      lines.push("");
      const results = s.result?.results || [];
      if (results.length) {
        for (const r of results.slice(0, 5)) {
          lines.push(`### ${r.title || "(sin título)"}`);
          if (r.snippet) lines.push(`> ${r.snippet.slice(0, 400)}`);
          if (r.url) lines.push(`🔗 ${r.url}`);
          lines.push("");
        }
      } else {
        lines.push("_Sin resultados visibles._");
        lines.push("");
      }
    } else if (s.name === "web_fetch") {
      lines.push(`## 🌐 Contenido de ${s.input?.url}`);
      lines.push("");
      lines.push("```");
      lines.push(String(s.result?.content || "").slice(0, 2500));
      lines.push("```");
      lines.push("");
    } else if (s.name === "list_external_directory") {
      lines.push(`## 📁 \`${s.input?.path || ""}\``);
      lines.push("");
      const entries = s.result?.entries || [];
      if (entries.length) {
        lines.push(`**${entries.length} entradas:**`);
        lines.push("");
        for (const e of entries.slice(0, 60)) {
          lines.push(`- ${e.isDirectory ? "📁" : "📄"} \`${e.name}\``);
        }
      } else {
        lines.push("_Carpeta vacía o sin acceso._");
      }
      lines.push("");
    } else if (s.name === "read_external_file") {
      lines.push(`## 📄 \`${s.input?.path || ""}\``);
      lines.push("");
      lines.push("```");
      lines.push(String(s.result?.content || "").slice(0, 3000));
      lines.push("```");
      lines.push("");
    } else if (s.name === "git_log") {
      lines.push(`## 🧾 Commits en \`${s.input?.repoPath || ""}\``);
      lines.push("");
      const commits = s.result?.commits || [];
      if (commits.length) {
        lines.push("| Hash | Autor | Mensaje |");
        lines.push("|------|-------|---------|");
        for (const c of commits.slice(0, 20)) {
          lines.push(`| \`${c.hash}\` | ${c.author} | ${String(c.message || "").slice(0, 80)} |`);
        }
      } else {
        lines.push("_Sin commits._");
      }
      lines.push("");
    } else if (s.name === "git_status") {
      lines.push(`## 🧾 Status de \`${s.input?.repoPath || ""}\``);
      lines.push("");
      lines.push(`- **Branch:** \`${s.result?.branch || "?"}\``);
      lines.push(`- **Clean:** ${s.result?.clean ? "✅ sí" : "❌ no"}`);
      if ((s.result?.modified || []).length) lines.push(`- **Modified:** ${s.result.modified.map((x) => `\`${x}\``).join(", ")}`);
      if ((s.result?.not_added || []).length) lines.push(`- **Untracked:** ${s.result.not_added.map((x) => `\`${x}\``).join(", ")}`);
      lines.push("");
    } else if (s.name === "git_diff") {
      lines.push(`## 🧾 Diff de \`${s.input?.repoPath || ""}\``);
      lines.push("");
      lines.push("```diff");
      lines.push(String(s.result?.diff || "").slice(0, 2500));
      lines.push("```");
      lines.push("");
    } else if (s.name === "list_skills") {
      const count = s.result?.count || 0;
      lines.push(`## 🧩 Skills instaladas: ${count}`);
      lines.push("");
      const skills = s.result?.skills || [];
      if (skills.length) {
        for (const sk of skills) {
          lines.push(`- **${sk.name}**${sk.version ? ` \`v${sk.version}\`` : ""}${sk.description ? ` — ${sk.description}` : ""}`);
        }
      } else {
        lines.push("_No hay skills instaladas actualmente._");
        lines.push("");
        lines.push("> 💡 **Sugerencia:** Puedes instalar una con `install_skill(repoUrl, skillName)`.");
      }
      lines.push("");
    } else if (s.name === "run_shell") {
      lines.push(`## ⚙️ Comando: \`${s.input?.command || ""}\``);
      lines.push("");
      if (s.result?.stdout) {
        lines.push("**Salida:**");
        lines.push("```");
        lines.push(String(s.result.stdout).slice(0, 2000));
        lines.push("```");
      }
      if (s.result?.stderr) {
        lines.push("**Errores:**");
        lines.push("```");
        lines.push(String(s.result.stderr).slice(0, 1000));
        lines.push("```");
      }
      lines.push("");
    } else if (s.name === "git_clone") {
      lines.push(`## 📦 Repositorio clonado`);
      lines.push("");
      lines.push(`- **URL:** ${s.input?.url}`);
      lines.push(`- **Destino:** \`${s.input?.targetDir}\``);
      lines.push("");
    } else if (s.name === "install_skill") {
      lines.push(`## 🧩 Skill instalada`);
      lines.push("");
      lines.push(`- **Nombre:** \`${s.input?.skillName}\``);
      lines.push(`- **Repo:** ${s.input?.repoUrl}`);
      lines.push("");
    }
  }

  if (!any) {
    lines.push("## ⚠️ Sin resultados");
    lines.push("");
    lines.push("_No se obtuvo evidencia de las herramientas._");
  }

  return lines.join("\n").trim();
}

/**
 * Detecta si el texto del modelo contiene afirmaciones contradictorias con la evidencia.
 * Ej: el usuario pidió skills y el modelo habla de Node.js.
 */
function modelTextContradictsEvidence(text = "", steps = []) {
  const t = String(text || "").toLowerCase();

  // Recolectar keywords que las tools DEVOLVIERON
  const evidenceKeywords = new Set();
  for (const s of steps) {
    if (!s.ok) continue;
    if (s.name === "web_search") {
      for (const r of (s.result?.results || [])) {
        String(r.title || "").toLowerCase().split(/\W+/).forEach((w) => w.length > 4 && evidenceKeywords.add(w));
      }
    }
    if (s.name === "list_skills" && s.result?.skills) {
      for (const sk of s.result.skills) {
        String(sk.name || "").toLowerCase().split(/\W+/).forEach((w) => w.length > 2 && evidenceKeywords.add(w));
      }
    }
    if (s.name === "list_external_directory" && s.result?.entries) {
      for (const e of s.result.entries) {
        String(e.name || "").toLowerCase().split(/\W+/).forEach((w) => w.length > 2 && evidenceKeywords.add(w));
      }
    }
  }

  // Detectar palabras que el modelo menciona y NO están en evidencia.
  // Ej: si pidió skills y el modelo habla de "node.js", "lts", "v22..." → contradice
  const suspiciousWords = ["node.js", "nodejs", "v8", "npm registry", "electron version"];
  const mentionsSuspicious = suspiciousWords.some((w) => t.includes(w));

  // Si el usuario pidió skills o listar carpeta, y el modelo habla de versiones de node/electron sin tools relacionadas
  const toolsWereAboutSkillsOrFiles = steps.some((s) =>
    s.ok && ["list_skills", "list_external_directory", "read_external_file"].includes(s.name)
  );
  const noVersionTool = !steps.some((s) => s.ok && s.name === "web_search" && /node|electron/i.test(s.input?.query || ""));

  if (toolsWereAboutSkillsOrFiles && mentionsSuspicious && noVersionTool) {
    return true;
  }
  return false;
}

/**
 * Verifier: arma respuesta final en español; NUNCA meta-verificacion.
 */
function verifyAndReport({ plan, steps, input, finalText = "" }) {
  const mode = plan?.mode || "chat";
  const okTools = (steps || []).filter((s) => s.ok === true);
  const failed = (steps || []).filter((s) => s.ok === false);
  const modelText = String(finalText || "").trim();

  if (mode === "chat") {
    return {
      text: modelText || "Soy el Agent Core de EDITCOREAI. Indica una carpeta a listar, un archivo a explicar, un diagnostico o un cambio concreto.",
      completed: true,
      stopReason: "chat",
    };
  }

  // ============ modo research (consultas extendidas de solo lectura) ============
  if (mode === "research") {
    const extNames = ["web_search", "web_fetch", "git_log", "git_status", "git_diff", "read_external_file", "list_external_directory", "list_skills"];
    const extOk = okTools.filter((s) => extNames.includes(s.name));

    if (extOk.length === 0 && failed.length) {
      return {
        text: `## ⚠️ Consulta fallida\n\nNo se pudo completar la operación:\n\n${failed.slice(0, 5).map((s) => `- **${s.name}:** ${s.error || "error"}`).join("\n")}`,
        completed: false,
        stopReason: "research_failed",
      };
    }

    // v0.4.1: SIEMPRE formatear la evidencia real de las tools como base.
    const evidenceBlock = formatResearchEvidence(steps);

    // Añadir análisis del modelo SOLO si no contradice la evidencia.
    const modelIsClean = modelText
      && !isMetaVerification(modelText)
      && !isUngroundedModelText(modelText)
      && !modelTextContradictsEvidence(modelText, steps)
      && modelText.length > 60
      && !/^#/m.test(modelText) === false; // si empieza con # es porque ya formateó bien

    if (modelIsClean) {
      // El modelo ya produjo markdown bien estructurado y no contradice.
      // Preferimos la evidencia REAL, con el texto del modelo como comentario adicional si aporta.
      return {
        text: evidenceBlock + (modelText && modelText !== evidenceBlock ? `\n\n---\n\n${modelText}` : ""),
        completed: true,
        stopReason: "research_model_augmented",
      };
    }

    // Modelo alucinó o contradice evidencia → devolver SOLO la evidencia real.
    return {
      text: evidenceBlock,
      completed: true,
      stopReason: modelText ? "research_evidence_model_rejected" : "research_evidence",
    };
  }

  if (!okTools.length && failed.length) {
    return {
      text: [
        "## Resultado",
        "",
        "No se pudo completar con tools reales.",
        ...failed.slice(0, 5).map((s) => `- ${s.name}: ${s.error || "fallo"}`),
      ].join("\n"),
      completed: false,
      stopReason: "tools_failed",
    };
  }

  if (mode === "list" || mode === "explain") {
    const grounded = [];
    for (const step of steps) {
      if (step.name === "list_files" && step.ok) grounded.push(...formatList(step));
    }
    for (const step of mergeReadStepsByPath(steps)) {
      grounded.push(...explainFile(step));
    }
    if (modelText && !isMetaVerification(modelText) && !isUngroundedModelText(modelText) && modelText.length > 60) {
      return { text: modelText, completed: true, stopReason: "list_explain_model" };
    }
    if (grounded.length) {
      return {
        text: grounded.join("\n").trim(),
        completed: true,
        stopReason: "list_explain_ok",
      };
    }
    return {
      text: "No obtuve listado ni lectura util. Reintenta con la ruta exacta.",
      completed: false,
      stopReason: "empty_evidence",
    };
  }

  if (mode === "diagnose") {
    const readCount = mergeReadStepsByPath(steps).length;
    const hasReads = readCount > 0;
    let text = modelText;
    let rejectReason = "";
    if (!text) rejectReason = "vacia";
    else if (isMetaVerification(text)) rejectReason = "meta-verificacion";
    else if (isUngroundedModelText(text)) rejectReason = "ungrounded-ipc";
    else if (hasFalseTruncationClaim(text, steps)) {
      text = scrubFalseTruncationClaims(text);
      if (hasFalseTruncationClaim(text, steps) || text.length < 80) {
        rejectReason = "falso-truncamiento";
      }
    }

    if (!rejectReason && text && text.length > 80) {
      const fakeClean = /sin defectos automaticos|Sin correcciones pendientes|Lecturas objetivo OK/i.test(text)
        && readCount < 8;
      if (fakeClean) rejectReason = "cierre-prematuro";
    }

    if (!rejectReason && text && text.length > 80) {
      return {
        text,
        completed: readCount >= 8,
        stopReason: readCount >= 8 ? "diagnose_model" : "diagnose_partial",
      };
    }

    const fallback = diagnoseReport(steps, input?.projectRoot);
    return {
      text: modelText
        ? `${fallback}\n\n_(Sintesis del modelo descartada (${rejectReason || "no-usable"}); se pide CONTINUA, no 'sin bugs'.)_`
        : fallback,
      completed: false,
      stopReason: hasReads ? (readCount >= 8 ? "diagnose_needs_findings" : "diagnose_incomplete") : "diagnose_empty",
    };
  }

  if (mode === "execute") {
    const mutated = hasMutation(steps);
    const mutatedPaths = [...new Set(
      steps
        .filter((s) => ["write_file", "replace_in_file", "delete_file", "apply_diff", "write_external_file", "git_clone"].includes(s.name) && s.ok)
        .map((s) => String(s.input?.path || s.result?.path || s.input?.targetDir || "").replace(/\\/g, "/"))
        .filter(Boolean),
    )];
    const evidence = formatExecuteEvidence(steps);

    if (mutated) {
      const body = (modelText && !isMetaVerification(modelText) && !claimsFakeMutation(modelText, mutatedPaths))
        ? modelText
        : "Se aplicaron cambios reales en disco.";
      const text = /## Evidencia de correccion/i.test(body)
        ? body
        : [body, "", evidence].join("\n");
      return {
        text,
        completed: true,
        stopReason: "execute_ok",
      };
    }

    if (claimsFakeMutation(modelText, [])) {
      return {
        text: [
          "## Resultado de ejecucion",
          "",
          "No hubo mutacion en disco.",
          "El modelo invento correcciones; fueron descartadas.",
          "Indica el path exacto y el cambio (ej. crear SMOKE_AGENT_CORE.txt) y escribe PROCEDE.",
        ].join("\n"),
        completed: true,
        stopReason: "execute_no_mutation_fake_rejected",
      };
    }

    if (modelText && !isMetaVerification(modelText) && /no hay (?:mutaciones|correcciones|defectos)|sin defectos|sin correcciones/i.test(modelText)) {
      return {
        text: modelText,
        completed: true,
        stopReason: "execute_no_defect",
      };
    }

    return {
      text: [
        "## Resultado de ejecucion",
        "",
        "No hubo mutacion en disco.",
        "Si no hay defecto real, indica otro cambio concreto.",
        "Si hay defecto, reintenta PROCEDE con el path y el arreglo deseado.",
      ].join("\n"),
      completed: true,
      stopReason: "execute_no_mutation",
    };
  }

  return {
    text: modelText || "Tarea procesada por Agent Core.",
    completed: true,
    stopReason: "done",
  };
}

function isSufficient(state = {}, prompt = "") {
  if (state?.mode === "chat") return false;
  if (state?.mode === "list") {
    return Array.isArray(state?.evidence) && state.evidence.some((e) => e.op === "list" || e.name === "list_files");
  }
  if (state?.mode === "diagnose" || state?.mode === "analysis") {
    return Array.isArray(state?.evidence) && state.evidence.filter((e) => e.op === "read" || e.name === "read_file").length >= 2;
  }
  if (state?.mode === "research") {
    return Array.isArray(state?.evidence) && state.evidence.length > 0;
  }
  return false;
}

module.exports = {
  verifyAndReport,
  formatList,
  explainFile,
  formatExecuteEvidence,
  formatResearchEvidence,
  diagnoseReport,
  mergeReadStepsByPath,
  hasMutation,
  claimsFakeMutation,
  isMetaVerification,
  isUngroundedModelText,
  hasFalseTruncationClaim,
  scrubFalseTruncationClaims,
  isSufficient,
  modelTextContradictsEvidence,
};