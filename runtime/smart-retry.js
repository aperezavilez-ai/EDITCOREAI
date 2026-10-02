"use strict";

/**
 * SmartRetry: Ejecuta múltiples estrategias hasta encontrar una que funcione
 *
 * Soluciona el error crítico: "list_files falló dos veces con la misma entrada"
 *
 * Características:
 * - Intenta estrategias en orden de preferencia
 * - No repite la misma estrategia dos veces
 * - Logging detallado de cada intento
 * - Timeout configurable por estrategia
 */
class SmartRetry {
  constructor(options = {}) {
    this.maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
    this.defaultTimeout = Math.max(1000, Number(options.timeout) || 5000);
    this.retryDelay = Math.max(0, Number(options.retryDelay) || 1000);
    this.logger = options.logger || console;
  }

  /**
   * Ejecuta estrategias hasta que una tenga éxito
   * @param {Array<Object>} strategies - Array de estrategias
   * @returns {*} Resultado de la primera estrategia exitosa
   */
  async executeWithFallback(strategies) {
    if (!Array.isArray(strategies) || strategies.length === 0) {
      throw new Error("SmartRetry requiere al menos una estrategia");
    }

    const errors = [];
    const startTime = Date.now();

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      if (!strategy || typeof strategy.execute !== "function") {
        this.logger.warn(`⚠ Estrategia ${i + 1} inválida, saltando...`);
        continue;
      }

      const strategyName = strategy.name || `estrategia-${i + 1}`;
      this.logger.log(`\n🔄 Intentando ${i + 1}/${strategies.length}: ${strategyName}`);

      try {
        // Ejecutar con timeout
        const result = await this._executeWithTimeout(
          strategy.execute,
          strategy.timeout || this.defaultTimeout
        );

        const elapsed = Date.now() - startTime;
        this.logger.log(`✓ ${strategyName} exitosa (${elapsed}ms total)`);

        return {
          success: true,
          result: result,
          strategy: strategyName,
          attemptNumber: i + 1,
          totalAttempts: strategies.length,
          elapsedMs: elapsed,
        };

      } catch (error) {
        const errorMsg = String(error?.message || error || "Error desconocido");
        this.logger.error(`✗ ${strategyName} falló: ${errorMsg}`);

        errors.push({
          strategy: strategyName,
          error: errorMsg,
          timestamp: Date.now(),
          attemptNumber: i + 1,
        });

        // Si no es la última estrategia, esperar antes de continuar
        if (i < strategies.length - 1) {
          this.logger.log(`  Esperando ${this.retryDelay}ms antes de siguiente estrategia...`);
          await this._sleep(this.retryDelay);
        }
      }
    }

    // Todas las estrategias fallaron
    const elapsed = Date.now() - startTime;
    const errorSummary = errors.map((e) => `  ${e.attemptNumber}. ${e.strategy}: ${e.error}`).join("\n");

