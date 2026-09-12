"use strict";

/**
 * Tab prediction: paths del indice + sugerencias de codigo (simbolos / snippets locales).
 */

function collectCandidates(projectRoot, prompt = "", { index = null, history = [] } = {}) {
  const text = String(prompt || "");
  const token = (text.match(/(?:^|\s)(@?[\w./-]*)$/) || [])[1] || "";
  const out = [];
  const seen = new Set();

  const push = (value, source) => {
    const v = String(value || "");
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({ text: v, source });
  };

  // Completar path @...
  if (token && token.length >= 2) {
    const q = token.replace(/^@/, "").toLowerCase();
    for (const file of index?.files || []) {
      const p = String(file.path || "");
      if (!p.toLowerCase().includes(q) && !p.toLowerCase().startsWith(q)) continue;
      push(token.startsWith("@") && !p.startsWith("@") ? `@${p}` : p, "index");
      if (out.length >= 8) break;
    }
    for (const msg of history.slice(-20)) {
      const content = String(msg?.content || "");
      for (const m of content.matchAll(/\b((?:resources|src|app|runtime)\/[\w./-]+\.[\w]+)\b/gi)) {
        if (!String(m[1]).toLowerCase().includes(q)) continue;
        push(token.startsWith("@") ? `@${m[1]}` : m[1], "history");
        if (out.length >= 12) break;
      }
    }
  }

  // Prediccion de codigo: ultima linea incompleta
  const lines = text.split(/\r?\n/);
  const last = String(lines[lines.length - 1] || "");
  const codeToken = (last.match(/([A-Za-z_$][\w$]*)$/) || [])[1] || "";
  if (codeToken.length >= 2) {
    const q = codeToken.toLowerCase();
    for (const sym of index?.symbols || []) {
      const name = String(sym.name || "");
      if (!name.toLowerCase().startsWith(q)) continue;
      let suggestion = name;
      if (sym.kind === "function" || sym.kind === "method" || sym.kind === "hook") {
        suggestion = `${name}(`;
      } else if (sym.kind === "class" || sym.kind === "component") {
        suggestion = name;
      }
      // Reemplazar solo el token final de la ultima linea
      const completedLine = last.replace(/([A-Za-z_$][\w$]*)$/, suggestion);
      const full = [...lines.slice(0, -1), completedLine].join("\n");
      push(full, `symbol:${sym.kind || "id"}`);
      if (out.length >= 16) break;
    }
    // Snippets comunes
    const snippets = [
      { re: /^async\s+f?$/, text: "async function " },
      { re: /^expor?$/, text: "export function " },
      { re: /^cons?$/, text: "const " },
      { re: /^try$/, text: "try {\n  \n} catch (error) {\n  \n}" },
    ];
    for (const sn of snippets) {
      if (sn.re.test(codeToken)) {
        const completedLine = last.replace(/([A-Za-z_$][\w$]*)$/, sn.text);
        push([...lines.slice(0, -1), completedLine].join("\n"), "snippet");
      }
    }
  }

  return out.slice(0, 12);
}

function applyPrediction(prompt = "", prediction = "") {
  const text = String(prompt || "");
  const pred = String(prediction || "");
  if (!pred) return text;
  // Si la prediccion es el prompt completo (codigo), usarla tal cual
  if (pred.includes("\n") || pred.length > text.length) return pred;
  return text.replace(/(?:^|\s)(@?[\w./-]*)$/, (m) => {
    const lead = m.match(/^\s/) ? m[0] : "";
    return `${lead}${pred}`;
  });
}

module.exports = {
  collectCandidates,
  applyPrediction,
};
