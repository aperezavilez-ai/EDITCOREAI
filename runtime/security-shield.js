"use strict";

/**
 * EditCore Security Shield (v5.3.3)
 *
 * Módulo nativo de ciberseguridad proactiva permanente.
 * Protege contra:
 * 1. Fuga de credenciales, API keys y tokens en código fuente.
 * 2. Inclusión accidental de archivos sensibles (.env, .pem, .key, etc.) en Git.
 * 3. Ausencia de .gitignore seguro en proyectos nuevos y existentes.
 * 4. Exposición de secretos en ramas o repositorios públicos.
 */

const fs = require("node:fs");
const path = require("node:path");

const SHIELD_VERSION = "5.3.3";

// Patrones de secretos conocidos en código fuente
const SECRET_PATTERNS = [
  {
    id: "OPENAI_OR_AI_KEY",
    name: "AI Provider API Key (OpenAI, Anthropic, OpenRouter, Cohere, HuggingFace)",
    regex: /\b(?:sk-ant-api\d*-[A-Za-z0-9_\-]{20,}|sk-(?:live-|proj-)?[A-Za-z0-9_\-]{20,}|sk-or-v1-[A-Za-z0-9_\-]{20,}|hf_[A-Za-z0-9]{20,})\b/g,
  },
  {
    id: "GITHUB_TOKEN",
    name: "GitHub Personal Access Token / OAuth Token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{30,}\b/g,
  },
  {
    id: "AWS_ACCESS_KEY",
    name: "AWS Access Key ID",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    id: "GOOGLE_API_KEY",
    name: "Google Cloud / Firebase API Key",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    id: "STRIPE_KEY",
    name: "Stripe Secret / Restricted Key",
    regex: /\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,
  },
  {
    id: "SLACK_TOKEN",
    name: "Slack Bot / User Token",
    regex: /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/g,
  },
  {
    id: "JWT_TOKEN",
    name: "JSON Web Token (JWT)",
    regex: /\beyJ[A-Za-z0-9\-_=]{10,}\.eyJ[A-Za-z0-9\-_=]{10,}\.[A-Za-z0-9\-_.+\/=]{10,}\b/g,
  },
  {
    id: "DATABASE_PASSWORD_URI",
    name: "Database Connection String with Password",
    regex: /\b(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|mssql):\/\/[^\s:]+:([^\s@]{3,})@[^\s\/]+/gi,
  },
  {
    id: "PRIVATE_KEY_BLOCK",
    name: "Private Key Cryptographic Block",
    regex: /-----BEGIN\s+(?:RSA|OPENSSH|DSA|EC|PGP)?\s*PRIVATE\s+KEY-----/gi,
  },
  {
    id: "GENERIC_HARDCODED_KEY",
    name: "Hardcoded Credential or Password Assignment",
    regex: /(?:(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|jwt[_-]?secret|database[_-]?url)\s*[:=]\s*["'])([A-Za-z0-9_\-\.+=/]{16,})(?:["'])/gi,
  },
];

// Obtiene el nombre base del archivo de forma independiente del separador del OS
function getBaseName(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  const parts = norm.split("/");
  return parts[parts.length - 1] || "";
}

// Comprueba si un path es un archivo sensible que nunca debe commitearse
function isSensitiveFile(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  const base = getBaseName(norm);
  const lowerBase = base.toLowerCase();

  // Excepciones seguras: plantillas públicas
  if (
    lowerBase === ".env.example" ||
    lowerBase === ".env.sample" ||
    lowerBase === ".env.template" ||
    lowerBase === ".env.dist"
  ) {
    return false;
  }

  // Archivos .env
  if (lowerBase === ".env" || lowerBase.startsWith(".env.")) {
    return true;
  }

  // Certificados y claves criptográficas
  if (/\.(pem|key|p12|pfx|crt|cer|der)$/i.test(base)) {
    return true;
  }

  // Claves SSH
  if (/^id_(?:rsa|ed25519|ecdsa|dsa)(?:\.pub)?$/i.test(base)) {
    return true;
  }

  // Archivos de credenciales y secretos comunes
  if (
    lowerBase === "credentials.json" ||
    lowerBase === "secrets.json" ||
    lowerBase === "secret.json" ||
    lowerBase === "service-account.json" ||
    lowerBase === "serviceaccount.json" ||
    lowerBase === ".htpasswd" ||
    lowerBase === ".npmrc"
  ) {
    return true;
  }

  // Carpetas sensibles
  if (norm.includes(".editcore/vault/") || norm.includes(".ssh/") || norm.includes("/.ssh/")) {
    return true;
  }

  return false;
}

// Filtro rápido de placeholders o valores ficticios de prueba
function isPlaceholderOrTest(sample) {
  const s = String(sample || "").toLowerCase().trim();
  return (
    s === "password" ||
    s === "pass" ||
    s === "secret" ||
    s === "admin" ||
    s === "root" ||
    s.includes("your_") ||
    s.includes("your-") ||
    s.includes("tu_clave") ||
    s.includes("tu_token") ||
    s.includes("example") ||
    s.includes("placeholder") ||
    s.includes("dummy") ||
    s.includes("change_me") ||
    s.includes("changeme") ||
    s.includes("xxxx") ||
    s.includes("00000000") ||
    s.includes("my_secret") ||
    s.includes("insert_here") ||
    s.includes("<password>") ||
    s.includes("<ref>") ||
    s.includes("<region>") ||
    s.includes("<user>") ||
    s.includes("<token>") ||
    s.includes("<key>") ||
    s.includes("<dbname>")
  );
}

// Escanea el contenido de un archivo en busca de secretos
function scanContentForSecrets(content, filePath = "") {
  const text = String(content || "");
  if (!text || text.length < 10) {
    return { blocked: false, findings: [] };
  }

  const normPath = String(filePath || "").replace(/\\/g, "/");
  const baseName = getBaseName(normPath).toLowerCase();

  // Metadatos internos de EditCoreAI (índices, cola de revisión, snapshots): omitir
  if (normPath.includes("/.editcore/") || normPath.startsWith(".editcore/")) {
    return { blocked: false, findings: [] };
  }

  // Permitir templates .env.example
  if (
    baseName === ".env.example" ||
    baseName === ".env.sample" ||
    baseName === ".env.template" ||
    baseName === ".env.dist"
  ) {
    return { blocked: false, findings: [] };
  }

  // En archivos .env y .env.local, los secretos son esperados: no bloqueamos la escritura local
  // pero advertimos si se intenta commitear
  const isEnvFile = baseName === ".env" || baseName.startsWith(".env.");
  if (isEnvFile) {
    return { blocked: false, findings: [], isEnv: true };
  }

  // En archivos de tests unitarios, permitir mocks explícitos
  const isTestFile =
    normPath.includes("/test/") ||
    normPath.includes("/tests/") ||
    normPath.includes("__tests__") ||
    normPath.endsWith(".test.js") ||
    normPath.endsWith(".test.ts") ||
    normPath.endsWith(".spec.js") ||
    normPath.endsWith(".spec.ts");

  const lines = text.split(/\r?\n/);
  const findings = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (!line || line.trim().length < 8) continue;

    // Saltar comentarios que solo explican formato
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      if (isPlaceholderOrTest(trimmed)) continue;
    }

    for (const pat of SECRET_PATTERNS) {
      pat.regex.lastIndex = 0;
      let match;
      while ((match = pat.regex.exec(line)) !== null) {
        const fullMatch = match[0];
        const secretValue = match[1] || fullMatch;

        if (isPlaceholderOrTest(secretValue)) {
          continue;
        }

        // Si es archivo de test y tiene patrones mock conocidos, omitir
        if (isTestFile && (secretValue.includes("test") || secretValue.includes("mock") || secretValue.includes("dummy"))) {
          continue;
        }

        findings.push({
          line: idx + 1,
          patternId: pat.id,
          patternName: pat.name,
          preview: fullMatch.slice(0, 6) + "..." + fullMatch.slice(-4),
          snippet: line.trim().slice(0, 100),
        });
      }
    }
  }

  if (findings.length > 0) {
    shieldStats.blocksCount += 1;
    shieldStats.lastAlert = {
      at: new Date().toISOString(),
      file: filePath,
      finding: findings[0],
    };

    return {
      blocked: true,
      findings,
      message: `EditCore Security Shield bloqueó la escritura en '${filePath || "archivo"}': se detectó un secreto privado (${findings[0].patternName}) en la línea ${findings[0].line}. Por seguridad, almacena este secreto en .env.local y accede a él mediante variables de entorno (process.env.VARIABLE o import.meta.env.VARIABLE).`,
    };
  }

  return { blocked: false, findings: [] };
}

