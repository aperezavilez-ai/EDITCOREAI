"use strict";

/**
 * Chequeos forenses deterministas. Cada hallazgo sale de un comando real o de un análisis
 * reproducible del disco, con archivo, línea y evidencia. El modelo solo los explica.
 */

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { builtinModules } = require("node:module");

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", "coverage", "release", "vendor", "target",
  "bower_components", "__pycache__", "venv", "fixtures", "__fixtures__", "__mocks__",
]);
// Copias que se montan sobre otra raíz en producción: sus rutas relativas no se resuelven desde su carpeta.
// Ejemplos de skills: material de referencia, no código que la app ejecute.
const SKIP_PATHS = ["resources/ui-overlay", "brain-seed/skills"];
// Respaldos y copias viejas: suelen estar incompletos y no son código que se ejecute.
const BACKUP_DIR = /^(_*(backups?|respaldos?|copias?|old|archive|archivo)([-_ .].*)?|.*\.(bak|old|orig))$/i;
const MAX_FILES = 4000;
const MAX_FILE_BYTES = 1_500_000;
const MAX_ESM_CHECKS = 150;
const OUTPUT_CAP = 400_000;
const JSONC_NAMES = /^(tsconfig.*|jsconfig.*|\.eslintrc.*|devcontainer|.*\.code-workspace)\.json$/i;
const TRANSPILE_DEPS = [
  "react", "preact", "@babel/core", "typescript", "vite", "webpack", "next", "esbuild",
  "flow-bin", "parcel", "rollup", "@vitejs/plugin-react", "vue", "svelte", "solid-js",
];
const TRANSPILE_SUSPECT = /Unexpected token '(<|@|:)'|Unexpected identifier|Invalid or unexpected token|Unexpected strict mode reserved word|Unexpected token 'type'|Unexpected token 'interface'/i;
const NPM_DEFAULT_TEST = /no test specified/i;
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), "electron"]);

const SEVERITY_ORDER = { error: 0, warning: 1 };

function rel(root, abs) {
  return path.relative(root, abs).replace(/\\/g, "/");
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function stripAnsi(text = "") {
  return String(text || "").replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");
}

function tailLines(text = "", n = 20) {
  return stripAnsi(text).split(/\r?\n/).filter((l) => l.trim()).slice(-n).join("\n");
}

// Exclusiones explícitas (plantillas, ejemplos): package.json "editcoreForensic.skip" o .editcore/forensic.json.
// Siempre se informan en el reporte.
function loadProjectConfig(root, pkg) {
  const local = readJson(path.join(root, ".editcore", "forensic.json")) || {};
  const fromPkg = pkg?.editcoreForensic || {};
  const skip = [...(Array.isArray(fromPkg.skip) ? fromPkg.skip : []), ...(Array.isArray(local.skip) ? local.skip : [])]
    .map((s) => String(s).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  return { skip: [...new Set(skip)] };
}

function walkProject(root, extraSkip = []) {
  const skipPaths = [...SKIP_PATHS, ...extraSkip];
  const files = [];
  const autoExcluded = [];
  let truncated = false;
  (function walk(dir) {
    if (files.length >= MAX_FILES) { truncated = true; return; }
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) { truncated = true; return; }
      const name = entry.name;
      const abs = path.join(dir, name);
      const relPath = rel(root, abs);
      if (entry.isDirectory()) {
        if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
        if (skipPaths.some((p) => relPath === p || relPath.startsWith(`${p}/`))) {
          if (SKIP_PATHS.includes(relPath)) autoExcluded.push(relPath);
          continue;
        }
        if (BACKUP_DIR.test(name)) { autoExcluded.push(relPath); continue; }
        walk(abs);
      } else if (entry.isFile()) {
        let size = 0;
        try { size = fs.statSync(abs).size; } catch { continue; }
        files.push({ abs, rel: relPath, ext: path.extname(name).toLowerCase(), name, size });
      }
    }
  })(root);
  return { files, truncated, autoExcluded };
}

// ---------------------------------------------------------------------------
// Lexer mínimo: encuentra especificadores de módulo en código real (no en strings,
// comentarios ni fixtures) y marca si están dentro de un try/catch (carga opcional).
// ---------------------------------------------------------------------------
const REGEX_PREV = /(^|[(,=:[!&|?{};+\-*%<>~^]|\b(return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await))\s*$/;
const SPEC_PREV = /(\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s*|\bimport\s+|\bexport\s*\*\s*from\s*)$/;

function scanModuleSpecifiers(source = "") {
  const specs = [];
  const src = String(source || "");
  const braces = [];
  let tail = "";
  let line = 1;
  let i = 0;
  const push = (ch) => { tail = (tail + ch).slice(-80); };

  const readQuoted = (quote) => {
    let value = "";
    i += 1;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "\\") { value += src[i + 1] || ""; i += 2; continue; }
      if (ch === quote) { i += 1; return value; }
      if (ch === "\n") { line += 1; i += 1; return null; }
      value += ch;
      i += 1;
    }
    return null;
  };

  const skipTemplate = () => {
    // Devuelve true si entró a una expresión ${ } (el resto se procesa como código).
    while (i < src.length) {
      const ch = src[i];
      if (ch === "\\") { i += 2; continue; }
      if (ch === "\n") line += 1;
      if (ch === "`") { i += 1; return false; }
      if (ch === "$" && src[i + 1] === "{") { i += 2; braces.push("tpl"); return true; }
      i += 1;
    }
    return false;
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "\n") { line += 1; push(" "); i += 1; continue; }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line += 1; i += 1; }
      i += 2;
      push(" ");
      continue;
    }
    if (ch === "/" && REGEX_PREV.test(tail)) {
      i += 1;
      let inClass = false;
      while (i < src.length && src[i] !== "\n") {
        const c = src[i];
        if (c === "\\") { i += 2; continue; }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) { i += 1; break; }
        i += 1;
      }
      push("R");
      continue;
    }
    if (ch === "'" || ch === "\"") {
      const startLine = line;
      const isSpec = SPEC_PREV.test(tail);
      const value = readQuoted(ch);
      if (isSpec && value) specs.push({ spec: value, line: startLine, optional: braces.includes("try"), lazy: braces.length > 0 });
      push("S");
      continue;
    }
    if (ch === "`") {
      const startLine = line;
      const isSpec = SPEC_PREV.test(tail);
      const start = i + 1;
      i += 1;
      const enteredExpr = skipTemplate();
      if (isSpec && !enteredExpr) {
        const value = src.slice(start, i - 1);
        if (value && !value.includes("\n")) specs.push({ spec: value, line: startLine, optional: braces.includes("try"), lazy: braces.length > 0 });
      }
      push("S");
      continue;
    }
    if (ch === "{") {
      braces.push(/\btry\s*$/.test(tail) || /\bcatch\s*(\([^)]*\))?\s*$/.test(tail) ? "try" : "x");
      push(ch);
      i += 1;
      continue;
    }
    if (ch === "}") {
      const top = braces.pop();
      i += 1;
      if (top === "tpl") {
        const enteredExpr = skipTemplate();
        if (!enteredExpr) push("S");
        continue;
      }
      push(ch);
      continue;
    }
    push(ch);
    i += 1;
  }
  return specs;
}

