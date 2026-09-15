"use strict";

(function exposeProjectFilesUi(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreProjectFilesUi = api;
})(typeof window !== "undefined" ? window : globalThis, function createProjectFilesUi() {
  function normalizeSlashes(value = "") {
    return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
  }

  function resolveWrittenFileViewDir(projectRoot = "", writtenPath = "") {
    const root = normalizeSlashes(projectRoot);
    let rel = String(writtenPath || "").trim().replace(/\\/g, "/");
    if (!rel) return "";
    if (root && rel.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      rel = rel.slice(root.length + 1);
    }
    if (!rel.includes("/")) return "";
    return rel.split("/").filter(Boolean).slice(0, -1).join("/");
  }

  function resolveWrittenFileName(writtenPath = "") {
    const rel = String(writtenPath || "").trim().replace(/\\/g, "/");
    const parts = rel.split("/").filter(Boolean);
    return parts[parts.length - 1] || "";
  }

  function shouldAutoStartPreview(fileName = "") {
    const base = String(fileName || "").trim().toLowerCase();
    return /^(package\.json|index\.html|vite\.config\.(ts|js|mjs|cjs)|next\.config\.(js|mjs|ts)|nuxt\.config\.(ts|js)|astro\.config\.(mjs|ts))$/.test(base);
  }

  /** Hot-reload del webview si ya hay preview abierto (css/js/tsx/html...). */
  function shouldHotReloadPreview(fileName = "") {
    const base = String(fileName || "").trim().toLowerCase();
    if (!base) return false;
    if (shouldAutoStartPreview(base)) return true;
    return /\.(css|scss|sass|less|html|htm|js|jsx|mjs|cjs|ts|tsx|vue|svelte|mdx)$/i.test(base);
  }

  function resolveTouchedRelativePath(projectRoot = "", writtenPath = "") {
    const root = normalizeSlashes(projectRoot);
    let rel = String(writtenPath || "").trim().replace(/\\/g, "/");
    if (!rel) return "";
    if (root && rel.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
      rel = rel.slice(root.length + 1);
    }
    return rel.replace(/^\/+/, "");
  }

  function resolveHighlightNames(projectRoot = "", writtenPath = "") {
    const viewDir = resolveWrittenFileViewDir(projectRoot, writtenPath);
    const fileName = resolveWrittenFileName(writtenPath);
    if (!viewDir) return fileName ? [fileName] : [];
    const parts = viewDir.split("/").filter(Boolean);
    // Incluye carpeta raíz (src) y padre inmediato (components) para resaltar en cualquier nivel.
    return [...new Set([parts[0], parts[parts.length - 1], fileName].filter(Boolean))];
  }

  function filesChangedPayload(progress = {}, projectRoot = "") {
    const writtenPath = String(progress.input?.path || progress.result?.path || progress.changedFiles?.[0] || "").trim();
    const fileName = resolveWrittenFileName(writtenPath);
    const viewDir = resolveWrittenFileViewDir(projectRoot, writtenPath);
    return {
      projectRoot: String(projectRoot || "").trim(),
      writtenPath,
      // Carpeta del archivo; el renderer decide si quedarse en raíz o navegar.
      viewDir,
      relativePath: resolveTouchedRelativePath(projectRoot, writtenPath),
      fileName,
      highlightNames: resolveHighlightNames(projectRoot, writtenPath),
      tool: String(progress.name || ""),
      autoPreview: shouldAutoStartPreview(fileName),
      hotReload: shouldHotReloadPreview(fileName),
    };
  }

  /** Recorta contenido grande en progreso de mutacion para no saturar IPC/UI. */
  function clipMutationProgressForUi(progress = {}) {
    if (!progress || typeof progress !== "object") return progress || {};
    const name = String(progress.name || "");
    if (!["write_file", "replace_in_file", "apply_diff"].includes(name)) return progress;
    const input = progress.input && typeof progress.input === "object" ? progress.input : null;
    if (!input) return progress;
    const nextInput = { ...input };
    if (typeof nextInput.content === "string" && nextInput.content.length > 4500) {
      nextInput.content = `${nextInput.content.slice(0, 4500)}\n…`;
    }
    if (typeof nextInput.oldText === "string" && nextInput.oldText.length > 2200) {
      nextInput.oldText = `${nextInput.oldText.slice(0, 2200)}\n…`;
    }
    if (typeof nextInput.newText === "string" && nextInput.newText.length > 2200) {
      nextInput.newText = `${nextInput.newText.slice(0, 2200)}\n…`;
    }
    return { ...progress, input: nextInput };
  }

  return {
    normalizeSlashes,
    resolveWrittenFileViewDir,
    resolveWrittenFileName,
    resolveTouchedRelativePath,
    resolveHighlightNames,
    shouldAutoStartPreview,
    shouldHotReloadPreview,
    filesChangedPayload,
    clipMutationProgressForUi,
  };
});
