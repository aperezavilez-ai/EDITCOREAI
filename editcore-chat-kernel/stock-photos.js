"use strict";

/**
 * Fotografías reales de stock para los proyectos que el agente construye.
 *
 * Sin imágenes, toda landing sale "plano cuadrado": cajas CSS y texto
 * (veredicto de Luis sobre la landing de Taller Luis, 2026-11-10). El
 * agente no tenía NINGUNA forma de conseguir una foto. Este módulo busca
 * en Openverse (índice de imágenes con licencia abierta; su API pública
 * no exige llave) y DESCARGA la elegida a assets/ del proyecto: la web
 * queda con archivos locales suyos, no con enlaces calientes frágiles.
 *
 * fetchStockPhoto nunca lanza: devuelve { ok:false, error } y el agente
 * decide si sigue sin foto. Las funciones de búsqueda/selección son
 * puras y el fetch es inyectable para pruebas.
 */

const fs = require("fs");
const path = require("path");

const SEARCH_ENDPOINT = "https://api.openverse.org/v1/images/";
const EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};
const MIN_IMAGE_BYTES = 10240;

function buildSearchUrl(query, pageSize = 8) {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", String(query || "").trim());
  url.searchParams.set("page_size", String(Math.max(1, Math.min(20, pageSize))));
  url.searchParams.set("license_type", "all");
  url.searchParams.set("size", "large");
  return url.toString();
}

function pickCandidates(payload, limit = 8) {
  const results = payload && Array.isArray(payload.results) ? payload.results : [];
  return results
    .filter((item) => item && typeof item.url === "string" && /^https?:\/\//i.test(item.url))
    .slice(0, limit)
    .map((item) => ({
      url: item.url,
      title: String(item.title || "").slice(0, 120),
      creator: String(item.creator || "").slice(0, 80),
      license: String(item.license || "").toUpperCase(),
      landing: String(item.foreign_landing_url || ""),
    }));
}

function slugify(text, fallback = "foto") {
  const slug = String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

async function fetchWithTimeout(fetcher, url, timeoutMs, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { signal: controller.signal, headers: headers || {} });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStockPhoto(opts = {}) {
  const query = String(opts.query || "").trim();
  if (!query) return { ok: false, error: "Falta el término de búsqueda (query)." };
  const projectRoot = path.resolve(opts.projectRoot || process.cwd());
  const fetcher = typeof opts.fetcher === "function" ? opts.fetcher : globalThis.fetch;
  if (typeof fetcher !== "function") return { ok: false, error: "Este entorno no tiene fetch disponible." };
  const headers = { "User-Agent": "EditCoreAI/1.0 (buscador de fotos de stock)", Accept: "application/json" };

  let payload;
  try {
    const res = await fetchWithTimeout(fetcher, buildSearchUrl(query), Number(opts.timeoutMs || 15000), headers);
    if (!res || !res.ok) return { ok: false, error: `El buscador de fotos respondió ${res ? res.status : "sin respuesta"}.` };
    payload = await res.json();
  } catch (error) {
    return { ok: false, error: `No se pudo buscar fotos: ${String(error?.message || error).slice(0, 200)}` };
  }

  const candidates = pickCandidates(payload);
  if (!candidates.length) return { ok: false, error: `Sin resultados de fotos para "${query}".` };

  // Carpeta destino dentro del proyecto: "assets" por defecto (webs
  // sueltas); en proyectos Vite la foto debe ir a "public/assets" para
  // que se sirva. Se sanea por segmentos: jamás sale del proyecto.
  const folderName = String(opts.folder || "assets").replace(/\\/g, "/")
    .split("/").filter((seg) => seg && seg !== "." && seg !== "..").join("/") || "assets";
  const assetsDir = path.join(projectRoot, ...folderName.split("/"));
  const base = slugify(opts.name || query);
  let lastError = "";
  for (const candidate of candidates.slice(0, 5)) {
    try {
      const res = await fetchWithTimeout(fetcher, candidate.url, Number(opts.downloadTimeoutMs || 20000), { "User-Agent": headers["User-Agent"] });
      if (!res || !res.ok) { lastError = `HTTP ${res ? res.status : "?"}`; continue; }
      const type = String(res.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = EXT_BY_TYPE[type];
      if (!ext) { lastError = `Tipo no soportado: ${type || "desconocido"}`; continue; }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < MIN_IMAGE_BYTES) { lastError = "Imagen demasiado pequeña"; continue; }
      fs.mkdirSync(assetsDir, { recursive: true });
      let fileName = `${base}${ext}`;
      for (let n = 2; fs.existsSync(path.join(assetsDir, fileName)); n++) fileName = `${base}-${n}${ext}`;
      fs.writeFileSync(path.join(assetsDir, fileName), buffer);
      return {
        ok: true,
        path: `${folderName}/${fileName}`,
        bytes: buffer.length,
        source: candidate.url,
        credit: { creator: candidate.creator, license: candidate.license, landing: candidate.landing },
      };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 200);
    }
  }
  return { ok: false, error: `Ninguna foto descargable para "${query}" (${lastError || "sin detalle"}).` };
}

module.exports = { buildSearchUrl, pickCandidates, slugify, fetchStockPhoto, SEARCH_ENDPOINT };