    throw Object.assign(
      new Error(`Todas las estrategias fallaron después de ${errors.length} intentos (${elapsed}ms):\n${errorSummary}`),
      {
        code: "ALL_STRATEGIES_FAILED",
        errors: errors,
        totalAttempts: errors.length,
        elapsedMs: elapsed,
      }
    );
  }

  /**
   * Ejecuta función con timeout
   */
  async _executeWithTimeout(fn, timeout) {
    return Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout de ${timeout}ms excedido`)),
          timeout
        )
      ),
    ]);
  }

  /**
   * Sleep helper
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reintenta una función simple sin estrategias complejas
   * Útil para errores transitorios de red
   */
  async retrySimple(fn, options = {}) {
    const maxRetries = Math.max(1, Number(options.maxRetries) || this.maxAttempts);
    const delay = Math.max(0, Number(options.delay) || this.retryDelay);
    const timeout = Math.max(1000, Number(options.timeout) || this.defaultTimeout);

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._executeWithTimeout(fn, timeout);

        if (attempt > 1) {
          this.logger.log(`✓ Exitoso en intento ${attempt}/${maxRetries}`);
        }

        return result;

      } catch (error) {
        lastError = error;
        const errorMsg = String(error?.message || error || "Error desconocido");
        this.logger.warn(`✗ Intento ${attempt}/${maxRetries} falló: ${errorMsg}`);

        if (attempt < maxRetries) {
          this.logger.log(`  Reintentando en ${delay}ms...`);
          await this._sleep(delay);
        }
      }
    }

    throw Object.assign(
      new Error(`Falló después de ${maxRetries} reintentos: ${lastError?.message || lastError}`),
      { code: "MAX_RETRIES_EXCEEDED", attempts: maxRetries, lastError }
    );
  }
}

/**
 * Crea estrategias para operaciones comunes con fallbacks
 */
function createCommonStrategies(operation, params, options = {}) {
  const strategies = [];

  if (operation === "list_files") {
    const path = String(params?.path || "").replace(/\\/g, "/");

    // Estrategia 1: API nativa (más rápida)
    if (options.api) {
      strategies.push({
        name: "list_files API",
        timeout: 5000,
        execute: () => options.api.listFiles(path),
      });
    }

    // Estrategia 2: Glob pattern (más flexible)
    strategies.push({
      name: "glob pattern",
      timeout: 10000,
      execute: async () => {
        const fsp = require("fs").promises;
        const pathModule = require("path");
        if (typeof fsp.glob !== "function") throw new Error("fs.glob no disponible en esta versión de Node");
        const skip = new Set(["node_modules", ".git", "dist", "build"]);
        const pattern = path ? `${path}/**/*` : "**/*";
        const files = [];
        for await (const entry of fsp.glob(pattern, { withFileTypes: true, exclude: (d) => skip.has(d.name) })) {
          if (entry.isFile()) {
            files.push({ path: pathModule.join(entry.parentPath, entry.name).replace(/\\/g, "/"), name: entry.name, kind: "file" });
          }
        }
        if (files.length === 0) throw new Error("No se encontraron archivos");
        return files;
      },
    });

    // Estrategia 3: fs.readdir recursivo
    strategies.push({
      name: "fs.readdir recursivo",
      timeout: 15000,
      execute: async () => {
        const fs = require("fs").promises;
        const pathModule = require("path");
        const targetPath = path || process.cwd();

        async function walkDir(dir) {
          const files = [];
          try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
              const fullPath = pathModule.join(dir, entry.name);
              if (entry.isDirectory()) {
                // Evitar directorios comunes que causan problemas
                if (!["node_modules", ".git", "dist", "build"].includes(entry.name)) {
                  files.push(...await walkDir(fullPath));
                }
              } else {
                files.push({ path: fullPath.replace(/\\/g, "/"), name: entry.name, kind: "file" });
              }
            }
          } catch (error) {
            // Ignorar errores de permisos y continuar
          }

          return files;
        }

        const files = await walkDir(targetPath);
        if (files.length === 0) throw new Error("No se encontraron archivos");
        return files;
      },
    });
  }

  if (operation === "read_file") {
    const filepath = String(params?.path || "");

    // Estrategia 1: fs.readFile directo
    strategies.push({
      name: "fs.readFile",
      timeout: 5000,
      execute: async () => {
        const fs = require("fs").promises;
        return await fs.readFile(filepath, "utf-8");
      },
    });

    // Estrategia 2: Buscar archivo con nombre similar
    if (options.findSimilar) {
      strategies.push({
        name: "buscar archivo similar",
        timeout: 8000,
        execute: async () => {
          const fs = require("fs").promises;
          const path = require("path");

          const dir = path.dirname(filepath);
          const basename = path.basename(filepath, path.extname(filepath));
          const ext = path.extname(filepath);

          // Extensiones alternativas
          const alternativeExts = {
            ".tsx": [".ts", ".jsx", ".js"],
            ".ts": [".tsx", ".js"],
            ".jsx": [".js", ".tsx", ".ts"],
            ".js": [".ts", ".jsx", ".tsx"],
          };

          const extsToTry = alternativeExts[ext] || [];

          for (const altExt of extsToTry) {
            const altPath = path.join(dir, basename + altExt);
            try {
              const content = await fs.readFile(altPath, "utf-8");
              console.log(`✓ Archivo alternativo encontrado: ${altPath}`);
              return content;
            } catch {}
          }

          throw new Error("No se encontró archivo similar");
        },
      });
    }
  }

  return strategies;
}

module.exports = { SmartRetry, createCommonStrategies };
