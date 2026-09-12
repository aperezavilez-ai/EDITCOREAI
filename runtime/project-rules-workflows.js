"use strict";

/**
 * Reglas por subcarpeta + workflows declarativos (.editcore/workflows).
 */

const fs = require("node:fs");
const path = require("node:path");

function rulesDir(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "rules");
}

function workflowsDir(projectRoot) {
  return path.join(String(projectRoot || ""), ".editcore", "workflows");
}

function parseFrontmatter(raw = "") {
  const text = String(raw || "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta = {};
  for (const line of String(m[1] || "").split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.+)$/);
    if (!kv) continue;
    meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: String(m[2] || "").trim() };
}

function loadScopedRules(projectRoot, targetPath = "") {
  const dir = rulesDir(projectRoot);
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const relTarget = String(targetPath || "").replace(/\\/g, "/");
  for (const name of fs.readdirSync(dir)) {
    if (!/\.(md|mdc|txt)$/i.test(name)) continue;
    let raw = "";
    try { raw = fs.readFileSync(path.join(dir, name), "utf8"); } catch { continue; }
    const { meta, body } = parseFrontmatter(raw);
    const scope = String(meta.path || meta.glob || meta.scope || "*").replace(/\\/g, "/");
    if (scope !== "*" && relTarget) {
      const pattern = scope.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
      if (!new RegExp(`^${pattern}$`, "i").test(relTarget)
        && !relTarget.startsWith(scope.replace(/\*.*$/, ""))) {
        continue;
      }
    }
    out.push({
      name: `.editcore/rules/${name}`,
      scope,
      content: body.slice(0, 4000),
    });
  }
  return out;
}

function listWorkflows(projectRoot) {
  const dir = workflowsDir(projectRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => /\.json$/i.test(n))
    .slice(0, 30)
    .map((name) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
        return {
          id: String(raw.id || name.replace(/\.json$/i, "")),
          name: String(raw.name || name),
          description: String(raw.description || ""),
          steps: Array.isArray(raw.steps) ? raw.steps : [],
          file: `.editcore/workflows/${name}`,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function ensureWorkflowScaffold(projectRoot) {
  const dir = workflowsDir(projectRoot);
  fs.mkdirSync(dir, { recursive: true });
  const sample = path.join(dir, "smoke-verify.json");
  if (!fs.existsSync(sample)) {
    fs.writeFileSync(sample, `${JSON.stringify({
      id: "smoke-verify",
      name: "Smoke verify",
      description: "Flujo minimo: leer archivo, correr node --test si aplica.",
      steps: [
        { type: "read_file", path: "package.json" },
        { type: "run_command", command: "node --version" },
      ],
    }, null, 2)}\n`, "utf8");
  }
  const rules = rulesDir(projectRoot);
  fs.mkdirSync(rules, { recursive: true });
  const sampleRule = path.join(rules, "src.md");
  if (!fs.existsSync(sampleRule)) {
    fs.writeFileSync(sampleRule, `---
path: src/**
---
Reglas para src/: preferir TypeScript estricto, no secretos en codigo, tests junto al cambio.
`, "utf8");
  }
  return { workflows: listWorkflows(projectRoot), rules: loadScopedRules(projectRoot) };
}

function formatScopedRulesForPrompt(projectRoot, targetPath = "") {
  const rules = loadScopedRules(projectRoot, targetPath);
  if (!rules.length) return "";
  return rules.map((r) => `REGLA ${r.name} [${r.scope}]:\n${r.content}`).join("\n\n");
}

function getWorkflow(projectRoot, workflowId = "") {
  const id = String(workflowId || "").trim();
  const all = listWorkflows(projectRoot);
  return all.find((w) => w.id === id || w.name === id) || null;
}

/**
 * Ejecuta un workflow declarativo (read_file / run_command).
 * runCommand(command) opcional para inyectar la terminal del agente.
 */
function runWorkflow(projectRoot, workflowId, { runCommand } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  ensureWorkflowScaffold(root);
  const wf = getWorkflow(root, workflowId);
  if (!wf) {
    return { ok: false, error: `Workflow no encontrado: ${workflowId}`, available: listWorkflows(root).map((w) => w.id) };
  }
  const results = [];
  for (const step of wf.steps || []) {
    const type = String(step.type || step.tool || "").toLowerCase();
    try {
      if (type === "read_file") {
        const rel = String(step.path || "").replace(/\\/g, "/");
        const abs = path.join(root, ...rel.split("/").filter(Boolean));
        const content = fs.readFileSync(abs, "utf8");
        results.push({
          type,
          path: rel,
          ok: true,
          bytes: Buffer.byteLength(content, "utf8"),
          preview: content.slice(0, 1200),
        });
      } else if (type === "run_command") {
        const command = String(step.command || "").trim();
        if (!command) throw new Error("run_command sin command");
        let out;
        if (typeof runCommand === "function") {
          out = runCommand(command);
        } else {
          const { spawnSync } = require("node:child_process");
          const spawned = spawnSync(command, {
            cwd: root,
            encoding: "utf8",
            shell: true,
            windowsHide: true,
            timeout: 120_000,
            maxBuffer: 1_000_000,
          });
          out = {
            ok: spawned.status === 0,
            code: spawned.status,
            stdout: String(spawned.stdout || "").slice(0, 4000),
            stderr: String(spawned.stderr || "").slice(0, 2000),
          };
        }
        const ok = out?.ok === true || Number(out?.code) === 0;
        results.push({
          type,
          command,
          ok,
          stdout: String(out?.stdout || "").slice(0, 4000),
          stderr: String(out?.stderr || "").slice(0, 2000),
        });
        if (!ok && step.continueOnError !== true) {
          return { ok: false, workflow: wf.id, stoppedAt: results.length, results };
        }
      } else {
        results.push({ type, ok: false, error: `Tipo de paso no soportado: ${type}` });
        if (step.continueOnError !== true) {
          return { ok: false, workflow: wf.id, stoppedAt: results.length, results };
        }
      }
    } catch (error) {
      results.push({ type, ok: false, error: String(error?.message || error) });
      if (step.continueOnError !== true) {
        return { ok: false, workflow: wf.id, stoppedAt: results.length, results };
      }
    }
  }
  return { ok: true, workflow: wf.id, results };
}

module.exports = {
  loadScopedRules,
  listWorkflows,
  ensureWorkflowScaffold,
  formatScopedRulesForPrompt,
  parseFrontmatter,
  getWorkflow,
  runWorkflow,
};
