"use strict";

const fs = require("fs");
const path = require("path");

async function runDevopsSubagent({ projectRoot, target = ".", signal, memoryContext = "" }) {
  if (signal?.aborted) {
    return { ok: false, aborted: true, summary: "Inspección DevOps cancelada.", steps: [] };
  }

  const reports = [];
  const configs = [];

  for (const rel of [
    "vercel.json", "netlify.toml", "Dockerfile", "docker-compose.yml",
    ".github/workflows/deploy.yml", ".github/workflows/ci.yml",
  ]) {
    if (fs.existsSync(path.join(projectRoot, rel))) {
      configs.push(rel);
      reports.push(`- **Configuración de CI/Deploy**: \`${rel}\``);
    }
  }

  const pkgPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const scripts = pkg.scripts || {};
      const devopsScripts = Object.keys(scripts).filter((s) => /build|deploy|start|preview|docker/i.test(s));
      if (devopsScripts.length) {
        reports.push(`- **Scripts de build/deploy**: ${devopsScripts.map((s) => `\`${s}\``).join(", ")}`);
      }
    } catch { /* ignore */ }
  }

  const summary = [
    `## Diagnóstico DevOps y Pipeline de Despliegue (${target})`,
    reports.length ? reports.join("\n") : "- No se detectaron pipelines de CI/CD ni Dockerfiles en la raíz.",
    configs.length ? `\n### Archivos de infraestructura:\n${configs.map((f) => `- ${f}`).join("\n")}` : "",
    memoryContext ? `\n### Contexto compartido:\n${String(memoryContext).slice(0, 1000)}` : "",
  ].filter(Boolean).join("\n");

  return { ok: true, summary, report: summary, configsCount: configs.length };
}

module.exports = { runDevopsSubagent };
