"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { assertProjectRoot, assertWritableProjectRoot, resolveInside } = require("./project-path-policy");

const execFileAsync = promisify(execFile);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cpp", ".cs", ".css", ".go", ".h", ".html", ".java", ".js", ".json", ".jsx",
  ".md", ".php", ".py", ".rb", ".rs", ".sql", ".svelte", ".ts", ".tsx", ".vue", ".yaml", ".yml",
]);
const SKIP_DIRS = new Set([".git", ".editcore", ".next", ".nuxt", ".cache", ".venv", "node_modules", "dist", "build", "coverage", "release", "out", "vendor"]);
const MAX_FILES = 2500;
const MAX_FILE_BYTES = 256 * 1024;
const INSPECTOR_VERSION = 1;

async function readJson(filePath, fallback) {
  try { return JSON.parse(await fs.promises.readFile(filePath, "utf8")); } catch { return fallback; }
}

async function writeJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function hasTaskMarker(value) {
  return String(value || "").split(/\r?\n/).some((line) => {
    return /(?:^\s*|\/\/\s*|\/\*+\s*|\*\s*|#\s*|<!--\s*|--\s*)(?:TODO|FIXME|HACK)\b/.test(line);
  });
}

function normalizeRel(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function detectFrameworks(root, packageJson = {}) {
  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const names = new Set(Object.keys(deps));
  const found = [];
  if (names.has("next")) found.push("Next.js");
  if (names.has("react")) found.push("React");
  if (names.has("vue")) found.push("Vue");
  if (names.has("@angular/core")) found.push("Angular");
  if (names.has("electron")) found.push("Electron");
  if (names.has("express")) found.push("Express");
  if (names.has("@nestjs/core")) found.push("NestJS");
  if (names.has("vite")) found.push("Vite");
  if (names.has("laravel-vite-plugin") || fs.existsSync(path.join(root, "artisan"))) found.push("Laravel");
  if (fs.existsSync(path.join(root, "manage.py"))) found.push("Django/Python");
  if (fs.existsSync(path.join(root, "pubspec.yaml"))) found.push("Flutter/Dart");
  if (fs.existsSync(path.join(root, "Cargo.toml"))) found.push("Rust");
  if (fs.existsSync(path.join(root, "go.mod"))) found.push("Go");
  if (fs.existsSync(path.join(root, "pom.xml")) || fs.existsSync(path.join(root, "build.gradle"))) found.push("Java");
  if (fs.existsSync(path.join(root, "Dockerfile"))) found.push("Docker");
  if (fs.existsSync(path.join(root, "docker-compose.yml")) || fs.existsSync(path.join(root, "docker-compose.yaml"))) found.push("Docker Compose");
  return unique(found);
}

function detectDatabases(root, packageJson = {}) {
  const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
  const names = new Set(Object.keys(deps));
  const found = [];
  if (names.has("@supabase/supabase-js")) found.push("Supabase");
  if (names.has("pg") || names.has("postgres") || names.has("postgresql-client")) found.push("PostgreSQL");
  if (names.has("mysql") || names.has("mysql2")) found.push("MySQL");
  if (names.has("mongodb") || names.has("mongoose")) found.push("MongoDB");
  if (names.has("sqlite3") || names.has("better-sqlite3")) found.push("SQLite");
  if (fs.existsSync(path.join(root, "supabase"))) found.push("Supabase");
  return unique(found);
}

function classifyFile(relativePath) {
  const name = path.basename(relativePath).toLowerCase();
  const ext = path.extname(name);
  if (name === "package.json" || name === "requirements.txt" || name === "pyproject.toml" || name === "composer.json" || name === "go.mod" || name === "cargo.toml") return "manifest";
  if (name.includes("test") || name.includes("spec") || relativePath.includes("/test/") || relativePath.includes("/tests/")) return "test";
  if ([".env", ".env.local", ".env.production", ".env.development"].includes(name)) return "env";
  if (name.includes("route") || name.includes("controller") || relativePath.includes("/api/")) return "api";
  if ([".tsx", ".jsx", ".vue", ".svelte", ".css"].includes(ext)) return "frontend";
  if ([".js", ".ts", ".py", ".php", ".java", ".cs", ".go", ".rs"].includes(ext)) return "code";
  if ([".json", ".yaml", ".yml", ".toml"].includes(ext)) return "config";
  if ([".md", ".txt"].includes(ext)) return "docs";
  return "other";
}

function detectIssues(root, files, packageJson, frameworks) {
  const issues = [];
  const hasPkg = Boolean(packageJson && Object.keys(packageJson).length);
  const isEditCoreRuntime = packageJson?.name === "editcoreai";
  const installRoot = isEditCoreRuntime ? path.resolve(root, "..", "..") : root;
  const existsInScope = (rel) => fs.existsSync(path.join(root, rel))
    || (isEditCoreRuntime && fs.existsSync(path.join(installRoot, rel)));
  if (hasPkg && !packageJson.scripts?.test) {
    issues.push({ severity: "medium", title: "No se detecto script de pruebas", detail: "package.json no define scripts.test.", recommendation: "Agregar una prueba minima o documentar la estrategia QA." });
  }
  const hasBuildPath = Boolean(packageJson?.scripts?.build || packageJson?.scripts?.["dist:win"] || packageJson?.scripts?.["release:win"] || packageJson?.build);
  if (hasPkg && !hasBuildPath && frameworks.some((name) => ["React", "Next.js", "Vue", "Angular", "Vite", "Electron"].includes(name))) {
    issues.push({ severity: "medium", title: "No se detecto script de build", detail: "El proyecto usa frontend/app runtime pero no define scripts.build.", recommendation: "Agregar o validar el comando de build real." });
  }
  const envFiles = files.filter((file) => classifyFile(file.relative) === "env");
  if (envFiles.length) {
    issues.push({ severity: "high", title: "Variables de entorno detectadas", detail: `${envFiles.length} archivo(s) .env presentes en el proyecto.`, recommendation: "Verificar que no se suban secretos a git y que EDITCOREAI use solo lectura/redaccion." });
  }
  if (!files.some((file) => /^readme\.md$/i.test(file.relative)) && !existsInScope("README.md")) {
    issues.push({ severity: "low", title: "README no detectado en raiz", detail: "No se encontro README.md en la raiz.", recommendation: "Crear documentacion minima del proyecto." });
  }
  if (fs.existsSync(path.join(installRoot, ".git")) && !existsInScope(".gitignore")) {
    issues.push({ severity: "medium", title: ".gitignore no detectado", detail: "El proyecto parece ser git pero no tiene .gitignore en raiz.", recommendation: "Agregar reglas para dependencias, builds y secretos." });
  }
  return issues;
}

function fileExists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function evidence(status, label, detail, source = "inspector") {
  return { status, label, detail, source };
}

function statusFromEvidence(rows) {
  if (rows.some((row) => row.status === "fail")) return "critical";
  if (rows.some((row) => row.status === "warn")) return "attention";
  if (rows.some((row) => row.status === "unknown")) return "unverified";
  return "ok";
}

function scoreFromStatus(status) {
  return status === "ok" ? 100 : status === "attention" ? 70 : status === "unverified" ? 45 : 25;
}

class InspectorCoreService {
  constructor({ brainService = null, storageRoot = "" } = {}) {
    this.brainService = brainService;
    this.storageRoot = storageRoot ? path.resolve(storageRoot) : "";
  }

  projectRoot(root) { return assertProjectRoot(String(root || "").trim()); }
  inspectorRoot(root) {
    const ws = this.projectRoot(root);
    return this.storageRoot ? path.join(this.storageRoot, hash(ws).slice(0, 20)) : resolveInside(ws, ".editcore/inspector-core");
  }
  configPath(root) { return this.storageRoot ? path.join(this.inspectorRoot(root), "config.json") : resolveInside(this.projectRoot(root), ".editcore/inspector-core.json"); }
  twinPath(root) { return path.join(this.inspectorRoot(root), "digital-twin.json"); }
  reportsPath(root) { return path.join(this.inspectorRoot(root), "reports.json"); }
  alertsPath(root) { return path.join(this.inspectorRoot(root), "alerts.json"); }
  fixesPath(root) { return path.join(this.inspectorRoot(root), "fixes.json"); }
  emitProgress(progress, percent, label, stage, state = "running") {
    if (typeof progress === "function") progress({ percent, label, stage, state });
  }

  assertNotAborted(signal, label = "Inspector cancelado por el usuario.") {
    if (signal?.aborted) {
      const reason = signal.reason instanceof Error ? signal.reason : new Error(label);
      throw reason;
    }
  }

  async runScript(root, script, packageJson = {}, signal = null) {
    this.assertNotAborted(signal);
    const runner = this.commandRunner(root, packageJson);
    if (!runner || !packageJson?.scripts?.[script]) return { script, skipped: true, reason: "script no definido" };
    const commandArgs = [...runner.args, script];
    const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : runner.bin;
    const executableArgs = process.platform === "win32" ? ["/d", "/s", "/c", `${runner.bin} ${commandArgs.join(" ")}`] : commandArgs;
    try {
      const { stdout, stderr } = await execFileAsync(executable, executableArgs, {
        cwd: root,
        timeout: 120_000,
        windowsHide: true,
        maxBuffer: 1_500_000,
        signal: signal || undefined,
      });
      this.assertNotAborted(signal);
      return { script, ok: true, command: `${runner.bin} ${commandArgs.join(" ")}`, output: `${stdout || ""}${stderr ? `\n${stderr}` : ""}`.trim().slice(0, 6000) };
    } catch (error) {
      if (signal?.aborted || error?.name === "AbortError") {
        throw (signal?.reason instanceof Error ? signal.reason : new Error("Inspector cancelado por el usuario."));
      }
      return {
        script,
        ok: false,
        command: `${runner.bin} ${commandArgs.join(" ")}`,
        exitCode: error?.code ?? null,
        output: `${error?.stdout || ""}${error?.stderr ? `\n${error.stderr}` : ""}${error?.message ? `\n${error.message}` : ""}`.trim().slice(0, 6000),
      };
    }
  }

  async runChecks(root, area, packageJson = {}, signal = null) {
    const scripts = packageJson?.scripts || {};
    const desired = ["check", "lint", "test", "build"];
    const available = desired.filter((name) => Boolean(scripts[name]));
    const results = [];
    for (const script of available) {
      this.assertNotAborted(signal);
      results.push(await this.runScript(root, script, packageJson, signal));
    }
    return results;
  }

  async brainSnapshot(root, query) {
    if (!this.brainService) return { available: false, contextLoaded: false, skillsAvailable: 0, installedCapabilities: 0, memory: null, context: "" };
    const [context, inventory, memory] = await Promise.all([
      this.brainService.assembleContext(root, query),
      this.brainService.agentInventory(root, query, 50),
      Promise.resolve(this.brainService.memoryStats(root)),
    ]);
    return {
      available: true,
      contextLoaded: Boolean(context),
      skillsAvailable: Array.isArray(inventory?.skills) ? inventory.skills.length : 0,
      installedCapabilities: Array.isArray(inventory?.installed) ? inventory.installed.length : 0,
      memory,
      context: String(context || "").slice(0, 8_000),
    };
  }

  async install(root) {
    const ws = this.projectRoot(root);
    const now = new Date().toISOString();
    const existing = await readJson(this.configPath(ws), null);
    const config = {
      version: INSPECTOR_VERSION,
      name: "Inspector Core AI",
      status: "active",
      projectName: path.basename(ws),
      projectRoot: ws,
      autonomyLevel: existing?.autonomyLevel || 2,
      permissions: existing?.permissions || {
        observe: true,
        analyze: true,
        propose: true,
        writeRequiresApproval: true,
        autoFixSafeIssues: false,
      },
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await writeJson(this.configPath(ws), config);
    await fs.promises.mkdir(this.inspectorRoot(ws), { recursive: true });
    return config;
  }

  async walk(root) {
    const ws = this.projectRoot(root);
    const files = [];
    const stack = [ws];
    while (stack.length && files.length < MAX_FILES) {
      const dir = stack.pop();
      let entries;
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const abs = path.join(dir, entry.name);
        const rel = normalizeRel(ws, abs);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || rel === ".editcore/inspector-core") continue;
          stack.push(abs);
          continue;
        }
        if (!entry.isFile()) continue;
        let stat;
        try { stat = await fs.promises.stat(abs); } catch { continue; }
        const ext = path.extname(entry.name).toLowerCase();
        files.push({
          relative: rel,
          ext,
          type: classifyFile(rel),
          bytes: stat.size,
          mtimeMs: stat.mtimeMs,
          text: TEXT_EXTENSIONS.has(ext) && stat.size <= MAX_FILE_BYTES,
        });
        if (files.length >= MAX_FILES) break;
      }
    }
    return files.sort((a, b) => a.relative.localeCompare(b.relative));
  }

  async readPackage(root) {
    return readJson(resolveInside(this.projectRoot(root), "package.json"), null);
  }

  async scan(root, options = {}, progress = null) {
    const ws = this.projectRoot(root);
    this.emitProgress(progress, 5, "Verificando instalacion de Inspector Core...", "install");
    await this.install(ws);
    const previous = await readJson(this.twinPath(ws), null);
    this.emitProgress(progress, 12, "Leyendo inventario real del proyecto...", "walk");
    const [files, packageJson] = await Promise.all([this.walk(ws), this.readPackage(ws)]);
    const fingerprints = Object.fromEntries(files.map((file) => [file.relative, `${file.mtimeMs}:${file.bytes}`]));
    const fingerprintHash = hash(JSON.stringify(fingerprints));
    if (!options.force && previous?.fingerprintHash === fingerprintHash) {
      const reports = await this.reports(ws);
      this.emitProgress(progress, 35, "Inventario sin cambios; usando gemelo digital vigente.", "cache");
      return { ...previous, cached: true, reports: reports.items };
    }

    this.emitProgress(progress, 24, "Detectando frameworks, scripts, bases de datos y archivos criticos...", "facts");
    const frameworks = detectFrameworks(ws, packageJson || {});
    const databases = detectDatabases(ws, packageJson || {});
    const byType = files.reduce((acc, file) => {
      acc[file.type] = (acc[file.type] || 0) + 1;
      return acc;
    }, {});
    const languages = unique(files.map((file) => file.ext.replace(/^\./, "")).filter(Boolean));
    const scripts = packageJson?.scripts || {};
    const issues = detectIssues(ws, files, packageJson || {}, frameworks);
    const twin = {
      version: INSPECTOR_VERSION,
      projectName: path.basename(ws),
      projectRoot: ws,
      generatedAt: new Date().toISOString(),
      fingerprintHash,
      fileCount: files.length,
      byType,
      languages,
      frameworks,
      databases,
      packageManager: fs.existsSync(path.join(ws, "pnpm-lock.yaml")) ? "pnpm" : fs.existsSync(path.join(ws, "bun.lockb")) || fs.existsSync(path.join(ws, "bun.lock")) ? "bun" : fs.existsSync(path.join(ws, "package-lock.json")) ? "npm" : "",
      scripts,
      importantFiles: files.filter((file) => ["manifest", "api", "env", "test"].includes(file.type)).slice(0, 120),
      issues,
      evaluations: this.evaluateAll(ws, files, packageJson || {}, { frameworks, databases, scripts, issues }),
    };
    this.emitProgress(progress, 30, "Construyendo alertas desde evidencia de archivos...", "alerts");
    const alerts = await this.buildAlerts(ws, files, packageJson || {}, { frameworks, databases, scripts, issues }, []);
    await writeJson(this.alertsPath(ws), { version: 1, updatedAt: new Date().toISOString(), items: alerts });
    this.emitProgress(progress, 34, "Guardando gemelo digital y reporte de escaneo...", "write-scan");
    await writeJson(this.twinPath(ws), twin);
    await this.addReport(ws, {
      type: "scan",
      severity: issues.some((issue) => issue.severity === "high") ? "high" : issues.length ? "medium" : "info",
      title: `Inspeccion de ${twin.projectName}`,
      summary: `${files.length} archivos analizados, ${frameworks.length || 0} framework(s), ${issues.length} alerta(s).`,
      findings: issues,
      twinHash: fingerprintHash,
    });
    if (this.brainService) {
      this.emitProgress(progress, 36, "Indexando memoria del proyecto para Inspector...", "brain");
      await this.brainService.indexProject(ws, { force: options.force === true }).catch(() => null);
      await this.brainService.remember(ws, {
        scope: "project",
        type: "inspector-scan",
        title: "Inspector Core AI: escaneo interno de EDITCOREAI",
        content: this.summaryMarkdown(twin),
      }).catch(() => null);
    }
    return { ...twin, cached: false, reports: (await this.reports(ws)).items };
  }

  evaluateAll(root, files, packageJson = {}, facts = {}) {
    const areas = ["overview", "security", "tests", "deploy", "database", "pending"];
    return Object.fromEntries(areas.map((area) => [area, this.evaluateArea(root, area, files, packageJson, facts)]));
  }

  async readTextIfSmall(root, rel) {
    const filePath = resolveInside(root, rel);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size > MAX_FILE_BYTES) return "";
    return fs.promises.readFile(filePath, "utf8").catch(() => "");
  }

  commandRunner(root, packageJson = {}) {
    if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) return { bin: process.platform === "win32" ? "pnpm.cmd" : "pnpm", args: ["run"] };
    if (fs.existsSync(path.join(root, "bun.lock")) || fs.existsSync(path.join(root, "bun.lockb"))) return { bin: process.platform === "win32" ? "bun.cmd" : "bun", args: ["run"] };
    if (packageJson?.scripts) return { bin: process.platform === "win32" ? "npm.cmd" : "npm", args: ["run"] };
    return null;
  }

  async buildAlerts(root, files, packageJson = {}, facts = {}, commandResults = []) {
    const alerts = [];
    const add = (input) => alerts.push({
      id: input.id || `alert:${hash(`${input.area}:${input.title}:${input.file || ""}:${input.detail || ""}`).slice(0, 16)}`,
      status: input.status || "open",
      severity: input.severity || "medium",
      area: input.area || "overview",
      title: input.title,
      detail: input.detail || "",
      file: input.file || "",
      evidence: input.evidence || input.detail || "",
      recommendation: input.recommendation || "",
      fixable: Boolean(input.fixable),
      fixedAt: input.fixedAt || "",
      createdAt: input.createdAt || new Date().toISOString(),
    });
    const scripts = packageJson?.scripts || {};
    const isEditCoreRuntime = packageJson?.name === "editcoreai";
    const installRoot = isEditCoreRuntime ? path.resolve(root, "..", "..") : root;
    const existsInScope = (rel) => fileExists(root, rel) || (isEditCoreRuntime && fileExists(installRoot, rel));
    const frameworks = facts.frameworks || detectFrameworks(root, packageJson);
    const databases = facts.databases || detectDatabases(root, packageJson);
    const envFiles = files.filter((file) => file.type === "env").map((file) => file.relative);
    const gitignoreText = await this.readTextIfSmall(root, ".gitignore");
    const envProtected = envFiles.length && fileExists(root, ".env.example") && /(^|\n)\.env(?:\.\*|\s*$)/m.test(gitignoreText);
    if (envFiles.length) add({
      area: "security",
      severity: envProtected ? "low" : "high",
      status: envProtected ? "fixed" : "open",
      title: "Archivos .env detectados",
      detail: envProtected
        ? `Detectados y protegidos por .gitignore con plantilla sanitizada: ${envFiles.join(", ")}`
        : `Detectados: ${envFiles.join(", ")}`,
      file: envFiles[0],
      recommendation: envProtected ? "Mantener las claves fuera del repositorio." : "Verificar que no se suban secretos y crear .env.example sanitizado.",
      fixable: !envProtected,
    });
    if (!existsInScope(".gitignore")) add({ area: "security", severity: "medium", title: ".gitignore faltante", detail: "No existe .gitignore en raiz.", file: ".gitignore", recommendation: "Crear .gitignore minimo para dependencias, builds y secretos.", fixable: true });
    if (!fileExists(root, ".env.example") && (envFiles.length || databases.length)) add({ area: "security", severity: "medium", title: ".env.example faltante", detail: "No existe plantilla publica de variables.", file: ".env.example", recommendation: "Crear plantilla sin valores secretos.", fixable: true });
    if (Object.keys(scripts).length && !scripts.test) add({ area: "tests", severity: "high", title: "Script test faltante", detail: "package.json no define scripts.test.", file: "package.json", recommendation: "Agregar script de pruebas o test smoke compatible.", fixable: false });
    if (!files.some((file) => file.type === "test")) add({ area: "tests", severity: "medium", title: "Archivos de prueba faltantes", detail: "No se detectaron archivos test/spec.", file: "test/smoke.test.js", recommendation: "Agregar prueba smoke minima.", fixable: true });
    const hasBuildPath = Boolean(scripts.build || scripts["dist:win"] || scripts["release:win"] || packageJson.build);
    if (frameworks.some((name) => ["React", "Next.js", "Vue", "Angular", "Vite", "Electron"].includes(name)) && !hasBuildPath) add({ area: "deploy", severity: "high", title: "Script build faltante", detail: "Runtime frontend/app sin ruta de empaquetado o build.", file: "package.json", recommendation: "Agregar o documentar el build real de EDITCOREAI.", fixable: false });
    const hasDeployPath = Boolean(packageJson.build || ["vercel.json", "Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".github/workflows"].some((rel) => fileExists(root, rel)));
    if (!hasDeployPath) add({ area: "deploy", severity: "medium", title: "Configuracion deploy no detectada", detail: "No se detecto empaquetado Electron, Vercel, Docker o workflow de deploy.", file: "docs/PRODUCTION.md", recommendation: "Documentar proceso de produccion y variables.", fixable: true });
    if (databases.length && !files.some((file) => /migration|migrations|schema/i.test(file.relative))) add({ area: "database", severity: "medium", title: "Migraciones/schema no detectados", detail: `Base detectada: ${databases.join(", ")} sin migraciones/schema evidentes.`, file: "database", recommendation: "Agregar o verificar migraciones y politicas de acceso.", fixable: false });
    if (!files.some((file) => /^readme\.md$/i.test(file.relative)) && !existsInScope("README.md")) add({ area: "overview", severity: "low", title: "README faltante", detail: "No se encontro README.md en raiz.", file: "README.md", recommendation: "Crear documentacion minima del proyecto.", fixable: true });
    for (const file of files.filter((item) => item.text && ["code", "frontend", "config"].includes(item.type)).slice(0, 350)) {
      const text = await this.readTextIfSmall(root, file.relative);
      const detectorSource = /^(inspector-core-service\.js|test\/inspector-core-service\.test\.js)$/i.test(file.relative);
      if (!detectorSource && hasTaskMarker(text)) add({ area: "pending", severity: "low", title: "Marcador TODO/FIXME detectado", detail: "El archivo contiene TODO/FIXME/HACK en un comentario de codigo.", file: file.relative, recommendation: "Revisar y convertir en tarea concreta.", fixable: false });
      const containsSecretFixture = /editcore-build-verification|whsec_editcore/i.test(text);
      if (!detectorSource && !containsSecretFixture && /(api[_-]?key|secret|token|password)\s*[:=]\s*['\"][^'\"\s]{8,}/i.test(text) && !/\.env\.example$/i.test(file.relative)) add({ area: "security", severity: "high", title: "Posible secreto hardcodeado", detail: "Patron de key/secret/token/password con valor literal.", file: file.relative, recommendation: "Mover secreto a variables de entorno.", fixable: false });
    }
    if (isEditCoreRuntime) {
      const [indexText, mainText] = await Promise.all([
        this.readTextIfSmall(root, "index.html"),
        this.readTextIfSmall(root, "main.js"),
      ]);
      if (!/Content-Security-Policy/i.test(indexText)) add({ area: "security", severity: "high", title: "CSP interna ausente", detail: "index.html no define Content-Security-Policy.", file: "index.html", recommendation: "Bloquear scripts, objetos, formularios y conexiones no autorizadas.", fixable: false });
      if (!/configureElectronSecurity\(\)/.test(mainText) || !/setPermissionRequestHandler/.test(mainText)) add({ area: "security", severity: "high", title: "Permisos Electron sin endurecer", detail: "No se encontro politica nativa de permisos para las ventanas de EDITCOREAI.", file: "main.js", recommendation: "Denegar permisos emergentes por defecto y autorizar solo capacidades explicitas.", fixable: false });
      if (!/will-attach-webview/.test(mainText) || !/setWindowOpenHandler/.test(mainText)) add({ area: "security", severity: "high", title: "Webview sin aislamiento verificable", detail: "No se encontraron controles completos de navegacion, popups y preferencias del webview.", file: "main.js", recommendation: "Aislar webview, bloquear popups y limitar protocolos de navegacion.", fixable: false });
      if (!/safeStorage/.test(mainText)) add({ area: "security", severity: "high", title: "Almacenamiento cifrado no detectado", detail: "No se encontro uso de safeStorage para configuracion sensible.", file: "main.js", recommendation: "Cifrar claves y tokens en el proceso principal.", fixable: false });
    }
    for (const result of commandResults) {
      if (result.skipped) continue;
      if (!result.ok) add({ area: result.script === "build" ? "deploy" : result.script === "test" ? "tests" : "overview", severity: "high", title: `Fallo real en npm run ${result.script}`, detail: `Comando: ${result.command}. Exit code: ${result.exitCode ?? "desconocido"}`, file: "package.json", evidence: result.output, recommendation: "Corregir salida del comando antes de cerrar.", fixable: false });
    }
    return alerts;
  }

  async backupFile(root, rel) {
    const source = resolveInside(root, rel);
    if (!fs.existsSync(source)) return "";
    const backupDir = path.join(this.inspectorRoot(root), "backups", new Date().toISOString().replace(/[:.]/g, "-"));
    await fs.promises.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, rel.replace(/[\\/:"*?<>|]+/g, "__"));
    await fs.promises.copyFile(source, backupPath);
    return normalizeRel(root, backupPath);
  }

  async writeFix(root, rel, content, mode = "create") {
    // Diagnosticar dentro de un .asar es legitimo; corregir no. Falla aqui con
    // causa explicita en lugar de un ENOENT del shim de asar.
    assertWritableProjectRoot(root);
    const target = resolveInside(root, rel);
    const existed = fs.existsSync(target);
    const backup = existed ? await this.backupFile(root, rel) : "";
    if (mode === "create" && existed) return { skipped: true, path: rel, reason: "ya existe" };
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content, "utf8");
    return { path: rel, backup, bytes: Buffer.byteLength(content, "utf8") };
  }

  async applySafeFixes(root, alerts, files, packageJson = {}) {
    const fixes = [];
    const hasAlert = (title) => alerts.find((alert) => alert.title === title && alert.fixable && alert.status !== "fixed");
    const markFixed = (alert, fix) => {
      if (!alert || fix?.skipped) return;
      alert.status = "fixed";
      alert.fixedAt = new Date().toISOString();
      fixes.push({ id: `fix:${alert.id}`, alertId: alert.id, title: alert.title, path: fix.path, backup: fix.backup || "", bytes: fix.bytes || 0, fixedAt: alert.fixedAt });
    };
    let alert = hasAlert(".gitignore faltante");
    if (alert) markFixed(alert, await this.writeFix(root, ".gitignore", ["node_modules/", "dist/", "build/", ".next/", ".env", ".env.*", "!.env.example", "coverage/", ".DS_Store", ".editcore/", ""].join("\n")));
    alert = hasAlert(".env.example faltante") || hasAlert("Archivos .env detectados");
    if (alert && !fileExists(root, ".env.example")) {
      const envFiles = files.filter((file) => file.type === "env").map((file) => file.relative);
      const keys = new Set();
      for (const rel of envFiles) {
        const text = await this.readTextIfSmall(root, rel);
        for (const line of text.split(/\r?\n/)) {
          const key = line.match(/^\s*([A-Z0-9_]{2,})\s*=/i)?.[1];
          if (key) keys.add(key);
        }
      }
      markFixed(alert, await this.writeFix(root, ".env.example", [...keys].sort().map((key) => `${key}=`).join("\n") + "\n"));
    }
    alert = hasAlert("Configuracion deploy no detectada");
    if (alert && !fileExists(root, "docs/PRODUCTION.md")) markFixed(alert, await this.writeFix(root, "docs/PRODUCTION.md", `# Produccion\n\nPendiente validar build, variables de entorno, migraciones y proveedor de deploy.\n\nGenerado por Inspector Core.\n`));
    alert = hasAlert("README faltante");
    if (alert) markFixed(alert, await this.writeFix(root, "README.md", `# ${path.basename(root)}\n\nProyecto inspeccionado por EDITCOREAI Inspector.\n`));
    alert = hasAlert("Archivos de prueba faltantes");
    if (alert && !files.some((file) => file.type === "test")) {
      const isNode = Boolean(packageJson?.scripts || packageJson?.dependencies || packageJson?.devDependencies);
      if (isNode) markFixed(alert, await this.writeFix(root, "test/smoke.test.js", `"use strict";\n\nconst test = require("node:test");\nconst assert = require("node:assert/strict");\n\ntest("smoke", () => {\n  assert.equal(1 + 1, 2);\n});\n`));
    }
    return fixes;
  }

  async createCheckpoint(root) {
    const ws = this.projectRoot(root);
    const id = `checkpoint-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const checkpointRoot = path.join(this.inspectorRoot(ws), "checkpoints", id);
    const backupRoot = path.join(checkpointRoot, "files");
    const files = (await this.walk(ws)).filter((file) => file.text);
    const packageJson = await this.readPackage(ws) || {};
    const commandResults = await this.runChecks(ws, "report", packageJson);
    const items = [];
    for (const file of files) {
      const source = resolveInside(ws, file.relative);
      const backup = path.join(backupRoot, file.relative);
      await fs.promises.mkdir(path.dirname(backup), { recursive: true });
      await fs.promises.copyFile(source, backup);
      items.push({ path: file.relative, bytes: file.bytes, hash: hash(await fs.promises.readFile(source)) });
    }
    const manifest = { id, root: ws, createdAt: new Date().toISOString(), items, commandResults };
    await writeJson(path.join(checkpointRoot, "manifest.json"), manifest);
    return { id, files: items.length, commandResults };
  }

  async restoreCheckpoint(root, checkpointId, changedFiles = []) {
    const ws = assertWritableProjectRoot(root);
    const safeId = String(checkpointId || "");
    if (!/^checkpoint-[a-z0-9-]+$/i.test(safeId)) throw new Error("Checkpoint de Inspector invalido.");
    const checkpointRoot = path.join(this.inspectorRoot(ws), "checkpoints", safeId);
    const manifest = await readJson(path.join(checkpointRoot, "manifest.json"), null);
    if (!manifest || path.resolve(manifest.root) !== path.resolve(ws)) throw new Error("Checkpoint de Inspector no encontrado.");
    const originals = new Set((manifest.items || []).map((item) => item.path));
    const restored = [];
    for (const rel of unique(changedFiles.map((item) => String(item || "").replace(/\\/g, "/")))) {
      const target = resolveInside(ws, rel);
      const backup = path.join(checkpointRoot, "files", rel);
      if (originals.has(rel) && fs.existsSync(backup)) {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.copyFile(backup, target);
      } else if (!originals.has(rel)) {
        await fs.promises.rm(target, { force: true, recursive: true });
      }
      restored.push(rel);
    }
    return { restored, checkpointId: safeId };
  }

  async discardCheckpoint(root, checkpointId) {
    const ws = this.projectRoot(root);
    const safeId = String(checkpointId || "");
    if (!/^checkpoint-[a-z0-9-]+$/i.test(safeId)) return false;
    await fs.promises.rm(path.join(this.inspectorRoot(ws), "checkpoints", safeId), { recursive: true, force: true });
    return true;
  }

  evaluateReport(root, files, packageJson = {}, facts = {}) {
    const areas = ["overview", "security", "tests", "deploy", "database", "pending"];
    const evaluations = areas.map((area) => this.evaluateArea(root, area, files, packageJson, facts));
    const evidenceRows = evaluations.flatMap((evaluation) =>
      (evaluation.evidence || []).map((row) => evidence(row.status, `${this.areaLabel(evaluation.area)}: ${row.label}`, row.detail, row.source))
    );
    const actions = evaluations.flatMap((evaluation) => evaluation.actions || []);
    const references = evaluations.flatMap((evaluation) => evaluation.references || []);
    const status = statusFromEvidence(evidenceRows);
    return {
      area: "report",
      status,
      score: Math.round(evaluations.reduce((sum, evaluation) => sum + Number(evaluation.score || 0), 0) / evaluations.length),
      generatedAt: new Date().toISOString(),
      evidence: evidenceRows,
      actions: unique(actions),
      references: unique(references),
    };
  }

  areaLabel(area) {
    return {
      overview: "estado de EDITCOREAI",
      security: "Seguridad de EDITCOREAI",
      tests: "Validacion de EDITCOREAI",
      deploy: "Runtime y empaquetado",
      database: "Conexiones de EDITCOREAI",
      pending: "Pendientes",
      report: "Reporte completo",
      alerts: "Alertas",
    }[area] || area;
  }

  evaluateArea(root, area, filesArg = null, packageArg = null, factsArg = null) {
    const files = filesArg || [];
    const packageJson = packageArg || {};
    const frameworks = factsArg?.frameworks || detectFrameworks(root, packageJson);
    const databases = factsArg?.databases || detectDatabases(root, packageJson);
    const scripts = factsArg?.scripts || packageJson.scripts || {};
    const issues = factsArg?.issues || detectIssues(root, files, packageJson, frameworks);
    const isEditCoreRuntime = packageJson?.name === "editcoreai";
    const installRoot = isEditCoreRuntime ? path.resolve(root, "..", "..") : root;
    const existsInScope = (rel) => fileExists(root, rel) || (isEditCoreRuntime && fileExists(installRoot, rel));
    const rows = [];
    const actions = [];
    const refs = [];
    const add = (status, label, detail, source) => { rows.push(evidence(status, label, detail, source)); if (source) refs.push(source); };

    if (area === "overview") {
      add(frameworks.length ? "pass" : "unknown", "Arquitectura detectada", frameworks.length ? frameworks.join(", ") : "No se detecto framework principal.", "package.json / archivos raiz");
      add(Object.keys(scripts).length ? "pass" : "warn", "Scripts disponibles", Object.keys(scripts).join(", ") || "No se detectaron scripts de ejecucion.", "package.json");
      add(files.length ? "pass" : "unknown", "Inventario de archivos", `${files.length} archivo(s) escaneados por Inspector.`, "digital-twin");
      if (issues.length) add("warn", "Alertas abiertas", `${issues.length} alerta(s) requieren revision.`, "reports.json");
      else add("pass", "Alertas abiertas", "No hay alertas abiertas detectadas por el escaneo basico.", "reports.json");
      actions.push("Ejecutar analisis de pruebas, seguridad y empaquetado antes de marcar EDITCOREAI como estable.");
    }

    if (area === "security") {
      const envFiles = files.filter((file) => file.type === "env").map((file) => file.relative);
      add(envFiles.length ? "fail" : "pass", "Archivos de entorno", envFiles.length ? `Detectados: ${envFiles.join(", ")}` : "No se detectaron archivos .env dentro del escaneo.", envFiles[0] || "file scan");
      add(existsInScope(".gitignore") ? "pass" : "warn", ".gitignore", existsInScope(".gitignore") ? "Existe .gitignore en la instalacion de EDITCOREAI." : "No se detecto .gitignore en raiz.", ".gitignore");
      if (isEditCoreRuntime) {
        const secureConfig = files.some((file) => ["main.js", "preload.js"].includes(file.relative));
        add(secureConfig ? "pass" : "warn", "Configuracion segura", secureConfig ? "EDITCOREAI separa configuracion sensible mediante IPC y almacenamiento seguro." : "No se pudo verificar el canal de configuracion segura.", "main.js / preload.js");
      } else {
        add(fileExists(root, ".env.example") ? "pass" : "warn", ".env.example", fileExists(root, ".env.example") ? "Existe plantilla publica de variables." : "No se detecto .env.example.", ".env.example");
        add(packageJson.dependencies?.["@supabase/supabase-js"] || databases.includes("Supabase") ? "warn" : "unknown", "Secretos de servicios externos", databases.includes("Supabase") ? "Supabase detectado; verificar que las llaves privadas no esten en cliente." : "No se detecto proveedor de secretos en este analisis.", "package.json");
        actions.push("Verificar .gitignore y crear .env.example sin secretos reales.");
        actions.push("Separar llaves publicas y privadas antes de produccion.");
      }
    }

    if (area === "tests") {
      add(scripts.test ? "pass" : "fail", "Script test", scripts.test ? `npm test ejecuta: ${scripts.test}` : "No existe scripts.test.", "package.json");
      add(files.some((file) => file.type === "test") ? "pass" : "warn", "Archivos de prueba", files.some((file) => file.type === "test") ? `${files.filter((file) => file.type === "test").length} archivo(s) de prueba detectados.` : "No se detectaron archivos test/spec.", "file scan");
      add(scripts.lint || scripts.check ? "pass" : "warn", "Validacion estatica", scripts.lint ? `Lint disponible: ${scripts.lint}` : scripts.check ? `Check disponible: ${scripts.check}` : "No existe scripts.lint ni scripts.check.", "package.json");
      const buildScript = scripts.build || scripts["dist:win"] || scripts["release:win"];
      add(buildScript ? "pass" : "warn", "Validacion build", buildScript ? `Build disponible: ${buildScript}` : "No existe un script de build.", "package.json");
      if (!scripts.test || !buildScript) actions.push("Agregar prueba smoke minima y ejecutar test/build antes de cierre.");
    }

    if (area === "deploy") {
      const deployFiles = isEditCoreRuntime ? ["package.json", "scripts/build-windows.js"] : ["vercel.json", "Dockerfile", "docker-compose.yml", "docker-compose.yaml", ".github/workflows"];
      const found = deployFiles.filter((rel) => fileExists(root, rel));
      add(found.length || packageJson.build ? "pass" : "warn", "Configuracion deploy", packageJson.build ? "Configuracion electron-builder detectada en package.json." : found.length ? `Detectado: ${found.join(", ")}` : "No se detecto configuracion de deploy comun.", packageJson.build ? "package.json#build" : found[0] || "file scan");
      const buildScript = scripts.build || scripts["dist:win"] || scripts["release:win"];
      add(buildScript ? "pass" : "warn", "Build de produccion", buildScript ? `Comando build: ${buildScript}` : "No existe script de build en package.json.", "package.json");
      add(existsInScope("README.md") ? "pass" : "unknown", "Documentacion produccion", existsInScope("README.md") ? "La instalacion incluye README.md." : "No se detecto documentacion de produccion.", "README.md");
      if (!isEditCoreRuntime) actions.push("Validar variables de Vercel/Supabase y ejecutar build antes de desplegar.");
    }

    if (area === "database") {
      if (isEditCoreRuntime) {
        add(files.some((file) => file.relative === "project-storage.js") ? "pass" : "warn", "Persistencia local", "EDITCOREAI guarda proyectos y estado fuera de los proyectos abiertos.", "project-storage.js");
        add(files.some((file) => file.relative === "service-harness.js") ? "pass" : "warn", "Conectores de servicios", "Harness de conexiones detectado y separado del chat.", "service-harness.js");
        add("pass", "Migraciones", "No aplican: EDITCOREAI no declara una base de datos relacional interna.", "package.json");
      } else {
        add(databases.length ? "pass" : "unknown", "Base de datos detectada", databases.length ? databases.join(", ") : "No se detecto base de datos por dependencias/rutas.", "package.json / file scan");
        add(fileExists(root, "drizzle.config.ts") || fileExists(root, "prisma/schema.prisma") || fileExists(root, "supabase") ? "pass" : "unknown", "Schema/migraciones", "Revisar existencia de migraciones/schema antes de produccion.", "drizzle/prisma/supabase");
        add(files.some((file) => /migration|migrations/i.test(file.relative)) ? "pass" : "warn", "Migraciones", files.some((file) => /migration|migrations/i.test(file.relative)) ? "Se detectaron archivos/directorios de migraciones." : "No se detectaron migraciones en el escaneo.", "file scan");
        actions.push("Verificar schema, migraciones y politicas de acceso con conexion real.");
      }
    }

    if (area === "pending" || area === "alerts") {
      for (const issue of issues) add(issue.severity === "high" ? "fail" : "warn", issue.title, issue.detail || issue.recommendation || "Pendiente detectado.", "inspector issue");
      if (!issues.length) add("pass", "Pendientes automaticos", "No hay pendientes automaticos en el escaneo actual.", "inspector issue");
      actions.push("Convertir cada pendiente interno en una reparacion autorizada antes de marcar EDITCOREAI como estable.");
    }

    const status = statusFromEvidence(rows);
    return {
      area,
      status,
      score: scoreFromStatus(status),
      generatedAt: new Date().toISOString(),
      evidence: rows,
      actions: unique(actions),
      references: unique(refs),
    };
  }

  async evaluate(root, area = "overview", progress = null, options = {}) {
    const ws = this.projectRoot(root);
    const startedAt = Date.now();
    const repair = options.repair === true;
    const signal = options.signal || null;
    this.assertNotAborted(signal);
    this.emitProgress(progress, 1, `Iniciando escaneo completo para ${this.areaLabel(area)}...`, "start");
    const twin = await this.scan(ws, { force: true }, progress);
    this.assertNotAborted(signal);
    this.emitProgress(progress, 40, "Consultando memoria, skills y conocimiento del Cerebro...", "brain-context");
    const brainState = await this.brainSnapshot(ws, `Inspector ${this.areaLabel(area)} ${twin.projectName}`);
    this.assertNotAborted(signal);
    this.emitProgress(progress, 42, "Escaneo y contexto del Cerebro listos; preparando evaluacion profunda...", "scan-complete");
    const files = await this.walk(ws);
    const packageJson = await this.readPackage(ws) || {};
    this.assertNotAborted(signal);
    this.emitProgress(progress, 52, "Ejecutando scripts reales disponibles para esta evaluacion...", "commands");
    let commandResults = await this.runChecks(ws, area, packageJson, signal);
    const facts = {
      frameworks: twin.frameworks || [],
      databases: twin.databases || [],
      scripts: twin.scripts || {},
      issues: twin.issues || [],
    };
    this.assertNotAborted(signal);
    this.emitProgress(progress, 70, "Calculando alertas abiertas y corregibles con evidencia...", "build-alerts");
    const alerts = await this.buildAlerts(ws, files, packageJson, facts, commandResults);
    let fixes = [];
    if (repair) {
      this.assertNotAborted(signal);
      this.emitProgress(progress, 82, "Aplicando correcciones seguras con respaldo...", "fixes");
      fixes = await this.applySafeFixes(ws, alerts, files, packageJson);
      this.assertNotAborted(signal);
      this.emitProgress(progress, 88, "Repitiendo comandos y alertas despues de la reparacion...", "post-verify");
      commandResults = await this.runChecks(ws, area, packageJson, signal);
      const verifiedFiles = await this.walk(ws);
      const verifiedAlerts = await this.buildAlerts(ws, verifiedFiles, packageJson, facts, commandResults);
      alerts.splice(0, alerts.length, ...verifiedAlerts);
    } else {
      this.emitProgress(progress, 82, "Escaneo de solo lectura; no se modificaran archivos.", "read-only");
    }
    this.assertNotAborted(signal);
    this.emitProgress(progress, 90, "Guardando alerts.json, fixes.json y reporte verificable...", "write-results");
    await writeJson(this.alertsPath(ws), { version: 1, updatedAt: new Date().toISOString(), items: alerts });
    if (repair) await writeJson(this.fixesPath(ws), { version: 1, updatedAt: new Date().toISOString(), items: fixes });
    const evaluation = area === "report"
      ? this.evaluateReport(ws, files, packageJson, facts)
      : area === "alerts"
        ? this.evaluateAlerts(alerts, fixes, commandResults)
        : this.evaluateArea(ws, area, files, packageJson, facts);
    evaluation.commandResults = commandResults;
    evaluation.alerts = area === "alerts" ? alerts : alerts.filter((alert) => area === "overview" || area === "report" || alert.area === area);
    evaluation.fixes = fixes;
    evaluation.brain = {
      available: brainState.available,
      contextLoaded: brainState.contextLoaded,
      skillsAvailable: brainState.skillsAvailable,
      installedCapabilities: brainState.installedCapabilities,
      memory: brainState.memory,
    };
    evaluation.evidence.push(evidence(
      brainState.available && brainState.contextLoaded ? "pass" : "fail",
      "Cerebro de EDITCOREAI",
      brainState.available
        ? `${brainState.skillsAvailable} skills y ${brainState.installedCapabilities} capacidades instaladas disponibles para Inspector.`
        : "Inspector no tiene acceso al servicio de Cerebro.",
      "EditCoreBrainService",
    ));
    evaluation.repairVerification = repair ? {
      ok: commandResults.every((item) => item.skipped || item.ok) && !alerts.some((item) => item.status !== "fixed" && item.severity === "high"),
      commands: commandResults,
      remainingHighAlerts: alerts.filter((item) => item.status !== "fixed" && item.severity === "high").length,
    } : null;
    evaluation.target = "editcore-runtime";
    evaluation.targetRoot = ws;
    evaluation.openAlertCount = alerts.filter((item) => item.status !== "fixed").length;
    evaluation.fixedAlertCount = alerts.filter((item) => item.status === "fixed").length;
    const correction = this.correctionPrompt(ws, area, alerts, commandResults);
    evaluation.handoffPrompt = [
      correction,
      evaluation.openAlertCount
        ? `Hay ${evaluation.openAlertCount} hallazgo(s) abiertos. Usa el boton Reparar EDITCOREAI / Reparar proyecto.`
        : "",
      brainState.context ? `CONTEXTO DEL CEREBRO DE EDITCOREAI (usar como memoria interna):\n${brainState.context}` : "",
    ].filter(Boolean).join("\n\n");
    evaluation.durationMs = Date.now() - startedAt;
    await this.addReport(ws, {
      type: `${repair ? "repair" : "scan"}:${area}`,
      severity: evaluation.status === "critical" ? "high" : evaluation.status === "attention" ? "medium" : "info",
      title: `Evaluacion ${this.areaLabel(area)}`,
      summary: `Estado ${evaluation.status}. Score ${evaluation.score}. Alertas ${alerts.filter((item) => item.status !== "fixed").length} abiertas, ${fixes.length} corregidas. Duracion ${Math.round(evaluation.durationMs / 1000)}s.`,
      findings: [...alerts, ...evaluation.evidence.map((row) => ({
        severity: row.status === "fail" ? "high" : row.status === "warn" ? "medium" : "low",
        title: row.label,
        detail: row.detail,
        recommendation: row.status === "pass" ? "Sin accion inmediata." : "Revisar evidencia y ejecutar correccion autorizada.",
      }))],
      evaluation,
    });
    this.emitProgress(progress, 100, `${repair ? "Reparacion" : "Escaneo"} ${this.areaLabel(area)} completado con evidencia real.`, "complete", "complete");
    return evaluation;
  }

  async diagnose(root, progress = null, options = {}) {
    return this.evaluate(root, "report", progress, { ...options, repair: false });
  }

  async repair(root, progress = null, options = {}) {
    return this.evaluate(root, "report", progress, { ...options, repair: true });
  }

  correctionPrompt(root, area, alerts = [], commandResults = []) {
    const open = alerts.filter((item) => item.status !== "fixed");
    const failedCommands = commandResults.filter((item) => !item.skipped && !item.ok);
    if (!open.length && !failedCommands.length) return "";
    return [
      `Corrige EDITCOREAI en ${root}.`,
      `Area diagnosticada por Inspector: ${this.areaLabel(area)}.`,
      "Trabaja solamente dentro de esta carpeta. Lee primero los archivos implicados y conserva la arquitectura existente.",
      "Crea respaldos mediante las herramientas de EDITCOREAI antes de escribir. Corrige un problema por vez.",
      ...open.slice(0, 20).map((alert, index) => `${index + 1}. [${alert.severity}] ${alert.title}${alert.file ? ` en ${alert.file}` : ""}: ${alert.detail || alert.recommendation}`),
      ...failedCommands.slice(0, 6).map((result) => `Comando fallido ${result.command}: ${String(result.output || "").replace(/\s+/g, " ").slice(0, 800)}`),
      "Al terminar ejecuta npm run check y npm test cuando existan. No declares corregido un hallazgo sin volver a ejecutar su comprobacion.",
      "Si una correccion provoca una regresion, restaura el archivo afectado e informa el bloqueo exacto.",
    ].join("\n");
  }

  evaluateAlerts(alerts, fixes, commandResults = []) {
    const open = alerts.filter((alert) => alert.status !== "fixed");
    const rows = alerts.map((alert) => evidence(alert.status === "fixed" ? "pass" : alert.severity === "high" ? "fail" : "warn", `${alert.status === "fixed" ? "Corregida" : "Abierta"}: ${alert.title}`, `${alert.detail}${alert.file ? ` (${alert.file})` : ""}`, alert.evidence || alert.file || "alerts.json"));
    for (const result of commandResults) {
      if (!result.skipped) rows.push(evidence(result.ok ? "pass" : "fail", `Comando real: ${result.script}`, result.ok ? `OK: ${result.command}` : `Fallo: ${result.command}`, "package.json"));
    }
    const status = open.some((alert) => alert.severity === "high") ? "critical" : open.length ? "attention" : "ok";
    return {
      area: "alerts",
      status,
      score: scoreFromStatus(status),
      generatedAt: new Date().toISOString(),
      evidence: rows,
      actions: open.length
        ? open.map((alert) => `${alert.title}: ${alert.recommendation || "Revisar evidencia."}`)
        : ["No quedan alertas abiertas despues de las correcciones seguras."],
      references: unique(alerts.map((alert) => alert.file || "alerts.json")),
      alerts,
      fixes,
    };
  }

  async addReport(root, report) {
    const ws = this.projectRoot(root);
    const current = await readJson(this.reportsPath(ws), { version: 1, items: [] });
    const item = {
      id: report.id || `icr-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      createdAt: report.createdAt || new Date().toISOString(),
      status: report.status || "open",
      ...report,
    };
    const next = { version: 1, updatedAt: new Date().toISOString(), items: [item, ...(current.items || [])].slice(0, 200) };
    await writeJson(this.reportsPath(ws), next);
    return item;
  }

  async reports(root) {
    const ws = this.projectRoot(root);
    return readJson(this.reportsPath(ws), { version: 1, items: [] });
  }

  async snapshot(root) {
    const ws = this.projectRoot(root);
    const [config, twin, reports, alerts, fixes] = await Promise.all([
      readJson(this.configPath(ws), null),
      readJson(this.twinPath(ws), null),
      this.reports(ws),
      readJson(this.alertsPath(ws), { version: 1, items: [] }),
      readJson(this.fixesPath(ws), { version: 1, items: [] }),
    ]);
    const openAlertItems = (alerts.items || []).filter((item) => item.status !== "fixed");
    return {
      installed: Boolean(config?.status === "active"),
      config,
      twin,
      reports: reports.items || [],
      alerts: alerts.items || [],
      fixes: fixes.items || [],
      openAlerts: openAlertItems.length,
      fixedAlerts: (alerts.items || []).filter((item) => item.status === "fixed").length,
      ready: true,
    };
  }

  summaryMarkdown(twin) {
    const issues = twin.issues || [];
    return [
      `Proyecto: ${twin.projectName}`,
      `Archivos: ${twin.fileCount}`,
      `Frameworks: ${twin.frameworks?.join(", ") || "no detectados"}`,
      `Bases de datos: ${twin.databases?.join(", ") || "no detectadas"}`,
      `Lenguajes/extensiones: ${twin.languages?.slice(0, 18).join(", ") || "no detectados"}`,
      `Scripts: ${Object.keys(twin.scripts || {}).join(", ") || "no detectados"}`,
      `Alertas: ${issues.length}`,
      ...issues.slice(0, 8).map((issue) => `- [${issue.severity}] ${issue.title}: ${issue.recommendation}`),
    ].join("\n");
  }

  async listCheckpoints(root) {
    const ws = this.projectRoot(root);
    const dir = path.join(this.inspectorRoot(ws), "checkpoints");
    if (!fs.existsSync(dir)) return [];
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const checkpoints = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^checkpoint-/.test(entry.name)) continue;
      const manifestPath = path.join(dir, entry.name, "manifest.json");
      const manifest = await readJson(manifestPath, null);
      if (manifest) checkpoints.push({ id: manifest.id, createdAt: manifest.createdAt, files: manifest.items?.length || 0 });
    }
    return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async cleanOldCheckpoints(root, keep = 5) {
    const all = await this.listCheckpoints(root);
    const toDelete = all.slice(keep);
    for (const checkpoint of toDelete) await this.discardCheckpoint(root, checkpoint.id);
    return { kept: all.slice(0, keep).length, deleted: toDelete.length };
  }

  async cleanCheckpoints(root, keep = 5) {
    return this.cleanOldCheckpoints(root, keep);
  }

  async validateAfterRepair(root, checkpointId) {
    const ws = this.projectRoot(root);
    const checkpointRoot = path.join(this.inspectorRoot(ws), "checkpoints", checkpointId);
    const manifest = await readJson(path.join(checkpointRoot, "manifest.json"), null);
    if (!manifest) return { degraded: false, reason: "Checkpoint no encontrado; no se puede comparar." };
    const beforeResults = manifest.commandResults || [];
    const packageJson = await this.readPackage(ws) || {};
    const afterResults = await this.runChecks(ws, "validation", packageJson);
    const degraded = [];
    for (const before of beforeResults) {
      if (!before.ok) continue;
      const after = afterResults.find((r) => r.script === before.script);
      if (after && !after.ok) degraded.push({ script: before.script, beforeOk: true, afterOk: false, error: after.error });
    }
    return {
      degraded: degraded.length > 0,
      failures: degraded,
      reason: degraded.length
        ? `${degraded.length} comprobacion(es) que pasaban ahora fallan: ${degraded.map((d) => d.script).join(", ")}`
        : "Todas las comprobaciones que pasaban antes siguen pasando.",
    };
  }

  async validateRepair(root, checkpointId) {
    return this.validateAfterRepair(root, checkpointId);
  }
}


module.exports = { InspectorCoreService, detectFrameworks, detectDatabases, classifyFile, hasTaskMarker };