// Plantilla maestra de .gitignore seguro
function generateSafeGitignore() {
  return `# ==========================================
# EditCore Security Shield — Protecciones Automáticas
# ==========================================

# Variables de entorno y credenciales (NUNCA COMMITEAR)
.env
.env.local
.env.*.local
.env.development.local
.env.test.local
.env.production.local
*.pem
*.key
*.p12
*.pfx
*.crt
*.cer
*.der
id_rsa
id_ed25519
id_ecdsa
credentials.json
secrets.json
secret.json
service-account.json
serviceaccount.json
.htpasswd
.npmrc
.editcore/

# Plantilla pública permitida
!.env.example

# Dependencias
node_modules/
.pnp
.pnp.js

# Salidas de compilación
dist/
build/
out/
.next/
.nuxt/
.cache/

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
*.log

# Entornos del sistema y editores
.DS_Store
Thumbs.db
.vscode/
.idea/
`;
}

// Genera un archivo .env.example seguro a partir de un .env existente
function generateEnvExample(envContent = "") {
  const lines = String(envContent || "").split(/\r?\n/);
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      result.push(line);
      continue;
    }

    const key = line.slice(0, eqIdx).trim();
    const keyLower = key.toLowerCase();

    let placeholder = "your_" + key.toLowerCase() + "_here";
    if (keyLower.includes("url") || keyLower.includes("uri")) {
      placeholder = "https://your-domain.example.com";
    } else if (keyLower.includes("port")) {
      placeholder = "3000";
    } else if (keyLower.includes("database") || keyLower.includes("db")) {
      placeholder = "postgresql://user:password@localhost:5432/dbname";
    }

    result.push(`${key}=${placeholder}`);
  }

  return result.join("\n") + "\n";
}

