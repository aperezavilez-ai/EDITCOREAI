"use strict";

/**
 * Auto docs: genera/actualiza documentacion basica del proyecto.
 */

const fs = require("node:fs");
const path = require("node:path");

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function listTopEntries(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .slice(0, 40)
      .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
  } catch {
    return [];
  }
}

function generateAutoDocs(projectRoot, { write = true } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) throw new Error("Proyecto invalido.");
  const pkg = readJsonSafe(path.join(root, "package.json")) || {};
  const name = pkg.name || path.basename(root);
  const entries = listTopEntries(root);
  const scripts = pkg.scripts && typeof pkg.scripts === "object"
    ? Object.keys(pkg.scripts).slice(0, 12)
    : [];
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const depNames = Object.keys(deps).slice(0, 20);

  const readme = `# ${name}

Documento generado automaticamente por EDITCOREAI (AUTO DOCS).

## Resumen

- Nombre: \`${name}\`
- Version: \`${pkg.version || "n/a"}\`
- Descripcion: ${pkg.description || "(sin description en package.json)"}

## Estructura (raiz)

${entries.map((e) => `- \`${e.name}${e.type === "dir" ? "/" : ""}\``).join("\n") || "- (vacia)"}

## Scripts

${scripts.length ? scripts.map((s) => `- \`npm run ${s}\``).join("\n") : "- (sin scripts)"}

## Dependencias (muestra)

${depNames.length ? depNames.map((d) => `- ${d}`).join("\n") : "- (sin package.json deps)"}

## Siguiente

1. Revisa este archivo y elimina lo que no aplique.
2. Escribe \`WORKFLOWS INIT\` si quieres playbooks locales.
3. Mantén \`ROADMAP.md\` como fuente de verdad del estado.

---
Generado: ${new Date().toISOString()}
`;

  const apiDoc = `# API / superficies

Auto-docs EDITCOREAI — inventariar endpoints cuando existan.

## Detectado

${fs.existsSync(path.join(root, "resources", "app", "main.js"))
    ? "- Runtime Electron en `resources/app/main.js` (IPC handlers)."
    : "- No se detecto main Electron tipico."}
${fs.existsSync(path.join(root, "src")) ? "- Carpeta `src/` presente." : "- Sin carpeta `src/`."}

Actualiza esta pagina cuando agregues rutas HTTP o IPC nuevas.
`;

  const out = {
    readmePath: "docs/AUTO_README.md",
    apiPath: "docs/AUTO_API.md",
    readme,
    apiDoc,
  };

  if (write) {
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "AUTO_README.md"), readme, "utf8");
    fs.writeFileSync(path.join(root, "docs", "AUTO_API.md"), apiDoc, "utf8");
  }
  return { ok: true, ...out, files: [out.readmePath, out.apiPath] };
}

module.exports = {
  generateAutoDocs,
  listTopEntries,
};
