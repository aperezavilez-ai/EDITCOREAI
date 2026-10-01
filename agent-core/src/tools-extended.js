"use strict";

/**
 * tools-extended.js — Herramientas avanzadas para EDITCOREAI v0.4.0
 * Internet + Git + Acceso externo + Skills + Shell
 * v0.4.1 — web_search mejorado con 3 fuentes de fallback
 */

const axios = require("axios");
const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

// ============================================================
// CONFIGURACIÓN: RUTAS AUTORIZADAS
// ============================================================
let config = { allowedDirectories: [], maxFileSizeMB: 10 };
try {
  config = require("../config.json");
} catch {
  config = {
    allowedDirectories: [
      "D:\\PROGRAMAS IA",
      "D:\\RESPALDO DATOS\\PROGRAMAS IA",
      "C:\\Users\\aperez\\Documents",
    ],
    maxFileSizeMB: 10,
  };
}

function isPathAllowed(targetPath) {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  return config.allowedDirectories.some((dir) => {
    try {
      return resolved.startsWith(path.resolve(dir));
    } catch {
      return false;
    }
  });
}

// ============================================================
// 1. INTERNET — Búsqueda multi-fuente con fallbacks
// ============================================================
function stripHtml(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function ddgHtmlSearch(query, maxResults) {
  const results = [];
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
      },
    });
    const html = String(response.data || "");
    // Parseo tolerante de bloques de resultado
    const blockRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="[^"]*result__a|<\/div>\s*<\/div>|$)/g;
    let match;
    while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
      let link = match[1] || "";
      // DDG envuelve los links reales: //duckduckgo.com/l/?uddg=<encoded>&rut=...
      const uddg = link.match(/uddg=([^&]+)/);
      if (uddg) link = decodeURIComponent(uddg[1]);
      if (link.startsWith("//")) link = "https:" + link;
      const title = stripHtml(match[2]);
      const rest = match[3] || "";
      const snippetMatch = rest.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";
      if (link && title && !link.includes("duckduckgo.com/y.js")) {
        results.push({ title, url: link, snippet });
      }
    }
  } catch {
    // continuar con el siguiente fallback
  }
  return results;
}

async function ddgInstantSearch(query, maxResults) {
  const results = [];
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const response = await axios.get(url, { timeout: 10000 });
    if (response.data?.AbstractText) {
      results.push({
        title: response.data.Heading || "Resultado",
        url: response.data.AbstractURL || "",
        snippet: response.data.AbstractText,
      });
    }
    if (Array.isArray(response.data?.RelatedTopics)) {
      for (const t of response.data.RelatedTopics) {
        if (results.length >= maxResults) break;
        if (t.Text && t.FirstURL) {
          results.push({ title: t.Text.slice(0, 120), url: t.FirstURL, snippet: t.Text });
        }
      }
    }
  } catch {
    // continuar
  }
  return results;
}

async function wikipediaSearch(query, maxResults) {
  const results = [];
  try {
    // Buscar primero títulos relacionados
    const searchUrl = `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}`;
    const searchRes = await axios.get(searchUrl, { timeout: 10000 });
    const hits = searchRes.data?.query?.search || [];
    for (const hit of hits.slice(0, maxResults)) {
      if (!hit.title) continue;
      try {
        const summaryUrl = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`;
        const summaryRes = await axios.get(summaryUrl, { timeout: 8000 });
        results.push({
          title: summaryRes.data.title || hit.title,
          url: summaryRes.data.content_urls?.desktop?.page || `https://es.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
          snippet: summaryRes.data.extract || hit.snippet || "",
        });
      } catch {
        results.push({
          title: hit.title,
          url: `https://es.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
          snippet: stripHtml(hit.snippet || ""),
        });
      }
    }
  } catch {
    // continuar
  }
  return results;
}

async function web_search({ query, maxResults = 5 }) {
  try {
    if (!query) throw new Error("query es requerido");
    const limit = Math.max(1, Math.min(10, Number(maxResults) || 5));

    let results = [];
    let source = "";

    // Fuente 1: DuckDuckGo HTML (resultados generales)
    results = await ddgHtmlSearch(query, limit);
    if (results.length) source = "duckduckgo-html";

    // Fuente 2: DuckDuckGo Instant Answer API
    if (!results.length) {
      results = await ddgInstantSearch(query, limit);
      if (results.length) source = "duckduckgo-instant";
    }

    // Fuente 3: Wikipedia (fallback final)
    if (!results.length) {
      results = await wikipediaSearch(query, limit);
      if (results.length) source = "wikipedia";
    }

    return {
      ok: true,
      query,
      source: source || "none",
      count: results.length,
      results,
      summary: results.length
        ? results
            .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.snippet}\n    ${r.url}`)
            .join("\n\n")
        : "No se encontraron resultados. Intenta reformular la busqueda con palabras clave distintas o usa web_fetch con una URL directa.",
    };
  } catch (error) {
    return { ok: false, error: `Error en web_search: ${error.message}` };
  }
}

