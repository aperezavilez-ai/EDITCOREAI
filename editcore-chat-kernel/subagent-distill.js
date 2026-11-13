"use strict";

/**
 * [EDITCORE-V510-B5] DESTILADOR DE SUBAGENTES Y DE CIERRES.
 *
 * Antes de la Fase B, los informes de los subagentes volvían como
 * texto de herramienta y MORÍAN en el turno: nadie los escribía en el
 * expediente ni en el Cerebro, y el `brainRemember` del cierre copiaba
 * el RELATO del turno (pedido + 1.200 caracteres de prosa) en vez de
 * su destilado. Este módulo es el destilador DETERMINISTA (sin modelo,
 * sin invención): extrae de un informe lo que el expediente sabe
 * guardar — zona mapeada, archivos clave, conclusiones con su línea —
 * y del cierre de un turno, los hechos (aplicado / verificado /
 * descartado) que el Cerebro debe recordar. Todo asiento lleva su
 * procedencia («subagente <rol> · <target>»): la memoria compartida
 * distingue lo que vio un subagente de lo que hizo el agente oficial.
 */

const FILE_MENTION_RE = /(?:^|[\s`"'(\[])((?:[\w.-]+\/)+[\w.-]+\.[a-z]{2,5}|[\w.-]+\.(?:js|jsx|ts|tsx|mjs|cjs|py|json|md|css|scss|html|sql|yml|yaml))(?=$|[\s`"' )\]:,;])/g;

function clip(text, max) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

// Archivos clave mencionados en un informe (rutas con extensión),
// únicos y en orden de aparición.
function extractKeyFiles(text, max = 8) {
  const out = [];
  const seen = new Set();
  const src = String(text || "");
  FILE_MENTION_RE.lastIndex = 0;
  let m;
  while ((m = FILE_MENTION_RE.exec(src)) !== null) {
    const file = String(m[1] || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!file || file.length > 160) continue;
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
    if (out.length >= max) break;
  }
  return out;
}

// Conclusiones: las primeras líneas con sustancia del informe (no
// encabezados de mapa ni líneas vacías), recortadas. Determinista: no
// resume con palabras nuevas; cita las líneas del propio informe.
function extractConclusions(text, max = 3) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const line = String(raw || "").trim().replace(/^[-*•#>]+\s*/, "");
    if (line.length < 25) continue;
    if (/^(mapa de|delegación en paralelo|evidencia base|archivos leídos|raíz|carpetas)/i.test(line)) continue;
    out.push(clip(line, 220));
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Destila el informe de UN subagente a asientos del expediente:
 *  - facts: hechos `read` por archivo clave, con procedencia en `why`,
 *    y un hecho-resumen con el texto destilado (kind «subagent»).
 *  - decisionText: la conclusión principal como asiento de decisión
 *    del expediente (noteDecision), con procedencia. Puede ser "".
 */
function distillSubagentReport({ role = "", target = "", question = "", text = "", ok = true } = {}) {
  const roleName = String(role || "subagente").trim() || "subagente";
  const zone = String(target || "").trim();
  const provenance = `subagente ${roleName}${zone ? ` · ${zone}` : ""}${question ? ` · ${clip(question, 60)}` : ""}`;
  if (ok === false || !String(text || "").trim()) {
    return { provenance, facts: [], decisionText: "" };
  }
  const files = extractKeyFiles(text);
  const conclusions = extractConclusions(text);
  const facts = files.map((file) => ({
    kind: "read",
    file,
    why: clip(`mapeado por ${provenance}`, 160),
  }));
  const summary = conclusions[0] || clip(text, 220);
  if (summary) {
    facts.push({
      kind: "subagent",
      file: files[0] || "",
      text: clip(`${provenance}: ${summary}`, 300),
    });
  }
  return {
    provenance,
    facts,
    decisionText: conclusions.length ? clip(`${provenance}: ${conclusions[0]}`, 400) : "",
  };
}

/**
 * Escribe en el expediente el destilado de una oleada de subagentes
 * (resultados de runDelegatedTasks o el resultado de un invoke). Nunca
 * lanza: la memoria compartida no puede tumbar el despacho.
 * Devuelve cuántos asientos se escribieron.
 */
function recordSubagentDistillates(projectRoot, results = []) {
  if (!projectRoot || !Array.isArray(results) || !results.length) return 0;
  let written = 0;
  try {
    const tm = require("./thread-memory");
    for (const r of results) {
      if (!r) continue;
      const d = distillSubagentReport({
        role: r.role || r.effectiveRole || r.requestedRole || "",
        target: r.target || "",
        question: r.question || "",
        text: r.text || r.summary || r.report || "",
        ok: r.ok !== false,
      });
      if (d.facts.length) { tm.noteFacts(projectRoot, d.facts); written += d.facts.length; }
      if (d.decisionText) { tm.noteDecision(projectRoot, d.decisionText); written += 1; }
    }
  } catch { /* la memoria nunca tumba el turno */ }
  return written;
}

/**
 * [EDITCORE-V510-B5] Destilado del cierre de un turno de EJECUCIÓN
 * para el Cerebro (brainRemember): en vez de copiar el relato, se
 * extraen los HECHOS del turno desde sus pasos — qué se aplicó, qué
 * verificación pasó o falló, qué se descartó — y un extracto breve
 * del cierre. Es lo que el próximo turno (y los subagentes, vía la
 * memoria compartida) necesitan recordar: hechos, no prosa.
 */
function distillTurnForBrain({ userText = "", steps = [], finalText = "" } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  const applied = [];
  const seenApplied = new Set();
  const failed = [];
  let verifiedOk = 0;
  let verifiedFail = 0;
  for (const s of list) {
    if (!s) continue;
    if ((s.name === "write_file" || s.name === "replace_in_file" || s.name === "scaffold_project")
      && s.ok !== false && s.result?.ok !== false && !s.result?.unchanged) {
      const rel = String(s.input?.path || s.result?.path || "").replace(/\\/g, "/");
      if (rel && !seenApplied.has(rel)) { seenApplied.add(rel); applied.push(rel); }
    }
    if (s.name === "invoke_subagent" && Array.isArray(s.result?.applied)) {
      for (const p of s.result.applied) {
        if (p?.ok === true && p?.planned !== true && p?.path && !seenApplied.has(p.path)) {
          seenApplied.add(p.path);
          applied.push(String(p.path).replace(/\\/g, "/"));
        }
      }
    }
    if (s.name === "capture_preview_screenshot") {
      if (s.result?.renderOk === true) verifiedOk += 1;
      else if (s.ok !== false) verifiedFail += 1;
    }
    if (s.ok === false || s.result?.ok === false) {
      const err = clip(s.result?.error || s.result?.stderr || "", 120);
      if (err) failed.push(`${s.name}: ${err}`);
    }
  }
  const lines = [`Pedido: ${clip(userText, 300)}`];
  lines.push(applied.length
    ? `Aplicado (hechos del kernel): ${applied.slice(0, 10).join(", ")}`
    : "Aplicado: nada (el kernel no registró escrituras en este turno).");
  if (verifiedOk || verifiedFail) lines.push(`Verificación visual: ${verifiedOk} captura(s) con render OK, ${verifiedFail} sin render confirmado.`);
  if (failed.length) lines.push(`Descartado/falló: ${failed.slice(0, 4).join(" · ")}`);
  const close = clip(finalText, 500);
  if (close) lines.push(`Cierre del agente: ${close}`);
  return lines.join("\n").slice(0, 2000);
}

module.exports = {
  distillSubagentReport,
  recordSubagentDistillates,
  distillTurnForBrain,
  extractKeyFiles,
  extractConclusions,
};
