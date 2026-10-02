"use strict";

/**
 * Web page cloning pipeline:
 * 1) Render URL (Puppeteer → Playwright → fetch)
 * 2) Extract DOM / Tailwind-ish classes / computed styles / screenshots
 * 3) Vision LLM → React/Tailwind components (optional)
 * 4) Merge into golden template (animated-pwa / web-clone-base) + data replacement
 */

const fs = require("node:fs");
const path = require("node:path");
const { parseGeneratedFiles, buildReactScaffold, sanitizeName } = require("./images-to-code");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const TOKEN_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function assertHttpUrl(url) {
  const raw = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL inválida.");
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Solo se permiten URLs http/https.");
  }
  return parsed.href;
}

function stampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function cloneWorkDir(projectRoot, stamp = stampId()) {
  const dir = path.join(String(projectRoot || ""), ".editcore", "web-clone", stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function goldenWebCloneRoot() {
  return path.join(__dirname, "golden-templates", "web-clone-base");
}

/** In-page extractor: DOM snapshot, Tailwind-like classes, key computed styles. */
function pageExtractScript() {
  const pickStyles = (el) => {
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      className: String(el.className || "").slice(0, 240),
      display: cs.display,
      position: cs.position,
      flexDirection: cs.flexDirection,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      gap: cs.gap,
      gridTemplateColumns: cs.gridTemplateColumns,
      width: cs.width,
      height: cs.height,
      padding: cs.padding,
      margin: cs.margin,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontFamily: cs.fontFamily.slice(0, 80),
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow === "none" ? "none" : cs.boxShadow.slice(0, 120),
    };
  };

  const body = document.body;
  const clone = body ? body.cloneNode(true) : null;
  if (clone) {
    clone.querySelectorAll("script, style, noscript, iframe, svg script").forEach((n) => n.remove());
  }

  const classSet = new Set();
  document.querySelectorAll("[class]").forEach((el) => {
    String(el.className || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 40)
      .forEach((c) => {
        if (/^(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|w-|h-|p-|m-|px-|py-|mx-|my-|gap-|text-|bg-|border-|rounded-|shadow-|font-|items-|justify-|col-|row-|sm:|md:|lg:|xl:|2xl:|hover:|focus:)/.test(c)
          || c.length <= 48) {
          classSet.add(c);
        }
      });
  });

  const sections = [...document.querySelectorAll("header, nav, main, section, footer, [role='banner'], [role='main'], [role='contentinfo']")]
    .slice(0, 24)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      className: String(el.className || "").slice(0, 200),
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 280),
      styles: pickStyles(el),
    }));

  const keyNodes = [
    document.querySelector("h1"),
    document.querySelector("nav"),
    document.querySelector("header"),
    document.querySelector("main"),
    document.querySelector("button, a.btn, [role='button']"),
    document.querySelector("footer"),
  ].filter(Boolean);

  return {
    title: document.title || "",
    url: location.href,
    lang: document.documentElement.lang || "",
    metaDescription: document.querySelector('meta[name="description"]')?.content || "",
    bodyText: (body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 8000),
    htmlSnippet: (clone?.innerHTML || "").replace(/\s+/g, " ").trim().slice(0, 40_000),
    tailwindClasses: [...classSet].slice(0, 400),
    sections,
    keyStyles: keyNodes.map(pickStyles),
    colors: {
      background: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.body).color,
    },
  };
}

