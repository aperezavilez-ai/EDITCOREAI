"use strict";

const fs = require("fs");
const path = require("path");
const tools = require("../tools");

/** Explorer enriquecido: árbol + configs clave. */
async function runExplorer({ projectRoot, target = ".", onProgress }) {
  onProgress?.({ phase: "subagent", name: "explorer", text: `Mapeando ${target}...` });
  const steps = [];
  const res = tools.listFiles(projectRoot, target);
  steps.push({ name: "list_files", input: { path: target }, result: res, ok: res.ok });

  if (!res.ok) {
    return { summary: `No se pudo listar "${target}": ${res.error}`, steps, map: null };
  }

  const configs = ["package.json", "tsconfig.json", ".env.example", ".env.local", ".env", "next.config.js", "next.config.ts", "vite.config.ts", "vite.config.js"];
  const configHits = {};
  for (const name of configs) {
    const full = path.join(projectRoot, name);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) {
      const read = tools.readFile(projectRoot, name, 2000);
      steps.push({ name: "read_file", input: { path: name }, ok: read.ok });
      configHits[name] = read.ok ? String(read.content || "").slice(0, 800) : null;
    }
  }

  const deps = (() => {
    try {
      const pkg = JSON.parse(configHits["package.json"] || "{}");
      return {
        scripts: pkg.scripts || {},
        dependencies: Object.keys(pkg.dependencies || {}).slice(0, 40),
        devDependencies: Object.keys(pkg.devDependencies || {}).slice(0, 40),
      };
    } catch {
      return null;
    }
  })();

  const map = {
    root: projectRoot,
    dirs: res.dirs || [],
    files: res.files || [],
    configs: Object.keys(configHits),
    deps,
  };

  const summary = [
    `## Mapa de ${target}`,
    `- Carpetas: ${(res.dirs || []).join(", ") || "(ninguna)"}`,
    `- Archivos: ${(res.files || []).join(", ") || "(ninguno)"}`,
    `- Configs: ${map.configs.join(", ") || "(ninguna)"}`,
    deps ? `- Scripts: ${Object.keys(deps.scripts).join(", ") || "(ninguno)"}` : "",
  ].filter(Boolean).join("\n");

  onProgress?.({ phase: "subagent", name: "explorer", text: "Mapa listo" });
  return { summary, steps, map };
}

module.exports = { runExplorer };
