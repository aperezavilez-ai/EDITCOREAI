"use strict";

/**
 * Tab / ghost-text prediction — ultra-low-latency local candidates.
 * No cloud model: index symbols + paths + snippets only.
 */

function looksLikePathToken(token = "") {
  const t = String(token || "");
  if (!t) return false;
  if (t.startsWith("@")) return true;
  if (t.includes("/") || t.includes("\\") || t.includes(".")) return true;
  if (/^(src|app|runtime|scripts|lib|components|pages|api|public|assets)[/\\-]/i.test(t)) return true;
  return false;
}

function looksLikeNaturalLanguage(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) return false;
  // Frases con espacios / puntuación → no sugerir rutas a medias.
  if (/\s/.test(text) && !looksLikePathToken((text.match(/(?:^|\s)(@?[\w./\\-]*)$/) || [])[1] || "")) {
    return true;
  }
  if (/^(hola|hi|hello|hey|buenas|gracias|por\s*qu[eé]|como|qué|que)\b/i.test(text)) return true;
  return false;
}

function basenameOf(p = "") {
  const norm = String(p || "").replace(/\\/g, "/");
  const parts = norm.split("/");
  return parts[parts.length - 1] || norm;
}

function collectCandidates(projectRoot, prompt = "", { index = null, history = [] } = {}) {
  const started = Date.now();
  const text = String(prompt || "");
  const token = (text.match(/(?:^|\s)(@?[\w./\\-]*)$/) || [])[1] || "";
  const out = [];
  const seen = new Set();

  const push = (value, source, { ghostSuffix = "", replaceFrom = -1 } = {}) => {
    const v = String(value || "");
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push({
      text: v,
      source,
      ghostSuffix: String(ghostSuffix || ""),
      replaceFrom: Number(replaceFrom),
    });
  };

  const allowPathSuggest = token.length >= 3 && looksLikePathToken(token) && !looksLikeNaturalLanguage(text);

  if (allowPathSuggest) {
    const q = token.replace(/^@/, "").toLowerCase().replace(/\\/g, "/");
    for (const file of index?.files || []) {
      const p = String(file.path || "").replace(/\\/g, "/");
      const base = basenameOf(p).toLowerCase();
      const pathLower = p.toLowerCase();
      const prefixOk = pathLower.startsWith(q) || base.startsWith(q);
      // includes solo si el token es suficientemente largo (evita "por" → domain-report)
      const includesOk = q.length >= 5 && (pathLower.includes(q) || base.includes(q));
      if (!prefixOk && !includesOk) continue;
      const full = token.startsWith("@") && !p.startsWith("@") ? `@${p}` : p;
      let suffix = "";
      if (full.toLowerCase().startsWith(token.toLowerCase())) {
        suffix = full.slice(token.length);
      } else if (base.startsWith(q)) {
        // Completar solo el basename si el token no es prefijo de la ruta completa.
        suffix = base.slice(q.length);
        const acceptBase = token.startsWith("@") ? `@${basenameOf(p)}` : basenameOf(p);
        push(acceptBase, "index-base", {
          ghostSuffix: acceptBase.toLowerCase().startsWith(token.toLowerCase())
            ? acceptBase.slice(token.length)
            : suffix,
          replaceFrom: text.length - token.length,
        });
        if (out.length >= 8) break;
        continue;
      } else {
        continue;
      }
      push(full, "index", { ghostSuffix: suffix, replaceFrom: text.length - token.length });
      if (out.length >= 8) break;
    }
    for (const msg of history.slice(-20)) {
      const content = String(msg?.content || "");
      for (const m of content.matchAll(/\b((?:resources|src|app|runtime|scripts)\/[\w./-]+\.[\w]+)\b/gi)) {
        const pathHit = String(m[1] || "");
        const pathLower = pathHit.toLowerCase();
        const base = basenameOf(pathHit).toLowerCase();
        if (!(pathLower.startsWith(q) || base.startsWith(q) || (q.length >= 5 && pathLower.includes(q)))) continue;
        const full = token.startsWith("@") ? `@${pathHit}` : pathHit;
        if (!full.toLowerCase().startsWith(token.toLowerCase())) continue;
        push(full, "history", {
          ghostSuffix: full.slice(token.length),
          replaceFrom: text.length - token.length,
        });
        if (out.length >= 12) break;
      }
    }
  }

  const lines = text.split(/\r?\n/);
  const last = String(lines[lines.length - 1] || "");
  const codeToken = (last.match(/([A-Za-z_$][\w$]*)$/) || [])[1] || "";
  const allowSymbolSuggest = codeToken.length >= 2 && !looksLikeNaturalLanguage(text);
  if (allowSymbolSuggest) {
    const q = codeToken.toLowerCase();
    for (const sym of index?.symbols || []) {
      const name = String(sym.name || "");
      if (!name.toLowerCase().startsWith(q)) continue;
      let suggestion = name;
      if (sym.kind === "function" || sym.kind === "method" || sym.kind === "hook") {
        suggestion = `${name}(`;
      }
      const completedLine = last.replace(/([A-Za-z_$][\w$]*)$/, suggestion);
      const full = [...lines.slice(0, -1), completedLine].join("\n");
      push(full, `symbol:${sym.kind || "id"}`, {
        ghostSuffix: suggestion.slice(codeToken.length),
        replaceFrom: text.length - codeToken.length,
      });
      if (out.length >= 16) break;
    }
    const snippets = [
      { re: /^async\s+f?$/, text: "async function " },
      { re: /^expor?$/, text: "export function " },
      { re: /^cons?$/, text: "const " },
      { re: /^try$/, text: "try {\n  \n} catch (error) {\n  \n}" },
      { re: /^funct?$/, text: "function " },
      { re: /^awa?$/, text: "await " },
    ];
    for (const sn of snippets) {
      if (sn.re.test(codeToken)) {
        const completedLine = last.replace(/([A-Za-z_$][\w$]*)$/, sn.text);
        const full = [...lines.slice(0, -1), completedLine].join("\n");
        push(full, "snippet", {
          ghostSuffix: sn.text.slice(Math.min(codeToken.length, sn.text.length)),
          replaceFrom: text.length - codeToken.length,
        });
      }
    }
  }

  return {
    candidates: out.slice(0, 12),
    latencyMs: Date.now() - started,
    engine: "local-index+snippets",
  };
}

