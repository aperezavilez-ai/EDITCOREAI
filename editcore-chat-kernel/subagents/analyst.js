"use strict";

const tools = require("../tools");

function loadMap() {
  try {
    return require("../../runtime/project-map");
  } catch {
    return null;
  }
}

async function runAnalyst({ projectRoot, onProgress, maxReads = 8, userMessage = "" }) {
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

  const listed = new Set((rootList.files || []).map((f) => String(f).replace(/\\/g, "/")));
  const mapFiles = new Set((cognitive?.files || []).map((f) => String(f).replace(/\\/g, "/")));
  const wantsRoadmap = /\broadmap\b|\betapa\b|\bestado\b|\bestado\s+del\s+proyecto\b/i.test(String(userMessage || ""));

  const importantFiles = [
    "ROADMAP.md",
    "EDITCORE-MANIFEST.md",
    ".editcore/session-state.json",
    ...(cognitive?.entrypoints || []),
    "package.json",
    "README.md",
    "index.js",
    "main.js",
  ];

  const foundToRead = [...new Set(importantFiles)]
    .filter((f) => listed.has(f) || mapFiles.has(f));

  // ROADMAP en raíz o carpeta (p. ej. ROADMAP/, FUXION SERVICE/ROADMAP.md)
  for (const name of listed) {
    if (foundToRead.length >= maxReads) break;
    if (/^ROADMAP(\.md)?$/i.test(name)) {
      if (/\.md$/i.test(name)) foundToRead.push(name);
      else foundToRead.push(`${name}/ROADMAP.md`, `${name}.md`);
    }
  }

  // Priorizar ROADMAP al inicio si el usuario lo pidió
  const prioritized = wantsRoadmap
    ? [...foundToRead.filter((f) => /roadmap/i.test(f)), ...foundToRead.filter((f) => !/roadmap/i.test(f))]
    : foundToRead;

  const unique = [...new Set(prioritized)].slice(0, maxReads);
  const excerpts = [];

  for (const file of unique) {
    if (readCount >= maxReads) break;
    onProgress?.({ phase: "tool", name: "read_file", input: { path: file } });
    const contentRes = tools.readFile(projectRoot, file, 6000);
    steps.push({ name: "read_file", input: { path: file }, result: contentRes, ok: contentRes.ok });
    readCount += 1;
    if (contentRes?.ok && contentRes.content) {
      excerpts.push({
        path: file,
        content: String(contentRes.content).slice(0, /roadmap/i.test(file) ? 4500 : 1800),
      });
    }
  }

  const roadmapBits = excerpts.filter((e) => /roadmap/i.test(e.path));
  const report = [
    "# Diagnóstico del proyecto",
    `- Raíz: ${projectRoot}`,
    `- Archivos leídos: ${readCount}`,
    cognitive?.rootDirs?.length
      ? `- Carpetas raíz (mapa): ${cognitive.rootDirs.slice(0, 20).join(", ")}`
      : "",
    cognitive?.stack?.length ? `- Stack: ${cognitive.stack.join(", ")}` : "",
    "",
    roadmapBits.length
      ? [
        "## Evidencia ROADMAP",
        ...roadmapBits.map((e) => `### ${e.path}\n\`\`\`\n${e.content}\n\`\`\``),
      ].join("\n")
      : "## Evidencia ROADMAP\nNo se encontró ROADMAP.md legible en la raíz ni en carpetas listadas.",
    "",
    "## Otros archivos leídos",
    excerpts.filter((e) => !/roadmap/i.test(e.path)).map((e) => `- ${e.path}`).join("\n") || "- (ninguno)",
  ].filter(Boolean).join("\n");

  return { report, steps, excerpts, wantsRoadmap };
}

module.exports = { runAnalyst };
