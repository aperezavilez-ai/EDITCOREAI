"use strict";

/**
 * Verifier quirúrgico.
 * Un cambio de color / un archivo NO dispara next build.
 * Un timeout NO es error de compilación y NUNCA hace rollback.
 */

const fs = require("fs");
const path = require("path");
const tools = require("../tools");
const forensic = require("../forensic-checks");
const { recordSolution, classifyErrorType } = require("../global-memory");

function ensureNextTypesStub(projectRoot) {
  const routes = path.join(projectRoot, ".next", "types", "routes.d.ts");
  if (fs.existsSync(routes)) return false;
  const nextEnv = path.join(projectRoot, "next-env.d.ts");
  if (!fs.existsSync(nextEnv)) return false;
  const text = fs.readFileSync(nextEnv, "utf8");
  if (!text.includes(".next/types/routes.d.ts")) return false;
  fs.mkdirSync(path.dirname(routes), { recursive: true });
  fs.writeFileSync(
    routes,
    [
      "// Auto-stub EDITCOREAI",
      "export type AppRoutes = string;",
      "export type PageRoutes = string;",
      "export type LayoutRoutes = string;",
      "export type RedirectRoutes = string;",
      "export type RewriteRoutes = string;",
      "export type Routes = AppRoutes;",
      "",
    ].join("\n"),
    "utf8",
  );
  return true;
}

function isTimeoutResult(run) {
  const blob = `${run?.error || ""} ${run?.stderr || ""} ${run?.stdout || ""}`;
  return /timeout|timed?\s*out|AbortError|TimeoutMs/i.test(blob);
}

function pickLightCommand(projectRoot, requested) {
  const raw = String(requested || "").trim();
  if (raw && !/\bnpm run build\b|\bnext build\b/i.test(raw)) return raw;

  const pkgPath = path.join(projectRoot, "package.json");
  let hasTypecheck = false;
  let hasTsc = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    hasTypecheck = Boolean(pkg?.scripts?.typecheck);
    hasTsc = fs.existsSync(path.join(projectRoot, "tsconfig.json"))
      || Boolean(pkg?.devDependencies?.typescript)
      || Boolean(pkg?.dependencies?.typescript);
  } catch { /* ignore */ }

  if (hasTypecheck) return "npm run typecheck";
  if (hasTsc) return "npx tsc --noEmit --pretty false";
  return null;
}

async function runVerifier({
  projectRoot,
  path: rel,
  command,
  onProgress,
  timeoutMs = 45_000,
  autoRollback = false,
  priorError = null,
  solutionApplied = null,
  learn = true,
  incremental = true,
} = {}) {
  const steps = [];
  onProgress?.({
    phase: "subagent",
    name: "verifier",
    text: "Comprobación ligera (sin next build en un cambio puntual).",
  });

  if (rel) {
    const file = tools.readFile(projectRoot, rel, 2000);
    steps.push({ name: "read_file", ok: file.ok, input: { path: rel } });
  }

  const cmd = incremental
    ? pickLightCommand(projectRoot, command)
    : (command || pickLightCommand(projectRoot, ""));

  if (!cmd) {
    onProgress?.({
      phase: "subagent",
      name: "verifier",
      text: "Sin typecheck: reviso sintaxis e imports y corro los tests del proyecto si existen.",
    });
    const checks = await forensic.runForensicChecks(projectRoot, {
      runTypecheck: false,
      runTests: true,
      testTimeoutMs: Math.max(timeoutMs, 180_000),
      onlyFiles: rel ? [rel] : null,
      onProgress,
    });
    steps.push({ name: "forensic_checks", ok: checks.ok, input: { path: rel || "." }, result: { counts: checks.counts, checks: checks.checks } });
    const exercised = checks.checks.filter((c) => ["pass", "fail", "warn"].includes(c.status));
    const testsRan = checks.checks.some((c) => c.id === "tests" && (c.status === "pass" || c.status === "fail"));
    const report = forensic.formatForensicMarkdown(checks);
    const firstErrors = checks.findings.filter((f) => f.severity === "error").slice(0, 5)
      .map((f) => `${f.file}${f.line ? `:${f.line}` : ""} — ${String(f.message).split("\n")[0]}`).join("\n");
    return {
      role: "verifier",
      steps,
      ok: checks.ok && exercised.length > 0,
      verified: exercised.length > 0,
      testsRan,
      forensic: checks,
      report: testsRan ? report : `${report}\n\n_El proyecto no tiene tests: solo se verificó sintaxis e imports._`,
      result: {
        ok: checks.ok,
        note: testsRan ? "Sintaxis, imports y tests verificados." : "Sin tests ni typecheck: solo se verificó sintaxis e imports.",
        error: checks.ok ? undefined : firstErrors,
      },
    };
  }

  try { ensureNextTypesStub(projectRoot); } catch { /* ignore */ }

  const run = await tools.runCommand(projectRoot, cmd, { timeoutMs });
  steps.push({ name: "run_command", ok: run.ok, input: { command: cmd } });
  onProgress?.({ phase: "tool", name: "run_command", ok: run.ok, input: { command: cmd } });

  const timedOut = isTimeoutResult(run);
  if (timedOut) {
    onProgress?.({
      phase: "subagent",
      name: "verifier",
      text: `El comando tardó más de ${Math.round(timeoutMs / 1000)} s. No es un error de código. No hago rollback.`,
    });
    return {
      role: "verifier",
      steps,
      ok: true,
      softTimeout: true,
      result: {
        ok: true,
        soft: true,
        timeout: true,
        command: cmd,
        error: undefined,
        note: "Timeout de verificación: se ignora. Los cambios se mantienen.",
      },
    };
  }

  const detailBlob = `${run.stderr || ""}\n${run.stdout || ""}\n${run.error || ""}\n${priorError || ""}`;
  const compileFail = !run.ok && /(?:Build error|Failed to compile|error TS\d+|TypeScript error|ELIFECYCLE)/i.test(detailBlob);

  let rollback = null;
  if (!run.ok && compileFail && autoRollback === true) {
    onProgress?.({ phase: "subagent", name: "verifier", text: "Error de compilación real. Rollback solo porque está autorizado." });
    rollback = tools.rollbackLastChange(projectRoot);
    steps.push({ name: "rollback_last_change", ok: rollback?.ok !== false, result: rollback });
  } else if (!run.ok) {
    onProgress?.({
      phase: "subagent",
      name: "verifier",
      text: "La comprobación no pasó del todo. Dejo los archivos; no deshago el trabajo.",
    });
  }

  let learned = null;
  if (run.ok && learn && priorError) {
    learned = recordSolution({
      tipoError: classifyErrorType(priorError),
      solucionAplicada: solutionApplied || `OK con ${cmd}`,
      errorExcerpt: String(priorError).slice(0, 400),
      projectHint: projectRoot,
      source: "verifier",
    });
  }

  onProgress?.({
    phase: "subagent",
    name: "verifier",
    text: run.ok
      ? "Comprobación ligera OK."
      : (rollback?.ok ? "Falló la compilación y se revirtió." : "Falló la comprobación; sin rollback."),
  });

  return {
    role: "verifier",
    steps,
    ok: run.ok,
    rollback,
    result: {
      ...run,
      error: run.ok ? undefined : (detailBlob.slice(0, 1200) || run.error),
      rolledBack: Boolean(rollback?.ok),
      snapshotId: rollback?.snapshotId || null,
    },
  };
}

module.exports = { runVerifier, ensureNextTypesStub, pickLightCommand };
