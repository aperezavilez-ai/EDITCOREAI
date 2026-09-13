"use strict";

/**
 * Helpers del panel browser (preview webview) para inspeccion DOM basica
 * sin salir de localhost.
 */

function buildDomProbeScript() {
  return `(() => {
    const title = document.title || "";
    const url = location.href;
    const headings = [...document.querySelectorAll("h1,h2")].slice(0, 12).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().slice(0, 120),
    }));
    const buttons = [...document.querySelectorAll("button,a[href],input[type=submit]")].slice(0, 20).map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || el.getAttribute("aria-label") || el.value || "").trim().slice(0, 80),
    }));
    const images = document.images?.length || 0;
    const issues = [];
    if (!document.querySelector("main, [role=main], h1")) issues.push("Falta h1/main visible");
    if (document.body && getComputedStyle(document.body).overflowX === "scroll") issues.push("overflow-x scroll en body");
    return { ok: true, title, url, headings, buttons, images, issues };
  })()`;
}

function formatDomProbe(result = {}) {
  if (!result || result.ok === false) {
    return `Inspeccion DOM fallo: ${result?.message || "sin resultado"}`;
  }
  const lines = [
    "## Browser · DOM",
    "",
    `URL: \`${result.url || ""}\``,
    `Titulo: ${result.title || "(sin titulo)"}`,
    `Imagenes: ${result.images ?? 0}`,
    "",
    "### Headings",
    ...(result.headings || []).map((h) => `- \`<${h.tag}>\` ${h.text}`) || ["- (ninguno)"],
    "",
    "### Controles",
    ...(result.buttons || []).slice(0, 12).map((b) => `- \`<${b.tag}>\` ${b.text}`) || ["- (ninguno)"],
  ];
  if (result.issues?.length) {
    lines.push("", "### Avisos", ...result.issues.map((i) => `- ${i}`));
  }
  return lines.join("\n");
}

module.exports = {
  buildDomProbeScript,
  formatDomProbe,
};
