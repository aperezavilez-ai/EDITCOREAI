"use strict";

const ALLOWED_COMMANDS = new Map([
  ["node", new Set(["--check", "--test", "--version", "-v"])],
  ["git", new Set(["status", "diff", "log", "ls-files"])],
  ["npm", new Set(["test", "run", "audit"])],
  ["pnpm", new Set(["test", "run", "audit"])],
  ["yarn", new Set(["test", "run"])],
  ["bun", new Set(["test", "run"])],
  ["npx", new Set(["tsc", "vite", "eslint"])],
  ["tsc", new Set(["--noEmit", "-v", "--version"])],
  ["eslint", new Set(["."])],
  ["rg", null],
  ["dir", null],
  ["ls", null],
]);
const FULL_ACCESS_EXECUTABLES = new Set([
  "node", "npm", "npx", "pnpm", "yarn", "bun", "git", "gh", "vercel", "supabase", "tsc", "eslint",
  "dir", "ls", "rg", "cargo", "pytest", "vitest", "jest", "prettier", "docker", "kubectl", "wget",
  "ssh", "psql", "pg_dump",
  "agent-reach", "yt-dlp", "curl", "mcporter", "opencli", "bili", "twitter", "rdt",
  "powershell", "pwsh", "cmd", "mkdir", "python", "py", "pip", "pip3",
]);

function tokenize(command) {
  const raw = String(command || "").trim();
  if (!raw || /[&|;<>\x00-\x1f\x60]/.test(raw) || raw.includes("$(")) throw new Error("Comando no permitido.");
  const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) || [];
  return { executable: String(parts.shift() || "").toLowerCase(), args: parts };
}