const RESOLVE_EXTS = ["", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts", ".json", ".vue", ".svelte", ".node", ".css", ".scss", ".sass", ".less"];
const INDEX_EXTS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".vue"];

function resolvesRelative(fromAbs, spec) {
  const clean = String(spec).split(/[?#]/)[0];
  const base = path.resolve(path.dirname(fromAbs), clean);
  if (RESOLVE_EXTS.some((ext) => isFile(base + ext))) return true;
  if (INDEX_EXTS.some((ext) => isFile(path.join(base, `index${ext}`)))) return true;
  const pkg = readJson(path.join(base, "package.json"));
  if (pkg?.main && isFile(path.resolve(base, pkg.main))) return true;
  if (/\.(m|c)?js$/.test(clean)) {
    const noExt = base.replace(/\.(m|c)?js$/, "");
    if ([".ts", ".tsx", ".mts", ".cts"].some((ext) => isFile(noExt + ext))) return true;
  }
  return false;
}

function packageName(spec) {
  const parts = String(spec).split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function createPackageContext(root) {
  const manifestCache = new Map();
  const aliasPrefixes = new Set(["@/", "~/", "#", "virtual:", "$"]);
  for (const cfgName of ["tsconfig.json", "jsconfig.json"]) {
    try {
      const raw = fs.readFileSync(path.join(root, cfgName), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'])\/\/.*$/gm, "$1")
        .replace(/,(\s*[}\]])/g, "$1");
      const paths = JSON.parse(raw)?.compilerOptions?.paths || {};
      for (const key of Object.keys(paths)) aliasPrefixes.add(key.replace(/\*$/, ""));
    } catch { /* sin alias */ }
  }
  let bundlerConfigText = "";
  for (const name of ["vite.config.js", "vite.config.ts", "vite.config.mjs", "webpack.config.js", "next.config.js", "next.config.mjs", "svelte.config.js", "nuxt.config.ts"]) {
    try { bundlerConfigText += fs.readFileSync(path.join(root, name), "utf8"); } catch { /* ignore */ }
  }

  const nearestManifest = (fromDir) => {
    let dir = fromDir;
    const visited = [];
    while (dir.length >= root.length) {
      if (manifestCache.has(dir)) { const hit = manifestCache.get(dir); visited.forEach((d) => manifestCache.set(d, hit)); return hit; }
      visited.push(dir);
      const pkgPath = path.join(dir, "package.json");
      if (isFile(pkgPath)) {
        const pkg = readJson(pkgPath) || {};
        const info = {
          dir,
          declared: new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies })),
          name: pkg.name || "",
        };
        visited.forEach((d) => manifestCache.set(d, info));
        return info;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    visited.forEach((d) => manifestCache.set(d, null));
    return null;
  };

  const isInstalled = (fromDir, name) => {
    let dir = fromDir;
    for (let depth = 0; depth < 12; depth += 1) {
      if (isFile(path.join(dir, "node_modules", name, "package.json"))) return true;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return false;
  };

  const isAlias = (spec) => {
    for (const prefix of aliasPrefixes) if (prefix && spec.startsWith(prefix)) return true;
    const name = packageName(spec);
    return Boolean(bundlerConfigText) && (bundlerConfigText.includes(`'${name}'`) || bundlerConfigText.includes(`"${name}"`)) && /alias/i.test(bundlerConfigText);
  };

  const rootManifest = nearestManifest(root);
  return { nearestManifest, isInstalled, isAlias, rootManifest };
}

// ---------------------------------------------------------------------------
// Ejecución de comandos (salida completa, con tope y timeout que mata el árbol).
// ---------------------------------------------------------------------------
function runShell(command, cwd, { timeoutMs = 300_000, env = {} } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;
    const childEnv = { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1", ...env };
    // Heredado de un node --test padre, hace que el node --test del proyecto reporte como subtest y salga en 0.
    delete childEnv.NODE_TEST_CONTEXT;
    try {
      child = spawn(command, {
        cwd,
        shell: true,
        windowsHide: true,
        env: childEnv,
      });
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: String(err?.message || err), timedOut: false, durationMs: 0 });
      return;
    }
    const cap = (buf, chunk) => { const next = buf + chunk; return next.length > OUTPUT_CAP ? next.slice(-OUTPUT_CAP) : next; };
    child.stdout?.on("data", (d) => { stdout = cap(stdout, String(d)); });
    child.stderr?.on("data", (d) => { stderr = cap(stderr, String(d)); });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else child.kill("SIGKILL");
      } catch { /* ignore */ }
    }, timeoutMs);
    child.on("error", (err) => { stderr = cap(stderr, String(err?.message || err)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? -1 : code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), timedOut, durationMs: Date.now() - started });
    });
  });
}

