"use strict";

/**
 * Terminal Agent — Puente de ejecución segura y bucle de auto-corrección.
 *
 * Ciclo 15 — Fase 1 y Fase 2.
 * - Ejecuta comandos shell de forma controlada.
 * - Captura stdout, stderr y código de salida.
 * - Interpreta errores y propone/aplica parches correctivos con ayuda del núcleo IA + RAG.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_STDOUT_BYTES = 256 * 1024;

class TerminalAgent {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.defaultTimeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.allowedEnv = options.allowedEnv || {};
    this._aiCore = options.aiCore || null;
    this._ragBridge = options.ragBridge || null;
  }

  setAICore(aiCore) {
    this._aiCore = aiCore;
  }

  setRAGBridge(ragBridge) {
    this._ragBridge = ragBridge;
  }

  async runCommand(input = {}) {
    const command = String(input.command || "").trim();
    if (!command) {
      return { ok: false, error: "Falta 'command' para ejecutar en terminal." };
    }

    const cwd = input.cwd ? String(input.cwd) : this.projectRoot;
    const shell = input.shell === false ? false : true;
    const timeoutMs = Number(input.timeoutMs || this.defaultTimeoutMs);
    const env = { ...process.env, ...this.allowedEnv, ...(input.env || {}) };

    const result = await this._execute({
      command,
      cwd,
      shell,
      timeoutMs,
      env,
    });

    if (result.ok) {
      return result;
    }

    const enriched = await this._maybeSelfHeal({
      command,
      cwd,
      shell,
      timeoutMs,
      env,
      execution: result,
    });

    return enriched;
  }

  async _execute({ command, cwd, shell, timeoutMs, env }) {
    return new Promise((resolve) => {
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let exited = false;
      let timer = null;
      let killed = false;

      const child = spawn(command, {
        cwd,
        shell,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const finish = (exitCode, signal) => {
        if (exited) return;
        exited = true;
        if (timer) clearTimeout(timer);
        timer = null;

        const truncatedStderr = stderr.length > MAX_STDERR_BYTES
          ? stderr.slice(0, MAX_STDERR_BYTES).toString("utf8") + "\n...[stderr truncado]"
          : stderr.toString("utf8");

        const truncatedStdout = stdout.length > MAX_STDOUT_BYTES
          ? stdout.slice(0, MAX_STDOUT_BYTES).toString("utf8") + "\n...[stdout truncado]"
          : stdout.toString("utf8");

        const failed = Boolean(killed || Number(exitCode) !== 0);
        resolve({
          ok: !failed,
          command,
          cwd,
          exitCode: Number(exitCode) || 0,
          signal: String(signal || ""),
          stdout: truncatedStdout,
          stderr: truncatedStderr,
          timedOut: killed,
        });
      };

      if (child.stdout) {
        child.stdout.on("data", (chunk) => {
          if (stdout.length + chunk.length <= MAX_STDOUT_BYTES + 1024) {
            stdout = Buffer.concat([stdout, chunk]);
          }
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (chunk) => {
          if (stderr.length + chunk.length <= MAX_STDERR_BYTES + 1024) {
            stderr = Buffer.concat([stderr, chunk]);
          }
        });
      }

      child.on("error", (error) => {
        if (exited) return;
        exited = true;
        if (timer) clearTimeout(timer);
        timer = null;
        resolve({
          ok: false,
          command,
          cwd,
          error: String(error && error.message ? error.message : error),
          exitCode: null,
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          timedOut: false,
        });
      });

      child.on("close", (code, signal) => finish(code, signal));

      timer = setTimeout(() => {
        if (exited) return;
        killed = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore kill errors
        }
        setTimeout(() => {
          if (!exited) {
            try {
              child.kill("SIGKILL");
            } catch {
              // ignore
            }
          }
        }, 500);
      }, timeoutMs);
    });
  }

  async _maybeSelfHeal({ command, cwd, shell, timeoutMs, env, execution }) {
    const shouldHeal = this._isHealableFailure(execution);
    if (!shouldHeal) {
      return execution;
    }

    const diagnosis = await this._diagnoseFailure(execution);
    if (!diagnosis.ok) {
      return { ...execution, selfHealing: { attempted: true, failed: true, reason: diagnosis.error } };
    }

    const patch = diagnosis.patch || null;
    if (!patch) {
      return { ...execution, selfHealing: { attempted: true, failed: true, reason: "Sin parche propuesto" } };
    }

    const applied = await this._applyPatch(patch);
    if (!applied.ok) {
      return { ...execution, selfHealing: { attempted: true, failed: true, reason: applied.error } };
    }

    const rerun = await this._execute({ command, cwd, shell, timeoutMs, env });
    return {
      ...rerun,
      selfHealing: {
        attempted: true,
        applied: true,
        patch,
        originalExecution: execution,
      },
    };
  }

  _isHealableFailure(execution) {
    if (!execution.ok) return true;
    if (execution.timedOut) return false;
    if (Number(execution.exitCode) === 0) return false;
    const text = `${execution.stdout}\n${execution.stderr}`.toLowerCase();
    return /test|compile|build|error|failed|exception|traceback|segmentation fault|enoent|eacces|eperm|syntaxerror|referenceerror|typeerror/.test(text);
  }

  async _diagnoseFailure(execution) {
    if (!this._aiCore || !this._ragBridge) {
      return { ok: false, error: "Falta núcleo IA o RAG para auto-corrección." };
    }

    const context = await this._ragBridge.enrichPrompt(
      `Error de terminal en proyecto. Comando: ${execution.command}. Código: ${execution.exitCode}. stderr: ${execution.stderr.slice(0, 4000)}`,
      { topK: 4 }
    ).catch(() => ({ prompt: "", context: [] }));

    const prompt = [
      "Sos un agente de auto-corrección de EditCoreAI.",
      "Dado un fallo de terminal, devolvé SOLO un JSON compacto con:",
      "{ \"file\": \"ruta relativa\", \"patch\": \"diff unificado mínimo\", \"reason\": \"causa\" }",
      "Si no podés generar un parche seguro, devolvé { \"file\": null, \"patch\": null, \"reason\": \"...\" }.",
      "No inventes rutas fuera del proyecto.",
      "",
      `Comando: ${execution.command}`,
      `CWD: ${execution.cwd}`,
      `EXIT_CODE: ${execution.exitCode}`,
      `STDERR:\n${execution.stderr.slice(0, 4000)}`,
      "",
      "Contexto RAG:",
      (context.context || []).map((item) => `- ${item.path}: ${(item.text || "").slice(0, 500)}`).join("\n"),
    ].join("\n");

    const response = await this._aiCore.chat({
      messages: [
        { role: "system", content: "Devolvé solo JSON compacto, sin markdown, sin explicaciones." },
        { role: "user", content: prompt },
      ],
      maxTokens: 1200,
      temperature: 0.1,
    }).catch(() => null);

    const raw = response && typeof response === "object" ? response.content || response.text || "" : String(response || "");
    const parsed = this._safeParseDiagnosis(raw);
    if (!parsed) {
      return { ok: false, error: "No se pudo parsear la respuesta de diagnóstico." };
    }
    return { ok: true, patch: parsed.patch || null, file: parsed.file || null, reason: parsed.reason || "" };
  }

  _safeParseDiagnosis(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  async _applyPatch(patch) {
    const text = String(patch || "").trim();
    if (!text) {
      return { ok: false, error: "Parche vacío." };
    }

    const unifiedMatch = text.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    if (!unifiedMatch) {
      return { ok: false, error: "Parche no tiene formato diff unificado." };
    }

    const targetRel = unifiedMatch[1];
    const targetPath = path.resolve(this.projectRoot, targetRel);

    if (!targetPath.startsWith(this.projectRoot)) {
      return { ok: false, error: "Ruta objetivo fuera del proyecto." };
    }

    const dir = path.dirname(targetPath);
    fs.mkdirSync(dir, { recursive: true });

    const content = this._applyUnifiedDiffToText(
      fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : "",
      text
    );

    if (content === null) {
      return { ok: false, error: "No se pudo aplicar el diff unificado." };
    }

    fs.writeFileSync(targetPath, content, "utf8");
    return { ok: true, path: targetRel };
  }

  _applyUnifiedDiffToText(original, diffText) {
    const lines = String(diffText).split(/\r?\n/);
    const hunks = [];
    let current = null;

    for (const line of lines) {
      if (/^diff --git/.test(line)) continue;
      if (/^index /.test(line)) continue;
      if (/^--- /.test(line)) continue;
      if (/^\+\+\+ /.test(line)) continue;
      if (/^@@/.test(line)) {
        current = { header: line, lines: [] };
        hunks.push(current);
        continue;
      }
      if (current) current.lines.push(line);
    }

    let result = original;
    for (const hunk of hunks.reverse()) {
      const headerMatch = hunk.header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!headerMatch) return null;

      const oldStart = Number(headerMatch[1]);
      const oldCount = Number(headerMatch[2] || 1);
      const newStart = Number(headerMatch[3]);
      const newCount = Number(headerMatch[4] || 1);

      const oldLines = result.split(/\r?\n/);
      const oldEnd = oldStart - 1 + oldCount;

      if (oldStart < 1 || oldEnd > oldLines.length + 1) return null;

      const prefix = oldLines.slice(0, oldStart - 1);
      const suffix = oldLines.slice(oldEnd - 1);

      const newLines = [];
      for (const line of hunk.lines) {
        if (line.startsWith("+")) {
          newLines.push(line.slice(1));
        } else if (line.startsWith("-")) {
          // removido del original
        } else if (line.startsWith(" ")) {
          newLines.push(line.slice(1));
        } else if (line === "\\ No newline at end of file") {
          // ignorar marker
        } else {
          return null;
        }
      }

      result = [...prefix, ...newLines, ...suffix].join("\n");
    }

    return result;
  }
}

module.exports = { TerminalAgent };