async function extractWithPuppeteer(url, { viewport = "desktop", outDir } = {}) {
  const puppeteer = require("puppeteer");
  const size = VIEWPORTS[viewport] || VIEWPORTS.desktop;
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EditCoreAI/1.0",
    );
    await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 700));
    const extract = await page.evaluate(pageExtractScript);
    const shotPath = path.join(outDir, `viewport-${viewport}.png`);
    await page.screenshot({ path: shotPath, fullPage: false, type: "png" });
    let fullPagePath = "";
    try {
      fullPagePath = path.join(outDir, `fullpage-${viewport}.png`);
      await page.screenshot({ path: fullPagePath, fullPage: true, type: "png" });
    } catch {
      fullPagePath = "";
    }
    return {
      engine: "puppeteer",
      extract,
      screenshots: [shotPath, fullPagePath].filter(Boolean),
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

async function extractWithPlaywright(url, { viewport = "desktop", outDir } = {}) {
  const { chromium } = require("playwright");
  const size = VIEWPORTS[viewport] || VIEWPORTS.desktop;
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: size.width, height: size.height } });
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    await new Promise((r) => setTimeout(r, 500));
    const extract = await page.evaluate(pageExtractScript);
    const shotPath = path.join(outDir, `viewport-${viewport}.png`);
    await page.screenshot({ path: shotPath, type: "png" });
    return {
      engine: "playwright",
      extract,
      screenshots: [shotPath],
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

async function extractWithFetch(url, { outDir } = {}) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "EditCoreAI/1.0 (+web-clone)",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al abrir ${url}`);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : url;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
  const classMatches = [...html.matchAll(/class=["']([^"']+)["']/gi)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter(Boolean)
    .slice(0, 400);
  const extract = {
    title,
    url,
    lang: "",
    metaDescription: "",
    bodyText: text,
    htmlSnippet: html.replace(/\s+/g, " ").trim().slice(0, 40_000),
    tailwindClasses: [...new Set(classMatches)].slice(0, 400),
    sections: [],
    keyStyles: [],
    colors: {},
  };
  fs.writeFileSync(path.join(outDir, "fetch-raw.html"), html.slice(0, 500_000), "utf8");
  return { engine: "fetch", extract, screenshots: [] };
}

async function extractWebPage(url, options = {}) {
  const href = assertHttpUrl(url);
  const outDir = options.outDir || cloneWorkDir(options.projectRoot || process.cwd());
  const viewport = options.viewport === "mobile" ? "mobile" : "desktop";
  const errors = [];

  if (options.extractOnly === "fetch") {
    return extractWithFetch(href, { outDir });
  }

  try {
    return await extractWithPuppeteer(href, { viewport, outDir });
  } catch (error) {
    errors.push(`puppeteer: ${error?.message || error}`);
  }
  try {
    require.resolve("playwright");
    return await extractWithPlaywright(href, { viewport, outDir });
  } catch (error) {
    errors.push(`playwright: ${error?.message || error}`);
  }
  try {
    const fallback = await extractWithFetch(href, { outDir });
    fallback.note = `Browser no disponible (${errors.join("; ")}); extracción HTTP.`;
    return fallback;
  } catch (error) {
    errors.push(`fetch: ${error?.message || error}`);
    throw new Error(`No se pudo clonar la página: ${errors.join(" | ")}`);
  }
}

function fileToDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  const b64 = buf.toString("base64");
  return `data:image/png;base64,${b64}`;
}

function applyDataReplacements(text = "", replacements = {}) {
  const map = replacements && typeof replacements === "object" ? replacements : {};
  return String(text || "").replace(TOKEN_RE, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(map, key)) return String(map[key]);
    const lower = key.toLowerCase();
    const hit = Object.keys(map).find((k) => k.toLowerCase() === lower);
    return hit != null ? String(map[hit]) : `{{${key}}}`;
  });
}

function applyReplacementsToFiles(files = [], replacements = {}) {
  return files.map((file) => ({
    ...file,
    content: applyDataReplacements(file.content, replacements),
  }));
}

function ensureWebCloneGoldenOnDisk() {
  const root = goldenWebCloneRoot();
  fs.mkdirSync(root, { recursive: true });
  const templateJson = {
    id: "web-clone-base",
    name: "Web Clone Base",
    stack: ["react", "vite", "tailwind", "framer-motion"],
    description: "Shell React/Tailwind para layouts clonados desde URL + visión.",
  };
  fs.writeFileSync(path.join(root, "template.json"), JSON.stringify(templateJson, null, 2), "utf8");
  const readme = `# web-clone-base

Plantilla golden para clonar páginas web externas.

Flujo:
1. \`clone_web_page\` extrae DOM/estilos/capturas
2. Visión genera componentes React/Tailwind
3. Tokens \`{{TITLE}}\`, \`{{CTA}}\`, etc. se reemplazan con datos del usuario
`;
  fs.writeFileSync(path.join(root, "README.md"), readme, "utf8");
  return root;
}