function nodeCheckFile(abs, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    let stderr = "";
    let child;
    try {
      child = spawn(process.execPath, ["--check", abs], {
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
    } catch (err) {
      resolve({ ok: null, stderr: String(err?.message || err) });
      return;
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs);
    child.stderr?.on("data", (d) => { stderr += String(d); });
    child.on("error", () => { clearTimeout(timer); resolve({ ok: null, stderr }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, stderr: stripAnsi(stderr) }); });
  });
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Chequeos
// ---------------------------------------------------------------------------
function looksEsm(source) {
  return /^\s*(import\s+[\w{*'"]|import\s*\(|export\s+(default|const|let|var|function|class|async|\{|\*))/m.test(source);
}

function classifySyntaxError(msg, { transpiled, wrapperClose }) {
  if (/Unexpected end of input|Unterminated template/i.test(msg) || wrapperClose) {
    return { severity: "error", message: `El archivo termina a mitad de código (faltan cierres al final): ${msg}` };
  }
  if (transpiled && TRANSPILE_SUSPECT.test(msg)) return null;
  return { severity: "error", message: `Error de sintaxis: ${msg}` };
}

async function checkSyntax(root, files, ctx) {
  const findings = [];
  let checked = 0;
  let unverifiable = 0;
  const esmQueue = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) continue;
    if (file.ext === ".json") {
      if (JSONC_NAMES.test(file.name)) continue;
      checked += 1;
      try { JSON.parse(fs.readFileSync(file.abs, "utf8").replace(/^\uFEFF/, "")); } catch (err) {
        findings.push({ check: "syntax", severity: "error", file: file.rel, line: 0, key: `syntax|${file.rel}`, message: `JSON inválido: ${String(err?.message || err).slice(0, 200)}`, evidence: "JSON.parse" });
      }
      continue;
    }
    if (![".js", ".cjs", ".mjs"].includes(file.ext) || /\.min\.js$/i.test(file.name)) continue;
    let source = "";
    try { source = fs.readFileSync(file.abs, "utf8"); } catch { continue; }
    if (file.ext === ".mjs" || (file.ext !== ".cjs" && looksEsm(source))) { esmQueue.push(file); continue; }
    checked += 1;
    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source.replace(/^#!.*/, "")}\n})`;
    try {
      new vm.Script(wrapped, { filename: file.rel });
    } catch (err) {
      const msg = String(err?.message || err).slice(0, 200);
      const rawLine = Number((String(err?.stack || "").match(/:(\d+)\r?\n/) || [])[1] || 0);
      const verdict = classifySyntaxError(msg, { transpiled: ctx.transpiled, wrapperClose: rawLine >= wrapped.split("\n").length });
      if (!verdict) { unverifiable += 1; continue; }
      findings.push({ check: "syntax", severity: verdict.severity, file: file.rel, line: rawLine ? Math.max(1, rawLine - 1) : 0, key: `syntax|${file.rel}`, message: verdict.message, evidence: "vm.Script (compilación sin ejecutar)" });
    }
  }
  const esmFiles = esmQueue.slice(0, MAX_ESM_CHECKS);
  const esmSkipped = esmQueue.length - esmFiles.length;
  const results = await mapLimit(esmFiles, 4, (file) => nodeCheckFile(file.abs));
  results.forEach((res, idx) => {
    const file = esmFiles[idx];
    if (res.ok === null) { unverifiable += 1; return; }
    checked += 1;
    if (res.ok) return;
    const msg = (res.stderr.match(/SyntaxError: (.+)/) || [])[1] || tailLines(res.stderr, 1);
    const line = Number((res.stderr.match(/:(\d+)\r?\n/) || [])[1] || 0);
    const verdict = classifySyntaxError(String(msg).slice(0, 200), { transpiled: ctx.transpiled, wrapperClose: false });
    if (!verdict) { unverifiable += 1; checked -= 1; return; }
    findings.push({ check: "syntax", severity: verdict.severity, file: file.rel, line, key: `syntax|${file.rel}`, message: verdict.message, evidence: "node --check" });
  });
  return {
    check: { id: "syntax", label: "Sintaxis JS/JSON", status: findings.length ? "fail" : "pass", summary: `${checked} archivos compilados${unverifiable ? `, ${unverifiable} requieren transpilación (los cubre typecheck/build)` : ""}${esmSkipped ? `, ${esmSkipped} módulos ES sin revisar por límite` : ""}` },
    findings,
  };
}

const CODE_EXTS = new Set([".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte"]);

function checkImports(root, files, ctx) {
  const findings = [];
  let scanned = 0;
  let missingNodeModules = false;
  const pkgCtx = createPackageContext(root);
  const rootDeclared = pkgCtx.rootManifest?.declared || new Set();
  if (pkgCtx.rootManifest && rootDeclared.size && !fs.existsSync(path.join(root, "node_modules"))) {
    missingNodeModules = true;
    findings.push({ check: "imports", severity: "error", file: "package.json", line: 0, key: "imports|node_modules", message: `Dependencias no instaladas: no existe node_modules (${rootDeclared.size} paquetes declarados). Ejecutar npm install.`, evidence: "fs.existsSync(node_modules)" });
  }
  for (const file of files) {
    if (!CODE_EXTS.has(file.ext) || file.size > MAX_FILE_BYTES || /\.min\.js$/i.test(file.name) || /\.d\.ts$/i.test(file.name)) continue;
    let source = "";
    try { source = fs.readFileSync(file.abs, "utf8"); } catch { continue; }
    if ((file.ext === ".vue" || file.ext === ".svelte")) {
      const script = source.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
      source = script ? script[1] : "";
    }
    scanned += 1;
    const seen = new Set();
    for (const { spec, line, optional, lazy } of scanModuleSpecifiers(source)) {
      if (optional || !spec || seen.has(spec)) continue;
      seen.add(spec);
      if (spec.startsWith(".")) {
        if (!resolvesRelative(file.abs, spec)) {
          findings.push({ check: "imports", severity: "error", file: file.rel, line, key: `imports|${file.rel}|${spec}`, message: `Importa "${spec}" y ese archivo no existe.`, evidence: "resolución de ruta relativa en disco" });
        }
        continue;
      }
      if (spec.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.includes("${")) continue;
      const name = packageName(spec);
      if (BUILTINS.has(name) || BUILTINS.has(spec) || pkgCtx.isAlias(spec)) continue;
      if (missingNodeModules) continue;
      const manifest = pkgCtx.nearestManifest(path.dirname(file.abs));
      if (manifest && manifest.name === name) continue;
      const declared = (manifest?.declared?.has(name)) || rootDeclared.has(name);
      const installed = pkgCtx.isInstalled(path.dirname(file.abs), name);
      if (!installed && declared) {
        findings.push({ check: "imports", severity: "error", file: file.rel, line, key: `imports|pkg|${name}|missing`, message: `"${name}" está declarado en package.json pero no está instalado (falta npm install).`, evidence: "node_modules/<paquete>/package.json" });
      } else if (!installed && lazy && new RegExp(`require\\.resolve\\(\\s*["'\`]${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}["'\`]`).test(source)) {
        continue;
      } else if (!installed && lazy) {
        findings.push({ check: "imports", severity: "warning", file: file.rel, line, key: `imports|pkg|${name}|absent`, message: `Carga bajo demanda el paquete "${name}", que no está declarado ni instalado: si esa ruta se ejecuta, fallará.`, evidence: "package.json + node_modules" });
      } else if (!installed) {
        findings.push({ check: "imports", severity: "error", file: file.rel, line, key: `imports|pkg|${name}|absent`, message: `Importa el paquete "${name}", que no está declarado ni instalado.`, evidence: "package.json + node_modules" });
      } else if (!declared && ctx.hasManifest) {
        findings.push({ check: "imports", severity: "warning", file: file.rel, line, key: `imports|pkg|${name}|undeclared`, message: `Usa "${name}" sin declararlo en package.json (funciona solo porque otra dependencia lo instala).`, evidence: "package.json" });
      }
    }
  }
  const dedup = [];
  const keys = new Set();
  for (const f of findings) { if (!keys.has(f.key)) { keys.add(f.key); dedup.push(f); } }
  const errors = dedup.filter((f) => f.severity === "error").length;
  return {
    check: { id: "imports", label: "Imports / require", status: errors ? "fail" : (dedup.length ? "warn" : "pass"), summary: `${scanned} archivos de código revisados` },
    findings: dedup,
  };
}

function checkConflictMarkers(root, files) {
  const findings = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES || !/\.(js|cjs|mjs|jsx|ts|tsx|json|css|scss|html|vue|svelte|md|py|yml|yaml)$/i.test(file.name)) continue;
    let source = "";
    try { source = fs.readFileSync(file.abs, "utf8"); } catch { continue; }
    if (!source.includes("<<<<<<< ") || !source.includes(">>>>>>> ")) continue;
    const lines = source.split(/\r?\n/);
    const idx = lines.findIndex((l) => /^<{7} /.test(l));
    if (idx >= 0 && lines.some((l) => /^>{7} /.test(l))) {
      findings.push({ check: "conflicts", severity: "error", file: file.rel, line: idx + 1, key: `conflicts|${file.rel}`, message: "Marcadores de conflicto de merge sin resolver (<<<<<<< / >>>>>>>).", evidence: "búsqueda de marcadores en el archivo" });
    }
  }
  return { check: { id: "conflicts", label: "Conflictos de merge", status: findings.length ? "fail" : "pass", summary: findings.length ? `${findings.length} archivos con conflicto` : "sin marcadores" }, findings };
}