function normalizeExecutableToken(token = "") {
  const raw = String(token || "").trim().replace(/^["']|["']$/g, "");
  const base = raw.split(/[/\\]/).pop()?.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/i, "") || raw.toLowerCase();
  const known = new Set([
    "npm", "npx", "pnpm", "yarn", "bun", "node", "tsc", "eslint", "prettier", "vitest", "jest", "git", "gh",
    "vercel", "supabase", "python", "py", "pip", "pip3", "cargo", "docker", "kubectl", "rg", "curl", "wget",
  ]);
  if (known.has(base)) return base;
  return raw.toLowerCase().replace(/\.exe$/i, "");
}

function splitWindowsCliCommand(command = "") {
  const raw = String(command || "").trim();
  const quoted = raw.match(/^("(?:[^"]|\\.)+"|'(?:[^']|\\.)+')\s+([\s\S]*)$/);
  if (quoted) {
    return { executable: normalizeExecutableToken(quoted[1]), rest: String(quoted[2] || "").trim() };
  }
  const winPath = raw.match(/^([A-Za-z]:\\.*?\.(?:cmd|exe|bat|com))\s+([\s\S]*)$/i);
  if (winPath) {
    return { executable: normalizeExecutableToken(winPath[1]), rest: String(winPath[2] || "").trim() };
  }
  return null;
}

function tokenizePermissive(command) {
  const raw = String(command || "").trim();
  if (!raw || /[\x00]/.test(raw)) throw new Error("Comando no permitido.");
  const windowsSplit = splitWindowsCliCommand(raw);
  if (windowsSplit) {
    const parts = windowsSplit.rest.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) || [];
    return { executable: windowsSplit.executable, args: parts };
  }
  const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^['"]|['"]$/g, "")) || [];
  const executable = normalizeExecutableToken(parts.shift() || "");
  if (!executable) throw new Error("Comando vacio.");
  return { executable, args: parts };
}

function isWindowsPackageManager(executable = "") {
  return ["npm", "npx", "pnpm", "yarn", "bun"].includes(String(executable || "").toLowerCase());
}

function commandTimeoutMs(parsed = {}) {
  const executable = String(parsed.executable || "").toLowerCase();
  const sub = String(parsed.args?.[0] || "").toLowerCase();
  const script = String(parsed.args?.[1] || "").toLowerCase();
  if (isWindowsPackageManager(executable) && sub === "install") return 600_000;
  if (isWindowsPackageManager(executable) && sub === "ci") return 600_000;
  if (isWindowsPackageManager(executable) && sub === "run" && ["build", "check", "lint", "typecheck", "verify"].includes(script)) return 300_000;
  return 120_000;
}

function shouldRunWithShell(executable = "") {
  const name = String(executable || "").toLowerCase();
  return isWindowsPackageManager(name)
    || ["vercel", "supabase", "gh", "tsc", "eslint", "prettier", "vitest", "jest", "node"].includes(name);
}

function isProjectDevServerCommand(command = "") {
  const raw = String(command || "").trim();
  if (!raw) return false;
  return /^(?:"[^"]+"|'[^']+'|[A-Za-z]:\\.*?\.(?:cmd|exe|bat)|npm|pnpm|yarn|bun)\s+run\s+(dev|start|preview)\b/i.test(raw)
    || /^(npm|pnpm|yarn|bun)\s+run\s+(dev|start|preview)\b/i.test(raw);
}

function quoteWindowsCmdArg(value = "") {
  const text = String(value);
  if (!/[\s"&<>|^()]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function buildWindowsCmdInvocation(executablePath, args = []) {
  const commandLine = [executablePath, ...args].map(quoteWindowsCmdArg).join(" ");
  return ["/d", "/s", "/c", commandLine];
}

function classifyCommandRisk(command = "", options = {}) {
  const raw = String(command || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return { level: "none" };
  const fullAccess = options.fullAccess === true || options.permissionMode === "full";

  const blocked = [
    [/\bformat\s+[a-z]:/i, "Formateo de volumen"],
    [/\bmkfs\./i, "Formateo de disco"],
    [/\bdd\s+if=/i, "Escritura directa a dispositivo de bloque"],
    [/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\s*$/i, "Eliminacion de la raiz del sistema"],
    [/\bdel\s+\/f\s+\/s\s+\/q\s+[a-z]:\\/i, "Eliminacion masiva de unidad Windows"],
  ];
  for (const [pattern, reason] of blocked) {
    if (pattern.test(raw)) return { level: "block", reason };
  }

  if (/^git\s+push\b/i.test(lower)) {
    return fullAccess
      ? { level: "none", kind: "git push" }
      : { level: "confirm", kind: "git push", message: "Publicar cambios en el repositorio remoto" };
  }
  if (/^gh\s+(pr|release|repo)\s+(create|merge|edit|publish)\b/i.test(lower)) {
    return fullAccess
      ? { level: "none", kind: "GitHub remoto" }
      : { level: "confirm", kind: "GitHub remoto", message: "Crear o publicar en GitHub" };
  }
  if (/^vercel\b/i.test(lower) && !/^vercel\s+(ls|list|whoami|inspect|logs|env\s+ls)\b/i.test(lower)) {
    return fullAccess
      ? { level: "none", kind: "deploy Vercel" }
      : { level: "confirm", kind: "deploy Vercel", message: "Desplegar en Vercel" };
  }
  if (/^supabase\s+(db\s+push|functions\s+deploy|secrets|migration\s+up|storage)\b/i.test(lower)) {
    return fullAccess
      ? { level: "none", kind: "Supabase remoto" }
      : { level: "confirm", kind: "Supabase remoto", message: "Aplicar cambios en Supabase" };
  }
  if (/\brm\s+-rf\b/i.test(lower) || /\bdel\s+\/s\b/i.test(lower) || /\bremove-item\b.*\s-recurse\b/i.test(lower)) {
    return { level: "confirm", kind: "eliminacion recursiva", message: "Eliminar archivos o carpetas de forma masiva" };
  }
  if (/\bnode\b.*\s(-e|--eval|--print|-p)\b/i.test(lower)) {
    return fullAccess
      ? { level: "none", kind: "codigo Node ad-hoc" }
      : { level: "confirm", kind: "codigo Node ad-hoc", message: "Ejecutar codigo Node inline (node -e)" };
  }
  if (/^(powershell|pwsh|cmd)(\.exe)?\b/i.test(lower)) {
    return fullAccess
      ? { level: "none", kind: "interprete shell" }
      : { level: "confirm", kind: "interprete shell", message: "Ejecutar interprete de shell del sistema" };
  }
  if (/&&|\||`/.test(raw) || raw.includes("$(")) {
    return fullAccess
      ? { level: "none", kind: "comando compuesto" }
      : { level: "confirm", kind: "comando compuesto", message: "Varios comandos encadenados en una sola ejecucion" };
  }
  return { level: "none" };
}

function parseSafeCommand(command) {
  const { executable, args } = tokenize(command);
  const allowedFirstArgs = ALLOWED_COMMANDS.get(executable);
  if (!ALLOWED_COMMANDS.has(executable)) throw new Error("Comando no permitido.");
  if (allowedFirstArgs && !allowedFirstArgs.has(String(args[0] || ""))) throw new Error("Comando no permitido.");
  if (executable === "node" && args[0] === "--check" && args.length !== 2) throw new Error("Usa: node --check <archivo>.");
  if (executable === "node" && ["--version", "-v"].includes(args[0]) && args.length !== 1) throw new Error("Argumentos no permitidos.");
  if (executable === "node" && args[0] === "--test" && (args.length < 1 || args.slice(1).some((arg) => arg.startsWith("-")))) throw new Error("Usa: node --test [archivos].");
  if (executable === "git") {
    const allowedForms = new Set([
      "status", "status --short", "diff", "diff --stat", "diff --name-only",
      "diff --cached", "diff --cached --stat", "diff --cached --name-only",
      "log --oneline", "log --oneline -5", "log --oneline -10", "ls-files",
    ]);
    if (!allowedForms.has(args.join(" "))) throw new Error("Argumentos de git no permitidos.");
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(executable)) {
    if (args[0] === "test" && args.length !== 1) throw new Error("Argumentos no permitidos.");
    if (args[0] === "run") {
      const allowedScripts = new Set(["build", "check", "dev", "lint", "preview", "start", "test", "test:unit", "typecheck", "verify"]);
      if (args.length !== 2 || !allowedScripts.has(args[1])) throw new Error("Script no permitido.");
    }
    if (args[0] === "audit" && (["yarn", "bun"].includes(executable) || args.some((arg) => !["audit", "--json"].includes(arg)))) {
      throw new Error("Usa solamente npm audit, npm audit --json, pnpm audit o pnpm audit --json.");
    }
  }
  if (executable === "npx") {
    if (args[0] === "tsc" && args.slice(1).some((arg) => !["--noEmit", "-v", "--version"].includes(arg))) throw new Error("Argumentos de npx tsc no permitidos.");
    if (args[0] === "vite" && args.slice(1).some((arg) => !["--version", "-v"].includes(arg))) throw new Error("Argumentos de npx vite no permitidos.");
    if (args[0] === "eslint" && args.slice(1).some((arg) => ![".", "--max-warnings=0"].includes(arg))) throw new Error("Argumentos de npx eslint no permitidos.");
  }
  if (executable === "tsc" && args.some((arg) => !["--noEmit", "-v", "--version"].includes(arg))) throw new Error("Argumentos de tsc no permitidos.");
  if (executable === "eslint" && args.some((arg) => ![".", "--max-warnings=0"].includes(arg))) throw new Error("Argumentos de eslint no permitidos.");
  if (executable === "rg") {
    if (!args.length || args.length > 8) throw new Error("Usa rg con una busqueda concreta.");
    if (args.some((arg) => /^-/.test(arg) && !["-n", "--files", "--hidden", "--glob", "-S", "-i"].includes(arg))) throw new Error("Argumentos de rg no permitidos.");
  }
  if ((executable === "dir" || executable === "ls") && args.some((arg) => ![".", "-la", "-l", "-a"].includes(arg))) throw new Error("Argumentos de listado no permitidos.");
  return { executable, args };
}

function parseAnalysisCommand(command, options = {}) {
  const raw = String(command || "").trim();
  if (isAnalysisHeavyVerificationCommand(raw)) {
    if (options.allowAcotadoDiagnostic === true && isAcotadoDiagnosticCommand(raw)) {
      return parseSafeCommand(command);
    }
    throw new Error("MODO ANALISIS: PROHIBIDO lint/test/build. Usa list_files/read_file/search_files; lint solo tras PROCEDE. Typecheck acotado solo tras cobertura.");
  }
  const parsed = parseSafeCommand(command);
  return parsed;
}

/** Lint/test/build (incl. pipes/redirecciones). */
function isAnalysisHeavyVerificationCommand(command = "") {
  const raw = String(command || "");
  return /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:lint|test|build|check|typecheck|verify|dev|start|preview)\b/i.test(raw)
    || /\b(?:npx\s+)?(?:eslint|tsc|vitest|jest)\b/i.test(raw)
    || /\bnode\s+--test\b/i.test(raw)
    || /\blint\b/i.test(raw);
}

/**
 * Diagnostico acotado de solo lectura (sin lint/build/dev).
 * Permitido en analisis SOLO tras cobertura (analysisDiagnosticAllowed).
 */
function isAcotadoDiagnosticCommand(command = "") {
  const raw = String(command || "").trim();
  if (!raw || /[|&;]/.test(raw) || /\b(?:lint|eslint|build|dev|start|preview|webpack)\b/i.test(raw)) {
    return false;
  }
  if (/^(?:npx\s+)?tsc(?:\.cmd)?(?:\s+-p\s+\S+)?\s+--noEmit\b/i.test(raw)) return true;
  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?typecheck\b/i.test(raw)) return true;
  return false;
}

/**
 * Bloquear verificacion pesada aunque analysisMode venga mal (CONTINUA/forense).
 * Solo PROCEDE (planAuthorized) puede lint/test/build.
 * Typecheck acotado: no se decide aqui (requiere comando + analysisDiagnosticAllowed en main).
 */
function shouldBlockHeavyVerification({ analysisMode = false, planAuthorized = false, prompt = "", goal = "", task = "" } = {}) {
  if (planAuthorized === true) return false;
  if (analysisMode === true) return true;
  const blob = `${prompt || ""}\n${goal || ""}\n${task || ""}`;
  if (/^\s*contin[uú]a\b/i.test(String(prompt || "").trim())) return true;
  if (/\b(forense|MODO:\s*DIAGN|NO\s+MODIFICAR)\b/i.test(blob)) return true;
  if (/\b(analiza|audita|diagnostica|an[aá]lisis|auditor[ií]a|reporte)\b/i.test(blob)
    && !/\b(corrige|repara|arregla|implementa|procede|adelante|autorizo)\b/i.test(blob)) {
    return true;
  }
  return false;
}

function parseLegacyReadCommand(command) {
  let parsed;
  try {
    parsed = tokenize(command);
  } catch {
    return null;
  }
  if (!["cat", "type"].includes(parsed.executable)) return null;
  if (parsed.args.length !== 1) return null;
  const target = String(parsed.args[0] || "");
  if (!target || target.startsWith("-")) return null;
  return { executable: parsed.executable, args: [target], path: target };
}

function isShellReadCommand(command) {
  return Boolean(parseLegacyReadCommand(command)?.path);
}

function resolveShellReadPath(command) {
  const parsed = parseLegacyReadCommand(command);
  return parsed?.path ? String(parsed.path) : null;
}

const DANGEROUS_FLAGS = new Map([
  ["node", new Set(["-e", "--eval", "-p", "--print"])],
  ["npx", new Set(["-c", "--call"])],
  ["yt-dlp", new Set(["--exec", "--exec-before-download"])],
  ["curl", new Set(["-K", "--config"])],
  ["ssh", new Set(["-o"])],
]);
const BLOCKED_SUBCOMMANDS = new Map([
  ["gh", [["repo", "delete"], ["secret", "delete"], ["release", "delete"]]],
  ["supabase", [["projects", "delete"], ["db", "reset"]]],
  ["vercel", [["remove"], ["rm"]]],
]);

function assertNoDangerousFlags(executable, args) {
  const flags = DANGEROUS_FLAGS.get(executable);
  if (!flags) return;
  const allowSshOption = (index) => executable === "ssh" && /^(StrictHostKeyChecking|UserKnownHostsFile|BatchMode|ConnectTimeout)=/i.test(String(args[index + 1] || ""));
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || "");
    const bare = arg.split("=")[0];
    if (!flags.has(bare)) continue;
    if (allowSshOption(i)) continue;
    throw new Error(`Argumento no permitido para ${executable}: ${bare}. Escribe un archivo y ejecutalo en su lugar.`);
  }
}

function assertNotBlockedSubcommand(executable, args) {
  const blocked = BLOCKED_SUBCOMMANDS.get(executable);
  if (!blocked) return;
  const positional = args.filter((arg) => !String(arg).startsWith("-")).map((arg) => String(arg).toLowerCase());
  for (const sequence of blocked) {
    if (sequence.every((token, index) => positional[index] === token)) {
      throw new Error(`Operacion destructiva bloqueada: ${executable} ${sequence.join(" ")}. Ejecutala manualmente si es intencional.`);
    }
  }
}

function parseFullAccessCommand(command) {
  const raw = String(command || "").trim();
  if (!raw) throw new Error("Comando vacio.");
  const risk = classifyCommandRisk(raw);
  if (risk.level === "block") throw new Error(`Operacion bloqueada: ${risk.reason}`);

  const needsShell = /[&|;`]/.test(raw)
    || raw.includes("$(")
    || /^(powershell|pwsh|cmd)(\.exe)?\b/i.test(raw);

  if (needsShell) {
    const executable = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "sh";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", raw] : ["-c", raw];
    return { shell: true, executable, args, risk, originalCommand: raw };
  }

  const parsed = tokenizePermissive(raw);
  if (!FULL_ACCESS_EXECUTABLES.has(parsed.executable) && !parsed.executable.includes("/") && !parsed.executable.includes("\\")) {
    throw new Error(`Ejecutable no permitido en acceso completo: ${parsed.executable}`);
  }
  if ((parsed.executable === "dir" || parsed.executable === "ls")
    && parsed.args.some((arg) => ![".", "-la", "-l", "-a", "/b", "/s"].includes(arg))) {
    // Acceso completo: permitir flags de listado extendidos
  }
  assertNotBlockedSubcommand(parsed.executable, parsed.args);
  return { ...parsed, shell: false, risk };
}

function isShellExploreCommand(command) {
  const raw = String(command || "").trim();
  if (!raw) return false;
  if (/^(find|grep|ls|dir|cat|type|head|tail|wc|awk|sed|rg|ag|fd|tree|gci|get-childitem)\b/i.test(raw)) return true;
  if (/\b(get-childitem|gci)\b/i.test(raw)) return true;
  if (/^(powershell|pwsh|cmd)(\.exe)?\b/i.test(raw) && /\b(dir|ls|tree|get-childitem|gci|findstr|find)\b/i.test(raw)) return true;
  return false;
}

function extractShellExplorePathHint(command = "") {
  const raw = String(command || "");
  const quoted = raw.match(/["']([^"']+)["']/);
  if (quoted?.[1]) return quoted[1].trim();
  const after = raw.match(/\b(?:dir|ls|tree|get-childitem|gci)\s+(\S+)/i);
  if (after?.[1] && !/^-\w/.test(after[1])) return after[1].replace(/["']/g, "").trim();
  return "";
}

module.exports = {
  parseSafeCommand,
  parseAnalysisCommand,
  parseFullAccessCommand,
  parseLegacyReadCommand,
  isShellReadCommand,
  resolveShellReadPath,
  isShellExploreCommand,
  extractShellExplorePathHint,
  classifyCommandRisk,
  normalizeExecutableToken,
  isProjectDevServerCommand,
  buildWindowsCmdInvocation,
  isWindowsPackageManager,
  commandTimeoutMs,
  shouldRunWithShell,
  isAnalysisHeavyVerificationCommand,
  isAcotadoDiagnosticCommand,
  shouldBlockHeavyVerification,
};
