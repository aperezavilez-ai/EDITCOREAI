"use strict";

const tools = require("../tools");

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
    if (/^(package\.json|next\.config|vite\.config|tailwind\.config|tsconfig|jsconfig|jest\.config|vitest\.config|eslint\.config)\.(js|ts|mjs|cjs|json)?$/i.test(f)) {
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
    const contentRes = tools.readFile(projectRoot, file, 6000);
    steps.push({ name: "read_file", input: { path: file }, result: contentRes, ok: contentRes.ok });
    readCount += 1;
    if (contentRes?.ok && contentRes.content) {
      const budget = /roadmap/i.test(file) ? 4000
        : /package\.json/i.test(file) ? 1500
        : /\.(md|txt)$/i.test(file) ? 2500
        : 3200;
      excerpts.push({
        path: file,
        content: String(contentRes.content).slice(0, budget),
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
    "",
    roadmapBits.length
      ? ["## ROADMAP (extracto)", ...roadmapBits.map((e) => `### ${e.path}\n\`\`\`\n${e.content}\n\`\`\``)].join("\n")
      : "## ROADMAP\n_No se encontró ROADMAP.md legible._",
    "",
    "## Archivos leídos",
    ...nonRoadmapBits.map((e) => `### ${e.path}\n\`\`\`\n${e.content}\n\`\`\``),
    "",
    "## Instrucción para el analista",
    "Con esta evidencia genera un informe real. Si necesitas más contexto (módulos, configuraciones específicas, tests), usa read_file para leerlos ANTES de cerrar.",
  ].join("\n");

  return { report, steps, excerpts, wantsRoadmap, presentSourceDirs };
}

module.exports = { runAnalyst };