function applyPrediction(prompt = "", prediction = "") {
  const text = String(prompt || "");
  const pred = String(prediction || "");
  if (!pred) return text;
  if (pred.includes("\n") || pred.length > text.length) return pred;
  return text.replace(/(?:^|\s)(@?[\w./\\-]*)$/, (m) => {
    const lead = m.match(/^\s/) ? m[0] : "";
    return `${lead}${pred}`;
  });
}

function ghostFromCandidates(prompt = "", candidates = []) {
  const first = Array.isArray(candidates) ? candidates[0] : null;
  if (!first) return { ghost: "", accept: "" };
  const text = String(prompt || "");
  if (looksLikeNaturalLanguage(text) && !looksLikePathToken((text.match(/(?:^|\s)(@?[\w./\\-]*)$/) || [])[1] || "")) {
    return { ghost: "", accept: "" };
  }
  if (first.ghostSuffix) {
    return { ghost: String(first.ghostSuffix), accept: String(first.text || "") };
  }
  const full = String(first.text || "");
  if (full.startsWith(text) && full.length > text.length) {
    return { ghost: full.slice(text.length), accept: full };
  }
  return { ghost: "", accept: full };
}

module.exports = {
  collectCandidates,
  applyPrediction,
  ghostFromCandidates,
  looksLikePathToken,
  looksLikeNaturalLanguage,
};
