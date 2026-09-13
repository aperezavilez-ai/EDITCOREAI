"use strict";

const path = require("node:path");

function commandFor(manager, script) {
  if (manager === "yarn") return `yarn ${script}`;
  if (manager === "bun") return script === "test" ? "bun test" : `bun run ${script}`;
  if (manager === "pnpm") return script === "test" ? "pnpm test" : `pnpm run ${script}`;
  return script === "test" ? "npm test" : `npm run ${script}`;
}

function changedKinds(files = []) {
  const extensions = new Set(files.map((file) => path.extname(String(file)).toLowerCase()));
  return {
    code: [...extensions].some((extension) => [".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"].includes(extension)),
    typescript: [...extensions].some((extension) => [".ts", ".tsx"].includes(extension)),
    config: files.some((file) => /(^|\/)(package\.json|tsconfig.*\.json|.*\.config\.[cm]?[jt]s)$/i.test(String(file).replace(/\\/g, "/"))),
    test: files.some((file) => /(^|\/)(test|tests|__tests__|spec)(\/|\.)|\.(test|spec)\.[jt]sx?$/i.test(String(file).replace(/\\/g, "/"))),
  };
}

class VerificationEngine {
  select(discovery = {}, changedFiles = [], input = {}) {
    const scripts = discovery.scripts || {};
    const manager = discovery.packageManager || "npm";
    const kinds = changedKinds(changedFiles);
    const commands = [];
    const add = (script, reason, priority) => {
      if (!script || commands.some((item) => item.script === script)) return;
      commands.push({ script, command: commandFor(manager, script), reason, priority, timeoutMs: 120_000 });
    };
    const first = (patterns) => Object.keys(scripts).find((name) => patterns.some((pattern) => pattern.test(name)));
    const testScript = first([/^test:unit$/i, /^test$/i, /^test:/i]);
    const typeScript = first([/^type-?check$/i, /^check$/i]);
    const lintScript = first([/^lint$/i, /^lint:/i]);
    const buildScript = first([/^build$/i, /^build:/i]);
    if (kinds.test && testScript) add(testScript, "El cambio toca pruebas; ejecutar su verificacion directa.", 1);
    if (kinds.typescript && typeScript) add(typeScript, "El cambio TypeScript requiere comprobar tipos.", 1);
    if (kinds.code && testScript) add(testScript, "El cambio de codigo requiere la prueba mas especifica disponible.", 2);
    if ((kinds.code || kinds.config) && lintScript) add(lintScript, "Comprobar reglas estaticas del proyecto.", 3);
    if ((kinds.config || input.risk === "high" || changedFiles.length > 4) && buildScript) add(buildScript, "El alcance requiere comprobar construccion.", 4);
    if (!commands.length && testScript) add(testScript, "Verificacion minima descubierta desde package.json.", 2);
    if (!commands.length && buildScript) add(buildScript, "No hay pruebas; comprobar construccion disponible.", 3);
    return {
      required: changedFiles.length > 0 || input.force === true,
      changedFiles: [...new Set(changedFiles.map(String))],
      commands: commands.sort((a, b) => a.priority - b.priority),
      level: changedFiles.length > 4 || kinds.config ? "broad" : "targeted",
      source: "discovered-project-scripts",
    };
  }

  evaluate(results = [], { required = true } = {}) {
    const normalized = results.map((result) => ({ command: String(result.command || ""), ok: result.ok === true, exitCode: Number.isFinite(Number(result.exitCode)) ? Number(result.exitCode) : result.ok === true ? 0 : 1, diagnostics: result.diagnostics || [] }));
    const attempted = normalized.length > 0;
    const passed = attempted && normalized.every((result) => result.ok);
    return { required, attempted, passed: required ? passed : !normalized.some((result) => !result.ok), status: !required ? "not_required" : !attempted ? "pending" : passed ? "passed" : "failed", results: normalized };
  }
}

module.exports = { VerificationEngine, changedKinds, commandFor };
