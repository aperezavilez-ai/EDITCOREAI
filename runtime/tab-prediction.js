"use strict";

/**
 * Tab / ghost-text prediction — ultra-low-latency local candidates.
 * No cloud model: index symbols + paths + snippets only.
 */

function collectCandidates(projectRoot, prompt = "", { index = null, history = [] } = {}) {
  const started = Date.now();
  const text = String(prompt || "");
  const token = (text.match(/(?:^|\s)(@?[\w./-]*)$/) || [])[1] || "";
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

  if (token && token.length >= 2) {
    const q = token.replace(/^@/, "").toLowerCase();
    for (const file of index?.files || []) {
      const p = String(file.path || "");
      if (!p.toLowerCase().includes(q) && !p.toLowerCase().startsWith(q)) continue;
      const full = token.startsWith("@") && !p.startsWith("@") ? `@${p}` : p;
      const suffix = full.slice(token.length);
      push(full, "index", { ghostSuffix: suffix, replaceFrom: text.length - token.length });
      if (out.length >= 8) break;
    }
    for (const msg of history.slice(-20)) {
      const content = String(msg?.content || "");
      for (const m of content.matchAll(/\b((?:resources|src|app|runtime)\/[\w./-]+\.[\w]+)\b/gi)) {
        if (!String(m[1]).toLowerCase().includes(q)) continue;
        const full = token.startsWith("@") ? `@${m[1]}` : m[1];
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
  if (codeToken.length >= 2) {
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
  return text.replace(/(?:^|\s)(@?[\w./-]*)$/, (m) => {
    const lead = m.match(/^\s/) ? m[0] : "";
    return `${lead}${pred}`;
  });
}

function ghostFromCandidates(prompt = "", candidates = []) {
  const first = Array.isArray(candidates) ? candidates[0] : null;
  if (!first) return { ghost: "", accept: "" };
  const text = String(prompt || "");
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
};
