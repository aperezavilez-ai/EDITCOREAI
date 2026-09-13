"use strict";

/**
 * Images → code: scaffold local + ruta vision LLM opcional.
 */

const fs = require("node:fs");
const path = require("node:path");

function sanitizeName(value = "ui") {
  return String(value || "ui")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "ui";
}

function buildScaffold({ title = "UI from image", description = "", imageName = "" } = {}) {
  const safeTitle = String(title || "UI from image").slice(0, 80);
  const desc = String(description || "Generado desde imagen adjunta / brief visual.").slice(0, 500);
  const imgNote = imageName ? `Referencia: ${imageName}` : "Sin archivo de imagen; usa el brief.";
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="./styles.css" />
</head>
<body>
  <main class="hero">
    <p class="eyebrow">EditCore · images→code</p>
    <h1>${safeTitle}</h1>
    <p class="lede">${desc}</p>
    <p class="meta">${imgNote}</p>
    <div class="actions">
      <button type="button" id="primaryBtn">Accion principal</button>
      <button type="button" class="ghost" id="secondaryBtn">Secundaria</button>
    </div>
  </main>
  <script src="./main.js"></script>
</body>
</html>
`;
  const css = `:root {
  --bg: #0f1419;
  --fg: #f4f0e8;
  --accent: #d97757;
  --muted: #9aa3ad;
  font-family: "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(1200px 600px at 10% -10%, #2a3340 0%, transparent 55%),
    var(--bg);
  color: var(--fg);
}
.hero { max-width: 720px; margin: 0 auto; padding: 18vh 24px 48px; }
.eyebrow { letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-size: 12px; }
h1 { font-size: clamp(2rem, 5vw, 3.4rem); line-height: 1.05; margin: 12px 0 16px; font-weight: 700; }
.lede { color: #d7dde4; font-size: 1.05rem; max-width: 42ch; }
.meta { color: var(--muted); font-size: 0.9rem; }
.actions { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
button { border: 0; border-radius: 999px; padding: 12px 18px; font-weight: 700; cursor: pointer; background: var(--accent); color: #1a120e; }
button.ghost { background: transparent; color: var(--fg); border: 1px solid #3a4654; }
`;
  const js = `document.getElementById("primaryBtn")?.addEventListener("click", () => console.log("primary"));
document.getElementById("secondaryBtn")?.addEventListener("click", () => console.log("secondary"));
`;
  return { html, css, js };
}

function buildReactScaffold({ title = "UI from image", description = "" } = {}) {
  const safeTitle = String(title || "UI from image").slice(0, 80);
  const desc = String(description || "Componente generado desde imagen.").slice(0, 500);
  const component = `import * as React from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";

export function GeneratedView() {
  return (
    <section className="py-16 px-4 sm:px-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5" />
          Diseño Recreado
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
          ${safeTitle}
        </h1>
        <p className="text-muted-foreground max-w-2xl mx-auto text-base sm:text-lg">
          ${desc}
        </p>
      </div>

      <Card className="p-6 sm:p-8 bg-card/80 backdrop-blur border-border/80 shadow-xl">
        <CardHeader className="p-0 pb-6">
          <CardTitle>Vista Principal</CardTitle>
          <CardDescription>Estructura y layout derivados de la referencia visual</CardDescription>
        </CardHeader>
        <CardContent className="p-0 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
              <h3 className="font-semibold text-sm mb-1">Módulo Primario</h3>
              <p className="text-xs text-muted-foreground">Componente interactivo listo para conectar con tu lógica de negocio.</p>
            </div>
            <div className="p-4 rounded-xl bg-muted/50 border border-border/50">
              <h3 className="font-semibold text-sm mb-1">Módulo Secundario</h3>
              <p className="text-xs text-muted-foreground">Diseño adaptativo preparado para dispositivos móviles y de escritorio.</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-border/50">
            <Button variant="outline">Cancelar</Button>
            <Button className="gap-2">
              Continuar <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
`;
  return { component };
}

function parseGeneratedFiles(modelText = "") {
  const raw = String(modelText || "").trim();
  if (!raw) return null;
  let jsonText = raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) jsonText = fenced[1].trim();
  try {
    const parsed = JSON.parse(jsonText);
    const files = Array.isArray(parsed) ? parsed : parsed?.files;
    if (!Array.isArray(files) || !files.length) return null;
    const out = [];
    for (const file of files.slice(0, 12)) {
      const rel = String(file.path || file.name || "").replace(/\\/g, "/").replace(/\.\./g, "").replace(/^\/+/, "");
      const content = String(file.content ?? "");
      if (!rel || !content || content.length > 200_000) continue;
      if (!/\.(html?|css|js|jsx|ts|tsx|json|svg|md)$/i.test(rel)) continue;
      out.push({ path: rel, content });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function writeFiles(absDir, relDir, files) {
  const written = [];
  for (const file of files) {
    const rel = `${relDir}/${file.path}`.replace(/\/+/g, "/");
    const abs = path.join(absDir, ...String(file.path).split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.content, "utf8");
    written.push(rel);
  }
  return written;
}

function imagesToCode(projectRoot, input = {}, options = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) throw new Error("Proyecto invalido.");
  const folder = sanitizeName(input.folder || input.name || "from-image");
  const relDir = String(input.outDir || `src/${folder}`).replace(/\\/g, "/").replace(/\.\./g, "");
  const absDir = path.join(root, ...relDir.split("/"));

  if (input.dryRun === true) {
    return { ok: true, dryRun: true, outDir: relDir, files: ["index.html", "styles.css", "main.js"] };
  }

  const images = Array.isArray(input.images) ? input.images.filter((img) => img?.dataUrl || img?.url) : [];
  const visionFn = typeof options.visionGenerate === "function" ? options.visionGenerate : null;
  const model = String(input.model || options.model || "");
  const supportsVision = /vision|claude|gpt-4o|gpt-4\.1|gpt-5|gemini|llava|qwen-vl|moonshot|kimi|haiku|sonnet|opus|pixtral/i.test(model)
    || Boolean(input.forceVision);

  if (visionFn && images.length && supportsVision) {
    return (async () => {
      try {
        const prompt = [
          "Convierte esta UI/imagen en codigo web minimo usable.",
          "Responde SOLO JSON: {\"files\":[{\"path\":\"index.html\",\"content\":\"...\"},{\"path\":\"styles.css\",\"content\":\"...\"},{\"path\":\"main.js\",\"content\":\"...\"}]}",
          "HTML+CSS+JS sin frameworks externos. Tipografia expresiva. Sin markdown.",
          `Brief: ${String(input.description || input.prompt || input.title || "").slice(0, 800)}`,
        ].join("\n");
        const text = await visionFn({
          prompt,
          images,
          model,
          systemPrompt: "Eres un generador de UI. Solo JSON de archivos.",
        });
        const generated = parseGeneratedFiles(text);
        if (generated?.length) {
          fs.mkdirSync(absDir, { recursive: true });
          const written = writeFiles(absDir, relDir, generated);
          return {
            ok: true,
            mode: "vision",
            outDir: relDir,
            files: written,
            note: "Generado con modelo vision. Revisa y personaliza.",
          };
        }
      } catch (error) {
        return imagesToCodeLocal(root, absDir, relDir, folder, input, {
          note: `Vision fallo (${error?.message || error}); scaffold local aplicado.`,
        });
      }
      return imagesToCodeLocal(root, absDir, relDir, folder, input, {
        note: "Vision no devolvio JSON valido; scaffold local aplicado.",
      });
    })();
  }

  return imagesToCodeLocal(root, absDir, relDir, folder, input, {
    note: images.length && !supportsVision
      ? "Imagen adjunta pero el modelo no soporta vision; scaffold local. Cambia a claude/gpt-4o/gemini y reintenta."
      : "Scaffold images→code local. Personaliza con el agente.",
  });
}

function imagesToCodeLocal(root, absDir, relDir, folder, input, extra = {}) {
  const scaffold = buildScaffold({
    title: input.title || folder,
    description: input.description || input.prompt || "",
    imageName: input.imageName || "",
  });
  fs.mkdirSync(absDir, { recursive: true });
  fs.writeFileSync(path.join(absDir, "index.html"), scaffold.html, "utf8");
  fs.writeFileSync(path.join(absDir, "styles.css"), scaffold.css, "utf8");
  fs.writeFileSync(path.join(absDir, "main.js"), scaffold.js, "utf8");
  return {
    ok: true,
    mode: "scaffold",
    outDir: relDir,
    files: [`${relDir}/index.html`, `${relDir}/styles.css`, `${relDir}/main.js`],
    note: extra.note || "Scaffold images→code creado.",
  };
}

module.exports = {
  imagesToCode,
  buildScaffold,
  buildReactScaffold,
  sanitizeName,
  parseGeneratedFiles,
};
