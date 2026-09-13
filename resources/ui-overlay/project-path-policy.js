"use strict";
const fs = require("node:fs");
const path = require("node:path");

function normalizeDriveLetter(p) {
  let resolved = path.resolve(String(p || ""));
  if (process.platform === "win32" && /^[a-z]:/i.test(resolved)) {
    resolved = resolved[0].toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

// Un segmento que termina exactamente en ".asar" es un paquete de solo lectura.
// "app.asar.unpacked" NO coincide: es un directorio real y escribible.
function isInsideAsar(targetPath) {
  return /(^|[\\/])[^\\/]*\.asar([\\/]|$)/i.test(String(targetPath || ""));
}

/**
 * Evita raices basura tipo resources/app-progress.asar (pack intermedio).
 * Prefiere carpeta fuente real: app / app-extracted.
 */
function preferSourceOverAsar(rootPath) {
  const raw = String(rootPath || "").trim();
  if (!raw) return raw;
  const root = normalizeDriveLetter(raw);
  if (!/\.asar$/i.test(root)) return root;
  const dir = path.dirname(root);
  const base = path.basename(root);
  const candidates = [];
  if (/-progress\.asar$/i.test(base)) {
    candidates.push(path.join(dir, "app"));
    candidates.push(path.join(dir, "app-extracted"));
  }
  candidates.push(root.replace(/\.asar$/i, "-extracted"));
  candidates.push(root.replace(/\.asar$/i, ""));
  candidates.push(path.join(dir, "app"));
  candidates.push(path.join(dir, "app-extracted"));
  for (const candidate of candidates) {
    const normalized = normalizeDriveLetter(candidate);
    if (!normalized || /\.asar$/i.test(normalized)) continue;
    try {
      if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory() && !isInsideAsar(normalized)) {
        return normalized;
      }
    } catch {
      /* ignore */
    }
  }
  return root;
}

function assertProjectRoot(rootPath) {
  const root = preferSourceOverAsar(rootPath);
  if (!rootPath || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Proyecto invalido.");
  return root;
}

// Para cualquier flujo que vaya a escribir. El shim de asar hace que existsSync e
// isDirectory devuelvan true dentro de app.asar, asi que sin esta comprobacion la
// primera escritura falla con un ENOENT crudo e imposible de diagnosticar.
function assertWritableProjectRoot(rootPath) {
  // El asar se comprueba antes de existsSync: dentro del paquete existsSync devuelve
  // true y el mensaje generico "Proyecto invalido" ocultaria la causa real.
  const candidate = normalizeDriveLetter(rootPath);
  if (rootPath && isInsideAsar(candidate)) {
    throw new Error(
      `Ruta de solo lectura: ${candidate} esta dentro de un paquete .asar y no admite escritura. ` +
        "Para Reparar EDITCOREAI apunta al directorio de codigo fuente desempaquetado (resources/app).",
    );
  }
  return assertProjectRoot(rootPath);
}

// Cierra la ventana TOCTOU: entre resolveInside y la escritura un proceso
// concurrente puede sustituir un directorio por un enlace fuera del proyecto.
// Se comprueba el objetivo y cada componente intermedio con lstat (no sigue enlaces).
function assertNoSymlinkPath(rootPath, targetPath) {
  const root = normalizeDriveLetter(rootPath);
  let current = normalizeDriveLetter(targetPath);
  const chain = [];
  while (current.length >= root.length) {
    chain.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const entry of chain) {
    let stat;
    try {
      stat = fs.lstatSync(entry);
    } catch {
      continue; // No existe todavia: nada que suplantar.
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Ruta con enlace simbolico no permitida para escritura: ${entry}`);
    }
  }
  return normalizeDriveLetter(targetPath);
}

// Para escrituras: resuelve dentro del proyecto y ademas rechaza enlaces en la ruta.
function resolveInsideForWrite(rootPath, relativePath = "") {
  const target = resolveInside(rootPath, relativePath);
  return assertNoSymlinkPath(assertProjectRoot(rootPath), target);
}

function resolveInside(rootPath, relativePath = "") {
  const root = assertProjectRoot(rootPath);
  let cleanRel = String(relativePath || ".").trim().replace(/\\/g, "/").replace(/^\/+/, "");

  // Mapeo inteligente y transparente: si el proyecto no tiene físicamente las carpetas 'app' o 'src' 
  // en la raíz pero el agente las solicita, redirigimos al contenido correspondiente en la raíz.
  if (!fs.existsSync(path.join(root, "app")) && (cleanRel.startsWith("app/") || cleanRel === "app")) {
    cleanRel = cleanRel.replace(/^app\/?/, "");
  }
  if (!fs.existsSync(path.join(root, "src")) && (cleanRel.startsWith("src/") || cleanRel === "src")) {
    cleanRel = cleanRel.replace(/^src\/?/, "");
  }

  const target = normalizeDriveLetter(path.resolve(root, cleanRel || "."));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Ruta fuera del proyecto.");
  let existing = target;
  while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) break; existing = parent; }
  const realRoot = normalizeDriveLetter(fs.realpathSync.native(root));
  const realExisting = normalizeDriveLetter(fs.realpathSync.native(existing));
  const realRelative = path.relative(realRoot, realExisting);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error("La ruta enlazada sale del proyecto.");
  return target;
}

/** Convierte path absoluto o relativo a ruta relativa al projectRoot ("" = raiz). */
function toProjectRelativePath(rootPath, maybePath = "") {
  const root = assertProjectRoot(rootPath);
  const raw = String(maybePath || "").trim();
  if (!raw || raw === "." || raw === "./" || raw === "/" || raw === "\\") return "";
  const abs = path.isAbsolute(raw)
    ? normalizeDriveLetter(raw)
    : normalizeDriveLetter(path.resolve(root, raw));
  const relative = path.relative(root, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Ruta fuera del proyecto: ${raw}`);
  }
  return relative.replace(/\\/g, "/");
}

/** Carpeta padre del proyecto (hermanos), nunca la raiz del disco. */
function workspaceParentRoot(primaryRoot) {
  const root = assertProjectRoot(primaryRoot);
  const parent = normalizeDriveLetter(path.dirname(root));
  if (!parent || parent === root) return "";
  const parsed = path.parse(parent);
  if (normalizeDriveLetter(parsed.root) === parent) return "";
  try {
    return assertProjectRoot(parent);
  } catch {
    return "";
  }
}

/** Extrae rutas absolutas que el usuario escribio (Windows o Unix). */
function extractAuthorizedPaths(text = "") {
  const raw = String(text || "");
  if (!raw) return [];
  const found = [];
  const patterns = [
    /[a-zA-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g,
    /[a-zA-Z]:\/(?:[^\\/:*?"<>|\r\n]+\/)*[^\\/:*?"<>|\r\n]*/g,
    // Atajo Windows: `D:PROGRAMAS IA` (sin barra tras los dos puntos).
    /[a-zA-Z]:(?![\\/])[^<>"|?*\r\n]+/g,
    /\\\\[^\\/\s]+\\[^\\/\s][^\r\n]*/g,
    /\/(?:Users|home|mnt|Volumes|opt|var|tmp)\/[^\s"'`]+/g,
  ];
  const trimPathProse = (value) => {
    let cleaned = String(value || "").trim().replace(/[.,;:)\]}>]+$/g, "");
    cleaned = cleaned.replace(/\s+(?:y|e|o|u|and|or|que|para|por|con|sin|sobre|desde|hasta|cuando|como|porque|dime|analiza|audita|listar?|enlista(?:r|me)?|abre|abrir|cierra|cerrar|revisa|corrige|implementa|crea|modifica)\b[\s\S]*$/i, "");
    return cleaned.trim().replace(/[.,;:)\]}>]+$/g, "");
  };
  for (const pattern of patterns) {
    const matches = raw.match(pattern) || [];
    for (const match of matches) {
      let cleaned = trimPathProse(match);
      if (/^[A-Za-z]:[^\\/]/.test(cleaned)) cleaned = `${cleaned.slice(0, 2)}\\${cleaned.slice(2)}`;
      if (cleaned && !found.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
        found.push(cleaned);
      }
    }
  }
  return found;
}

