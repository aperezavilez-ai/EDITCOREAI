"use strict";

const fs = require("fs");
const path = require("path");
const tools = require("../tools");
const { recordSolution, classifyErrorType } = require("../global-memory");

const DEFAULT_CHECKS = [
  "npx tsc --noEmit --pretty false",
  "npm run build",
];

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
      "// Auto-stub EDITCOREAI (generado para que tsc no falle antes del primer next build)",
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

function summarizeSolution(steps, solutionApplied, cmd) {
  if (solutionApplied) return String(solutionApplied).slice(0, 1200);
  const writes = (steps || [])
    .filter((s) => s?.name === "rollback_last_change" && s?.ok)
    .map((s) => `rollback snapshot ${s?.result?.snapshotId || ""}`.trim());
  if (writes.length) return writes.join("; ");
  return `Verificación OK con comando: ${cmd}`;
}

async function runVerifier({
  projectRoot,
  path: rel,
  command,
  onProgress,
  timeoutMs = 20000,
  autoRollback = false,
  priorError = null,
  solutionApplied = null,
  learn = true,
} = {}) {
  const steps = [];
  onProgress?.({ phase: "subagent", name: "verifier", text: "Validando..." });

  if (rel) {
    const file = tools.readFile(projectRoot, rel, 2000);
    steps.push({ name: "read_file", ok: file.ok, input: { path: rel } });
  }

  let cmd = command;
  if (!cmd) {
    const pkgPath = path.join(projectRoot, "package.json");
    let hasTsc = false;
    let hasBuild = false;
    let hasTypecheck = false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      hasBuild = Boolean(pkg?.scripts?.build);
      hasTypecheck = Boolean(pkg?.scripts?.typecheck);
      hasTsc = fs.existsSync(path.join(projectRoot, "tsconfig.json"))
        || Boolean(pkg?.devDependencies?.typescript)
        || Boolean(pkg?.dependencies?.typescript);
    } catch { /* ignore */ }
    if (hasTypecheck) cmd = "npm run typecheck";
    else if (hasTsc) cmd = DEFAULT_CHECKS[0];
    else if (hasBuild) cmd = DEFAULT_CHECKS[1];
    else cmd = null;
  }

  if (!cmd) {
    return { role: "verifier", steps, ok: true, result: { ok: true, note: "Sin typecheck/build disponible" } };
  }

  let stubbed = false;
  try { stubbed = ensureNextTypesStub(projectRoot) === true; } catch { /* ignore */ }

  const run = await tools.runCommand(projectRoot, cmd, { timeoutMs });
  steps.push({ name: "run_command", ok: run.ok, input: { command: cmd } });
  onProgress?.({ phase: "tool", name: "run_command", ok: run.ok, input: { command: cmd } });

  let rollback = null;
  let localHeal = null;
  const detailBlob = `${run.stderr || ""}\n${run.stdout || ""}\n${run.error || ""}\n${priorError || ""}`;
  const fatal = !run.ok && /(?:Build error|Failed to compile|ENOENT|TypeScript error|error TS\d+|ELIFECYCLE)/i.test(detailBlob);
  const nextServerEnoent = /ENOENT[\s\S]{0,180}?[\\/]\.next[\\/]server[\\/]|Cannot find module[\s\S]{0,120}?[\\/]\.next[\\/]server[\\/]|routes-manifest\.json/i.test(detailBlob)
    || /ENOENT[\s\S]{0,180}?[\\/]\.next[\\/]server[\\/]|Cannot find module[\s\S]{0,120}?[\\/]\.next[\\/]server[\\/]|routes-manifest\.json/i.test(String(priorError || ""));

  // ENOENT en .next/server: no insistir en leer el archivo — autorreparación local.
  if (nextServerEnoent) {
    onProgress?.({
      phase: "subagent",
      name: "auto-heal",
      text: "ENOENT .next/server detectado · regenerando caché…",
    });
    try {
      const { autoHealNextProject } = require("../../runtime/inspector-local-heal");
      localHeal = await autoHealNextProject(projectRoot, {
        rebuild: true,
        force: true,
        errorText: detailBlob,
        command: "npx next build",
        onProgress: (p) => onProgress?.({
          phase: "subagent",
          name: "auto-heal",
          text: p?.uiMessage || p?.label || "Regenerando .next…",
        }),
      });
      steps.push({
        name: "auto_heal_next_cache",
        ok: localHeal?.ok === true,
        result: {
          snapshotId: localHeal?.snapshotId || null,
          uiMessage: localHeal?.uiMessage || "",
        },
      });
      if (localHeal?.ok) {
        onProgress?.({
          phase: "subagent",
          name: "verifier",
          text: localHeal.uiMessage || "Caché de Next.js regenerada exitosamente",
        });
        return {
          role: "verifier",
          steps,
          ok: true,
          rollback: null,
          localHeal,
          learned: null,
          result: {
            ok: true,
            healed: true,
            uiMessage: localHeal.uiMessage || "Caché de Next.js regenerada exitosamente",
            snapshotId: localHeal.snapshotId || null,
          },
        };
      }
    } catch (error) {
      steps.push({
        name: "auto_heal_next_cache",
        ok: false,
        error: String(error?.message || error).slice(0, 300),
      });
    }
  }

  if (!run.ok && !localHeal?.ok && (autoRollback || fatal)) {
    onProgress?.({ phase: "subagent", name: "verifier", text: "Fallo grave: intentando rollback..." });
    rollback = tools.rollbackLastChange(projectRoot);
    steps.push({ name: "rollback_last_change", ok: rollback?.ok !== false, result: rollback });
    onProgress?.({
      phase: "tool",
      name: "rollback_last_change",
      ok: rollback?.ok !== false,
      result: rollback,
    });
  }

  let learned = null;
  if (run.ok && learn) {
    const excerpt = priorError
      || (stubbed ? "Missing .next/types/routes.d.ts referenced by next-env.d.ts" : null);
    if (excerpt || stubbed) {
      const tipoError = classifyErrorType(excerpt || "config-types");
      const solucionAplicada = stubbed && !priorError
        ? "Crear stub .next/types/routes.d.ts para desbloquear tsc antes del primer next build"
        : summarizeSolution(steps, solutionApplied, cmd);
      learned = recordSolution({
        tipoError: stubbed && !priorError ? "config-types" : tipoError,
        solucionAplicada,
        errorExcerpt: excerpt || undefined,
        projectHint: projectRoot,
        source: "verifier",
      });
      if (learned?.ok) {
        onProgress?.({
          phase: "subagent",
          name: "global-memory",
          text: `Aprendido: [${learned.tipoError}]`,
        });
      }
    }
  }

  onProgress?.({
    phase: "subagent",
    name: "verifier",
    text: run.ok
      ? (learned?.ok ? "Verificación OK · memoria global actualizada" : "Verificación OK")
      : (rollback?.ok ? "Verificación falló · rollback aplicado" : "Verificación con errores"),
  });

  const detail = [run.stderr, run.stdout, run.error].filter(Boolean).join("\n").slice(0, 1200);
  return {
    role: "verifier",
    steps,
    ok: run.ok,
    rollback,
    localHeal,
    learned,
    result: {
      ...run,
      error: run.ok ? undefined : (detail || run.error || "falló la verificación"),
      rolledBack: Boolean(rollback?.ok),
      snapshotId: rollback?.snapshotId || localHeal?.snapshotId || null,
      uiMessage: localHeal?.uiMessage || null,
      learned: learned?.ok ? { tipoError: learned.tipoError } : null,
    },
  };
}

module.exports = { runVerifier, ensureNextTypesStub };
