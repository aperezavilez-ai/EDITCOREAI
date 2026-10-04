"use strict";

const { buildSoundOneFiles } = require("./soundone-template");

function packageName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function compactRoadmap(name, template) {
  return [
    `# ${name} — ROADMAP`,
    "",
    "Indice compacto para agentes. Leer este archivo ANTES de explorar el repo. Actualizar al cerrar cada tarea. No pegar codigo fuente.",
    "",
    "## Estado",
    `- Plantilla: ${template}`,
    "- Fase: scaffold inicial",
    "",
    "## Mapa",
    "- README.md — descripcion",
    template === "react" ? "- src/main.jsx — entrada React" : "",
    template === "web" ? "- index.html, styles.css, app.js — app estatica" : "",
    template === "node" ? "- src/index.js — entrada Node" : "",
    "- AGENTS.md — reglas del agente",
    "",
    "## Tarea activa",
    "- Scaffold creado. Esperando pedido del usuario.",
    "",
    "## Siguiente",
    "- Implementar el pedido. Tras cambios: verificar (test/build/preview) y actualizar este ROADMAP.",
    "",
  ].filter((line) => line !== "").join("\n");
}

function buildProjectTemplate(input = {}) {
  const name = String(input.name || "").trim();
  const template = String(input.template || "blank").toLowerCase();
  if (!/^[a-z0-9][a-z0-9 _.-]{1,79}$/i.test(name)) throw new Error("Nombre de proyecto invalido.");
  if (!["blank", "web", "node", "react", "soundonemusic", "pro-web-app", "web-pro"].includes(template)) throw new Error("Plantilla no permitida.");
  const files = template === "blank"
    ? { "README.md": `# ${name}\n\nProyecto vacio creado con EDITCOREAI.\n` }
    : {
      "README.md": `# ${name}\n\nProyecto creado con EDITCOREAI.\n`,
      "AGENTS.md": "# Proyecto\n\nAnaliza, implementa, prueba y verifica cada cambio antes de cerrar la tarea.\n\nAntes de explorar el repo entero, lee ROADMAP.md. Tras cada tarea, actualizalo (estado, mapa, siguiente) para ahorrar tokens.\n",
      "ROADMAP.md": compactRoadmap(name, template),
    };
  if (template === "web") Object.assign(files, {
    "index.html": `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><link rel="stylesheet" href="styles.css"></head><body><main id="app"><h1>${name}</h1></main><script src="app.js"></script></body></html>\n`,
    "styles.css": "* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n",
    "app.js": '"use strict";\n',
  });
  if (template === "node") Object.assign(files, {
    "package.json": JSON.stringify({ name: packageName(name), version: "1.0.0", private: true, scripts: { start: "node src/index.js", test: "node --test" } }, null, 2) + "\n",
    "src/index.js": '"use strict";\n\nconsole.log("Proyecto listo");\n',
  });
  if (template === "react") Object.assign(files, {
    "package.json": JSON.stringify({ name: packageName(name), version: "1.0.0", private: true, type: "module", scripts: { dev: "vite", build: "vite build", test: "vitest run --passWithNoTests" }, dependencies: { react: "latest", "react-dom": "latest" }, devDependencies: { "@vitejs/plugin-react": "latest", vite: "latest", vitest: "latest" } }, null, 2) + "\n",
    "index.html": '<div id="root"></div><script type="module" src="/src/main.jsx"></script>\n',
    "src/main.jsx": 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")).render(<h1>Proyecto listo</h1>);\n',
    "src/styles.css": "* { box-sizing: border-box; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n",
  });
  if (template === "soundonemusic") Object.assign(files, buildSoundOneFiles(name));
  return { name, template, files };
}

module.exports = { buildProjectTemplate, packageName };