/**
 * Convierte una ruta dada por el usuario en raiz autorizada:
 * directorio existente tal cual; archivo → su carpeta padre.
 * Nunca autoriza la raiz del disco sola (C:\ / D:\).
 */
function resolveAuthorizedRoot(maybePath = "") {
  let raw = String(maybePath || "").trim();
  if (/^[A-Za-z]:[^\\/]/.test(raw)) raw = `${raw.slice(0, 2)}\\${raw.slice(2)}`;
  if (!raw || !path.isAbsolute(raw)) return "";
  let absolute = normalizeDriveLetter(raw);
  const isDriveRoot = (candidate) => {
    const value = normalizeDriveLetter(candidate);
    return Boolean(value) && normalizeDriveLetter(path.parse(value).root) === value;
  };
  try {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      absolute = path.dirname(absolute);
    }
  } catch {
    return "";
  }
  if (isDriveRoot(absolute)) return "";
  try {
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      return assertProjectRoot(absolute);
    }
  } catch {
    return "";
  }
  // Carpeta aun no creada: autorizar el ancestro existente mas cercano (nunca la raiz del disco).
  let cursor = absolute;
  while (cursor && !isDriveRoot(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor || isDriveRoot(parent)) return "";
    try {
      if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
        return assertProjectRoot(parent);
      }
    } catch {
      return "";
    }
    cursor = parent;
  }
  return "";
}

function collectFullAccessRoots(primaryRoot, prompt = "", extraRoots = []) {
  const fromPrompt = extractAuthorizedPaths(prompt)
    .map((item) => resolveAuthorizedRoot(item))
    .filter(Boolean);
  return collectAllowedRoots(primaryRoot, [
    workspaceParentRoot(primaryRoot),
    ...fromPrompt,
    ...(Array.isArray(extraRoots) ? extraRoots : []),
  ].filter(Boolean));
}

