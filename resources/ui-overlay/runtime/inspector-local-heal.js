"use strict";

/**
 * Autorreparación local del Inspector (sin Gateway).
 * Usa process-runner + snapshot + global-memory del kernel.
 *
 * Especial: ENOENT en `.next/server/` → snapshot → borrar `.next` → `npx next build`
 * sin reintentar lecturas del archivo inexistente.
 */

const fs = require("fs");
const path = require("path");
const { runProcess } = require("../editcore-chat-kernel/process-runner");
const { createSnapshot } = require("../editcore-chat-kernel/snapshot");
const { recordSolution, promptBlock } = require("../editcore-chat-kernel/global-memory");
const { capture_preview_screenshot } = require("../editcore-chat-kernel/vision-inspector");

const NEXT_SERVER_ENOENT_RE = new RegExp(
  String.raw`ENOENT[\s\S]{0,180}?[\\/]\.next[\\/](?:server|cache)[\\/]`
  + String.raw`|Cannot find module[\s\S]{0,160}?[\\/]\.next[\\/]server[\\/]`
  + String.raw`|Cannot find module ['"]./\d+\.js['"]`
  + String.raw`|routes-manifest\.json|build-manifest\.json|webpack-runtime\.js`,
  "i",
);
const ROUTES_MANIFEST_ENOENT_RE = /ENOENT[\s\S]{0,120}?routes-manifest\.json|Cannot find module[\s\S]{0,80}?routes-manifest\.json/i;

function rmrf(target) {
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function isNextServerEnoentError(text = "") {
  const value = String(text || "");
  if (!value.trim()) return false;
  return NEXT_SERVER_ENOENT_RE.test(value) || ROUTES_MANIFEST_ENOENT_RE.test(value);
}

function detectNextCacheCorruption(projectRoot, { errorText = "" } = {}) {
  const root = path.resolve(projectRoot || "");
  const nextDir = path.join(root, ".next");
  const issues = [];
  if (!fs.existsSync(path.join(root, "package.json"))) {
    return { isNext: false, issues };
  }
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")); } catch { /* ignore */ }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const isNext = Boolean(deps.next) || fs.existsSync(path.join(root, "next.config.js"))
    || fs.existsSync(path.join(root, "next.config.mjs"))
    || fs.existsSync(path.join(root, "next.config.ts"));
  if (!isNext) return { isNext: false, issues };

  const routesManifest = path.join(nextDir, "routes-manifest.json");
  const serverApp = path.join(nextDir, "server", "app");

  if (isNextServerEnoentError(errorText)) {
    issues.push({
      code: "ENOENT_NEXT_SERVER",
      summary: "ENOENT: .next/server",
      detail: String(errorText).slice(0, 500),
      autoHeal: true,
      skipRetryRead: true,
    });
  }

  if (fs.existsSync(nextDir) && !fs.existsSync(routesManifest)) {
    issues.push({
      code: "ENOENT_ROUTES_MANIFEST",
      summary: "ENOENT: routes-manifest.json",
      detail: "Caché .next incompleta o corrupta (falta routes-manifest.json).",
      autoHeal: true,
      skipRetryRead: true,
    });
  }

  if (fs.existsSync(nextDir) && !fs.existsSync(serverApp)) {
    issues.push({
      code: "ENOENT_NEXT_SERVER_APP",
      summary: "ENOENT: .next/server/app",
      detail: "Falta el árbol App Router en .next/server/app (caché incompleta).",
      autoHeal: true,
      skipRetryRead: true,
    });
  }

  // Pack temporales de webpack rotos
  const webpackCache = path.join(nextDir, "cache", "webpack");
  if (fs.existsSync(webpackCache)) {
    try {
      const walk = (dir, depth = 0) => {
        if (depth > 4) return;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full, depth + 1);
          else if (/\.pack_$/i.test(ent.name)) {
            issues.push({
              code: "WEBPACK_PACK_TEMP",
              summary: "Webpack pack temporal huérfano",
              detail: full,
            });
          }
        }
      };
      walk(webpackCache);
    } catch { /* ignore */ }
  }

  return { isNext: true, issues, nextDir, routesManifest, serverApp };
}

/**
 * Si detecta corrupción típica de Next / ENOENT en .next/server, limpia .next y regenera rutas.
 */