function buildFallbackReactFiles({ title, description, extract, replacements = {} } = {}) {
  const safeTitle = applyDataReplacements(String(title || extract?.title || "Cloned Page").slice(0, 80), replacements);
  const desc = applyDataReplacements(
    String(description || extract?.metaDescription || extract?.bodyText || "").slice(0, 400),
    replacements,
  );
  const classes = (extract?.tailwindClasses || []).slice(0, 24).join(" ");
  const { component } = buildReactScaffold({ title: safeTitle, description: desc });
  const cloned = `import * as React from "react";
import { FadeIn } from "@/components/motion/FadeIn";

/** Layout clonado / adaptado desde URL externa. */
export function ClonedPage() {
  return (
    <FadeIn className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-6 py-4 flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">EditCore · web clone</p>
        <a href="#cta" className="text-sm font-semibold text-primary hover:underline">{{CTA}}</a>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-16 space-y-10">
        <div className="space-y-4">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">{{TITLE}}</h1>
          <p className="text-lg text-muted-foreground max-w-2xl">{{SUBTITLE}}</p>
        </div>
        <section className="grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm">
            <h2 className="font-semibold mb-2">{{CARD_1_TITLE}}</h2>
            <p className="text-sm text-muted-foreground">{{CARD_1_BODY}}</p>
          </article>
          <article className="rounded-2xl border border-border/70 bg-card/70 p-6 shadow-sm">
            <h2 className="font-semibold mb-2">{{CARD_2_TITLE}}</h2>
            <p className="text-sm text-muted-foreground">{{CARD_2_BODY}}</p>
          </article>
        </section>
        <div id="cta" className="flex flex-wrap gap-3">
          <a className="inline-flex items-center rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground" href="#">
            {{CTA}}
          </a>
          <span className="text-xs text-muted-foreground self-center">clases ref: ${classes.slice(0, 120)}</span>
        </div>
      </main>
    </FadeIn>
  );
}

export default ClonedPage;
`;
  const defaults = {
    TITLE: safeTitle,
    SUBTITLE: desc || "Layout adaptado desde la página de referencia.",
    CTA: "Empezar",
    CARD_1_TITLE: "Sección principal",
    CARD_1_BODY: "Bloque derivado del layout original.",
    CARD_2_TITLE: "Sección secundaria",
    CARD_2_BODY: "Personaliza con replacements o visión.",
  };
  const merged = { ...defaults, ...replacements };
  return applyReplacementsToFiles([
    { path: "src/pages/ClonedPage.tsx", content: applyDataReplacements(cloned, merged) },
    { path: "src/components/GeneratedView.tsx", content: applyDataReplacements(component, merged) },
    {
      path: "src/pages/clone-meta.json",
      content: JSON.stringify({
        title: safeTitle,
        source: extract?.url || "",
        tailwindSample: (extract?.tailwindClasses || []).slice(0, 40),
        generatedAt: new Date().toISOString(),
      }, null, 2),
    },
  ], {});
}

