/**
 * runtime/proactive-architect.js
 * EditCoreAI - Arquitecto Proactivo Autónomo y Pulso del Proyecto (Ciclo 34)
 */

const fs = require("fs");
const path = require("path");

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
  "constants", "crypto", "dgram", "diagnostics_channel", "dns", "domain",
  "events", "fs", "http", "http2", "https", "inspector", "module", "net",
  "os", "path", "perf_hooks", "process", "punycode", "querystring", "readline",
  "repl", "stream", "string_decoder", "timers", "tls", "trace_events", "tty",
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib", "node:test",
  "node:assert", "node:fs", "node:path", "node:os", "node:crypto", "node:child_process",
  "node:util", "node:url", "node:net", "node:http", "node:https"
]);

class ProactiveArchitect {
  constructor(options = {}) {
    this.options = options;
    this.pulseCache = new Map(); // projectRoot -> pulseData
  }

  /**
   * Ejecuta un escaneo completo no bloqueante de la carpeta/workspace
   */
  scanWorkspace(projectRoot) {
    if (!projectRoot || !fs.existsSync(projectRoot)) {
      return {
        projectRoot: projectRoot || "",
        healthScore: 100,
        findingsCount: 0,
        cards: [],
        scannedFilesCount: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const files = this._collectProjectFiles(projectRoot);
    const findings = {
      mocks: [],
      missingEnvVars: [],
      missingDeps: [],
      incompleteCode: [],
      missingConfigs: [],
    };

    // 1. Detectar variables de entorno declaradas y usadas
    const declaredEnvVars = this._collectDeclaredEnvVars(projectRoot);
    const referencedEnvVars = new Set();

    // 2. Detectar dependencias declaradas en package.json
    const declaredDeps = this._collectDeclaredDependencies(projectRoot);
    const referencedDeps = new Set();

    // 3. Inspeccionar cada archivo del proyecto
    for (const file of files) {
      const fullPath = path.join(projectRoot, file);
      let content = "";
      try {
        content = fs.readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      // 3.1 Mocks & Stubs
      const mockMatches = this._detectMocks(file, content);
      if (mockMatches.length > 0) {
        findings.mocks.push(...mockMatches);
      }

      // 3.2 Código Incompleto (TODO, FIXME, Not implemented, empty catch)
      const incompleteMatches = this._detectIncompleteCode(file, content);
      if (incompleteMatches.length > 0) {
        findings.incompleteCode.push(...incompleteMatches);
      }

      // 3.3 Uso de process.env
      const envMatches = content.matchAll(/process\.env\.([A-Z0-9_]+)/g);
      for (const m of envMatches) {
        referencedEnvVars.add(m[1]);
      }

      // 3.4 Uso de dependencias require / import
      const reqMatches = content.matchAll(/(?:require\(['"]|import\s+.*?from\s+['"])([@a-z0-9_\-\.\/]+)['"]/g);
      for (const m of reqMatches) {
        let pkgName = m[1];
        if (!pkgName.startsWith(".") && !pkgName.startsWith("/")) {
          if (pkgName.startsWith("@")) {
            pkgName = pkgName.split("/").slice(0, 2).join("/");
          } else {
            pkgName = pkgName.split("/")[0];
          }
          if (!NODE_BUILTINS.has(pkgName) && !pkgName.startsWith("node:")) {
            referencedDeps.add(pkgName);
          }
        }
      }
    }

    // 4. Comparar variables de entorno
    for (const envVar of referencedEnvVars) {
      if (!declaredEnvVars.has(envVar) && !process.env[envVar]) {
        findings.missingEnvVars.push({
          varName: envVar,
          description: `Variable ${envVar} usada en código pero no configurada en .env`,
        });
      }
    }

    // 5. Comparar dependencias
    if (declaredDeps.hasPackageJson) {
      for (const dep of referencedDeps) {
        if (!declaredDeps.dependencies.has(dep) && !declaredDeps.devDependencies.has(dep)) {
          findings.missingDeps.push({
            pkgName: dep,
            description: `Módulo '${dep}' importado pero no listado en package.json`,
          });
        }
      }
    }

    // 6. Validar configs esenciales
    if (!fs.existsSync(path.join(projectRoot, ".gitignore"))) {
      findings.missingConfigs.push({
        type: "gitignore",
        description: "El proyecto no cuenta con archivo .gitignore",
      });
    }

    // 7. Generar Action Cards
    const cards = this.generateActionCards(findings, projectRoot);

    // 8. Calcular Health Score (100 base)
    let penalties = 0;
    penalties += findings.missingEnvVars.length * 15;
    penalties += findings.missingDeps.length * 20;
    penalties += findings.mocks.length * 5;
    penalties += findings.incompleteCode.length * 2;
    penalties += findings.missingConfigs.length * 5;

    const healthScore = Math.max(10, Math.min(100, 100 - penalties));

    const pulseData = {
      projectRoot,
      healthScore,
      findingsCount:
        findings.mocks.length +
        findings.missingEnvVars.length +
        findings.missingDeps.length +
        findings.incompleteCode.length +
        findings.missingConfigs.length,
      findings,
      cards,
      scannedFilesCount: files.length,
      timestamp: new Date().toISOString(),
    };

    this.pulseCache.set(projectRoot, pulseData);
    return pulseData;
  }

  /**
   * Genera tarjetas de acción claras para el usuario
   */
  generateActionCards(findings, projectRoot = "") {
    const cards = [];

    // Tarjeta: Variables de Entorno Faltantes
    if (findings.missingEnvVars && findings.missingEnvVars.length > 0) {
      const varNames = findings.missingEnvVars.map((v) => v.varName).join(", ");
      cards.push({
        cardId: `card_env_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "🔑 Variables de Entorno Faltantes",
        description: `Se detectaron referencias a [${varNames}] sin declarar en el archivo .env.`,
        category: "env",
        priority: "high",
        suggestedAction: "Configurar archivo .env",
        actionPayload: {
          type: "create_env",
          vars: findings.missingEnvVars.map((v) => v.varName),
          prompt: `Crea o actualiza el archivo .env configurando las variables necesarias: ${varNames}`,
        },
        dismissed: false,
      });
    }

    // Tarjeta: Dependencias no registradas
    if (findings.missingDeps && findings.missingDeps.length > 0) {
      const depNames = findings.missingDeps.map((d) => d.pkgName).join(" ");
      cards.push({
        cardId: `card_deps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "📦 Dependencias sin registrar",
        description: `Los siguientes módulos están en uso pero faltan en package.json: ${depNames}.`,
        category: "deps",
        priority: "high",
        suggestedAction: "Instalar y registrar dependencias",
        actionPayload: {
          type: "install_deps",
          command: `npm install ${depNames}`,
          prompt: `Añade las dependencias faltantes al proyecto: ${depNames}`,
        },
        dismissed: false,
      });
    }

    // Tarjeta: Endpoints Simulados / Mocks
    if (findings.mocks && findings.mocks.length > 0) {
      const filesCount = new Set(findings.mocks.map((m) => m.file)).size;
      cards.push({
        cardId: `card_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "🔌 Endpoints / Servicios con Mocks Detectados",
        description: `Se encontraron ${findings.mocks.length} bloques simulados (mock/dummy) en ${filesCount} archivo(s).`,
        category: "mock",
        priority: "medium",
        suggestedAction: "Conectar servicios reales",
        actionPayload: {
          type: "replace_mocks",
          files: findings.mocks.map((m) => m.file),
          prompt: `Reemplaza los datos simulados y mocks en ${findings.mocks.map((m) => m.file).join(", ")} por implementaciones reales.`,
        },
        dismissed: false,
      });
    }

    // Tarjeta: Tareas pendientes / TODOs
    if (findings.incompleteCode && findings.incompleteCode.length > 0) {
      cards.push({
        cardId: `card_todo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "📝 Código Incompleto o TODOs Pendientes",
        description: `Hay ${findings.incompleteCode.length} comentarios TODO/FIXME o métodos sin implementar.`,
        category: "quality",
        priority: "low",
        suggestedAction: "Completar implementaciones",
        actionPayload: {
          type: "finish_todos",
          items: findings.incompleteCode,
          prompt: "Revisa y completa los TODOs e implementaciones pendientes del proyecto.",
        },
        dismissed: false,
      });
    }

    // Tarjeta: Configuración faltante (.gitignore)
    if (findings.missingConfigs && findings.missingConfigs.length > 0) {
      cards.push({
        cardId: `card_config_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "🛡️ Protección de Proyecto (.gitignore)",
        description: "El proyecto no tiene un archivo .gitignore configurado para excluir node_modules y credenciales.",
        category: "security",
        priority: "medium",
        suggestedAction: "Generar .gitignore recomendado",
        actionPayload: {
          type: "create_gitignore",
          prompt: "Crea un archivo .gitignore estándar para Node.js y entornos de desarrollo.",
        },
        dismissed: false,
      });
    }

    return cards;
  }

  /**
   * Obtiene el pulso del proyecto almacenado o ejecuta un escaneo rápido
   */
  getProjectPulse(projectRoot) {
    let pulse = this.pulseCache.get(projectRoot);
    if (!pulse) {
      pulse = this.scanWorkspace(projectRoot);
    }
    return pulse;
  }

  /**
   * Descarta una tarjeta de acción específica
   */
  dismissActionCard(projectRoot, cardId) {
    const pulse = this.pulseCache.get(projectRoot);
    if (!pulse || !Array.isArray(pulse.cards)) return false;

    const card = pulse.cards.find((c) => c.cardId === cardId);
    if (card) {
      card.dismissed = true;
      return true;
    }
    return false;
  }

  /**
   * Helper: Detección de Mocks
   */
  _detectMocks(file, content) {
    const results = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/mockData|mockResponse|dummyData|placeholder|simulated|fake[A-Z]/i.test(line)) {
        results.push({
          file,
          line: i + 1,
          snippet: line.trim(),
          type: "mock",
        });
      }
    }
    return results;
  }

  /**
   * Helper: Detección de código incompleto
   */
  _detectIncompleteCode(file, content) {
    const results = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/(?:\/\/|\/\*|\*)\s*(?:TODO|FIXME|HACK|XXX)\b/i.test(line)) {
        results.push({
          file,
          line: i + 1,
          snippet: line.trim(),
          type: "todo",
        });
      } else if (/throw new Error\(['"](?:Not implemented|TODO)['"]\)/i.test(line)) {
        results.push({
          file,
          line: i + 1,
          snippet: line.trim(),
          type: "unimplemented",
        });
      }
    }
    return results;
  }

  /**
   * Helper: Recolectar variables de entorno declaradas
   */
  _collectDeclaredEnvVars(projectRoot) {
    const envVars = new Set();
    const envFiles = [".env", ".env.local", ".env.example", ".env.development"];

    for (const ef of envFiles) {
      const fullPath = path.join(projectRoot, ef);
      if (fs.existsSync(fullPath)) {
        try {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const lines = raw.split(/\r?\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
              const key = trimmed.split("=")[0].trim();
              if (key) envVars.add(key);
            }
          }
        } catch {
          // Ignorar fallos de lectura
        }
      }
    }
    return envVars;
  }

  /**
   * Helper: Recolectar dependencias declaradas en package.json
   */
  _collectDeclaredDependencies(projectRoot) {
    const pkgPath = path.join(projectRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      return { hasPackageJson: false, dependencies: new Set(), devDependencies: new Set() };
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      return {
        hasPackageJson: true,
        dependencies: new Set(Object.keys(pkg.dependencies || {})),
        devDependencies: new Set(Object.keys(pkg.devDependencies || {})),
      };
    } catch {
      return { hasPackageJson: true, dependencies: new Set(), devDependencies: new Set() };
    }
  }

  /**
   * Helper: Recolectar archivos del proyecto excluyendo carpetas pesadas
   */
  _collectProjectFiles(dir, fileList = [], depth = 0) {
    if (depth > 6 || fileList.length > 500) return fileList;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (["node_modules", ".git", ".editcore", "dist", "build", "coverage"].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this._collectProjectFiles(fullPath, fileList, depth + 1);
        } else if (entry.isFile() && /\.(js|ts|json|py|html|css|env)$/i.test(entry.name)) {
          fileList.push(path.relative(dir, fullPath).replace(/\\/g, "/"));
        }
      }
    } catch {
      // Ignorar fallos
    }

    return fileList;
  }
}

const proactiveArchitectInstance = new ProactiveArchitect();

module.exports = {
  ProactiveArchitect,
  proactiveArchitect: proactiveArchitectInstance,
};
