"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { searchBrainDocs } = require("./brain-ingest");

const execFileAsync = promisify(execFile);

const EXTERNAL_ACTION_TOOLS = new Set(["publish_project", "deploy_one_click"]);
const DOCUMENT_TEXT_CAP = 12_000;
const SCREENSHOT_VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

function userDataDir(helpers = {}) {
  const explicit = String(helpers?.userDataPath || process.env.EDITCORE_USER_DATA_PATH || "").trim();
  if (explicit) return explicit;
  try { return require("electron").app?.getPath?.("userData") || os.tmpdir(); } catch { return os.tmpdir(); }
}

async function readPdf(file, { maxChars = DOCUMENT_TEXT_CAP } = {}) {
  if (!fs.existsSync(file)) return { ok: false, error: `No existe: ${file}` };
  if (fs.statSync(file).isDirectory()) return { ok: false, error: `Es carpeta: ${file}` };
  const ext = path.extname(file).toLowerCase();
  if (![".pdf", ".docx", ".xlsx"].includes(ext)) return { ok: false, error: "read_pdf acepta .pdf, .docx o .xlsx; para texto plano usa read_file." };
  const { extractDocumentFromBuffer } = require("../document-attachments");
  const doc = await extractDocumentFromBuffer(path.basename(file), fs.readFileSync(file));
  if (!doc.supported) return { ok: false, error: doc.error || "No se pudo leer el documento." };
  const text = String(doc.text || "");
  const cap = Math.max(500, Math.min(DOCUMENT_TEXT_CAP, Number(maxChars) || DOCUMENT_TEXT_CAP));
  return { ok: true, path: file, format: doc.format, chars: text.length, truncated: text.length > cap, text: text.slice(0, cap) };
}

function assertHttpUrl(url) {
  let parsed;
  try { parsed = new URL(String(url || "").trim()); } catch { throw new Error("URL inválida"); }
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error("Solo se aceptan URLs http(s)");
  return parsed.href;
}

async function screenshotPage(url, { viewport = "desktop", fullPage = false, helpers = {} } = {}) {
  const href = assertHttpUrl(url);
  const size = SCREENSHOT_VIEWPORTS[viewport] || SCREENSHOT_VIEWPORTS.desktop;
  const dir = path.join(userDataDir(helpers), "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const host = new URL(href).hostname.replace(/[^a-z0-9.-]/gi, "_");
  const outPath = path.join(dir, `${host}-${Date.now()}.png`);
  const puppeteer = require("puppeteer");
  let browser = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage();
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    const response = await page.goto(href, { waitUntil: "networkidle2", timeout: 35_000 });
    await page.screenshot({ path: outPath, fullPage: fullPage === true, type: "png" });
    const info = await page.evaluate(() => ({
      title: document.title || "",
      headings: [...document.querySelectorAll("h1,h2")].slice(0, 8).map((n) => (n.textContent || "").trim().slice(0, 120)),
      text: (document.body?.innerText || "").trim().slice(0, 1500),
    }));
    return { ok: true, url: href, status: response?.status?.() ?? null, viewport, screenshot: outPath, ...info };
  } catch (e) {
    return { ok: false, url: href, error: String(e?.message || e).slice(0, 300) };
  } finally {
    if (browser) { try { await browser.close(); } catch { /* ignore */ } }
  }
}

