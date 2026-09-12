"use strict";

function buildSoundOneFiles(name) {
  const packageJson = {
    name: "soundonemusic",
    version: "1.0.0",
    private: true,
    type: "module",
    scripts: {
      dev: "concurrently -k \"node --watch server/index.js\" \"vite --host 127.0.0.1\"",
      start: "node server/index.js",
      build: "vite build",
      test: "vitest run",
      check: "npm run test && npm run build",
    },
    dependencies: {
      "@vitejs/plugin-react": "latest",
      "class-variance-authority": "latest",
      "clsx": "latest",
      "express": "latest",
      "lucide-react": "latest",
      "motion": "latest",
      "react": "latest",
      "react-dom": "latest",
      "tailwind-merge": "latest",
      "zod": "latest",
    },
    devDependencies: {
      "concurrently": "latest",
      "supertest": "latest",
      "vite": "latest",
      "vitest": "latest",
    },
  };

  return {
    "package.json": `${JSON.stringify(packageJson, null, 2)}\n`,
    ".gitignore": "node_modules/\ndist/\n.env\n.DS_Store\n",
    ".env.example": "SOUNDONE_API_PORT=8787\n",
    "README.md": `# ${name}\n\nGenerador full-stack de prompts estructurados para Suno AI.\n\n## Desarrollo\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nFrontend: http://127.0.0.1:5173\nAPI: http://127.0.0.1:8787/api/health\n\n## Verificacion\n\n\`\`\`bash\nnpm run check\n\`\`\`\n`,
    "index.html": `<!doctype html>\n<html lang="es">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <meta name="theme-color" content="#101114" />\n  <meta name="description" content="Generador profesional de prompts para Suno AI" />\n  <title>${name}</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>\n`,
    "vite.config.js": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    host: "127.0.0.1",\n    port: 5173,\n    strictPort: true,\n    proxy: { "/api": "http://127.0.0.1:8787" },\n  },\n});\n`,
    "src/main.jsx": `import { StrictMode } from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")).render(\n  <StrictMode><App /></StrictMode>\n);\n`,
    "src/lib/utils.js": `import { clsx } from "clsx";\nimport { twMerge } from "tailwind-merge";\n\nexport function cn(...inputs) {\n  return twMerge(clsx(inputs));\n}\n`,
    "src/components/ui/button.jsx": `import { cva } from "class-variance-authority";\nimport { cn } from "../../lib/utils";\n\nconst buttonVariants = cva("button", {\n  variants: {\n    variant: { primary: "button-primary", secondary: "button-secondary", ghost: "button-ghost", danger: "button-danger" },\n    size: { default: "button-default", icon: "button-icon", sm: "button-sm" },\n  },\n  defaultVariants: { variant: "primary", size: "default" },\n});\n\nexport function Button({ className, variant, size, type = "button", ...props }) {\n  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;\n}\n`,
    "src/components/ui/skeleton.jsx": `export function Skeleton({ className = "" }) {\n  return <div aria-hidden="true" className={"skeleton " + className} />;\n}\n`,
    "src/App.jsx": String.raw`import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AudioWaveform, Check, Clipboard, Clock3, History, LoaderCircle, Music2, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";

const initialForm = {
  idea: "",
  genre: "Reggaeton",
  subgenre: "Commercial",
  instruments: "808 dembow, catchy synth lead",
  bpm: 94,
  voice: "male",
  language: "Español",
};

function readHistory() {
  try { return JSON.parse(localStorage.getItem("soundone-history") || "[]"); }
  catch { return []; }
}

function Field({ label, children, wide = false }) {
  return <label className={wide ? "field field-wide" : "field"}><span>{label}</span>{children}</label>;
}

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }
  return <Button variant="ghost" size="icon" onClick={copy} title={"Copiar " + label} aria-label={"Copiar " + label}>
    {copied ? <Check size={17} /> : <Clipboard size={17} />}
  </Button>;
}

function ResultPanel({ result }) {
  if (!result) return <section className="empty-state"><AudioWaveform size={42} /><strong>Sin generación activa</strong><span>El resultado aparecerá aquí.</span></section>;
  return <motion.section className="results" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
    <div className="result-header">
      <div><span className="eyebrow">Proyecto</span><h2>{result.project_info.suggested_title}</h2></div>
      <div className="meta"><span>{result.project_info.genre}</span><span>{result.project_info.bpm}</span></div>
    </div>
    <article className="output-block">
      <header><div><span className="eyebrow">Style of Music</span><strong>{result.suno_style_prompt.length}/120</strong></div><CopyButton value={result.suno_style_prompt} label="estilo" /></header>
      <p>{result.suno_style_prompt}</p>
    </article>
    <article className="output-block lyrics-block">
      <header><div><span className="eyebrow">Custom Lyrics</span><strong>Lyrics</strong></div><CopyButton value={result.suno_lyrics_prompt} label="letra" /></header>
      <pre>{result.suno_lyrics_prompt}</pre>
    </article>
  </motion.section>;
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(readHistory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canGenerate = useMemo(() => form.idea.trim().length >= 3 && !loading, [form.idea, loading]);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  async function generate(event) {
    event.preventDefault();
    if (!canGenerate) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, bpm: Number(form.bpm) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "No se pudo generar el proyecto musical.");
      setResult(payload);
      const next = [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), input: form, result: payload }, ...history].slice(0, 12);
      setHistory(next);
      localStorage.setItem("soundone-history", JSON.stringify(next));
    } catch (reason) { setError(reason.message || String(reason)); }
    finally { setLoading(false); }
  }

  function clearHistory() { setHistory([]); localStorage.removeItem("soundone-history"); }

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="brand-mark"><AudioWaveform size={23} /></span><div><strong>SOUNDONEMUSIC</strong><span>Suno prompt studio</span></div></div>
      <div className="system-state"><span className="status-dot" /> Motor disponible</div>
    </header>

    <main className="workspace">
      <section className="generator-panel">
        <div className="section-heading"><div><span className="eyebrow">Generador</span><h1>Nuevo proyecto musical</h1></div><Button variant="ghost" size="icon" title="Restablecer" aria-label="Restablecer" onClick={() => setForm(initialForm)}><RotateCcw size={17} /></Button></div>
        <form onSubmit={generate} className="generator-form">
          <Field label="Idea o referencia" wide><textarea value={form.idea} onChange={(event) => update("idea", event.target.value)} placeholder="Una historia de reencuentro en la ciudad..." maxLength={800} required /></Field>
          <Field label="Género"><input value={form.genre} onChange={(event) => update("genre", event.target.value)} maxLength={80} required /></Field>
          <Field label="Subgénero"><input value={form.subgenre} onChange={(event) => update("subgenre", event.target.value)} maxLength={80} /></Field>
          <Field label="Instrumentación" wide><input value={form.instruments} onChange={(event) => update("instruments", event.target.value)} maxLength={160} /></Field>
          <Field label="BPM"><input type="number" min="60" max="200" value={form.bpm} onChange={(event) => update("bpm", event.target.value)} /></Field>
          <Field label="Voz"><select value={form.voice} onChange={(event) => update("voice", event.target.value)}><option value="male">Male</option><option value="female">Female</option><option value="duet">Duet</option></select></Field>
          <Field label="Idioma"><select value={form.language} onChange={(event) => update("language", event.target.value)}><option>Español</option><option>English</option></select></Field>
          <div className="form-action field-wide"><Button type="submit" disabled={!canGenerate}>{loading ? <><LoaderCircle className="spin" size={18} /> Generando</> : <><Sparkles size={18} /> Generar prompts</>}</Button><span>{form.idea.length}/800</span></div>
        </form>
        {error && <div className="error-banner" role="alert">{error}</div>}
      </section>

      <section className="result-panel">
        <AnimatePresence mode="wait">{loading ? <motion.div key="loading" className="loading-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Skeleton className="skeleton-title" /><Skeleton className="skeleton-line" /><Skeleton className="skeleton-card" /><Skeleton className="skeleton-card tall" /></motion.div> : <ResultPanel key="result" result={result} />}</AnimatePresence>
      </section>

      <aside className="history-panel">
        <div className="history-heading"><div><History size={17} /><strong>Historial</strong></div>{history.length > 0 && <Button variant="ghost" size="icon" title="Borrar historial" aria-label="Borrar historial" onClick={clearHistory}><Trash2 size={16} /></Button>}</div>
        {history.length === 0 ? <div className="history-empty"><Clock3 size={22} /><span>Sin generaciones</span></div> : <div className="history-list">{history.map((entry) => <button key={entry.id} className="history-item" onClick={() => { setForm(entry.input); setResult(entry.result); }}><Music2 size={16} /><span><strong>{entry.result.project_info.suggested_title}</strong><small>{entry.result.project_info.genre}</small></span></button>)}</div>}
      </aside>
    </main>
  </div>;
}
`,
    "src/styles.css": String.raw`:root {
  color-scheme: dark;
  font-family: Inter, Geist, ui-sans-serif, system-ui, sans-serif;
  color: #f5f7f8;
  background: #0d0e10;
  font-synthesis: none;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; background: #0d0e10; }
button, input, textarea, select { font: inherit; letter-spacing: 0; }
button { cursor: pointer; }
button:disabled { cursor: not-allowed; opacity: .48; }
.app-shell { min-height: 100vh; }
.app-header { height: 68px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #282b2f; background: #121316; }
.brand { display: flex; align-items: center; gap: 11px; }
.brand-mark { width: 38px; height: 38px; display: grid; place-items: center; color: #0d0e10; background: #43e0b0; border-radius: 7px; box-shadow: 0 0 22px rgba(67,224,176,.18); }
.brand > div { display: grid; gap: 2px; }
.brand strong { font-size: 14px; }
.brand span { color: #8d949b; font-size: 12px; }
.system-state { display: flex; align-items: center; gap: 8px; color: #aeb4ba; font-size: 12px; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; background: #43e0b0; box-shadow: 0 0 0 4px rgba(67,224,176,.1); }
.workspace { min-height: calc(100vh - 68px); display: grid; grid-template-columns: minmax(340px, 440px) minmax(420px, 1fr) 250px; }
.generator-panel, .result-panel, .history-panel { min-width: 0; }
.generator-panel { padding: 28px 26px; border-right: 1px solid #282b2f; background: #141518; }
.result-panel { padding: 28px; background: #0d0e10; }
.history-panel { border-left: 1px solid #282b2f; background: #121316; }
.section-heading, .result-header, .output-block header, .history-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.section-heading { margin-bottom: 24px; }
.eyebrow { display: block; color: #43e0b0; font-size: 11px; font-weight: 700; text-transform: uppercase; }
h1, h2 { margin: 4px 0 0; letter-spacing: 0; }
h1 { font-size: 22px; }
h2 { font-size: 21px; }
.generator-form { display: grid; grid-template-columns: 1fr 1fr; gap: 17px 14px; }
.field { display: grid; gap: 7px; min-width: 0; color: #b7bdc2; font-size: 12px; font-weight: 600; }
.field-wide { grid-column: 1 / -1; }
input, textarea, select { width: 100%; border: 1px solid #34383d; border-radius: 6px; background: #0e0f11; color: #f5f7f8; outline: none; }
input, select { height: 42px; padding: 0 12px; }
textarea { min-height: 118px; padding: 12px; resize: vertical; line-height: 1.5; }
input:focus, textarea:focus, select:focus { border-color: #43e0b0; box-shadow: 0 0 0 3px rgba(67,224,176,.1); }
.form-action { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 2px; }
.form-action > span { color: #737a81; font-size: 11px; }
.button { min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; border-radius: 6px; font-weight: 700; transition: background-color .16s, border-color .16s, color .16s, transform .1s; }
.button:active { transform: translateY(1px); }
.button-primary { padding: 0 18px; background: #43e0b0; color: #09110e; }
.button-primary:hover { background: #6de8c2; }
.button-secondary { padding: 0 18px; background: #24272b; border-color: #383c41; color: #f5f7f8; }
.button-ghost { background: transparent; border-color: #30343a; color: #aeb4ba; }
.button-ghost:hover { background: #202328; color: #fff; }
.button-icon { width: 36px; height: 36px; min-height: 36px; padding: 0; }
.button-sm { min-height: 32px; padding: 0 11px; }
.error-banner { margin-top: 18px; padding: 11px 12px; border: 1px solid #853d48; border-radius: 6px; background: #2b171b; color: #ffb8c1; font-size: 13px; }
.results { display: grid; gap: 18px; max-width: 920px; margin: 0 auto; }
.result-header { padding: 0 2px 4px; }
.meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.meta span { padding: 5px 8px; border: 1px solid #31353a; border-radius: 5px; color: #adb3b9; background: #15171a; font-size: 11px; }
.output-block { border: 1px solid #2e3237; border-radius: 8px; background: #141619; overflow: hidden; }
.output-block header { min-height: 52px; padding: 0 12px 0 16px; border-bottom: 1px solid #292d31; }
.output-block header > div { display: flex; align-items: center; gap: 10px; }
.output-block header strong { color: #767e85; font-size: 11px; }
.output-block p { margin: 0; padding: 20px; color: #f1f4f5; line-height: 1.65; }
.output-block pre { margin: 0; padding: 20px; max-height: calc(100vh - 330px); overflow: auto; color: #dfe4e6; font-family: "SFMono-Regular", Consolas, monospace; font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
.empty-state { min-height: calc(100vh - 124px); display: grid; place-content: center; justify-items: center; gap: 9px; color: #697077; text-align: center; }
.empty-state strong { color: #b3b9be; font-size: 14px; }
.empty-state span { font-size: 12px; }
.history-heading { height: 58px; padding: 0 14px 0 18px; border-bottom: 1px solid #282b2f; }
.history-heading > div { display: flex; align-items: center; gap: 8px; }
.history-heading strong { font-size: 13px; }
.history-empty { padding: 48px 14px; display: grid; justify-items: center; gap: 8px; color: #697077; font-size: 12px; }
.history-list { padding: 10px; display: grid; gap: 5px; }
.history-item { width: 100%; min-height: 54px; padding: 9px 10px; display: flex; align-items: center; gap: 10px; text-align: left; border: 1px solid transparent; border-radius: 6px; background: transparent; color: #8f979d; }
.history-item:hover { border-color: #34383d; background: #1a1c20; color: #43e0b0; }
.history-item > span { min-width: 0; display: grid; gap: 3px; }
.history-item strong, .history-item small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-item strong { color: #e4e8ea; font-size: 12px; }
.history-item small { color: #747c83; font-size: 10px; }
.loading-results { display: grid; gap: 18px; max-width: 920px; margin: 0 auto; }
.skeleton { position: relative; overflow: hidden; border-radius: 6px; background: #1a1c20; }
.skeleton::after { content: ""; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, rgba(255,255,255,.05), transparent); animation: shimmer 1.3s infinite; }
.skeleton-title { width: 42%; height: 28px; }
.skeleton-line { width: 70%; height: 16px; }
.skeleton-card { height: 126px; }
.skeleton-card.tall { height: 360px; }
.spin { animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmer { to { transform: translateX(100%); } }
@media (max-width: 1100px) { .workspace { grid-template-columns: minmax(330px, 420px) 1fr; } .history-panel { grid-column: 1 / -1; border-left: 0; border-top: 1px solid #282b2f; } .history-list { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .app-header { padding: 0 16px; } .system-state { display: none; } .workspace { display: block; } .generator-panel { padding: 22px 16px; border-right: 0; border-bottom: 1px solid #282b2f; } .result-panel { padding: 22px 16px; } .generator-form { grid-template-columns: 1fr; } .field-wide { grid-column: auto; } .history-list { grid-template-columns: 1fr; } .result-header { align-items: flex-start; } .meta { justify-content: flex-start; } .output-block pre { max-height: 520px; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
`,
    "server/generator.js": String.raw`import { z } from "zod";

export const generationSchema = z.object({
  idea: z.string().trim().min(3).max(800),
  genre: z.string().trim().min(2).max(80),
  subgenre: z.string().trim().max(80).default(""),
  instruments: z.string().trim().max(160).default(""),
  bpm: z.coerce.number().int().min(60).max(200),
  voice: z.enum(["male", "female", "duet"]),
  language: z.enum(["Español", "English"]).default("Español"),
});

function clean(value) { return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }

function stylePrompt(input) {
  const tags = [clean(input.subgenre), clean(input.genre), clean(input.instruments), String(input.bpm) + " BPM", input.voice + " vocals"].filter(Boolean);
  let result = tags.join(", ");
  while (result.length > 120 && tags.length > 3) { tags.splice(tags.length === 5 ? 2 : 1, 1); result = tags.join(", "); }
  return result.length <= 120 ? result : result.slice(0, 120).replace(/[, ]+$/, "");
}

function titleFromIdea(idea) {
  const ignored = new Set(["a", "al", "an", "and", "bajo", "by", "de", "del", "el", "en", "la", "las", "los", "of", "the", "un", "una", "y"]);
  const words = clean(idea).replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter((word) => word && !ignored.has(word.toLowerCase())).slice(0, 5);
  const title = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
  return title || "Nueva Canción";
}

function spanishLyrics(input, title) {
  const idea = clean(input.idea);
  return [
    "[Intro]", "(Instrumental)", "", "[Verse 1]",
    "Cruzo la ciudad siguiendo aquella señal,", "cada paso en la noche me devuelve a tu portal.",
    idea + ",", "y el pulso de la calle nos invita a comenzar.", "", "[Pre-Chorus]",
    "Sube la marea, ya no mires hacia atrás,", "cuando el ritmo llama nada nos podrá parar.", "", "[Chorus]",
    title + ", vuelve a sonar,", "quédate conmigo, no te vayas a apagar.",
    title + ", déjate llevar,", "hoy la noche es nuestra y va a volver a comenzar.", "", "[Verse 2]",
    "Luces en el vidrio, pasos sobre el boulevard,", "lo que estaba roto hoy aprende a respirar.",
    "Tu voz encuentra el tempo, mi respuesta encuentra el mar,", "somos dos historias con un mismo compás.", "", "[Bridge]",
    "Si se apaga el cielo, yo te vuelvo a encontrar,", "si termina el sueño, lo empezamos una vez más.", "", "[Chorus]",
    title + ", vuelve a sonar,", "quédate conmigo, no te vayas a apagar.",
    title + ", déjate llevar,", "hoy la noche es nuestra y va a volver a comenzar.", "", "[Outro]", "(Vocal hook)", title + "... vuelve a sonar.", "", "[Fade Out]"
  ].join("\n");
}

function englishLyrics(input, title) {
  const idea = clean(input.idea);
  return [
    "[Intro]", "(Instrumental)", "", "[Verse 1]",
    "City lights are calling while the midnight turns to gold,", "every quiet heartbeat brings me closer than before.",
    idea + ",", "now the rhythm opens every waiting door.", "", "[Pre-Chorus]",
    "Feel the water rising, leave the shadows in the past,", "when the music finds us we can make the moment last.", "", "[Chorus]",
    title + ", say it again,", "keep me in the moment till the night becomes the day.",
    title + ", carry me away,", "we can start forever every time the speakers play.", "", "[Verse 2]",
    "Footsteps on the pavement, silver running through the rain,", "everything once broken finds a melody again.",
    "Your voice becomes the tempo, mine becomes the open flame,", "two unfinished stories now are singing out the same.", "", "[Bridge]",
    "If the sky goes quiet, I will find you in the sound,", "if the dream is over, we can turn it back around.", "", "[Chorus]",
    title + ", say it again,", "keep me in the moment till the night becomes the day.",
    title + ", carry me away,", "we can start forever every time the speakers play.", "", "[Outro]", "(Vocal hook)", title + "... say it again.", "", "[Fade Out]"
  ].join("\n");
}

export function generateSunoPrompts(rawInput) {
  const input = generationSchema.parse(rawInput);
  const title = titleFromIdea(input.idea);
  const style = stylePrompt(input);
  const lyrics = input.language === "English" ? englishLyrics(input, title) : spanishLyrics(input, title);
  return {
    project_info: { suggested_title: title, genre: [input.genre, input.subgenre].filter(Boolean).join(" / "), bpm: String(input.bpm) + " BPM" },
    suno_style_prompt: style,
    suno_lyrics_prompt: lyrics,
  };
}
`,
    "server/app.js": String.raw`import express from "express";
import { ZodError } from "zod";
import { generateSunoPrompts } from "./generator.js";

export function createApp() {
  const app = express();
  const requests = new Map();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use((request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    const key = request.ip || "local";
    const now = Date.now();
    const recent = (requests.get(key) || []).filter((time) => now - time < 60_000);
    if (recent.length >= 30) return response.status(429).json({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." });
    recent.push(now); requests.set(key, recent); next();
  });
  app.get("/api/health", (_request, response) => response.json({ ok: true, service: "soundonemusic" }));
  app.post("/api/generate", (request, response, next) => {
    try { response.json(generateSunoPrompts(request.body)); }
    catch (error) { next(error); }
  });
  app.use((error, _request, response, _next) => {
    if (error instanceof ZodError) return response.status(400).json({ error: "Datos inválidos.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) });
    if (error?.type === "entity.too.large") return response.status(413).json({ error: "Solicitud demasiado grande." });
    console.error(error); return response.status(500).json({ error: "Error interno del generador." });
  });
  return app;
}
`,
    "server/index.js": `import { createApp } from "./app.js";\n\nconst port = Number(process.env.SOUNDONE_API_PORT || 8787);\nconst server = createApp().listen(port, "127.0.0.1", () => console.log("SOUNDONEMUSIC API http://127.0.0.1:" + port));\n\nfunction shutdown() { server.close(() => process.exit(0)); }\nprocess.on("SIGINT", shutdown);\nprocess.on("SIGTERM", shutdown);\n`,
    "test/generator.test.js": String.raw`import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../server/app.js";
import { generateSunoPrompts } from "../server/generator.js";

const valid = { idea: "un reencuentro bajo las luces de la ciudad", genre: "Reggaeton", subgenre: "Commercial", instruments: "808 dembow, synth lead", bpm: 94, voice: "male", language: "Español" };

describe("Suno prompt generator", () => {
  it("returns the exact integration shape and a bounded English style", () => {
    const result = generateSunoPrompts(valid);
    expect(Object.keys(result)).toEqual(["project_info", "suno_style_prompt", "suno_lyrics_prompt"]);
    expect(result.suno_style_prompt.length).toBeLessThanOrEqual(120);
    expect(result.suno_style_prompt).toContain("94 BPM");
    expect(result.suno_style_prompt).toContain("male vocals");
    expect(result.suno_lyrics_prompt).toContain("[Verse 1]");
    expect(result.suno_lyrics_prompt).toContain("[Chorus]");
    expect(result.suno_lyrics_prompt).toContain("[Fade Out]");
  });

  it("supports English lyrics", () => {
    const result = generateSunoPrompts({ ...valid, language: "English" });
    expect(result.suno_lyrics_prompt).toContain("City lights are calling");
  });

  it("validates the HTTP contract", async () => {
    const response = await request(createApp()).post("/api/generate").send(valid).expect(200);
    expect(response.body.suno_style_prompt.length).toBeLessThanOrEqual(120);
    await request(createApp()).post("/api/generate").send({ ...valid, bpm: 20 }).expect(400);
  });
});
`,
  };
}

module.exports = { buildSoundOneFiles };
