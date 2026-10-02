"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const tools = require("../tools");

const SYNTAX_CHECK_MAX_BYTES = 2_000_000;

function checkSyntax(projectRoot, file) {
  const ext = path.extname(file).toLowerCase();
  if (![".js", ".cjs", ".mjs", ".json"].includes(ext)) return "";
  let source = "";
  try {
    const abs = path.resolve(projectRoot, file);
    if (fs.statSync(abs).size > SYNTAX_CHECK_MAX_BYTES) return "";
    source = fs.readFileSync(abs, "utf8");
  } catch {
    return "";
  }
  if (ext === ".json") {
    try { JSON.parse(source); return "JSON válido (archivo completo)"; } catch (err) { return `ERROR: JSON inválido: ${String(err?.message || err).slice(0, 160)}`; }
  }
  // Mismo envoltorio que usa Node para CommonJS (permite return de nivel superior); suma 1 línea arriba.
  const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source.replace(/^#!.*/, "")}\n})`;
  try {
    new vm.Script(wrapped, { filename: file });
    return "sintaxis JS OK (archivo completo)";
  } catch (err) {
    const msg = String(err?.message || err).slice(0, 160);
    const lineMatch = String(err?.stack || "").match(/:(\d+)\r?\n/);
    const rawLine = lineMatch ? Number(lineMatch[1]) : 0;
    const line = rawLine ? Math.max(1, rawLine - 1) : 0;
    const where = line ? ` en línea ${line}` : "";
    // Un error en la línea de cierre del envoltorio significa que faltan cierres al final del archivo.
    if (/Unexpected end of input/i.test(msg) || (rawLine && rawLine >= wrapped.split("\n").length)) {
      return `ERROR: el archivo termina a mitad de código (faltan cierres al final; ${msg})`;
    }
    if (ext === ".mjs" || /Cannot use import statement|Unexpected token 'export'|import\.meta|top level bodies of modules/i.test(msg)) {
      return "sintaxis no verificada (módulo ES)";
    }
    return `posible error de sintaxis${where}: ${msg} (puede ser normal si el proyecto transpila JSX/TypeScript/decoradores)`;
  }
}

function excerptHeader(file, res, syntax) {
  const parts = [`${res.totalLines} líneas, ${res.bytes} bytes`];
  parts.push(res.partial
    ? `extracto: líneas ${res.startLine}-${res.endLine} (el archivo continúa)`
    : "extracto completo");
  if (syntax) parts.push(syntax);
  return `### ${file} — ${parts.join(" · ")}`;
}

function testScriptLine(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const script = String(pkg?.scripts?.test || "").trim();
    if (!script) return "- **Tests**: package.json no define script `test`.";
    return `- **Tests**: script \`npm test\` = \`${script.slice(0, 120)}\`. No ejecutado en este análisis (resultado no verificado).`;
  } catch {
    return "";
  }
}

function loadMap() {
  try {
    return require("../../runtime/project-map");
  } catch {
    return null;
  }
}

// Carpetas de código típicas donde vive la lógica real.
const SOURCE_DIRS = [
  "src", "lib", "app", "server", "api", "packages", "core",
  "modules", "runtime", "agent-core", "editcore-chat-kernel",
  "components", "pages", "routes", "handlers", "services",
];

