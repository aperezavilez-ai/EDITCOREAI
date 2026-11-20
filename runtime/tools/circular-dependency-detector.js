"use strict";

const fs = require("fs");
const path = require("path");

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", ".turbo", "coverage", ".system_generated"
]);

const EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];

function extractDependencies(filePath) {
  try {
    const code = fs.readFileSync(filePath, "utf8");
    const deps = new Set();

    // require('...') or require("...")
    const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = requireRegex.exec(code)) !== null) {
      if (match[1] && match[1].startsWith(".")) {
        deps.add(match[1]);
      }
    }

    // import ... from '...' or import('...')
    const importRegex = /(?:import\s+(?:[\s\w{},*]+from\s+)?|import\s*\()\s*['"]([^'"]+)['"]/g;
    while ((match = importRegex.exec(code)) !== null) {
      if (match[1] && match[1].startsWith(".")) {
        deps.add(match[1]);
      }
    }

    return Array.from(deps);
  } catch {
    return [];
  }
}

function resolveDependencyPath(sourceFile, depRelative) {
  const dir = path.dirname(sourceFile);
  const targetBase = path.resolve(dir, depRelative);

  // 1. Direct file match
  if (fs.existsSync(targetBase) && fs.statSync(targetBase).isFile()) {
    return targetBase;
  }

  // 2. Try extensions
  for (const ext of EXTENSIONS) {
    const candidate = `${targetBase}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  // 3. Try index files in directory
  if (fs.existsSync(targetBase) && fs.statSync(targetBase).isDirectory()) {
    for (const ext of EXTENSIONS) {
      const candidate = path.join(targetBase, `index${ext}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  return null;
}

function collectSourceFiles(targetDir, rootDir, files = []) {
  if (!fs.existsSync(targetDir)) return files;
  const entries = fs.readdirSync(targetDir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    const fullPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, rootDir, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTENSIONS.includes(ext)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function detectCircularDependencies(projectRoot, options = {}) {
  const root = path.resolve(projectRoot || process.cwd());
  const scanTarget = options.path ? path.resolve(root, options.path) : root;
  const maxDepth = Number(options.maxDepth) || 25;

  const allFiles = collectSourceFiles(scanTarget, root);
  const graph = new Map();

  for (const file of allFiles) {
    const relSource = path.relative(root, file).replace(/\\/g, "/");
    const rawDeps = extractDependencies(file);
    const resolvedDeps = [];

    for (const rawDep of rawDeps) {
      const resolved = resolveDependencyPath(file, rawDep);
      if (resolved && resolved.startsWith(root)) {
        const relDep = path.relative(root, resolved).replace(/\\/g, "/");
        if (relDep !== relSource) {
          resolvedDeps.push(relDep);
        }
      }
    }

    graph.set(relSource, resolvedDeps);
  }

  const cycles = [];
  const visited = new Set();
  const recursionStack = [];

  function dfs(node, depth) {
    if (depth > maxDepth) return;
    const stackIdx = recursionStack.indexOf(node);

    if (stackIdx !== -1) {
      const cyclePath = recursionStack.slice(stackIdx).concat(node);
      const cycleKey = cyclePath.slice(0, -1).sort().join("|");
      if (!cycles.some((c) => c.key === cycleKey)) {
        cycles.push({
          key: cycleKey,
          length: cyclePath.length - 1,
          cycle: cyclePath,
          description: cyclePath.join(" -> "),
        });
      }
      return;
    }

    if (visited.has(node)) return;
    visited.add(node);
    recursionStack.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      dfs(neighbor, depth + 1);
    }

    recursionStack.pop();
  }

  for (const node of graph.keys()) {
    visited.clear();
    dfs(node, 0);
  }

  return {
    ok: true,
    scannedFiles: allFiles.length,
    graphSize: graph.size,
    hasCycles: cycles.length > 0,
    cycleCount: cycles.length,
    cycles: cycles.map(({ length, cycle, description }) => ({ length, cycle, description })),
    summary: cycles.length === 0
      ? `No se detectaron dependencias circulares en ${allFiles.length} archivos analizados.`
      : `Se detectaron ${cycles.length} dependencias circulares en ${allFiles.length} archivos.`,
  };
}

module.exports = {
  detectCircularDependencies,
  extractDependencies,
  resolveDependencyPath,
};
