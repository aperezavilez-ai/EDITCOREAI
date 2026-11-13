"use strict";

const fs = require("fs");
const path = require("path");
const tools = require("../tools");

function loadProjectMap() {
  try {
    return require("../../runtime/project-map");
  } catch {
    try {
      return require("../project-map");
    } catch {
      return null;
    }
  }
}

/** Explorer enriquecido: árbol real vía mapa cognitivo + configs clave. */
async function runExplorer({ projectRoot, target = ".", onProgress, signal, memoryContext = "" }) {
  if (signal?.aborted) {
    return { ok: false, aborted: true, summary: "Exploración cancelada por el usuario.", steps: [], target };
  }
  const mapApi = loadProjectMap();
  let cognitive = null;
  let resolvedTarget = target;
  let resolveMeta = null;

  try {
    if (mapApi?.ensureProjectMap) {
      const ensured = mapApi.ensureProjectMap(projectRoot, { maxAgeMs: 5 * 60_000 });
      cognitive = ensured?.map || null;
    }
    if (mapApi?.resolveExistingTarget) {
      resolveMeta = mapApi.resolveExistingTarget(projectRoot, target, cognitive);
      resolvedTarget = resolveMeta?.target || ".";
      cognitive = resolveMeta?.map || cognitive;
    }
  } catch {
    resolvedTarget = target || ".";
  }

  const label = resolveMeta?.missing
    ? `${resolvedTarget} (solicitado '${resolveMeta.missing}' no existe)`
    : resolvedTarget;

  // [EDITCORE-V511-B] Sin etiqueta a la superficie: este progreso
  // («Mapeando …») se anunciaba como línea del chat — el renderer lo
  // prefija con 🧠 — y Luis lo vetó (regla de producto 2026-11-11:
  // nada de líneas-recibo del sistema; solo la voz del agente). La
  // exploración y sus fases internas continúan igual; su etiqueta ya
  // no se anuncia. Mismo criterio con el que en la v4.9.2 se silenció
  // el contador del Cerebro: el trabajo sigue ocurriendo, el anuncio
  // no. (`label` se conserva: documenta la resolución del target.)
  void label;
  const steps = [];
  const res = tools.listFiles(projectRoot, resolvedTarget);
  if (signal?.aborted) {
    return { ok: false, aborted: true, summary: "Exploración cancelada por el usuario.", steps, target: resolvedTarget };
  }
  steps.push({
    name: "list_files",
    input: { path: resolvedTarget, requested: target },
    result: res,
    ok: res.ok,
  });

  if (!res.ok) {
    const roots = (cognitive?.rootDirs || []).slice(0, 20).join(", ") || "(desconocidas)";
    return {
      ok: false,
      summary: [
        `No se pudo listar "${resolvedTarget}": ${res.error}`,
        `Carpetas raíz del mapa: ${roots}`,
        "No se buscan rutas inventadas (src/, app/) si no aparecen en el mapa.",
      ].join("\n"),
      steps,
      map: cognitive,
      target: resolvedTarget,
    };
  }

  const configs = [
    "package.json", "tsconfig.json", ".env.example", ".env.local", ".env",
    "next.config.js", "next.config.ts", "vite.config.ts", "vite.config.js",
  ];
  const configHits = {};
  const rootFiles = new Set([
    ...(res.files || []),
    ...(cognitive?.rootFiles || []),
  ].map((f) => String(f).replace(/\\/g, "/")));

  for (const name of configs) {
    if (!rootFiles.has(name) && !fs.existsSync(path.join(projectRoot, name))) continue;
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
    target: resolvedTarget,
    requested: target,
    missing: resolveMeta?.missing || null,
    dirs: res.dirs || [],
    files: res.files || [],
    configs: Object.keys(configHits),
    deps,
    cognitive: cognitive
      ? {
          rootDirs: cognitive.rootDirs || [],
          stack: cognitive.stack || [],
          dirCount: cognitive.dirCount,
          fileCount: cognitive.fileCount,
        }
      : null,
  };

  const summary = [
    `## Mapa de ${resolvedTarget}`,
    resolveMeta?.missing
      ? `- Nota: la ruta solicitada \`${resolveMeta.missing}\` no existe; se usó el mapa cognitivo.`
      : "",
    cognitive?.rootDirs?.length
      ? `- Carpetas raíz (mapa): ${cognitive.rootDirs.slice(0, 24).join(", ")}`
      : "",
    `- Carpetas: ${(res.dirs || []).join(", ") || "(ninguna)"}`,
    `- Archivos: ${(res.files || []).join(", ") || "(ninguno)"}`,
    `- Configs: ${map.configs.join(", ") || "(ninguna)"}`,
    deps ? `- Scripts: ${Object.keys(deps.scripts).join(", ") || "(ninguno)"}` : "",
    cognitive?.stack?.length ? `- Stack: ${cognitive.stack.join(", ")}` : "",
    // [EDITCORE-V510-B5] Memoria compartida recibida al despacharse:
    // el mapa se lee junto al expediente/Cerebro/Mapa del proyecto.
    memoryContext ? `\n## Memoria compartida (expediente + Cerebro + Mapa)\n${String(memoryContext).slice(0, 3200)}` : "",
  ].filter(Boolean).join("\n");

  // [EDITCORE-V511-B] Tampoco se anuncia «Mapa listo» al cerrar:
  // sin etiquetas del sistema en la superficie (ver la nota de la
  // cabecera). El resumen vuelve al llamador como siempre.
  return { summary, steps, map, target: resolvedTarget };
}

module.exports = { runExplorer };