async function dockerPs({ all = false } = {}) {
  const args = ["ps", "--format", "{{json .}}"];
  if (all) args.splice(1, 0, "-a");
  try {
    const { stdout } = await execFileAsync("docker", args, { timeout: 20_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    const containers = String(stdout || "").split(/\r?\n/).filter(Boolean).map((line) => {
      try {
        const c = JSON.parse(line);
        return { name: c.Names, image: c.Image, status: c.Status, state: c.State, ports: c.Ports };
      } catch { return null; }
    }).filter(Boolean);
    return { ok: true, count: containers.length, containers: containers.slice(0, 60) };
  } catch (e) {
    const msg = String(e?.stderr || e?.message || e);
    if (e?.code === "ENOENT") return { ok: false, error: "Docker no está instalado o no está en el PATH." };
    if (/daemon|pipe|connect/i.test(msg)) return { ok: false, error: "Docker está instalado pero el motor no está corriendo (abre Docker Desktop)." };
    return { ok: false, error: msg.slice(0, 300) };
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: tiempo agotado`)), ms); }),
  ]);
}

async function searchBrain(root, query, helpers = {}, limit = 6) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "search_brain requiere query" };
  const documents = searchBrainDocs(root, q, limit).map((r) => ({ title: r.title, path: r.path, text: r.text.slice(0, 700) }));
  let memory = [];
  let code = [];
  if (typeof helpers?.brainSearch === "function") {
    try {
      const out = await withTimeout(Promise.resolve(helpers.brainSearch(root, q, { scope: "all", limit })), 20_000, "Cerebro");
      memory = (out?.memory || []).slice(0, limit).map((m) => ({ title: m.title, type: m.type, text: String(m.content || m.text || "").slice(0, 400) }));
      code = (out?.knowledge || []).slice(0, limit).map((k) => ({ path: k.path, text: String(k.text || "").slice(0, 400) }));
    } catch { /* el índice global es opcional */ }
  }
  return { ok: true, query: q, documents, memory, code, found: documents.length + memory.length + code.length };
}

function externalActionPreview(name, args, root) {
  const lines = [];
  if (name === "deploy_one_click") {
    const { detectProvider } = require("../runtime/deploy-one-click");
    lines.push(`Deploy de \`${path.basename(root)}\` a **${detectProvider(root, args.provider)}**${args.production === false ? " (preview)" : " (producción)"}.`);
  } else {
    lines.push(`Publicar \`${path.basename(root)}\` (modo ${args.mode || "project"}): commit sin secretos${args.skipPush ? "" : ", push de la rama actual"}${args.supabasePush === false ? "" : ", migraciones de Supabase si aplican"}${args.deploy === false ? "" : " y deploy"}.`);
    if (args.commitMessage) lines.push(`Mensaje de commit: "${String(args.commitMessage).slice(0, 120)}".`);
  }
  return lines.join("\n");
}

async function runExternalAction(name, args, root, helpers = {}) {
  if (!helpers?.externalActionApproved) {
    return {
      ok: false,
      needsConfirmation: true,
      action: name,
      args,
      preview: externalActionPreview(name, args, root),
      message: "Acción externa: requiere confirmación explícita del usuario antes de ejecutarse.",
    };
  }
  const connections = typeof helpers.readConnections === "function" ? (helpers.readConnections() || {}) : {};
  if (name === "deploy_one_click") {
    const { deployOneClick } = require("../runtime/deploy-one-click");
    return deployOneClick(root, args, { connections });
  }
  const { publishProject } = require("../runtime/publish-pipeline");
  return publishProject(root, {
    mode: String(args.mode || "project"),
    connections,
    deploy: args.deploy !== false,
    supabasePush: args.supabasePush !== false,
    commitMessage: String(args.commitMessage || ""),
    skipPush: args.skipPush === true,
  });
}

const EXTRA_DEFINITIONS = [
  { type: "function", function: { name: "read_pdf", description: "Extrae el texto de un PDF, Word (.docx) o Excel (.xlsx) del disco. Acepta rutas absolutas o relativas.", parameters: { type: "object", properties: { path: { type: "string" }, maxChars: { type: "number" } }, required: ["path"] } } },
  { type: "function", function: { name: "screenshot_page", description: "Abre una URL http(s) en un navegador headless, guarda una captura PNG y devuelve título, encabezados y texto visible.", parameters: { type: "object", properties: { url: { type: "string" }, viewport: { type: "string", enum: ["desktop", "mobile"] }, fullPage: { type: "boolean" } }, required: ["url"] } } },
  { type: "function", function: { name: "docker_ps", description: "Lista los contenedores Docker (nombre, imagen, estado, puertos). all=true incluye los detenidos.", parameters: { type: "object", properties: { all: { type: "boolean" } } } } },
  { type: "function", function: { name: "search_brain", description: "Busca en el Cerebro del proyecto: documentos ingeridos (.editcore/rag), memoria y código indexado.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "deploy_one_click", description: "Deploy a Vercel o Netlify con los tokens de Conexiones. Siempre pide confirmación al usuario antes de ejecutarse.", parameters: { type: "object", properties: { provider: { type: "string", enum: ["vercel", "netlify"] }, production: { type: "boolean" } } } } },
  { type: "function", function: { name: "publish_project", description: "Publica el proyecto: commit sin secretos, push de la rama actual, migraciones Supabase si aplican y deploy. Siempre pide confirmación al usuario antes de ejecutarse.", parameters: { type: "object", properties: { commitMessage: { type: "string" }, deploy: { type: "boolean" }, supabasePush: { type: "boolean" }, skipPush: { type: "boolean" } } } } },
];

module.exports = {
  EXTERNAL_ACTION_TOOLS,
  EXTRA_DEFINITIONS,
  readPdf,
  screenshotPage,
  dockerPs,
  searchBrain,
  runExternalAction,
  externalActionPreview,
};
