"use strict";

const fs = require("node:fs");
const path = require("node:path");

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage",
  ".turbo", ".cache", "out", "tmp", "temp", ".editcore", "graphify-out",
  "release", "release-275", "win-unpacked", "packaged", "app.asar",
  "app.asar.unpacked", "brain-seed",
]);

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
  ".vue", ".svelte", ".json", ".py", ".go", ".rs", ".sql"
]);

/**
 * Categoriza un archivo según su nombre y ruta.
 */
function categorizeNode(relPath) {
  const norm = relPath.replace(/\\/g, "/").toLowerCase();
  if (/\b(?:test|spec|__tests__)\b/.test(norm)) return "test";
  if (/\b(?:components?|views?|screens?)\b/.test(norm)) return "component";
  if (/\b(?:routes?|pages?|app\/(?:api|[\w-]+))\b/.test(norm)) return "route";
  if (/\b(?:services?|api|controllers?)\b/.test(norm)) return "service";
  if (/\b(?:db|database|supabase|prisma|models?)\b/.test(norm)) return "database";
  if (/\b(?:utils?|helpers?|lib)\b/.test(norm)) return "util";
  if (/\b(?:config|env|settings)\b/.test(norm)) return "config";
  if (/\b(?:styles?|css|scss)\b/.test(norm)) return "style";
  if (/\b(?:docs?|readme|architecture)\b/.test(norm)) return "doc";
  return "module";
}

/**
 * Extrae imports/requires de un archivo de código.
 */
function extractImports(content, ext) {
  const targets = [];
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte"].includes(ext)) {
    return targets;
  }

  // ES module import: import ... from '...' o import '...'
  const importRe = /(?:import\s+(?:[\w*\s{},$]+\s+from\s+)?|export\s+(?:[\w*\s{},$]+\s+from\s+)?)['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(content)) !== null) {
    if (m[1]) targets.push(m[1]);
  }

  // CommonJS require: require('...')
  const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = requireRe.exec(content)) !== null) {
    if (m[1]) targets.push(m[1]);
  }

  // Dynamic import: import('...')
  const dynImportRe = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynImportRe.exec(content)) !== null) {
    if (m[1]) targets.push(m[1]);
  }

  return [...new Set(targets)];
}

/**
 * Resuelve una ruta de import relativa a una ruta de archivo existente en el proyecto.
 */
function resolveImportTarget(sourceRelPath, importSpecifier, fileMap) {
  if (!importSpecifier.startsWith(".")) {
    return null; // Paquete externo de node_modules
  }

  const sourceDir = path.dirname(sourceRelPath);
  const normalizedCandidate = path.normalize(path.join(sourceDir, importSpecifier)).replace(/\\/g, "/");

  // Coincidencia exacta
  if (fileMap.has(normalizedCandidate)) return normalizedCandidate;

  // Extensiones implícitas (.js, .jsx, .ts, .tsx, .json)
  const candidateExtensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json"];
  for (const ext of candidateExtensions) {
    const withExt = normalizedCandidate + ext;
    if (fileMap.has(withExt)) return withExt;
  }

  // Index file (e.g. ./lib -> ./lib/index.js)
  for (const ext of candidateExtensions) {
    const indexWithExt = normalizedCandidate + "/index" + ext;
    if (fileMap.has(indexWithExt)) return indexWithExt;
  }

  return null;
}

/**
 * Recorre el árbol de archivos.
 */
function walkProject(dir, rootDir, fileList = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return fileList;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      walkProject(fullPath, rootDir, fileList);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        fileList.push({
          relPath,
          fullPath,
          ext,
          size: entry.size || 0,
        });
      }
    }
  }

  return fileList;
}

/**
 * Genera el grafo del proyecto completo con Graphify.
 */
