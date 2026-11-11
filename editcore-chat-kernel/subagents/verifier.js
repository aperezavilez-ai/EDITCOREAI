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

function ensureNextTypesStub(projectRoot, opts = {}) {
  // [EDITCORE-INTEGRAL-B5] Escribir el stub ES una escritura: queda bajo
  // la misma autorización que cualquier write_file. Sin autorización
  // (allowWrite === false: solo lectura o paso a paso sin autorizar) el
  // verifier NO escribe nada y el llamador lo declara — antes el stub
  // se escribía en .next/types al margen de la compuerta, en un turno
  // que el usuario había puesto en «solo lee».
  if (opts && opts.allowWrite === false) return false;
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
  // [EDITCORE-INTEGRAL-B1] runCommand devuelve `output`, no `stdout`:
  // incluirlo o los timeouts/errores que salen por stdout se pierden.
  const blob = `${run?.error || ""} ${run?.stderr || ""} ${run?.stdout || ""} ${run?.output || ""}`;
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
  signal,
  priorError = null,
  solutionApplied = null,
  learn = true,
  incremental = true,
  // [EDITCORE-INTEGRAL-B5] Autorización del turno que invoca: la misma
  // que exige run_command. allowExecution === false → ningún script
  // del proyecto se ejecuta (ni el comando ligero ni los tests
  // forenses) y el stub de .next/types no se escribe; el resultado lo
  // DECLARA (executionOmitted / stubOmitted). Sin el flag (llamadores
  // históricos y la verificación post-escritura, que ya corre tras una
  // escritura autorizada) se conserva la conducta de siempre.
  allowExecution,
  allowWrite,
} = {}) {
  const executionAllowed = allowExecution !== false;
  const stubAllowed = allowWrite !== false && executionAllowed;
  const steps = [];
  if (signal?.aborted) {
    return { ok: false, aborted: true, result: { error: "Verificación cancelada por el usuario." }, steps };
  }
  onProgress?.({
    phase: "subagent",
    name: "verifier",
    text: "Comprobación ligera (sin next build en un cambio puntual).",
  });

  if (rel) {
    const file = tools.readFile(projectRoot, rel, 2000);
    steps.push({ name: "read_file", ok: file.ok, input: { path: rel } });
  }

  // [EDITCORE-INTEGRAL-B5] Sin autorización de ejecución el comando
  // ligero tampoco corre: se cae a la ruta forense ESTÁTICA (lectura),
  // que declara la omisión en su propio resultado.
  const cmd = executionAllowed
    ? (incremental
      ? pickLightCommand(projectRoot, command)
      : (command || pickLightCommand(projectRoot, "")))
    : null;

  if (!cmd) {
    onProgress?.({
      phase: "subagent",
      name: "verifier",
      text: executionAllowed
        ? "Sin typecheck: reviso sintaxis e imports y corro los tests del proyecto si existen."
        : "Sin autorización de ejecución: reviso sintaxis e imports (los chequeos con ejecución quedan omitidos y declarados).",
    });
    const checks = await forensic.runForensicChecks(projectRoot, {
      runTypecheck: false,
      runTests: true,
      // [EDITCORE-INTEGRAL-B5] La compuerta de ejecución llega también
      // a los tests que el verifier pedía por su cuenta.
      allowExecution: executionAllowed,
      executionOmittedReason: "modo sin autorización de ejecución",
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
      // [EDITCORE-INTEGRAL-B5] Declaración de la omisión por permisos.
      executionOmitted: checks.executionOmitted === true,
      result: {
        ok: checks.ok,
        note: testsRan ? "Sintaxis, imports y tests verificados." : "Sin tests ni typecheck: solo se verificó sintaxis e imports.",
        error: checks.ok ? undefined : firstErrors,
      },
    };
  }

  // [EDITCORE-INTEGRAL-B5] El stub solo se escribe con autorización de
  // escritura (stubAllowed); sin ella no se toca .next/types.
  let stubWritten = false;
  try { stubWritten = ensureNextTypesStub(projectRoot, { allowWrite: stubAllowed }); } catch { /* ignore */ }
  const stubOmitted = !stubAllowed && !stubWritten;

  // [EDITCORE-INTEGRAL-B6] La señal del turno LLEGA al comando: antes
  // runVerifier recibía `signal` y llamaba runCommand SIN ella, así
  // que tras Detener el typecheck seguía hasta su timeout. Ahora el
  // runner (process-runner, Bloque 4) mata el ÁRBOL al abortar.
  const run = await tools.runCommand(projectRoot, cmd, { timeoutMs, signal: signal || undefined });
  steps.push({ name: "run_command", ok: run.ok, input: { command: cmd } });
  if (signal?.aborted || run?.aborted) {
    return { role: "verifier", steps, ok: false, aborted: true, result: { ok: false, aborted: true, error: "Verificación detenida por el usuario (Detener): el proceso en curso fue terminado." } };
  }
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

  // [EDITCORE-INTEGRAL-B1] LA ⚠️ SIN CAUSA: runCommand (tools.js) devuelve
  // el texto del comando en `output`, NO en `stdout` — tsc escribe sus
  // errores por stdout, así que el blob quedaba vacío, result.error salía
  // en blanco y el bloque ⚠️ no mostraba causa ni el modelo recibía el
  // error para corregirlo. Se leen TODOS los campos que el runner trae.
  const detailBlob = `${run.stderr || ""}\n${run.stdout || ""}\n${run.output || ""}\n${run.error || ""}\n${priorError || ""}`;
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
    // [EDITCORE-INTEGRAL-B5] Si el stub no se escribió por permisos, se declara.
    stubOmitted,
    stubWritten,
    result: {
      ...run,
      // [EDITCORE-INTEGRAL-B1] Un blob de solo separadores NO es una causa:
      // si no hay texto real, se cae a run.error en vez de guardar blanco.
      error: run.ok ? undefined : (detailBlob.trim() ? detailBlob.trim().slice(0, 1200) : (run.error || undefined)),
      rolledBack: Boolean(rollback?.ok),
      snapshotId: rollback?.snapshotId || null,
    },
  };
}

module.exports = { runVerifier, ensureNextTypesStub, pickLightCommand };
