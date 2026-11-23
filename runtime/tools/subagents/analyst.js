"use strict";

const fs = require("fs");
const path = require("path");
const tools = require("../tools");

function checkSyntax(projectRoot, file) {
  try {
    const full = path.join(projectRoot, file);
    if (!fs.existsSync(full)) return "";
    const ext = path.extname(file).toLowerCase();
    if (![".js", ".mjs", ".cjs", ".json"].includes(ext)) return "";
    const code = fs.readFileSync(full, "utf8");
    if (ext === ".json") {
      JSON.parse(code);
      return "sintaxis JSON válida";
    }
    const vm = require("vm");
    new vm.Script(code, { filename: file });
    return "sintaxis JS válida";
  } catch (err) {
    const msg = String(err?.message || err);
    if (/cannot use import statement outside a module/i.test(msg)) {
      return "sintaxis no verificada (módulo ES)";
    }
    return `posible advertencia de sintaxis: ${msg.slice(0, 140)}`;
  }
}

function excerptHeader(file, res, syntax) {
  const parts = [`${res.totalLines} líneas, ${res.bytes} bytes`];
  parts.push(res.partial
    ? `extracto: líneas ${res.startLine}-${res.endLine}`
    : "completo");
  if (syntax) parts.push(syntax);
  return `### ${file} — ${parts.join(" · ")}`;
}

function testScriptLine(projectRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const script = String(pkg?.scripts?.test || "").trim();
    if (!script) return "- **Tests**: package.json no define script `test`.";
    return `- **Tests**: script \`npm test\` = \`${script.slice(0, 120)}\`.`;
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

const SOURCE_DIRS = [
  "src", "lib", "app", "server", "api", "packages", "core",
  "modules", "runtime", "agent-core", "components", "pages", "routes",
];

async function runAnalyst({ projectRoot, onProgress, maxReads = 12, userMessage = "", signal, memoryContext = "" }) {
  if (signal?.aborted) {
    return { ok: false, aborted: true, report: "Análisis cancelado por el usuario.", steps: [] };
  }
  const steps = [];
  let readCount = 0;
  const mapApi = loadMap();
  let cognitive = null;
  try {
    cognitive = mapApi?.ensureProjectMap?.(projectRoot, { maxAgeMs: 5 * 60_000 })?.map || null;
  } catch {
    cognitive = null;
  }

  const rootList = tools.listFiles(projectRoot, ".");
  steps.push({ name: "list_files", input: { path: "." }, result: rootList, ok: rootList.ok });

  const listedFiles = new Set((rootList.files || []).map((f) => String(f).replace(/\\/g, "/")));
  const listedDirs = new Set((rootList.dirs || []).map((f) => String(f).replace(/\\/g, "/")));

  const priority = { docs: [], config: [], entrypoints: [], source: [] };

  for (const f of ["ROADMAP.md", "README.md", "AGENTS.md", "CLAUDE.md"]) {
    if (listedFiles.has(f)) priority.docs.push(f);
  }

  for (const f of listedFiles) {
    if (/^(package\.json|(next|vite|tailwind|jest|vitest|eslint)\.config\.(js|ts|mjs|cjs)|(tsconfig|jsconfig)\.json)$/i.test(f)) {
      priority.config.push(f);
    }
  }

  const entryCandidates = [
    "main.js", "index.js", "server.js", "app.js",
    "src/index.js", "src/index.ts", "src/main.js", "src/main.ts",
  ];
  for (const f of entryCandidates) {
    if (listedFiles.has(f)) priority.entrypoints.push(f);
  }

  const presentSourceDirs = SOURCE_DIRS.filter((d) => listedDirs.has(d));
  const sourceFilesFound = [];
  for (const dir of presentSourceDirs.slice(0, 4)) {
    const sub = tools.listFiles(projectRoot, dir);
    steps.push({ name: "list_files", input: { path: dir }, result: sub, ok: sub.ok });
    const dirFiles = (sub.files || []).map((f) => String(f).replace(/\\/g, "/"));
    for (const r of dirFiles.slice(0, 4)) {
      sourceFilesFound.push(`${dir}/${r}`);
    }
  }

  const plan = [
    ...priority.docs,
    ...priority.config.slice(0, 3),
    ...priority.entrypoints.slice(0, 3),
    ...sourceFilesFound.slice(0, 6),
  ];

  const unique = [...new Set(plan)].slice(0, maxReads);
  const excerpts = [];

  for (const file of unique) {
    if (readCount >= maxReads || signal?.aborted) break;
    const budget = /roadmap/i.test(file) ? 4000 : /package\.json/i.test(file) ? 1500 : 2500;
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

  const roadmapBits = excerpts.filter((e) => /roadmap/i.test(e.path));
  const nonRoadmapBits = excerpts.filter((e) => !/roadmap/i.test(e.path));

  const report = [
    "## Análisis de Arquitectura y Estado",
    memoryContext ? `### Memoria Compartida\n${String(memoryContext).slice(0, 2000)}\n` : "",
    `- **Raíz**: ${projectRoot}`,
    `- **Archivos analizados**: ${readCount}`,
    cognitive?.stack?.length ? `- **Stack**: ${cognitive.stack.join(", ")}` : "",
    testScriptLine(projectRoot),
    "",
    roadmapBits.length
      ? ["### ROADMAP del proyecto", ...roadmapBits.map((e) => `${e.header}\n\`\`\`\n${e.content}\n\`\`\``)].join("\n")
      : "",
    "",
    "### Archivos clave inspeccionados",
    ...nonRoadmapBits.map((e) => `${e.header}\n\`\`\`\n${e.content}\n\`\`\``),
  ].filter(Boolean).join("\n");

  return { ok: true, report, summary: report, steps, excerpts, presentSourceDirs };
}

module.exports = { runAnalyst };