async function buildProjectGraph(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || ".");
  const startedAt = Date.now();
  const files = walkProject(root, root);

  const fileMap = new Map();
  for (const f of files) {
    fileMap.set(f.relPath, f);
  }

  const nodes = [];
  const edges = [];
  const inDegreeMap = new Map();
  const outDegreeMap = new Map();
  const clusters = new Map();

  for (const f of files) {
    const category = categorizeNode(f.relPath);
    const clusterName = f.relPath.includes("/") ? f.relPath.split("/")[0] : "root";
    if (!clusters.has(clusterName)) clusters.set(clusterName, []);
    clusters.get(clusterName).push(f.relPath);

    let content = "";
    try {
      content = fs.readFileSync(f.fullPath, "utf8");
    } catch {
      content = "";
    }

    const linesCount = content ? content.split("\n").length : 0;
    const imports = extractImports(content, f.ext);

    nodes.push({
      id: f.relPath,
      label: path.basename(f.relPath),
      path: f.relPath,
      category,
      cluster: clusterName,
      lines: linesCount,
      size: content.length,
      ext: f.ext,
    });

    inDegreeMap.set(f.relPath, inDegreeMap.get(f.relPath) || 0);
    outDegreeMap.set(f.relPath, 0);

    for (const specifier of imports) {
      const resolvedTarget = resolveImportTarget(f.relPath, specifier, fileMap);
      if (resolvedTarget) {
        edges.push({
          source: f.relPath,
          target: resolvedTarget,
          type: "imports",
        });
        inDegreeMap.set(resolvedTarget, (inDegreeMap.get(resolvedTarget) || 0) + 1);
        outDegreeMap.set(f.relPath, (outDegreeMap.get(f.relPath) || 0) + 1);
      }
    }
  }

  // Identificar God Nodes (alta centralidad / más referenciados)
  const nodeDegrees = nodes.map((n) => ({
    id: n.id,
    category: n.category,
    inDegree: inDegreeMap.get(n.id) || 0,
    outDegree: outDegreeMap.get(n.id) || 0,
  })).sort((a, b) => b.inDegree - a.inDegree);

  const godNodes = nodeDegrees.filter((n) => n.inDegree >= 3).slice(0, 10);

  // Crear carpetas de salida
  const outDir = path.join(root, "graphify-out");
  fs.mkdirSync(outDir, { recursive: true });

  // 1. Guardar graph.json (GraphRAG-ready)
  const graphJson = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    projectRoot: root,
    statistics: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      totalClusters: clusters.size,
      godNodeCount: godNodes.length,
      durationMs: Date.now() - startedAt,
    },
    clusters: Object.fromEntries(clusters),
    godNodes,
    nodes,
    edges,
  };

  const jsonPath = path.join(outDir, "graph.json");
  fs.writeFileSync(jsonPath, JSON.stringify(graphJson, null, 2), "utf8");

  // 2. Generar GRAPH_REPORT.md
  const reportLines = [
    `# 🕸️ Reporte de Arquitectura y Grafo del Proyecto (Graphify)`,
    ``,
    `> Generado automáticamente el **${new Date().toLocaleString()}** en ${graphJson.statistics.durationMs}ms.`,
    ``,
    `## 📊 Resumen Ejecutivo`,
    `- **Nodos (Archivos analizados):** ${nodes.length}`,
    `- **Aristas (Relaciones de dependencia/import):** ${edges.length}`,
    `- **Comunidades/Módulos detectados:** ${clusters.size}`,
    `- **God Nodes (Nodos de alta centralidad):** ${godNodes.length}`,
    ``,
    `## 👑 God Nodes (Módulos Núcleo / Alta Centralidad)`,
    `Estos archivos son el corazón del proyecto; cambios en ellos impactan múltiples componentes:`,
    ``,
    `| Archivo | Tipo | Dependientes (In-Degree) | Salientes (Out-Degree) |`,
    `| :--- | :--- | :--- | :--- |`,
    ...godNodes.map((g) => `| \`${g.id}\` | ${g.category} | ${g.inDegree} | ${g.outDegree} |`),
    ``,
    `## 📦 Comunidades y Clústeres de Módulos`,
    ...Array.from(clusters.entries()).map(([cName, cFiles]) => `- **${cName}/**: ${cFiles.length} archivo(s)`),
    ``,
    `## 🔗 Principales Conexiones de Dependencia`,
    `| Archivo Origen | Depende de (Importa) |`,
    `| :--- | :--- |`,
    ...edges.slice(0, 40).map((e) => `| \`${e.source}\` | \`${e.target}\` |`),
    edges.length > 40 ? `| _(${edges.length - 40} relaciones adicionales registradas en graph.json)_ | ... |` : "",
    ``,
    `## 💡 Recomendaciones de Arquitectura`,
    `- Proteger los God Nodes con tests unitarios robustos para prevenir regresiones en cascada.`,
    `- Mantener acoplamiento bajo entre clústeres evitando dependencias cruzadas innecesarias.`,
    ``,
  ].filter(Boolean);

  const reportPath = path.join(outDir, "GRAPH_REPORT.md");
  fs.writeFileSync(reportPath, reportLines.join("\n"), "utf8");

  // 3. Generar HTML Interactivo (graph.html)
  const htmlPath = path.join(outDir, "graph.html");
  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Graphify — Visualizador de Arquitectura</title>
  <style>
    body { margin: 0; background: #0c0d12; color: #e4e6eb; font-family: system-ui, sans-serif; display: flex; flex-direction: column; height: 100vh; }
    header { padding: 12px 20px; background: #161822; border-bottom: 1px solid #232738; display: flex; justify-content: space-between; align-items: center; }
    h1 { font-size: 16px; margin: 0; color: #4fa3ff; }
    .stats { font-size: 13px; color: #8e95a5; }
    #container { flex: 1; position: relative; overflow: hidden; display: flex; }
    #sidebar { width: 320px; background: #12141c; border-right: 1px solid #232738; padding: 16px; overflow-y: auto; font-size: 13px; }
    #canvas { flex: 1; width: 100%; height: 100%; background: #0c0d12; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 6px; background: #232738; color: #4fa3ff; }
  </style>
</head>
<body>
  <header>
    <h1>🕸️ Graphify Architecture Graph</h1>
    <div class="stats">Nodos: <strong>${nodes.length}</strong> | Conexiones: <strong>${edges.length}</strong> | Módulos: <strong>${clusters.size}</strong></div>
  </header>
  <div id="container">
    <div id="sidebar">
      <h3>👑 God Nodes Principales</h3>
      <ul>
        ${godNodes.map((g) => `<li><strong>${g.id}</strong> <span class="badge">${g.inDegree} refs</span></li>`).join("")}
      </ul>
      <h3>📦 Módulos (${clusters.size})</h3>
      <ul>
        ${Array.from(clusters.keys()).map((k) => `<li>${k}</li>`).join("")}
      </ul>
    </div>
    <canvas id="canvas"></canvas>
  </div>
  <script>
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    function resize() { canvas.width = canvas.parentElement.clientWidth - 320; canvas.height = canvas.parentElement.clientHeight; draw(); }
    window.addEventListener('resize', resize);
    const nodes = ${JSON.stringify(nodes.slice(0, 80))};
    const edges = ${JSON.stringify(edges.slice(0, 120))};
    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2; const cy = canvas.height / 2;
      const r = Math.min(cx, cy) - 60;
      const pos = {};
      nodes.forEach((n, i) => {
        const angle = (i / nodes.length) * 2 * Math.PI;
        pos[n.id] = { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
      });
      ctx.strokeStyle = '#232738'; ctx.lineWidth = 1;
      edges.forEach(e => {
        if (pos[e.source] && pos[e.target]) {
          ctx.beginPath(); ctx.moveTo(pos[e.source].x, pos[e.source].y);
          ctx.lineTo(pos[e.target].x, pos[e.target].y); ctx.stroke();
        }
      });
      nodes.forEach(n => {
        const p = pos[n.id];
        ctx.fillStyle = n.category === 'component' ? '#4fa3ff' : n.category === 'service' ? '#38d39f' : '#ffaa33';
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = '#a0a8be'; ctx.font = '10px monospace';
        ctx.fillText(n.label, p.x + 8, p.y + 3);
      });
    }
    setTimeout(resize, 50);
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, htmlContent, "utf8");

  return {
    ok: true,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    totalClusters: clusters.size,
    godNodes: godNodes.map((g) => g.id),
    outputDir: "graphify-out",
    reportPath: "graphify-out/GRAPH_REPORT.md",
    jsonPath: "graphify-out/graph.json",
    htmlPath: "graphify-out/graph.html",
    durationMs: Date.now() - startedAt,
    summary: `Grafo del proyecto generado exitosamente con Graphify: ${nodes.length} nodos, ${edges.length} aristas y ${clusters.size} módulos. Archivos listos en graphify-out/ (GRAPH_REPORT.md, graph.json, graph.html).`,
  };
}

module.exports = {
  buildProjectGraph,
  categorizeNode,
  extractImports,
};