async function web_fetch({ url, maxChars = 12000 }) {
  try {
    if (!url) throw new Error("url es requerido");
    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      maxContentLength: 5 * 1024 * 1024,
    });
    let text = typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data, null, 2);
    text = stripHtml(text);
    const truncated = text.length > maxChars;
    return {
      ok: true,
      url,
      totalChars: text.length,
      truncated,
      content: truncated ? text.slice(0, maxChars) + "\n\n[...TRUNCADO...]" : text,
    };
  } catch (error) {
    return { ok: false, error: `Error en web_fetch: ${error.message}` };
  }
}

// ============================================================
// 2. GIT AVANZADO
// ============================================================
let simpleGit = null;
try {
  simpleGit = require("simple-git");
} catch {
  simpleGit = null;
}

async function git_clone({ url, targetDir, depth = 1 }) {
  try {
    if (!simpleGit) throw new Error("simple-git no esta instalado. Ejecuta: npm install simple-git");
    if (!url || !targetDir) throw new Error("url y targetDir son requeridos");
    if (!isPathAllowed(targetDir)) throw new Error(`Ruta no autorizada: ${targetDir}`);
    const git = simpleGit();
    const options = depth ? ["--depth", String(depth)] : [];
    await git.clone(url, targetDir, options);
    return { ok: true, url, targetDir, message: `Repositorio clonado en ${targetDir}` };
  } catch (error) {
    return { ok: false, error: `Error en git_clone: ${error.message}` };
  }
}

async function git_log({ repoPath, maxCount = 15 }) {
  try {
    if (!simpleGit) throw new Error("simple-git no esta instalado");
    const git = simpleGit(repoPath);
    const log = await git.log({ maxCount });
    return {
      ok: true,
      repoPath,
      commits: log.all.map((c) => ({
        hash: c.hash.slice(0, 7),
        author: c.author_name,
        date: c.date,
        message: c.message,
      })),
    };
  } catch (error) {
    return { ok: false, error: `Error en git_log: ${error.message}` };
  }
}

async function git_status({ repoPath }) {
  try {
    if (!simpleGit) throw new Error("simple-git no esta instalado");
    const git = simpleGit(repoPath);
    const status = await git.status();
    return {
      ok: true,
      repoPath,
      branch: status.current,
      modified: status.modified,
      not_added: status.not_added,
      created: status.created,
      deleted: status.deleted,
      staged: status.staged,
      clean: status.isClean(),
    };
  } catch (error) {
    return { ok: false, error: `Error en git_status: ${error.message}` };
  }
}

async function git_diff({ repoPath, staged = false }) {
  try {
    if (!simpleGit) throw new Error("simple-git no esta instalado");
    const git = simpleGit(repoPath);
    const diff = staged ? await git.diff(["--staged"]) : await git.diff();
    return { ok: true, repoPath, staged, diff: diff || "(sin cambios)" };
  } catch (error) {
    return { ok: false, error: `Error en git_diff: ${error.message}` };
  }
}

// ============================================================
// 3. ACCESO EXTERNO (archivos fuera del proyecto)
// ============================================================
async function read_external_file({ path: filePath }) {
  try {
    if (!filePath) throw new Error("path es requerido");
    if (!isPathAllowed(filePath)) {
      return {
        ok: false,
        error: `Acceso denegado: ${filePath} no esta en rutas autorizadas. Rutas permitidas: ${config.allowedDirectories.join(", ")}`,
      };
    }
    const stats = await fs.stat(filePath);
    const maxBytes = (config.maxFileSizeMB || 10) * 1024 * 1024;
    if (stats.size > maxBytes) {
      return {
        ok: false,
        error: `Archivo demasiado grande (${(stats.size / 1024 / 1024).toFixed(2)} MB). Maximo: ${config.maxFileSizeMB} MB`,
      };
    }
    const content = await fs.readFile(filePath, "utf-8");
    return { ok: true, path: filePath, size: stats.size, content };
  } catch (error) {
    return { ok: false, error: `Error en read_external_file: ${error.message}` };
  }
}

