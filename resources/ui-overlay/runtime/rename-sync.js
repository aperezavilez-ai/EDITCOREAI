"use strict";

/**
 * Rename sync seguro: solo path exacto + imports relativos al archivo renombrado.
 * NUNCA reemplaza basenames cortos globales (app, index, main, etc.).
 */

const fs = require("node:fs");
const path = require("node:path");

const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|json|md|html|css|vue|svelte)$/i;
const SKIP = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  "app.asar", "JarvisAI", "brain-seed", "release", "win-unpacked",
]);
const DANGEROUS_BASE = new Set([
  "app", "main", "index", "src", "lib", "test", "config", "package", "server", "client",
]);

function normalizeRel(p = "") {
  return String(p || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function walkTextFiles(root, max = 2500, out = []) {
  function walk(dir, depth = 0) {
    if (out.length >= max || depth > 10) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= max) break;
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full, depth + 1); continue; }
      if (!entry.isFile() || !TEXT_EXT.test(entry.name)) continue;
      try {
        if (fs.statSync(full).size > 400_000) continue;
      } catch { continue; }
      out.push(full);
    }
  }
  walk(root);
  return out;
}

function escapeRe(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativeImportCandidates(fromFileRel, targetRel) {
  const fromDir = path.posix.dirname(normalizeRel(fromFileRel));
  let rel = path.posix.relative(fromDir === "." ? "" : fromDir, normalizeRel(targetRel));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  const noExt = rel.replace(/\.[^.]+$/, "");
  return [...new Set([rel, noExt])];
}

function replaceExact(content, fromToken, toToken) {
  if (!fromToken || fromToken === toToken || !content.includes(fromToken)) return content;
  return content.split(fromToken).join(toToken);
}

function renameSyncFile(projectRoot, fromRel, toRel, { dryRun = false, updateRefs = true } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const from = normalizeRel(fromRel);
  const to = normalizeRel(toRel);
  if (!from || !to) throw new Error("rename requiere from y to.");
  if (from.includes("..") || to.includes("..")) throw new Error("Ruta invalida.");
  const fromAbs = path.join(root, ...from.split("/"));
  const toAbs = path.join(root, ...to.split("/"));
  if (!fs.existsSync(fromAbs) || !fs.statSync(fromAbs).isFile()) {
    throw new Error(`No existe origen: ${from}`);
  }
  if (fs.existsSync(toAbs)) throw new Error(`Destino ya existe: ${to}`);

  const fromBase = path.basename(from);
  const toBase = path.basename(to);
  const fromNoExt = fromBase.replace(/\.[^.]+$/, "");
  const allowBareBasename = fromNoExt.length >= 8 && !DANGEROUS_BASE.has(fromNoExt.toLowerCase());

  const refUpdates = [];
  if (updateRefs) {
    for (const file of walkTextFiles(root)) {
      const rel = normalizeRel(path.relative(root, file));
      if (rel === from) continue;
      let content = "";
      try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
      let next = content;

      // 1) Path absoluto relativo al proyecto (siempre).
      next = replaceExact(next, from, to);

      // 2) Solo imports relativos que apuntan a ESTE archivo desde ESTE referenciador.
      const fromCands = relativeImportCandidates(rel, from);
      const toCands = relativeImportCandidates(rel, to);
      for (let i = 0; i < fromCands.length; i++) {
        const a = fromCands[i];
        const b = toCands[i] || toCands[0];
        if (!a || !b || a === b) continue;
        // solo dentro de comillas
        const re = new RegExp(`(['"\`])${escapeRe(a)}\\1`, "g");
        next = next.replace(re, `$1${b}$1`);
      }

      // 3) Basename largo y no peligroso, solo con extension del archivo origen.
      if (allowBareBasename && fromBase !== toBase) {
        const reBase = new RegExp(`(['"\`])([^'"\`]*?/)?${escapeRe(fromBase)}\\1`, "g");
        next = next.replace(reBase, (m, q, prefix = "") => `${q}${prefix || ""}${toBase}${q}`);
      }

      if (next !== content) {
        refUpdates.push({ path: rel, bytes: next.length });
        if (!dryRun) fs.writeFileSync(file, next, "utf8");
      }
    }
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
    fs.renameSync(fromAbs, toAbs);
  }

  return {
    ok: true,
    dryRun: dryRun === true,
    from,
    to,
    refsUpdated: refUpdates.length,
    files: refUpdates.slice(0, 40),
    note: allowBareBasename
      ? ""
      : "Basename corto/peligroso: solo se actualizaron paths exactos e imports relativos.",
  };
}

function renameSyncSymbol(projectRoot, input = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const fileRel = normalizeRel(input.file || input.path || "");
  const oldName = String(input.oldName || input.fromSymbol || input.symbol || "").trim();
  const newName = String(input.newName || input.toSymbol || "").trim();
  const dryRun = input.dryRun === true;
  if (!fileRel || !oldName || !newName) {
    throw new Error("rename symbol requiere file, oldName y newName.");
  }
  if (!/^[A-Za-z_$][\w$]*$/.test(oldName) || !/^[A-Za-z_$][\w$]*$/.test(newName)) {
    throw new Error("Nombres de simbolo invalidos.");
  }
  if (oldName === newName) return { ok: true, dryRun, changed: 0, files: [] };

  let ts;
  try {
    ts = require("typescript");
  } catch {
    throw new Error("TypeScript no disponible para rename profundo.");
  }

  const fileAbs = path.join(root, ...fileRel.split("/"));
  if (!fs.existsSync(fileAbs)) throw new Error(`No existe ${fileRel}`);

  // Prefer nearest tsconfig; fallback a script host sobre archivos del proyecto.
  let configPath = ts.findConfigFile(path.dirname(fileAbs), ts.sys.fileExists, "tsconfig.json");
  if (!configPath) configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");

  const compilerOptions = { allowJs: true, checkJs: false, jsx: ts.JsxEmit.ReactJSX };
  let rootFileNames = [];
  if (configPath) {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
    Object.assign(compilerOptions, parsed.options || {});
    rootFileNames = parsed.fileNames || [];
  }
  if (!rootFileNames.length) {
    rootFileNames = walkTextFiles(root, 800)
      .filter((f) => /\.(ts|tsx|js|jsx)$/i.test(f))
      .slice(0, 400);
  }
  if (!rootFileNames.includes(fileAbs)) rootFileNames.push(fileAbs);

  const host = ts.createCompilerHost(compilerOptions);
  const program = ts.createProgram(rootFileNames, compilerOptions, host);
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileAbs);
  if (!source) throw new Error(`TypeScript no pudo cargar ${fileRel}`);

  let targetNode = null;
  function visit(node) {
    if (targetNode) return;
    if (ts.isIdentifier(node) && node.text === oldName) {
      const parent = node.parent;
      if (
        ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent)
        || ts.isTypeAliasDeclaration(parent) || ts.isEnumDeclaration(parent) || ts.isMethodDeclaration(parent)
        || ts.isPropertyDeclaration(parent) || ts.isVariableDeclaration(parent)
        || (ts.isParameter(parent) && parent.name === node)
      ) {
        targetNode = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!targetNode) throw new Error(`No se encontro declaracion de simbolo '${oldName}' en ${fileRel}`);

  const symbol = checker.getSymbolAtLocation(targetNode);
  if (!symbol) throw new Error(`No se resolvio simbolo '${oldName}'.`);

  const locations = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!sf.fileName.startsWith(root) && path.resolve(sf.fileName) !== fileAbs) continue;
    function collect(node) {
      if (ts.isIdentifier(node) && node.text === oldName) {
        const sym = checker.getSymbolAtLocation(node);
        const resolved = sym && (sym.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(sym) : sym;
        const target = (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
        if (resolved === target || sym === symbol) {
          locations.push({ file: sf.fileName, start: node.getStart(sf), end: node.getEnd() });
        }
      }
      ts.forEachChild(node, collect);
    }
    collect(sf);
  }

  const byFile = new Map();
  for (const loc of locations) {
    const list = byFile.get(loc.file) || [];
    list.push(loc);
    byFile.set(loc.file, list);
  }

  const changed = [];
  for (const [file, locs] of byFile) {
    let content = fs.readFileSync(file, "utf8");
    const ordered = locs.sort((a, b) => b.start - a.start);
    for (const loc of ordered) {
      content = content.slice(0, loc.start) + newName + content.slice(loc.end);
    }
    const rel = normalizeRel(path.relative(root, file));
    changed.push({ path: rel, edits: locs.length });
    if (!dryRun) fs.writeFileSync(file, content, "utf8");
  }

  return {
    ok: true,
    kind: "symbol",
    dryRun,
    oldName,
    newName,
    file: fileRel,
    refsUpdated: locations.length,
    files: changed.slice(0, 80),
  };
}

module.exports = {
  renameSyncFile,
  renameSyncSymbol,
  walkTextFiles,
  normalizeRel,
  DANGEROUS_BASE,
};
