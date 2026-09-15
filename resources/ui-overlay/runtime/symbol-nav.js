"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Go-to-definition heurístico (sin LSP completo): busca definiciones en el proyecto.
 */
function walkFiles(root, { maxFiles = 400, maxDepth = 6 } = {}) {
  const out = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", "release", ".next", "coverage"]);
  function walk(dir, depth) {
    if (out.length >= maxFiles || depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (out.length >= maxFiles) break;
      const name = ent.name;
      if (name.startsWith(".") && name !== ".editcore") continue;
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) walk(full, depth + 1);
      else if (/\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|rs|java)$/i.test(name)) out.push(full);
    }
  }
  walk(root, 0);
  return out;
}

function gotoDefinition(projectRoot, symbol, { fromPath = "", resolveInside } = {}) {
  const needle = String(symbol || "").trim();
  if (!needle || !/^[A-Za-z_$][\w$]*$/.test(needle)) return null;
  const root = String(projectRoot || "");
  if (!root || typeof resolveInside !== "function") return null;

  const patterns = [
    new RegExp(`(?:function|class|const|let|var|type|interface|enum)\\s+${needle}\\b`),
    new RegExp(`(?:export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|const|let|var))\\s+${needle}\\b`),
    new RegExp(`(?:def|class)\\s+${needle}\\b`),
    new RegExp(`${needle}\\s*=\\s*(?:async\\s*)?(?:\\(|function\\b)`),
  ];

  const prefer = fromPath
    ? resolveInside(root, String(fromPath).replace(/\\/g, "/"))
    : "";
  const files = walkFiles(root);
  if (prefer && fs.existsSync(prefer)) {
    files.unshift(prefer);
  }

  const seen = new Set();
  for (const abs of files) {
    if (seen.has(abs)) continue;
    seen.add(abs);
    let text = "";
    try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!patterns.some((re) => re.test(line))) continue;
      const col = Math.max(1, line.indexOf(needle) + 1);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (prefer && abs === prefer && i + 1 === 0) continue;
      return { path: rel, line: i + 1, column: col, symbol: needle };
    }
  }
  return null;
}

module.exports = { gotoDefinition, walkFiles };