function mergeIntoProject(projectRoot, files, { mergeApp = true, appName = "ClonedApp" } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const written = [];
  const pkgPath = path.join(root, "package.json");
  let scaffolded = false;

  if (!fs.existsSync(pkgPath)) {
    const { scaffoldGreenfieldApp } = require("./greenfield-builder");
    scaffoldGreenfieldApp(root, { appName, prompt: "web clone animated-pwa shell" });
    scaffolded = true;
  }

  // Ensure FadeIn exists when writing ClonedPage
  const fadeIn = path.join(root, "src", "components", "motion", "FadeIn.tsx");
  if (!fs.existsSync(fadeIn)) {
    try {
      const { animatedPwaStaticFiles } = require("./templates");
      const staticFiles = animatedPwaStaticFiles(appName);
      if (staticFiles["src/components/motion/FadeIn.tsx"]) {
        fs.mkdirSync(path.dirname(fadeIn), { recursive: true });
        fs.writeFileSync(fadeIn, staticFiles["src/components/motion/FadeIn.tsx"], "utf8");
        written.push("src/components/motion/FadeIn.tsx");
      }
    } catch { /* optional */ }
  }

  for (const file of files) {
    const rel = String(file.path || "").replace(/\\/g, "/").replace(/\.\./g, "").replace(/^\/+/, "");
    if (!rel) continue;
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(file.content || ""), "utf8");
    written.push(rel);
  }

  if (mergeApp) {
    const hasCloned = files.some((f) => /ClonedPage\.tsx$/i.test(f.path || ""));
    if (hasCloned) {
      const appPath = path.join(root, "src", "App.tsx");
      const appExists = fs.existsSync(appPath) && fs.readFileSync(appPath, "utf8").trim().length > 40;
      if (!appExists) {
        const clonedApp = `import * as React from "react";
import { ClonedPage } from "@/pages/ClonedPage";

/** App entry — layout clonado desde URL (EditCore clone_web_page). */
export default function App() {
  return <ClonedPage />;
}
`;
        fs.mkdirSync(path.dirname(appPath), { recursive: true });
        fs.writeFileSync(appPath, clonedApp, "utf8");
        written.push("src/App.tsx");
      }
    }
  }

  // Mirror clone artifacts into golden template for reuse
  try {
    const golden = ensureWebCloneGoldenOnDisk();
    const sample = path.join(golden, "sample-ClonedPage.tsx");
    const clonedFile = files.find((f) => /ClonedPage\.tsx$/i.test(f.path || ""));
    if (clonedFile) fs.writeFileSync(sample, clonedFile.content, "utf8");
  } catch { /* ignore */ }

  return { written, scaffolded };
}

function buildVisionPrompt({ url, extract, replacements, folder }) {
  return [
    "Convierte esta captura + estructura DOM en componentes React + Tailwind limpios.",
    "Responde SOLO JSON: {\"files\":[{\"path\":\"src/pages/ClonedPage.tsx\",\"content\":\"...\"},{\"path\":\"src/components/sections/HeroClone.tsx\",\"content\":\"...\"}]}",
    "Reglas: TypeScript, Tailwind utility classes, sin frameworks externos raros, sin markdown.",
    "Usa tokens {{TITLE}}, {{SUBTITLE}}, {{CTA}} donde el texto deba ser reemplazable.",
    `URL origen: ${url}`,
    `Carpeta: ${folder}`,
    `Título: ${extract?.title || ""}`,
    `Meta: ${extract?.metaDescription || ""}`,
    `Clases Tailwind detectadas (muestra): ${(extract?.tailwindClasses || []).slice(0, 60).join(" ")}`,
    `Secciones: ${JSON.stringify((extract?.sections || []).slice(0, 8)).slice(0, 2000)}`,
    `Estilos clave: ${JSON.stringify(extract?.keyStyles || []).slice(0, 1500)}`,
    `Replacements pedidos: ${JSON.stringify(replacements || {}).slice(0, 500)}`,
  ].join("\n");
}

/**
 * @param {string} projectRoot
 * @param {object} input
 * @param {object} [options]
 * @param {Function} [options.visionGenerate]
 */