// Estado en memoria del escudo
const shieldStats = {
  version: SHIELD_VERSION,
  active: true,
  blocksCount: 0,
  warningsCount: 0,
  lastScanAt: null,
  lastAlert: null,
};

function getShieldStatus() {
  return {
    ...shieldStats,
    active: true,
  };
}

// Escaneo integral de un proyecto
function scanProjectForSecurity(projectRoot) {
  const root = path.resolve(projectRoot);
  const issues = [];
  let scannedFiles = 0;
  let safeGitignorePresent = false;
  let exposedEnvFiles = [];

  if (!fs.existsSync(root)) {
    return { ok: false, error: "Carpeta de proyecto no encontrada" };
  }

  // 1. Verificar .gitignore
  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    try {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      if (gitignoreContent.includes(".env") && gitignoreContent.includes("*.key")) {
        safeGitignorePresent = true;
      } else if (gitignoreContent.includes(".env")) {
        safeGitignorePresent = true;
      } else {
        issues.push({
          type: "WARNING",
          file: ".gitignore",
          message: ".gitignore existe pero no bloquea archivos .env ni certificados",
        });
      }
    } catch {}
  } else {
    issues.push({
      type: "WARNING",
      file: ".gitignore",
      message: "El proyecto no tiene .gitignore; los archivos sensibles podrían subirse a Git",
    });
  }

  // 2. Escanear archivos en disco
  const excludeDirs = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", "coverage", "public", ".editcore", ".turbo", ".cache"]);
  const codeExts = new Set([".js", ".ts", ".jsx", ".tsx", ".py", ".json", ".html", ".vue", ".php", ".sh", ".yml", ".yaml"]);

  function walk(dir, depth = 0) {
    if (depth > 8 || scannedFiles >= 300) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) {
          walk(path.join(dir, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        scannedFiles += 1;
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath).replace(/\\/g, "/");

        // Detección de archivos sensibles
        if (isSensitiveFile(relPath)) {
          if (!safeGitignorePresent) {
            exposedEnvFiles.push(relPath);
            issues.push({
              type: "CRITICAL",
              file: relPath,
              message: `Archivo sensible '${relPath}' presente sin un .gitignore que lo proteja`,
            });
          }
        }

        // Detección de secretos en código
        const ext = path.extname(entry.name).toLowerCase();
        if (codeExts.has(ext) && entry.name !== "package-lock.json") {
          try {
            const content = fs.readFileSync(fullPath, "utf8");
            const res = scanContentForSecrets(content, relPath);
            if (res.blocked && res.findings.length > 0) {
              issues.push({
                type: "BLOCKED",
                file: relPath,
                message: res.message,
                findings: res.findings,
              });
            }
          } catch {}
        }
      }
    }
  }

  walk(root);

  shieldStats.lastScanAt = new Date().toISOString();
  if (issues.length > 0) {
    shieldStats.warningsCount += issues.filter((i) => i.type === "WARNING").length;
  }

  return {
    ok: true,
    projectRoot: root,
    scannedFiles,
    safeGitignorePresent,
    exposedEnvFiles,
    issues,
    hasCriticalIssues: issues.some((i) => i.type === "CRITICAL" || i.type === "BLOCKED"),
    shieldStatus: getShieldStatus(),
  };
}

module.exports = {
  SHIELD_VERSION,
  SECRET_PATTERNS,
  getBaseName,
  isSensitiveFile,
  isPlaceholderOrTest,
  scanContentForSecrets,
  generateSafeGitignore,
  generateEnvExample,
  getShieldStatus,
  scanProjectForSecurity,
};