async function autoHealNextProject(projectRoot, {
  onProgress,
  rebuild = true,
  force = false,
  errorText = "",
  command = "npx next build",
} = {}) {
  const root = path.resolve(projectRoot || "");
  const detection = detectNextCacheCorruption(root, { errorText });
  const learned = promptBlock("routes-manifest ENOENT next build .next/server", 4);

  if (!detection.isNext) {
    return {
      ok: true,
      skipped: true,
      reason: "no-next",
      uiMessage: "",
      kernel: { processRunner: true, snapshot: true, globalMemory: true, vision: false },
      learnedPrompt: learned || "",
    };
  }

  const shouldHeal = force
    || detection.issues.some((issue) => issue.autoHeal || /ENOENT/i.test(issue.code || ""))
    || isNextServerEnoentError(errorText);

  if (!shouldHeal && !detection.issues.length) {
    return {
      ok: true,
      skipped: true,
      reason: "healthy",
      uiMessage: "",
      kernel: { processRunner: true, snapshot: true, globalMemory: true, vision: false },
      learnedPrompt: learned || "",
      issues: [],
    };
  }

  if (!shouldHeal) {
    return {
      ok: true,
      skipped: true,
      reason: "no-autoheal-issue",
      uiMessage: "",
      kernel: { processRunner: true, snapshot: true, globalMemory: true, vision: false },
      learnedPrompt: learned || "",
      issues: detection.issues,
    };
  }

  onProgress?.({
    percent: 8,
    label: "Inspector local: snapshot previo a autorreparación…",
    state: "running",
    uiMessage: "Regenerando caché de Next.js…",
  });
  const snap = createSnapshot(root, ["package.json", "next.config.ts", "next.config.js", "next.config.mjs"].filter((rel) =>
    fs.existsSync(path.join(root, rel))), "inspector-local-heal-enoent");

  onProgress?.({
    percent: 16,
    label: "Limpiando caché .next (ENOENT / server)…",
    state: "running",
  });
  // No reintentar leer el archivo inexistente: borrar .next de forma silenciosa.
  const wiped = rmrf(detection.nextDir);

  let build = null;
  if (rebuild) {
    onProgress?.({
      percent: 28,
      label: "Regenerando App Router (npx next build)…",
      state: "running",
    });
    const buildCmd = String(command || "").trim() || "npx next build";
    build = await runProcess({
      cwd: root,
      command: buildCmd,
      timeoutMs: 240_000,
    });
    // Fallback si no hay next en PATH vía npx fallido
    if (!build?.ok && buildCmd !== "npm run build") {
      build = await runProcess({
        cwd: root,
        command: "npm run build",
        timeoutMs: 240_000,
      });
    }
  }

  const routesOk = fs.existsSync(path.join(root, ".next", "routes-manifest.json"));
  const serverOk = fs.existsSync(path.join(root, ".next", "server", "app"));
  const healed = Boolean(wiped || force) && (!rebuild || (build?.ok && routesOk));
  const uiMessage = healed
    ? "Caché de Next.js regenerada exitosamente"
    : "Autorreparación de .next incompleta (revisa el build)";

  if (healed) {
    recordSolution({
      tipoError: "compile",
      solucionAplicada: "Snapshot + borrar .next + npx next build (ENOENT .next/server / routes-manifest)",
      errorExcerpt: errorText || detection.issues.map((i) => i.summary).join("; "),
      projectHint: root,
      source: "inspector-local-heal",
    });
  }

  onProgress?.({
    percent: healed ? 42 : 40,
    label: uiMessage,
    state: healed ? "running" : "warn",
    uiMessage,
  });

  return {
    ok: healed,
    skipped: false,
    wipedNext: wiped,
    snapshotId: snap?.id || null,
    issues: detection.issues.length
      ? detection.issues
      : [{ code: "ENOENT_NEXT_SERVER", summary: "ENOENT forzado", detail: String(errorText || "").slice(0, 300) }],
    build: build ? {
      ok: build.ok,
      timedOut: build.timedOut,
      error: build.error,
      stderr: String(build.stderr || "").slice(-800),
      stdout: String(build.stdout || "").slice(-400),
    } : null,
    verified: { routesManifest: routesOk, serverApp: serverOk },
    uiMessage,
    kernel: {
      processRunner: true,
      snapshot: Boolean(snap?.ok),
      globalMemory: true,
      vision: false,
    },
    learnedPrompt: learned || "",
  };
}

async function localVisionProbe(projectRoot, previewUrl) {
  try {
    return await capture_preview_screenshot({
      url: previewUrl || "http://127.0.0.1:4568/",
      projectRoot,
      viewport: "desktop",
    });
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 300) };
  }
}

module.exports = {
  detectNextCacheCorruption,
  autoHealNextProject,
  localVisionProbe,
  isNextServerEnoentError,
  NEXT_SERVER_ENOENT_RE,
};