async function cloneWebPage(projectRoot, input = {}, options = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root) throw new Error("Proyecto inválido.");
  fs.mkdirSync(root, { recursive: true });

  const url = assertHttpUrl(input.url || input.href || input.targetUrl);
  const folder = sanitizeName(input.folder || input.name || "web-clone");
  const replacements = input.replacements && typeof input.replacements === "object"
    ? input.replacements
    : (input.data && typeof input.data === "object" ? input.data : {});
  const stamp = stampId();
  const workDir = cloneWorkDir(root, stamp);
  const relWork = `.editcore/web-clone/${stamp}`;

  if (input.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      url,
      outDir: relWork,
      planned: ["extract", "vision-or-fallback", "merge-golden", "apply-replacements"],
    };
  }

  ensureWebCloneGoldenOnDisk();

  const extraction = input.mockExtract
    ? {
      engine: "mock",
      extract: input.mockExtract,
      screenshots: [],
    }
    : await extractWebPage(url, {
      projectRoot: root,
      outDir: workDir,
      viewport: input.viewport || "desktop",
      extractOnly: input.extractOnly,
    });

  fs.writeFileSync(
    path.join(workDir, "extract.json"),
    JSON.stringify({
      url,
      engine: extraction.engine,
      extract: extraction.extract,
      screenshots: (extraction.screenshots || []).map((p) => path.relative(root, p).replace(/\\/g, "/")),
      note: extraction.note || "",
    }, null, 2),
    "utf8",
  );
  if (extraction.extract?.htmlSnippet) {
    fs.writeFileSync(path.join(workDir, "dom-snippet.html"), extraction.extract.htmlSnippet, "utf8");
  }

  const images = [];
  for (const shot of extraction.screenshots || []) {
    try {
      images.push({ name: path.basename(shot), mimeType: "image/png", dataUrl: fileToDataUrl(shot) });
    } catch { /* ignore */ }
  }

  let files = null;
  let mode = "scaffold";
  const visionFn = typeof options.visionGenerate === "function" ? options.visionGenerate : null;
  const model = String(input.model || options.model || "");
  const wantVision = input.skipVision !== true
    && visionFn
    && (images.length > 0 || input.forceVision === true)
    && (/vision|claude|gpt-4o|gpt-4\.1|gpt-5|gemini|llava|qwen|sonnet|opus|pixtral|kimi|haiku/i.test(model) || input.forceVision === true);

  if (wantVision) {
    try {
      const text = await visionFn({
        prompt: buildVisionPrompt({
          url,
          extract: extraction.extract,
          replacements,
          folder,
        }),
        images: images.length
          ? images
          : [{ name: "placeholder.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }],
        model,
        systemPrompt: "Eres un generador de UI React/Tailwind. Solo JSON de archivos. Respeta tokens {{TITLE}} {{CTA}}.",
      });
      const generated = parseGeneratedFiles(text);
      if (generated?.length) {
        files = applyReplacementsToFiles(generated, {
          TITLE: replacements.TITLE || extraction.extract?.title || folder,
          SUBTITLE: replacements.SUBTITLE || extraction.extract?.metaDescription || "",
          CTA: replacements.CTA || "Empezar",
          ...replacements,
        });
        mode = "vision";
      }
    } catch (error) {
      mode = "scaffold";
      extraction.visionError = String(error?.message || error);
    }
  }

  if (!files?.length) {
    files = buildFallbackReactFiles({
      title: input.title || extraction.extract?.title || folder,
      description: input.description || input.prompt || "",
      extract: extraction.extract,
      replacements,
    });
    mode = mode === "vision" ? "scaffold" : mode;
  }

  const merge = mergeIntoProject(root, files, {
    mergeApp: input.mergeApp !== false,
    appName: String(input.appName || input.title || "ClonedApp").slice(0, 60),
  });

  return {
    ok: true,
    mode,
    engine: extraction.engine,
    url,
    workDir: relWork,
    screenshots: (extraction.screenshots || []).map((p) => path.relative(root, p).replace(/\\/g, "/")),
    files: merge.written,
    scaffolded: merge.scaffolded,
    goldTemplate: "web-clone-base",
    replacementsApplied: Object.keys(replacements),
    note: extraction.note
      || (mode === "vision"
        ? "Página clonada con visión → React/Tailwind y fusionada al template."
        : "Extracción lista; componentes scaffold aplicados (visión omitida o falló)."),
    visionError: extraction.visionError || undefined,
  };
}

module.exports = {
  cloneWebPage,
  extractWebPage,
  applyDataReplacements,
  buildFallbackReactFiles,
  mergeIntoProject,
  ensureWebCloneGoldenOnDisk,
  goldenWebCloneRoot,
  assertHttpUrl,
  VIEWPORTS,
};