async function runAnalyst({ projectRoot, onProgress, maxReads = 14, userMessage = "" }) {
  const steps = [];
  let readCount = 0;
  const mapApi = loadMap();
  let cognitive = null;
  try {
    cognitive = mapApi?.ensureProjectMap?.(projectRoot, { maxAgeMs: 5 * 60_000 })?.map || null;
  } catch {
    cognitive = null;
  }

  // --- 1. Listar raíz ---
  const rootList = tools.listFiles(projectRoot, ".");
  steps.push({ name: "list_files", input: { path: "." }, result: rootList, ok: rootList.ok });

  const listedFiles = new Set((rootList.files || []).map((f) => String(f).replace(/\\/g, "/")));
  const listedDirs = new Set((rootList.dirs || []).map((f) => String(f).replace(/\\/g, "/")));
  const mapFiles = new Set((cognitive?.files || []).map((f) => String(f).replace(/\\/g, "/")));

  const wantsRoadmap = /\broadmap\b|\betapa\b|\bestado\b|\bestado\s+del\s+proyecto\b/i.test(String(userMessage || ""));

  // --- 2. Descubrir archivos clave por categoría ---
  const priority = {
    docs: [],
    config: [],
    entrypoints: [],
    source: [],
  };

  // Docs
  for (const f of ["ROADMAP.md", "README.md", "AGENTS.md", "CLAUDE.md"]) {
    if (listedFiles.has(f)) priority.docs.push(f);
  }

  // Config
  for (const f of listedFiles) {
    if (/^(package\.json|(next|vite|tailwind|jest|vitest|eslint)\.config\.(js|ts|mjs|cjs)|(tsconfig|jsconfig)\.json)$/i.test(f)) {
      priority.config.push(f);
    }
  }

  // Entrypoints
  const entryCandidates = [
    "main.js", "index.js", "server.js", "app.js", "cli.js",
    "index.ts", "main.ts", "app.ts", "server.ts",
    "src/index.js", "src/index.ts", "src/main.js", "src/main.ts",
  ];
  for (const f of entryCandidates) {
    if (listedFiles.has(f)) priority.entrypoints.push(f);
  }

  // --- 3. Detectar carpetas de código y listar contenido ---
  const presentSourceDirs = SOURCE_DIRS.filter((d) => listedDirs.has(d));
  const sourceFilesFound = [];
  for (const dir of presentSourceDirs.slice(0, 5)) {
    onProgress?.({ phase: "tool", name: "list_files", input: { path: dir } });
    const sub = tools.listFiles(projectRoot, dir);
    steps.push({ name: "list_files", input: { path: dir }, result: sub, ok: sub.ok });
    // Candidatos: index y archivos con nombres "principales"
    const dirFiles = (sub.files || []).map((f) => String(f).replace(/\\/g, "/"));
    const ranked = dirFiles
      .map((name) => ({ name, score:
        /^index\./i.test(name) ? 0 :
        /^main\./i.test(name) ? 1 :
        /^(server|app|router|routes|api|core)\./i.test(name) ? 2 :
        /\.(js|ts|tsx|jsx|mjs|cjs)$/i.test(name) ? 3 : 4,
      }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 4);
    for (const r of ranked) {
      sourceFilesFound.push(`${dir}/${r.name}`);
    }
  }

  // --- 4. Plan de lectura ---
  const plan = [
    ...(wantsRoadmap ? priority.docs.filter((f) => /roadmap/i.test(f)) : []),
    ...priority.config.slice(0, 3),
    ...priority.entrypoints.slice(0, 4),
    ...sourceFilesFound.slice(0, 8),
    ...priority.docs.filter((f) => !/roadmap/i.test(f)),
  ];

  const unique = [...new Set(plan)]
    .filter((f) => listedFiles.has(f) || mapFiles.has(f) || f.includes("/"))
    .slice(0, maxReads);

  // --- 5. Leer archivos con presupuesto por tipo ---
  const excerpts = [];
  for (const file of unique) {
    if (readCount >= maxReads) break;
    onProgress?.({ phase: "tool", name: "read_file", input: { path: file } });
    const budget = /roadmap/i.test(file) ? 4000
      : /package\.json/i.test(file) ? 1500
      : /\.(md|txt)$/i.test(file) ? 2500
      : 3200;
    const contentRes = tools.readFile(projectRoot, file, budget);
    steps.push({ name: "read_file", input: { path: file }, result: contentRes, ok: contentRes.ok });
    readCount += 1;
    if (contentRes?.ok && contentRes.content) {
      excerpts.push({
        path: file,
        header: excerptHeader(file, contentRes, checkSyntax(projectRoot, file)),
        content: String(contentRes.content),
      });
    }
  }

  // --- 6. Armar evidencia base para el LLM ---
  const roadmapBits = excerpts.filter((e) => /roadmap/i.test(e.path));
  const nonRoadmapBits = excerpts.filter((e) => !/roadmap/i.test(e.path));

  const report = [
    "# Evidencia base del proyecto",
    `- **Raíz**: ${projectRoot}`,
    `- **Archivos leídos**: ${readCount}`,
    `- **Carpetas de código detectadas**: ${presentSourceDirs.length ? presentSourceDirs.join(", ") : "(ninguna obvia)"}`,
    cognitive?.rootDirs?.length ? `- **Carpetas raíz**: ${cognitive.rootDirs.slice(0, 20).join(", ")}` : "",
    cognitive?.stack?.length ? `- **Stack detectado**: ${cognitive.stack.join(", ")}` : "",
    testScriptLine(projectRoot),
    "",
    roadmapBits.length
      ? ["## ROADMAP (extracto)", ...roadmapBits.map((e) => `${e.header}\n\`\`\`\n${e.content}\n\`\`\``)].join("\n")
      : "## ROADMAP\n_No se encontró ROADMAP.md legible._",
    "",
    "## Archivos leídos",
    ...nonRoadmapBits.map((e) => `${e.header}\n\`\`\`\n${e.content}\n\`\`\``),
    "",
    "## Reglas de evidencia",
    "- Los extractos son PARCIALES por presupuesto de tokens. Que un extracto termine a mitad de una función NO significa que el archivo esté truncado ni incompleto: nunca lo reportes como hallazgo.",
    "- La integridad de cada archivo está en su encabezado (líneas totales, bytes, sintaxis). Solo hay archivo roto si la sintaxis dice ERROR.",
    "- Para ver más de un archivo usa read_file con startLine/endLine.",
    "- EditCore no ejecutó tests ni builds en este análisis: no afirmes que pasan ni que no se ejecutaron; di 'no verificado en este análisis'.",
    "- Cada hallazgo cita archivo y línea leída. Si no pudiste comprobar algo, márcalo 'no verificado'.",
    "",
    "## Instrucción para el analista",
    "Con esta evidencia genera un informe real. Si necesitas más contexto (módulos, configuraciones específicas, tests), usa read_file para leerlos ANTES de cerrar.",
  ].join("\n");

  return { report, steps, excerpts, wantsRoadmap, presentSourceDirs };
}

module.exports = { runAnalyst };