"use strict";

const fs = require("fs");
const path = require("path");
const { scaffoldNextApp } = require("./scaffold");
const { scrapeWebPage } = require("./browser-tool");
const { saveToBrain, listBrainDocs } = require("./brain-ingest");
const {
  snapshotBeforeWrite,
  rollbackLastChange,
  listSnapshots,
} = require("./snapshot");
const { runProcess, isLongRunningCommand } = require("./process-runner");
const { capture_preview_screenshot, DEFAULT_PREVIEW_URL } = require("./vision-inspector");

const TOOL_RESULT_CAP = 2000;

function safe(root, rel) {
  const base = path.resolve(root);
  const target = path.resolve(base, rel || ".");
  const normBase = base.toLowerCase();
  const normTarget = target.toLowerCase();
  if (normTarget !== normBase && !normTarget.startsWith(normBase + path.sep) && !normTarget.startsWith(normBase + "/")) {
    throw new Error("Ruta fuera del proyecto");
  }
  return target;
}

function truncatePayload(value, max = TOOL_RESULT_CAP) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncado ${text.length - max} chars]`;
}

function listFiles(root, rel = ".", max = 80) {
  const dir = safe(root, rel);
  if (!fs.existsSync(dir)) return { ok: false, error: `No existe: ${rel}` };
  const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, max);
  return {
    ok: true,
    path: rel,
    dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name),
    files: entries.filter((e) => e.isFile()).map((e) => e.name),
  };
}

function readFile(root, rel, maxChars = TOOL_RESULT_CAP) {
  const file = safe(root, rel);
  if (!fs.existsSync(file)) return { ok: false, error: `No existe: ${rel}` };
  if (fs.statSync(file).isDirectory()) return { ok: false, error: `Es carpeta: ${rel}` };
  let content = fs.readFileSync(file, "utf8");
  const bytes = content.length;
  if (content.length > maxChars) content = content.slice(0, maxChars) + "\n…[truncado]";
  return { ok: true, path: rel, content, bytes };
}

function writeFile(root, rel, content) {
  const snap = snapshotBeforeWrite(root, rel, "write_file");
  const file = safe(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(content ?? ""), "utf8");
  return { ok: true, path: rel, snapshotId: snap.ok ? snap.id : null };
}

/**
 * Localiza oldText con tolerancia leve (CRLF/LF, whitespace de línea).
 * Fallos leves → el orquestador relee y reintenta sin detener la sesión.
 */
function locateOldText(current, oldText) {
  const old = String(oldText ?? "");
  if (!old) return { ok: false, error: "oldText vacío" };
  if (current.includes(old)) return { ok: true, match: old, mode: "exact" };

  const normFile = current.replace(/\r\n/g, "\n");
  const normOld = old.replace(/\r\n/g, "\n");
  if (normFile.includes(normOld)) {
    // Preferir el fragmento real del archivo (preserva CRLF si aplica).
    const idx = current.replace(/\r\n/g, "\n").indexOf(normOld);
    if (idx >= 0) {
      // Reconstruir match aproximado por longitud en el original
      let cursor = 0;
      let fileIdx = 0;
      while (cursor < idx && fileIdx < current.length) {
        if (current[fileIdx] === "\r" && current[fileIdx + 1] === "\n") {
          cursor += 1;
          fileIdx += 2;
        } else {
          cursor += 1;
          fileIdx += 1;
        }
      }
      let end = fileIdx;
      let consumed = 0;
      while (consumed < normOld.length && end < current.length) {
        if (current[end] === "\r" && current[end + 1] === "\n") {
          consumed += 1;
          end += 2;
        } else {
          consumed += 1;
          end += 1;
        }
      }
      return { ok: true, match: current.slice(fileIdx, end), mode: "crlf" };
    }
  }

  const softLines = (s) => s.replace(/\r\n/g, "\n").split("\n").map((l) => l.trimEnd());
  const fileLines = softLines(current);
  const oldLines = softLines(old);
  if (oldLines.length && oldLines.every((l) => l.length || oldLines.length === 1)) {
    for (let i = 0; i <= fileLines.length - oldLines.length; i += 1) {
      let hit = true;
      for (let j = 0; j < oldLines.length; j += 1) {
        if (fileLines[i + j] !== oldLines[j]) {
          hit = false;
          break;
        }
      }
      if (hit) {
        const rawLines = current.split(/\r?\n/);
        const slice = rawLines.slice(i, i + oldLines.length).join(current.includes("\r\n") ? "\r\n" : "\n");
        return { ok: true, match: slice, mode: "trim-end" };
      }
    }
  }

  return {
    ok: false,
    error: "oldText no encontrado (debe ser exacto)",
    soft: true,
    hint: "Relee el archivo con read_file y reconstruye oldText EXACTO del contenido actual.",
  };
}

function replaceInFile(root, rel, oldText, newText) {
  const file = safe(root, rel);
  if (!fs.existsSync(file)) return { ok: false, error: `No existe: ${rel}`, soft: true };
  const current = fs.readFileSync(file, "utf8");
  const located = locateOldText(current, oldText);
  if (!located.ok) {
    return {
      ok: false,
      error: located.error,
      soft: true,
      path: rel,
      hint: located.hint || "Relee el archivo y reintenta replace_in_file.",
      preview: current.slice(0, 1200),
    };
  }
  const snap = snapshotBeforeWrite(root, rel, "replace_in_file");
  const next = current.replace(located.match, String(newText ?? ""));
  fs.writeFileSync(file, next, "utf8");
  return {
    ok: true,
    path: rel,
    replaced: true,
    softMatch: located.mode !== "exact" ? located.mode : undefined,
    snapshotId: snap.ok ? snap.id : null,
  };
}

/** Fallos leves que no deben detener la sesión OODA. */
function isSoftToolFailure(name, result, args = {}) {
  if (!result || result.ok !== false) return false;
  if (result.soft === true) return true;
  const err = String(result.error || result.stderr || result.message || "");
  if (name === "replace_in_file" && /oldText|no existe|No existe/i.test(err)) return true;
  if (name === "list_files" && /No existe|ENOENT/i.test(err)) return true;
  if (name === "run_command") {
    const cmd = String(args.command || "");
    if (/^\s*git\s+(status|diff|log|remote|branch|rev-parse)\b/i.test(cmd)) return true;
    if (/not a git repository|git:\s*command not found|is not recognized/i.test(err)) return true;
  }
  return false;
}

function searchFiles(root, query, maxHits = 30) {
  const hits = [];
  const skip = new Set(["node_modules", ".git", "dist", ".next", ".editcore", "out", "build"]);
  function walk(dir, depth) {
    if (hits.length >= maxHits || depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.(js|ts|tsx|jsx|json|md|css|sql)$/i.test(e.name)) {
        try {
          const text = fs.readFileSync(full, "utf8");
          if (text.includes(query)) hits.push(path.relative(root, full).replace(/\\/g, "/"));
        } catch { /* ignore */ }
      }
    }
  }
  walk(path.resolve(root), 0);
  return { ok: true, query, hits };
}

function runCommand(root, command, {
  timeoutMs = 25000,
  onChunk = null,
  onSevereError = null,
  signal = null,
  background = null,
} = {}) {
  const cmd = String(command || "").trim();
  const longLived = background === true || (background !== false && isLongRunningCommand(cmd));
  return runProcess({
    cwd: root,
    command: cmd,
    timeoutMs: longLived ? Math.max(timeoutMs, 8000) : timeoutMs,
    background: longLived,
    onChunk,
    onSevereError,
    signal,
  }).then((result) => ({
    ...result,
    // Compat con callers que esperan ok booleano clásico
    ok: result.ok !== false,
    note: result.streaming
      ? "Proceso de desarrollo en streaming (sin esperar exit). Errores graves disparan auto-heal."
      : undefined,
  }));
}

function auditEnv(root) {
  const examplePath = path.join(root, ".env.example");
  const localCandidates = [".env.local", ".env"];
  if (!fs.existsSync(examplePath)) {
    return { ok: true, missing: [], note: "No hay .env.example" };
  }
  const exampleKeys = fs.readFileSync(examplePath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
    .filter(Boolean);

  let localText = "";
  let localFile = "";
  for (const name of localCandidates) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) {
      localText = fs.readFileSync(p, "utf8");
      localFile = name;
      break;
    }
  }
  const present = new Set(
    localText.split(/\r?\n/).map((l) => l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1]).filter(Boolean),
  );
  const missing = exampleKeys.filter((k) => !present.has(k));
  const empty = exampleKeys.filter((k) => {
    const m = localText.match(new RegExp(`^\\s*${k}\\s*=\\s*(.*)$`, "m"));
    return m && !String(m[1] || "").trim();
  });
  return {
    ok: true,
    localFile: localFile || null,
    required: exampleKeys,
    missing,
    empty,
    message: missing.length
      ? `Faltan claves en ${localFile || ".env.local"}: ${missing.join(", ")}. Pégalas o créalas desde .env.example.`
      : "Variables de entorno alineadas con .env.example.",
  };
}

function readEnvFileKeys(root) {
  const out = {};
  for (const name of [".env.local", ".env"]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = String(m[2] || "").trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1]] = v;
    }
  }
  return out;
}

async function runSupabaseSql(root, sqlPath) {
  const rel = String(sqlPath || "").trim() || "supabase/migrations";
  const full = safe(root, rel);
  if (!fs.existsSync(full)) return { ok: false, error: `No existe ${rel}` };

  const env = readEnvFileKeys(root);
  const hasCliCreds = Boolean(env.SUPABASE_DB_URL || env.DATABASE_URL || env.SUPABASE_ACCESS_TOKEN);
  const nextGenTypes = "npx supabase gen types typescript --linked -o types/supabase.ts";

  if (fs.statSync(full).isDirectory()) {
    const files = fs.readdirSync(full).filter((f) => f.endsWith(".sql")).sort();
    const bodies = files.slice(0, 10).map((f) => ({
      path: path.join(rel, f).replace(/\\/g, "/"),
      preview: fs.readFileSync(path.join(full, f), "utf8").slice(0, 800),
    }));
    if (hasCliCreds) {
      const push = await runCommand(root, "npx supabase db push", { timeoutMs: 25000 });
      const types = push.ok
        ? await runCommand(root, nextGenTypes, { timeoutMs: 25000 })
        : null;
      return {
        ok: push.ok,
        mode: "executed",
        files: bodies,
        push,
        types,
        next: push.ok ? ["Revisa types/supabase.ts", "Reinicia el preview"] : ["Corrige el SQL", "supabase db push"],
      };
    }
    return {
      ok: true,
      mode: "prepared",
      files: bodies,
      missingEnv: ["SUPABASE_DB_URL o SUPABASE_ACCESS_TOKEN"],
      next: [
        "Configura SUPABASE_DB_URL / login CLI",
        "supabase db push",
        nextGenTypes,
      ],
    };
  }

  const sql = fs.readFileSync(full, "utf8");
  if (hasCliCreds) {
    const push = await runCommand(root, "npx supabase db push", { timeoutMs: 25000 });
    return {
      ok: push.ok,
      mode: "executed",
      path: rel,
      sqlPreview: sql.slice(0, TOOL_RESULT_CAP),
      push,
      next: [nextGenTypes],
    };
  }
  return {
    ok: true,
    mode: "prepared",
    path: rel,
    sqlPreview: sql.slice(0, TOOL_RESULT_CAP),
    missingEnv: ["SUPABASE_DB_URL o SUPABASE_ACCESS_TOKEN"],
    next: ["Revisa el SQL", "Aplica con supabase db push / SQL editor", nextGenTypes],
  };
}

async function cloneRepo(root, repoUrl, destRel) {
  const url = String(repoUrl || "").trim();
  if (!/^https?:\/\/|^git@/i.test(url)) {
    return { ok: false, error: "URL de repositorio inválida (usa https://github.com/...)" };
  }
  const dest = String(destRel || "").trim()
    || path.join(".editcore", "repos", path.basename(url.replace(/\.git$/i, ""), path.sep));
  const abs = safe(root, dest);
  if (fs.existsSync(abs) && fs.readdirSync(abs).length) {
    return { ok: true, path: dest.replace(/\\/g, "/"), note: "El destino ya existe; no se clonó de nuevo." };
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const quoted = url.includes(" ") ? `"${url}"` : url;
  const result = await runCommand(root, `git clone --depth 1 ${quoted} "${abs}"`, { timeoutMs: 120000 });
  if (!result.ok) {
    return { ok: false, error: result.stderr || result.error || "git clone falló", path: dest.replace(/\\/g, "/") };
  }

  // Ingesta automática de README si existe
  const readme = ["README.md", "readme.md", "README"].map((n) => path.join(abs, n)).find((p) => fs.existsSync(p));
  let ingested = null;
  if (readme) {
    const body = fs.readFileSync(readme, "utf8").slice(0, 12000);
    ingested = saveToBrain(root, `repo_${path.basename(abs)}`, body, { source: url, tags: ["git-clone", "readme"] });
  }

  return {
    ok: true,
    path: dest.replace(/\\/g, "/"),
    url,
    ingested,
    next: ["Usa list_files/read_file sobre el clon", "ingest_to_brain para memorias adicionales"],
  };
}

const DEFINITIONS = [
  { type: "function", function: { name: "list_files", description: "Lista carpetas/archivos relativos.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "read_file", description: "Lee archivo (truncado).", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "write_file", description: "Crea/sobrescribe archivo.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "replace_in_file", description: "Parche quirúrgico: reemplaza oldText exacto por newText.", parameters: { type: "object", properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" } }, required: ["path", "oldText", "newText"] } } },
  { type: "function", function: { name: "search_files", description: "Busca texto en el repo.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "run_command", description: "Comando shell (timeout 25s).", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "audit_env", description: "Compara .env.example vs .env.local y lista claves faltantes.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "supabase_migrate", description: "Prepara/lista migraciones SQL de supabase/migrations.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "scaffold_project", description: "Inicializa Next.js+Tailwind+TS (+Supabase stubs) 0→100.", parameters: { type: "object", properties: { withSupabase: { type: "boolean" } } } } },
  { type: "function", function: { name: "capture_preview", description: "Captura visual del preview local (Electron o Puppeteer).", parameters: { type: "object", properties: { url: { type: "string" }, viewport: { type: "string" } } } } },
  {
    type: "function",
    function: {
      name: "capture_preview_screenshot",
      description: "Captura el preview activo (por defecto http://127.0.0.1:4568/) con Puppeteer/Playwright y diagnostica maquetación para evaluación multimodal UI/UX.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL del preview (default 127.0.0.1:4568)" },
          viewport: { type: "string", description: "desktop | mobile" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_scrape",
      description: "Navega a una URL, extrae su contenido de texto y lo devuelve para análisis (Puppeteer/Playwright/fetch).",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL del sitio web a explorar" },
          ingest: { type: "boolean", description: "Si true, también guarda el extracto en .editcore/rag/" },
          title: { type: "string", description: "Título opcional para la ingesta RAG" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ingest_to_brain",
      description: "Guarda documentación, código clonado o información en el Cerebro RAG (.editcore/rag/).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Título del documento de conocimiento" },
          content: { type: "string", description: "Contenido a almacenar de forma persistente" },
          source: { type: "string", description: "URL o origen opcional" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_brain",
      description: "Lista documentos indexados en el Cerebro RAG del proyecto.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "clone_repo",
      description: "Clona un repositorio Git dentro del proyecto (.editcore/repos/) e ingesta el README al cerebro si existe.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL del repositorio (https://github.com/...)" },
          path: { type: "string", description: "Destino relativo opcional" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rollback_last_change",
      description: "Restaura el último snapshot (.editcore/snapshots/) tras un fallo de compilación o cambio incorrecto.",
      parameters: {
        type: "object",
        properties: {
          snapshotId: { type: "string", description: "Id opcional de snapshot; por defecto el último" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_snapshots",
      description: "Lista checkpoints recientes del proyecto.",
      parameters: { type: "object", properties: {} },
    },
  },
];

function resolveListPath(root, requested) {
  try {
    const mapApi = require("../runtime/project-map");
    mapApi.ensureProjectMap?.(root, { maxAgeMs: 5 * 60_000 });
    const resolved = mapApi.resolveExistingTarget(root, requested || ".");
    return resolved;
  } catch {
    return { target: requested || ".", source: "passthrough" };
  }
}

async function execute(name, args, root, allowWrite, helpers = {}) {
  const a = args || {};
  switch (name) {
    case "list_files": {
      const resolved = resolveListPath(root, a.path || ".");
      const listed = listFiles(root, resolved.target || ".");
      if (resolved.missing) {
        return {
          ...listed,
          requested: a.path || ".",
          resolved: resolved.target,
          note: `Ruta '${resolved.missing}' no está en el mapa cognitivo; listando '${resolved.target}'. Raíces: ${(resolved.availableRoots || []).slice(0, 20).join(", ")}`,
          soft: !listed.ok,
        };
      }
      return listed;
    }
    case "read_file": return readFile(root, a.path);
    case "search_files": return searchFiles(root, a.query || "");
    case "write_file":
      if (!allowWrite) return { ok: false, error: "Escritura no permitida" };
      return writeFile(root, a.path, a.content);
    case "replace_in_file":
      if (!allowWrite) return { ok: false, error: "Escritura no permitida" };
      return replaceInFile(root, a.path, a.oldText, a.newText);
    case "run_command":
      if (!allowWrite) return { ok: false, error: "Comandos no permitidos en modo lectura" };
      return runCommand(root, a.command, {
        onChunk: typeof helpers.onProcessChunk === "function"
          ? (ev) => helpers.onProcessChunk({ command: a.command, ...ev })
          : null,
        onSevereError: typeof helpers.onProcessSevereError === "function"
          ? (issue) => helpers.onProcessSevereError({ command: a.command, projectRoot: root, ...issue })
          : null,
        signal: helpers.abortSignal || null,
      });
    case "audit_env":
      return auditEnv(root);
    case "supabase_migrate":
      if (!allowWrite) return { ok: false, error: "Migraciones requieren modo escritura/ejecución" };
      return runSupabaseSql(root, a.path);
    case "scaffold_project":
      if (!allowWrite) return { ok: false, error: "Scaffold requiere escritura" };
      return scaffoldNextApp({ projectRoot: root, withSupabase: a.withSupabase !== false });
    case "capture_preview":
    case "capture_preview_screenshot": {
      const url = a.url || helpers.previewUrl || DEFAULT_PREVIEW_URL;
      const viewport = a.viewport || "desktop";
      try {
        const shot = await capture_preview_screenshot({
          url,
          viewport,
          projectRoot: root,
          electronCapture: typeof helpers.capturePreview === "function"
            ? (opts) => helpers.capturePreview(opts)
            : null,
        });
        // No devolver base64 enorme al modelo
        const {
          screenshotAbs: _abs,
          imageDataUrl: _img,
          ...safe
        } = shot;
        return safe;
      } catch (error) {
        return { ok: false, error: String(error?.message || error).slice(0, 400) };
      }
    }
    case "web_scrape": {
      const scraped = await scrapeWebPage(a.url);
      if (!scraped.ok) return scraped;
      let ingested = null;
      if (a.ingest === true) {
        if (!allowWrite) {
          return { ...scraped, ingested: { ok: false, error: "Ingesta requiere modo escritura" } };
        }
        ingested = saveToBrain(
          root,
          a.title || scraped.title || scraped.url || "web_doc",
          scraped.content,
          { source: scraped.url, tags: ["web_scrape"] },
        );
      }
      return {
        ok: true,
        url: scraped.url,
        title: scraped.title || "",
        engine: scraped.engine,
        content: scraped.content,
        bytes: scraped.bytes,
        note: scraped.note,
        ingested,
      };
    }
    case "ingest_to_brain":
      if (!allowWrite) return { ok: false, error: "Ingesta al cerebro requiere modo escritura" };
      return saveToBrain(root, a.title, a.content, { source: a.source || "" });
    case "list_brain":
      return listBrainDocs(root);
    case "clone_repo":
      if (!allowWrite) return { ok: false, error: "Clonar requiere modo escritura" };
      return cloneRepo(root, a.url, a.path);
    case "rollback_last_change":
      if (!allowWrite) return { ok: false, error: "Rollback requiere modo escritura" };
      return rollbackLastChange(root, a.snapshotId || null);
    case "list_snapshots":
      return listSnapshots(root);
    default:
      return { ok: false, error: `Herramienta desconocida: ${name}` };
  }
}

module.exports = {
  TOOL_RESULT_CAP,
  truncatePayload,
  listFiles,
  readFile,
  writeFile,
  replaceInFile,
  searchFiles,
  runCommand,
  auditEnv,
  runSupabaseSql,
  cloneRepo,
  rollbackLastChange,
  listSnapshots,
  capture_preview_screenshot,
  isSoftToolFailure,
  locateOldText,
  execute,
  DEFINITIONS,
};