function collectAllowedRoots(primaryRoot, extraRoots = []) {
  const roots = [];
  const add = (candidate) => {
    const value = String(candidate || "").trim();
    if (!value) return;
    try {
      const root = assertProjectRoot(value);
      if (!roots.some((item) => item.toLowerCase() === root.toLowerCase())) roots.push(root);
    } catch {
      // Ignorar raices invalidas; no tumbar la corrida.
    }
  };
  add(primaryRoot);
  for (const extra of extraRoots || []) add(extra);
  return roots;
}

/** Lectura multi-root: proyecto + carpeta padre (hermanos PROGRAMAS IA) siempre. */
function collectSiblingReadRoots(primaryRoot, extraRoots = []) {
  return collectAllowedRoots(primaryRoot, [
    workspaceParentRoot(primaryRoot),
    ...(Array.isArray(extraRoots) ? extraRoots : []),
  ].filter(Boolean));
}

/**
 * Resuelve path relativo/absoluto dentro de una o mas raices permitidas.
 * Acceso completo = proyecto + padre + rutas absolutas que el usuario dio.
 * Lectura de hermanos: rutas `../Hermano/...` o `Hermano/...` bajo el padre del workspace.
 */
function resolveAccessibleTarget(primaryRoot, maybePath = "", options = {}) {
  const primary = assertProjectRoot(primaryRoot);
  const allowed = collectAllowedRoots(
    primary,
    Array.isArray(options.allowedRoots) ? options.allowedRoots : [],
  );
  const roots = allowed.length ? allowed : [primary];
  const raw = String(maybePath || "").trim();

  const tryResolveAbsolute = (absolute) => {
    for (const root of roots) {
      const relative = path.relative(root, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      const target = resolveInside(root, relative || ".");
      return {
        root,
        relative: (relative || "").replace(/\\/g, "/"),
        absolute: target,
        primary,
        outsidePrimary: root.toLowerCase() !== primary.toLowerCase(),
      };
    }
    return null;
  };

  let absolute;
  if (!raw || raw === "." || raw === "./" || raw === "/" || raw === "\\") {
    absolute = primary;
    const hit = tryResolveAbsolute(absolute);
    if (hit) return hit;
  } else if (path.isAbsolute(raw)) {
    absolute = normalizeDriveLetter(raw);
    if (options.grantAbsoluteOnFull === true) {
      const granted = resolveAuthorizedRoot(absolute);
      if (granted && !roots.some((item) => item.toLowerCase() === granted.toLowerCase())) {
        roots.push(granted);
      }
    }
    const hit = tryResolveAbsolute(absolute);
    if (hit) return hit;
  } else {
    let cleanRel = raw.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!fs.existsSync(path.join(primary, "app")) && (cleanRel.startsWith("app/") || cleanRel === "app")) {
      cleanRel = cleanRel.replace(/^app\/?/, "");
    }
    if (!fs.existsSync(path.join(primary, "src")) && (cleanRel.startsWith("src/") || cleanRel === "src")) {
      cleanRel = cleanRel.replace(/^src\/?/, "");
    }
    const candidates = [
      normalizeDriveLetter(path.resolve(primary, cleanRel)),
    ];
    // Hermano por nombre: "GAFCORE GATEWAY/src/..." bajo el padre del workspace.
    for (const root of roots) {
      if (root.toLowerCase() === primary.toLowerCase()) continue;
      candidates.push(normalizeDriveLetter(path.resolve(root, cleanRel)));
    }
    // Preferir candidatos que existan; si ninguno, el primero permitido.
    const existing = candidates.filter((candidate) => {
      try { return fs.existsSync(candidate); } catch { return false; }
    });
    const ordered = existing.length ? existing : candidates;
    for (const candidate of ordered) {
      const hit = tryResolveAbsolute(candidate);
      if (hit) return hit;
    }
  }

  const scope = roots.join(" | ");
  throw new Error(
    `Ruta fuera del alcance permitido: ${raw || absolute}. ` +
      `Raices activas: ${scope}. Usa ../Hermano/... o el nombre del hermano bajo ${workspaceParentRoot(primary) || "el padre"}.`,
  );
}

function pathForToolResult(resolved, relativeInsideRoot = "") {
  const rel = String(relativeInsideRoot || resolved.relative || "").replace(/\\/g, "/");
  if (!resolved.outsidePrimary) return rel;
  const abs = rel
    ? normalizeDriveLetter(path.join(resolved.root, rel))
    : resolved.absolute;
  return abs;
}

module.exports = {
  assertProjectRoot,
  assertWritableProjectRoot,
  assertNoSymlinkPath,
  isInsideAsar,
  preferSourceOverAsar,
  resolveInside,
  resolveInsideForWrite,
  toProjectRelativePath,
  normalizeDriveLetter,
  workspaceParentRoot,
  extractAuthorizedPaths,
  resolveAuthorizedRoot,
  collectFullAccessRoots,
  collectAllowedRoots,
  collectSiblingReadRoots,
  resolveAccessibleTarget,
  pathForToolResult,
};