function parseEnvKeys(text = "") {
  const map = new Map();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) map.set(m[1], m[2].replace(/^["']|["']$/g, "").trim().length > 0);
  }
  return map;
}

function checkEnv(root) {
  const example = [".env.example", ".env.sample", ".env.template", ".env.local.example"].find((n) => isFile(path.join(root, n)));
  if (!example) return { check: { id: "env", label: "Variables de entorno", status: "skipped", summary: "no hay .env.example para comparar" }, findings: [] };
  const expected = parseEnvKeys(fs.readFileSync(path.join(root, example), "utf8"));
  const localNames = [".env.local", ".env", ".env.development.local", ".env.development"].filter((n) => isFile(path.join(root, n)));
  const present = new Map();
  for (const n of localNames) for (const [k, filled] of parseEnvKeys(fs.readFileSync(path.join(root, n), "utf8"))) present.set(k, present.get(k) || filled);
  const findings = [];
  for (const key of expected.keys()) {
    if (!present.has(key)) {
      findings.push({ check: "env", severity: "warning", file: example, line: 0, key: `env|${key}`, message: `Falta la variable ${key} (está en ${example}, no en ${localNames.join(" / ") || ".env.local"}).`, evidence: "comparación de nombres de variables (sin leer valores)" });
    } else if (!present.get(key)) {
      findings.push({ check: "env", severity: "warning", file: localNames[0] || ".env.local", line: 0, key: `env|${key}|empty`, message: `La variable ${key} está vacía.`, evidence: "comparación de nombres de variables (sin leer valores)" });
    }
  }
  return { check: { id: "env", label: "Variables de entorno", status: findings.length ? "warn" : "pass", summary: `${expected.size} esperadas en ${example}` }, findings };
}

async function checkGit(root) {
  if (!fs.existsSync(path.join(root, ".git"))) return { check: { id: "git", label: "Git", status: "skipped", summary: "no es repositorio git" }, findings: [] };
  const res = await runShell("git status --porcelain", root, { timeoutMs: 20_000 });
  if (res.code !== 0) return { check: { id: "git", label: "Git", status: "error", command: "git status --porcelain", summary: tailLines(res.stderr, 2) || "git no respondió" }, findings: [] };
  const rows = res.stdout.split(/\r?\n/).filter(Boolean);
  const findings = rows
    .filter((r) => /^(UU|AA|DD|AU|UA|DU|UD) /.test(r))
    .map((r) => ({ check: "git", severity: "error", file: r.slice(3).trim(), line: 0, key: `git|conflict|${r.slice(3).trim()}`, message: "Archivo en conflicto de merge sin resolver (git status).", evidence: "git status --porcelain" }));
  return { check: { id: "git", label: "Git", status: findings.length ? "fail" : "pass", command: "git status --porcelain", summary: `${rows.length} archivos con cambios sin commit` }, findings };
}

const DOC_FILES = /^(AGENTS|CLAUDE|README|ROADMAP|CONTRIBUTING|ARQUITECTURA[\w-]*)\.md$/i;
const DOC_PATH = /`([\w@.\-/]+\.(?:js|cjs|mjs|ts|tsx|jsx|json|md|css|html|py|sql|sh|ps1|yml|yaml|toml))`/g;
const DOCUMENTS_MISSING = /eliminad|borrad|retirad|inexistente|no existe|ya no existe|deleted|removed/i;

function checkDocReferences(root, files) {
  const findings = [];
  for (const file of files.filter((f) => !f.rel.includes("/") && DOC_FILES.test(f.name))) {
    const lines = fs.readFileSync(file.abs, "utf8").split(/\r?\n/);
    let missingCtxIndent = -1;
    lines.forEach((text, idx) => {
      if (!text.trim()) return;
      const indent = text.length - text.trimStart().length;
      if (missingCtxIndent >= 0 && indent <= missingCtxIndent) missingCtxIndent = -1;
      if (DOCUMENTS_MISSING.test(text)) {
        if (missingCtxIndent < 0) missingCtxIndent = indent;
        return;
      }
      if (missingCtxIndent >= 0) return;
      for (const m of text.matchAll(DOC_PATH)) {
        const ref = m[1];
        if (!ref.includes("/") || ref.startsWith("node_modules") || ref.startsWith(".editcore/") || ref.includes("..") || /^[A-Z_]+\//.test(ref)) continue;
        if (isFile(path.join(root, ref))) continue;
        findings.push({ check: "docs", severity: "warning", file: file.rel, line: idx + 1, key: `docs|${file.rel}|${ref}`, message: `Cita \`${ref}\`, que no existe en el proyecto.`, evidence: "existencia del archivo en disco" });
      }
    });
  }
  return { check: { id: "docs", label: "Referencias en documentación", status: findings.length ? "warn" : "pass", summary: findings.length ? `${findings.length} referencias rotas` : "todas las rutas citadas existen" }, findings: findings.slice(0, 40) };
}

function parseTestOutput(text = "") {
  const t = stripAnsi(text);
  const num = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  const summary = {
    total: num(/[ℹ#]\s*tests\s+(\d+)/),
    passed: num(/[ℹ#]\s*pass\s+(\d+)/),
    failed: num(/[ℹ#]\s*fail\s+(\d+)/),
    skipped: num(/[ℹ#]\s*skipped\s+(\d+)/),
  };
  const jest = t.match(/Tests:\s+([^\n]*?)(\d+)\s+total/);
  if (summary.total == null && jest) {
    summary.total = Number(jest[2]);
    summary.failed = Number((jest[1].match(/(\d+)\s+failed/) || [])[1] || 0);
    summary.passed = Number((jest[1].match(/(\d+)\s+passed/) || [])[1] || 0);
    summary.skipped = Number((jest[1].match(/(\d+)\s+skipped/) || [])[1] || 0);
  }
  const vitest = t.match(/Tests\s+([^\n]*?)\((\d+)\)/);
  if (summary.total == null && vitest) {
    summary.total = Number(vitest[2]);
    summary.failed = Number((vitest[1].match(/(\d+)\s+failed/) || [])[1] || 0);
    summary.passed = Number((vitest[1].match(/(\d+)\s+passed/) || [])[1] || 0);
    summary.skipped = Number((vitest[1].match(/(\d+)\s+skipped/) || [])[1] || 0);
  }
  if (summary.total == null && /\d+\s+passing/.test(t)) {
    summary.passed = num(/(\d+)\s+passing/);
    summary.failed = num(/(\d+)\s+failing/) || 0;
    summary.skipped = num(/(\d+)\s+pending/) || 0;
    summary.total = summary.passed + summary.failed + summary.skipped;
  }
  const names = [];
  const lines = t.split(/\r?\n/);
  const locate = (fromIdx) => {
    for (let j = fromIdx; j < Math.min(lines.length, fromIdx + 40); j += 1) {
      const m = lines[j].match(/([A-Za-z]:[\\/][^():\n]+|\/[^():\n]+|[\w.\\/-]+\.(?:test|spec)\.[cm]?[jt]sx?):(\d+):\d+/);
      if (m && !/node_modules|node:internal/.test(m[1])) return { file: m[1], line: Number(m[2]) };
    }
    return null;
  };
  lines.forEach((line, idx) => {
    let m = line.match(/^\s*not ok \d+ - (.+?)\s*$/)
      || line.match(/^\s*✖\s+(.+?)(?:\s+\(\d+(?:\.\d+)?m?s\))?\s*$/)
      || line.match(/^\s*●\s+(.+?)\s*$/)
      || line.match(/^\s*(?:×|✗)\s+(.+?)\s*$/)
      || line.match(/^\s*FAIL\s+(.+?)\s*$/);
    if (m && !/^(tests?|failing tests|Test suite failed to run|Console)\s*:?$/i.test(m[1])) names.push({ name: m[1], loc: locate(idx + 1) });
  });
  const unique = [];
  const seen = new Set();
  for (const n of names) { if (!seen.has(n.name)) { seen.add(n.name); unique.push(n); } }
  return { ...summary, failures: unique.slice(0, 30) };
}

async function checkTests(root, pkg, { timeoutMs, onProgress }) {
  const script = String(pkg?.scripts?.test || "").trim();
  if (!script || NPM_DEFAULT_TEST.test(script)) {
    return { check: { id: "tests", label: "Tests", status: "skipped", summary: "el proyecto no tiene script `test`" }, findings: [], noTests: true };
  }
  onProgress?.({ phase: "tool", name: "run_command", input: { command: "npm test" }, text: "Corriendo los tests del proyecto (npm test)…" });
  const res = await runShell("npm test", root, { timeoutMs });
  const output = `${res.stdout}\n${res.stderr}`;
  if (res.timedOut) {
    return { check: { id: "tests", label: "Tests", status: "error", command: "npm test", durationMs: res.durationMs, summary: `no terminaron en ${Math.round(timeoutMs / 1000)} s (resultado no verificado)` }, findings: [] };
  }
  const parsed = parseTestOutput(output);
  const counts = parsed.total != null ? `${parsed.total} tests, ${parsed.passed ?? "?"} pass, ${parsed.failed ?? "?"} fail${parsed.skipped ? `, ${parsed.skipped} skip` : ""}` : "";
  const findings = parsed.failures.map((f) => ({
    check: "tests",
    severity: "error",
    file: f.loc ? (path.isAbsolute(f.loc.file) ? rel(root, f.loc.file) : f.loc.file.replace(/\\/g, "/")) : "",
    line: f.loc?.line || 0,
    key: `tests|${f.name}`,
    message: `Test fallando: ${f.name}`,
    evidence: "npm test",
  }));
  if (res.code !== 0 && !findings.length && /No tests found|no test files found|0 matches/i.test(output)) {
    findings.push({ check: "tests", severity: "error", file: "package.json", line: 0, key: "tests|none", message: `El script \`test\` (${script.slice(0, 60)}) existe pero el proyecto no tiene ningún test: npm test siempre falla.`, evidence: "npm test" });
  } else if (res.code !== 0 && !findings.length) {
    findings.push({ check: "tests", severity: "error", file: "package.json", line: 0, key: "tests|exit", message: `npm test terminó con código ${res.code}${counts ? ` (${counts})` : ""}. Últimas líneas:\n${tailLines(output, 12)}`, evidence: "npm test" });
  }
  return {
    check: { id: "tests", label: "Tests", status: res.code === 0 ? "pass" : "fail", command: "npm test", durationMs: res.durationMs, summary: counts || (res.code === 0 ? "terminaron con código 0" : `código ${res.code}`) },
    findings,
    stats: parsed,
  };
}

function parseTscOutput(text, root) {
  const findings = [];
  for (const m of stripAnsi(text).matchAll(/^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm)) {
    const file = path.isAbsolute(m[1]) ? rel(root, m[1]) : m[1].replace(/\\/g, "/");
    findings.push({ check: "typecheck", severity: "error", file, line: Number(m[2]), key: `typecheck|${file}|${m[4]}|${m[5].slice(0, 80)}`, message: `${m[4]}: ${m[5]}`, evidence: "typecheck" });
    if (findings.length >= 60) break;
  }
  return findings;
}

async function checkTypecheck(root, pkg, { timeoutMs, onProgress }) {
  let command = "";
  if (pkg?.scripts?.typecheck) command = "npm run typecheck";
  else if (isFile(path.join(root, "tsconfig.json")) && isFile(path.join(root, "node_modules", "typescript", "bin", "tsc"))) command = "npx --no-install tsc --noEmit --pretty false";
  if (!command) return { check: { id: "typecheck", label: "Typecheck", status: "skipped", summary: "sin TypeScript ni script typecheck" }, findings: [] };
  onProgress?.({ phase: "tool", name: "run_command", input: { command }, text: "Revisando tipos (typecheck)…" });
  const res = await runShell(command, root, { timeoutMs });
  if (res.timedOut) return { check: { id: "typecheck", label: "Typecheck", status: "error", command, durationMs: res.durationMs, summary: "no terminó a tiempo (no verificado)" }, findings: [] };
  const findings = parseTscOutput(`${res.stdout}\n${res.stderr}`, root);
  if (res.code !== 0 && !findings.length) {
    findings.push({ check: "typecheck", severity: "error", file: "", line: 0, key: "typecheck|exit", message: `${command} terminó con código ${res.code}:\n${tailLines(`${res.stdout}\n${res.stderr}`, 12)}`, evidence: command });
  }
  return { check: { id: "typecheck", label: "Typecheck", status: res.code === 0 ? "pass" : "fail", command, durationMs: res.durationMs, summary: res.code === 0 ? "sin errores de tipos" : `${findings.length} errores` }, findings };
}

async function checkScript(root, pkg, { id, label, script, timeoutMs, onProgress }) {
  if (!pkg?.scripts?.[script]) return { check: { id, label, status: "skipped", summary: `el proyecto no tiene script \`${script}\`` }, findings: [] };
  const command = `npm run ${script}`;
  onProgress?.({ phase: "tool", name: "run_command", input: { command }, text: `Corriendo ${command}…` });
  const res = await runShell(command, root, { timeoutMs });
  const output = `${res.stdout}\n${res.stderr}`;
  if (res.timedOut) return { check: { id, label, status: "error", command, durationMs: res.durationMs, summary: "no terminó a tiempo (no verificado)" }, findings: [] };
  const findings = [];
  if (id === "lint") {
    let current = "";
    for (const line of output.split(/\r?\n/)) {
      if (/^\S.*\.(m?[jt]sx?|vue|svelte)$/.test(line.trim()) && !/^\s/.test(line)) { current = line.trim(); continue; }
      const m = line.match(/^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(\S+)\s*$/);
      if (m && current) {
        const file = path.isAbsolute(current) ? rel(root, current) : current.replace(/\\/g, "/");
        findings.push({ check: id, severity: "error", file, line: Number(m[1]), key: `${id}|${file}|${m[4]}|${m[1]}`, message: `${m[3]} (${m[4]})`, evidence: command });
        if (findings.length >= 60) break;
      }
    }
  }
  if (res.code !== 0 && !findings.length) {
    const loc = output.match(/([\w./\\-]+\.(?:m?[jt]sx?|vue|svelte|css|scss)):(\d+)(?::\d+)?/);
    findings.push({ check: id, severity: "error", file: loc ? loc[1].replace(/\\/g, "/") : "", line: loc ? Number(loc[2]) : 0, key: `${id}|exit`, message: `${command} falló (código ${res.code}):\n${tailLines(output, 15)}`, evidence: command });
  }
  return { check: { id, label, status: res.code === 0 ? "pass" : "fail", command, durationMs: res.durationMs, summary: res.code === 0 ? "terminó con código 0" : `código ${res.code}` }, findings };
}

function detectTranspiled(pkg) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  return TRANSPILE_DEPS.some((d) => d in deps);
}

/**
 * @param {string} projectRoot
 * @param {object} [opts]
 * @param {boolean} [opts.runTests=true]
 * @param {boolean} [opts.runTypecheck=true]
 * @param {boolean} [opts.runLint=false]
 * @param {boolean} [opts.runBuild=false]
 * @param {string[]} [opts.onlyFiles] limita los chequeos estáticos a esos archivos (rutas relativas).
 */
async function runForensicChecks(projectRoot, opts = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const started = Date.now();
  const {
    runTests = true,
    runTypecheck = true,
    runLint = false,
    runBuild = false,
    testTimeoutMs = 300_000,
    commandTimeoutMs = 240_000,
    onProgress,
    onlyFiles = null,
  } = opts;
  const pkg = readJson(path.join(root, "package.json"));
  const config = loadProjectConfig(root, pkg);
  const walked = walkProject(root, config.skip);
  let files = walked.files;
  if (Array.isArray(onlyFiles) && onlyFiles.length) {
    const wanted = new Set(onlyFiles.map((f) => String(f).replace(/\\/g, "/").replace(/^\.\//, "")));
    files = files.filter((f) => wanted.has(f.rel));
  }
  const ctx = { transpiled: detectTranspiled(pkg), hasManifest: Boolean(pkg) };
  onProgress?.({ phase: "subagent", name: "forensic", text: `Revisando ${files.length} archivos: sintaxis, imports, conflictos…` });

  const sections = [];
  sections.push(await checkSyntax(root, files, ctx));
  sections.push(checkImports(root, files, ctx));
  sections.push(checkConflictMarkers(root, files));
  if (!onlyFiles) {
    sections.push(checkEnv(root));
    sections.push(checkDocReferences(root, walked.files));
    sections.push(await checkGit(root));
  }
  const notRun = [];
  if (runTypecheck) sections.push(await checkTypecheck(root, pkg, { timeoutMs: commandTimeoutMs, onProgress }));
  else notRun.push("typecheck");
  if (runTests) sections.push(await checkTests(root, pkg, { timeoutMs: testTimeoutMs, onProgress }));
  else notRun.push("tests");
  if (runLint) sections.push(await checkScript(root, pkg, { id: "lint", label: "Lint", script: "lint", timeoutMs: commandTimeoutMs, onProgress }));
  if (runBuild) sections.push(await checkScript(root, pkg, { id: "build", label: "Build", script: "build", timeoutMs: commandTimeoutMs, onProgress }));
  else if (pkg?.scripts?.build) notRun.push("build");

  const findings = sections.flatMap((s) => s.findings)
    .sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || String(a.file).localeCompare(String(b.file)) || (a.line - b.line));
  const counts = {
    error: findings.filter((f) => f.severity === "error").length,
    warning: findings.filter((f) => f.severity === "warning").length,
  };
  return {
    ok: counts.error === 0,
    root,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    filesScanned: files.length,
    filesTruncated: walked.truncated,
    excluded: config.skip,
    autoExcluded: walked.autoExcluded,
    onlyFiles: Array.isArray(onlyFiles) && onlyFiles.length ? files.map((f) => f.rel) : null,
    checks: sections.map((s) => s.check),
    testStats: sections.find((s) => s.check.id === "tests")?.stats || null,
    findings,
    counts,
    notRun,
  };
}

// ---------------------------------------------------------------------------
// Persistencia y comparación antes/después
// ---------------------------------------------------------------------------
function forensicPath(root, name = "forensic-last.json") {
  return path.join(path.resolve(String(root || "")), ".editcore", name);
}

function saveForensic(root, result) {
  try {
    const file = forensicPath(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, forensicPath(root, "forensic-prev.json"));
    fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf8");
    return true;
  } catch {
    return false;
  }
}

function loadForensic(root) {
  return readJson(forensicPath(root));
}

function compareForensic(before, after) {
  const ranChecks = new Set((after?.checks || []).filter((c) => c.status !== "skipped" && c.status !== "error").map((c) => c.id));
  const afterKeys = new Set((after?.findings || []).map((f) => f.key));
  const beforeKeys = new Set((before?.findings || []).map((f) => f.key));
  const scoped = Array.isArray(after?.onlyFiles) ? new Set(after.onlyFiles) : null;
  const STATIC = new Set(["syntax", "imports", "conflicts"]);
  const resolved = [];
  const remaining = [];
  const unverified = [];
  for (const f of before?.findings || []) {
    const covered = ranChecks.has(f.check) && !(scoped && (STATIC.has(f.check) ? !scoped.has(f.file) : !["tests", "typecheck", "lint", "build"].includes(f.check)));
    if (afterKeys.has(f.key)) remaining.push(f);
    else if (covered) resolved.push(f);
    else unverified.push(f);
  }
  const introduced = (after?.findings || []).filter((f) => !beforeKeys.has(f.key));
  return { resolved, remaining, introduced, unverified };
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
const STATUS_LABEL = { pass: "✅ pasa", fail: "❌ falla", warn: "⚠️ avisos", skipped: "⏭️ no aplica", error: "⚠️ no verificado" };

function location(f) {
  if (!f.file) return "";
  return f.line ? `${f.file}:${f.line}` : f.file;
}

function findingLine(f) {
  const loc = location(f);
  const msg = String(f.message || "").split("\n");
  const head = `- ${loc ? `\`${loc}\` — ` : ""}${msg[0]}`;
  return msg.length > 1 ? `${head}\n\n\`\`\`\n${msg.slice(1).join("\n")}\n\`\`\`` : head;
}

function formatForensicMarkdown(result, { maxFindings = 80 } = {}) {
  if (!result) return "";
  const rows = result.checks.map((c) => `| ${c.label} | ${STATUS_LABEL[c.status] || c.status} | ${String(c.summary || "").replace(/\|/g, "/")}${c.command ? ` (\`${c.command}\`)` : ""} |`);
  const errors = result.findings.filter((f) => f.severity === "error");
  const warnings = result.findings.filter((f) => f.severity === "warning");
  const out = [
    "## 🧪 Chequeos reales ejecutados",
    "",
    "| Chequeo | Resultado | Detalle |",
    "|---|---|---|",
    ...rows,
    "",
    `## ❌ Errores verificados (${errors.length})`,
    ...(errors.length ? errors.slice(0, maxFindings).map(findingLine) : ["- Ninguno detectado por los chequeos ejecutados."]),
  ];
  if (errors.length > maxFindings) out.push(`- … y ${errors.length - maxFindings} más.`);
  out.push("", `## ⚠️ Advertencias verificadas (${warnings.length})`);
  out.push(...(warnings.length ? warnings.slice(0, maxFindings).map(findingLine) : ["- Ninguna."]));
  if (warnings.length > maxFindings) out.push(`- … y ${warnings.length - maxFindings} más.`);
  const notRun = [...(result.notRun || [])];
  if (result.filesTruncated) notRun.push(`solo se revisaron los primeros ${MAX_FILES} archivos`);
  if (notRun.length) out.push("", `_No ejecutado en esta corrida: ${notRun.join(", ")}._`);
  if ((result.excluded || []).length) out.push("", `_Excluido por configuración del proyecto: ${result.excluded.map((p) => `\`${p}\``).join(", ")}._`);
  if ((result.autoExcluded || []).length) out.push("", `_Excluido automáticamente (respaldos, copias empaquetadas, ejemplos de skills): ${result.autoExcluded.slice(0, 10).map((p) => `\`${p}\``).join(", ")}${result.autoExcluded.length > 10 ? ` y ${result.autoExcluded.length - 10} más` : ""}._`);
  return out.join("\n");
}

function formatForensicPromptBlock(result, { maxFindings = 80 } = {}) {
  if (!result) return "";
  const lines = result.findings.slice(0, maxFindings).map((f) => `- [${f.severity.toUpperCase()}] ${location(f) || "(proyecto)"} — ${String(f.message).split("\n")[0]} (evidencia: ${f.evidence})`);
  return [
    "HECHOS VERIFICADOS POR EDITCORE (salida real de chequeos sobre el disco; son la base obligatoria del informe):",
    ...result.checks.map((c) => `- Chequeo ${c.label}: ${c.status}${c.summary ? ` — ${c.summary}` : ""}${c.command ? ` [${c.command}]` : ""}`),
    `Hallazgos verificados: ${result.counts.error} errores, ${result.counts.warning} advertencias.`,
    ...(lines.length ? lines : ["- Ningún hallazgo en los chequeos ejecutados."]),
    result.findings.length > maxFindings ? `- … y ${result.findings.length - maxFindings} más (ver informe).` : "",
    (result.notRun || []).length ? `No ejecutado: ${result.notRun.join(", ")} (no afirmes nada sobre eso como verificado).` : "",
    "REGLAS: lista TODOS los hallazgos verificados en la sección de verificados, sin quitar ni suavizar. Cualquier otra observación tuya va en una sección aparte de HIPÓTESIS (no verificadas). No contradigas un chequeo que pasó.",
  ].filter(Boolean).join("\n");
}

function formatComparisonMarkdown(cmp) {
  if (!cmp) return "";
  const list = (items) => items.slice(0, 40).map((f) => `  - \`${location(f) || "(proyecto)"}\` — ${String(f.message).split("\n")[0]}`);
  const out = ["## 🔁 Verificación antes / después"];
  out.push(`- ✅ Resueltos (el chequeo que los detectó ahora pasa): ${cmp.resolved.length}`);
  out.push(...list(cmp.resolved));
  out.push(`- ❌ Siguen fallando: ${cmp.remaining.length}`);
  out.push(...list(cmp.remaining));
  if (cmp.introduced.length) {
    out.push(`- 🆕 Errores nuevos tras los cambios: ${cmp.introduced.length}`);
    out.push(...list(cmp.introduced));
  }
  if (cmp.unverified.length) {
    out.push(`- ⏭️ No reverificados en esta corrida: ${cmp.unverified.length}`);
    out.push(...list(cmp.unverified));
  }
  return out.join("\n");
}

module.exports = {
  runForensicChecks,
  scanModuleSpecifiers,
  parseTestOutput,
  parseTscOutput,
  compareForensic,
  saveForensic,
  loadForensic,
  formatForensicMarkdown,
  formatForensicPromptBlock,
  formatComparisonMarkdown,
  runShell,
};