async function write_external_file({ path: filePath, content }) {
  try {
    if (!filePath) throw new Error("path es requerido");
    if (!isPathAllowed(filePath)) {
      return { ok: false, error: `Acceso denegado: ${filePath} no esta en rutas autorizadas.` };
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content || "", "utf-8");
    return { ok: true, path: filePath, message: `Escrito ${content?.length || 0} caracteres` };
  } catch (error) {
    return { ok: false, error: `Error en write_external_file: ${error.message}` };
  }
}

async function list_external_directory({ path: dirPath }) {
  try {
    if (!dirPath) throw new Error("path es requerido");
    if (!isPathAllowed(dirPath)) {
      return { ok: false, error: `Acceso denegado: ${dirPath} no esta en rutas autorizadas.` };
    }
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return {
      ok: true,
      path: dirPath,
      entries: entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      })),
    };
  } catch (error) {
    return { ok: false, error: `Error en list_external_directory: ${error.message}` };
  }
}

// ============================================================
// 4. SKILLS
// ============================================================
const SKILLS_DIR = path.resolve(__dirname, "../../skills");

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function install_skill({ repoUrl, skillName }) {
  try {
    if (!simpleGit) throw new Error("simple-git no esta instalado");
    if (!repoUrl || !skillName) throw new Error("repoUrl y skillName son requeridos");
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    const targetDir = path.join(SKILLS_DIR, skillName);
    const git = simpleGit();
    await git.clone(repoUrl, targetDir, ["--depth", "1"]);
    const hasManifest = await fileExists(path.join(targetDir, "manifest.json"));
    const hasIndex = await fileExists(path.join(targetDir, "index.js"));
    return {
      ok: true,
      skillName,
      repoUrl,
      targetDir,
      hasManifest,
      hasIndex,
      message: `Skill "${skillName}" instalada en ${targetDir}`,
    };
  } catch (error) {
    return { ok: false, error: `Error en install_skill: ${error.message}` };
  }
}

async function list_skills() {
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skills = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        const skillPath = path.join(SKILLS_DIR, e.name);
        const hasManifest = await fileExists(path.join(skillPath, "manifest.json"));
        let manifest = null;
        if (hasManifest) {
          try {
            manifest = JSON.parse(await fs.readFile(path.join(skillPath, "manifest.json"), "utf-8"));
          } catch {}
        }
        skills.push({
          name: e.name,
          path: skillPath,
          hasManifest,
          description: manifest?.description || null,
          version: manifest?.version || null,
        });
      }
    }
    return { ok: true, skillsDir: SKILLS_DIR, count: skills.length, skills };
  } catch (error) {
    return { ok: false, error: `Error en list_skills: ${error.message}` };
  }
}

// ============================================================
// 5. SHELL AVANZADO
// ============================================================
async function run_shell({ command, cwd }) {
  try {
    if (!command) throw new Error("command es requerido");
    const workDir = cwd || process.cwd();
    if (cwd && !isPathAllowed(cwd)) {
      return { ok: false, error: `cwd no autorizado: ${cwd}` };
    }
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      shell: "powershell.exe",
    });
    return {
      ok: true,
      command,
      cwd: workDir,
      stdout: stdout.slice(0, 8000),
      stderr: stderr.slice(0, 2000),
      truncated: stdout.length > 8000,
    };
  } catch (error) {
    return {
      ok: false,
      command,
      error: error.message,
      stdout: (error.stdout || "").slice(0, 4000),
      stderr: (error.stderr || "").slice(0, 4000),
    };
  }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  web_search,
  web_fetch,
  git_clone,
  git_log,
  git_status,
  git_diff,
  read_external_file,
  write_external_file,
  list_external_directory,
  install_skill,
  list_skills,
  run_shell,
  isPathAllowed,
  SKILLS_DIR,
};