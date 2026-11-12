"use strict";

/**
 * Fotografías reales de stock para los proyectos que el agente construye.
 *
 * Sin imágenes, toda landing sale "plano cuadrado": cajas CSS y texto
 * (veredicto de Luis sobre la landing de Taller Luis, 2026-11-10). El
 * agente no tenía NINGUNA forma de conseguir una foto. Este módulo busca
 * en bancos de imágenes con licencia clara y DESCARGA la elegida a
 * assets/ del proyecto: la web queda con archivos locales suyos, no con
 * enlaces calientes frágiles.
 *
 * [EDITCORE-V492-4] BANCOS AMPLIOS CON CAÍDA EN CASCADA (pendiente de
 * Luis, 2026-11-11): hasta la v4.9.1 solo existía Openverse y una
 * búsqueda real devolvió CERO resultados (hero de la M-6). Ahora la
 * búsqueda prueba, en orden: Openverse y Wikimedia Commons (sin llave)
 * y — SOLO si el usuario configuró las llaves en conexiones/env —
 * Pexels y Pixabay. Si una fuente devuelve cero resultados (o falla),
 * se prueba la siguiente ANTES de declarar que no hay fotos. La
 * consulta se traduce al inglés para los índices (los bancos rinden en
 * inglés) conservando la original como respaldo. La llamada devuelve
 * en UNA sola respuesta todas las candidatas con su licencia y autor.
 *
 * fetchStockPhoto nunca lanza: devuelve { ok:false, error } y el agente
 * decide si sigue sin foto. Las funciones de búsqueda/selección son
 * puras y el fetch es inyectable para pruebas.
 */

const fs = require("fs");
const path = require("path");

const SEARCH_ENDPOINT = "https://api.openverse.org/v1/images/";
const WIKIMEDIA_ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const PEXELS_ENDPOINT = "https://api.pexels.com/v1/search";
const PIXABAY_ENDPOINT = "https://pixabay.com/api/";
const EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};
const MIN_IMAGE_BYTES = 10240;
const USER_AGENT = "EditCoreAI/1.0 (buscador de fotos de stock)";

// ---------------------------------------------------------------------
// Traducción ES→EN de la consulta. Los índices de los bancos rinden en
// inglés; el usuario y el agente piden en español («barbero
// trabajando»). Diccionario palabra a palabra del vocabulario típico
// de fotos para webs de negocios + caída de palabras vacías; lo no
// traducido se conserva tal cual. Si la traducción no cambia nada, la
// consulta ya estaba en inglés y se usa una sola variante.
// ---------------------------------------------------------------------
const ES_EN_WORDS = {
  barbero: "barber", barberos: "barbers", barberia: "barbershop", peluquero: "hairdresser", peluqueria: "hair salon",
  trabajando: "working", trabajador: "worker", trabajadores: "workers", trabajo: "work",
  taller: "workshop", mecanico: "mechanic", mecanicos: "mechanics", mecanica: "mechanics",
  coche: "car", coches: "cars", carro: "car", carros: "cars", auto: "car", autos: "cars", motor: "engine", motores: "engines",
  reparacion: "repair", reparando: "repairing", repara: "repairing", herramienta: "tool", herramientas: "tools",
  cocina: "kitchen", cocinero: "chef", cocineros: "chefs", chef: "chef", restaurante: "restaurant", comida: "food",
  panaderia: "bakery", panadero: "baker", pan: "bread", cafe: "coffee", cafeteria: "cafe",
  tienda: "shop", negocio: "business", oficina: "office", equipo: "team", reunion: "meeting",
  hombre: "man", mujer: "woman", hombres: "men", mujeres: "women", personas: "people", gente: "people",
  nino: "child", ninos: "children", familia: "family", cliente: "customer", clientes: "customers",
  casa: "house", hogar: "home", jardin: "garden", flores: "flowers", flor: "flower",
  perro: "dog", perros: "dogs", gato: "cat", gatos: "cats",
  playa: "beach", montana: "mountain", bosque: "forest", ciudad: "city", campo: "countryside", naturaleza: "nature",
  manos: "hands", mano: "hand", sonrisa: "smile", sonriendo: "smiling", feliz: "happy", felices: "happy",
  computadora: "computer", ordenador: "computer", escritorio: "desk", portatil: "laptop",
  salon: "salon", cabello: "hair", pelo: "hair", corte: "cut", barba: "beard",
  dentista: "dentist", medico: "doctor", enfermera: "nurse", hospital: "hospital", clinica: "clinic",
  abogado: "lawyer", arquitecto: "architect", ingeniero: "engineer", constructor: "builder", construccion: "construction",
  agricultor: "farmer", granja: "farm", gimnasio: "gym", ejercicio: "exercise", deporte: "sport", yoga: "yoga",
  boda: "wedding", novia: "bride", novio: "groom", fiesta: "party", celebracion: "celebration",
  hotel: "hotel", viaje: "travel", viajero: "traveler", avion: "airplane", tren: "train",
  libro: "book", libros: "books", biblioteca: "library", escuela: "school", universidad: "university", estudiante: "student",
  musica: "music", musico: "musician", guitarra: "guitar", piano: "piano",
  interior: "interior", exterior: "exterior", moderno: "modern", clasico: "classic", antiguo: "vintage",
  joven: "young", jovenes: "young people", mayor: "elderly", mayores: "elderly",
  limpieza: "cleaning", limpiando: "cleaning", pintura: "painting", pintor: "painter", pintando: "painting",
  fontanero: "plumber", electricista: "electrician", carpintero: "carpenter", soldador: "welder", soldando: "welding",
};
const ES_STOPWORDS = new Set(["de", "del", "el", "la", "los", "las", "un", "una", "unos", "unas", "en", "con", "y", "o", "para", "por", "su", "sus", "al", "a"]);

function stripAccents(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function translateQuery(query) {
  const raw = String(query || "").trim();
  if (!raw) return raw;
  const words = raw.toLowerCase().split(/[^a-záéíóúñü]+/i).filter(Boolean);
  if (!words.length) return raw;
  let changed = false;
  const out = [];
  for (const word of words) {
    const key = stripAccents(word);
    if (ES_STOPWORDS.has(key)) { changed = true; continue; }
    if (ES_EN_WORDS[key]) { out.push(ES_EN_WORDS[key]); changed = true; continue; }
    out.push(word);
  }
  if (!changed || !out.length) return raw;
  return out.join(" ");
}

function queryVariants(query) {
  const original = String(query || "").trim();
  const translated = translateQuery(original);
  return translated && translated !== original ? [translated, original] : [original];
}

// ---------------------------------------------------------------------
// Fuentes. Cada buscador devuelve candidatas normalizadas:
// { url, title, creator, license, landing, provider }.
// ---------------------------------------------------------------------

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
      provider: "openverse",
    }));
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function buildWikimediaUrl(query, pageSize = 8) {
  const url = new URL(WIKIMEDIA_ENDPOINT);
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${String(query || "").trim()} filetype:bitmap`);
  url.searchParams.set("gsrlimit", String(Math.max(1, Math.min(20, pageSize))));
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|extmetadata");
  url.searchParams.set("iiurlwidth", "1600");
  return url.toString();
}

function pickWikimediaCandidates(payload, limit = 8) {
  const pages = payload && payload.query && typeof payload.query.pages === "object" ? Object.values(payload.query.pages) : [];
  const out = [];
  for (const page of pages) {
    const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
    const url = String(info?.thumburl || info?.url || "");
    if (!/^https?:\/\//i.test(url)) continue;
    const meta = info?.extmetadata || {};
    out.push({
      url,
      title: stripHtml(page.title || "").replace(/^File:/i, "").slice(0, 120),
      creator: stripHtml(meta.Artist?.value || "").slice(0, 80),
      license: stripHtml(meta.LicenseShortName?.value || "").toUpperCase(),
      landing: String(info?.descriptionurl || ""),
      provider: "wikimedia",
    });
    if (out.length >= limit) break;
  }
  return out;
}

function buildPexelsUrl(query, pageSize = 8) {
  const url = new URL(PEXELS_ENDPOINT);
  url.searchParams.set("query", String(query || "").trim());
  url.searchParams.set("per_page", String(Math.max(1, Math.min(20, pageSize))));
  return url.toString();
}

function pickPexelsCandidates(payload, limit = 8) {
  const photos = payload && Array.isArray(payload.photos) ? payload.photos : [];
  return photos
    .map((photo) => ({
      url: String(photo?.src?.large || photo?.src?.original || ""),
      title: String(photo?.alt || "").slice(0, 120),
      creator: String(photo?.photographer || "").slice(0, 80),
      license: "PEXELS LICENSE",
      landing: String(photo?.url || ""),
      provider: "pexels",
    }))
    .filter((c) => /^https?:\/\//i.test(c.url))
    .slice(0, limit);
}

function buildPixabayUrl(query, apiKey, pageSize = 8) {
  const url = new URL(PIXABAY_ENDPOINT);
  url.searchParams.set("key", String(apiKey || ""));
  url.searchParams.set("q", String(query || "").trim());
  url.searchParams.set("image_type", "photo");
  url.searchParams.set("per_page", String(Math.max(3, Math.min(20, pageSize))));
  url.searchParams.set("safesearch", "true");
  return url.toString();
}

function pickPixabayCandidates(payload, limit = 8) {
  const hits = payload && Array.isArray(payload.hits) ? payload.hits : [];
  return hits
    .map((hit) => ({
      url: String(hit?.largeImageURL || hit?.webformatURL || ""),
      title: String(hit?.tags || "").slice(0, 120),
      creator: String(hit?.user || "").slice(0, 80),
      license: "PIXABAY CONTENT LICENSE",
      landing: String(hit?.pageURL || ""),
      provider: "pixabay",
    }))
    .filter((c) => /^https?:\/\//i.test(c.url))
    .slice(0, limit);
}

// Llaves de las fuentes con llave: llegan por opts (la herramienta las
// lee del mecanismo de conexiones) o por variables de entorno. Sin
// llave, la fuente NO entra en la cascada (se salta en silencio).
function resolveApiKeys(opts = {}) {
  const fromOpts = opts.apiKeys && typeof opts.apiKeys === "object" ? opts.apiKeys : {};
  return {
    pexels: String(opts.pexelsApiKey || fromOpts.pexels || process.env.PEXELS_API_KEY || "").trim(),
    pixabay: String(opts.pixabayApiKey || fromOpts.pixabay || process.env.PIXABAY_API_KEY || "").trim(),
  };
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

async function fetchWithTimeout(fetcher, url, timeoutMs, headers, turnSignal = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // [EDITCORE-INTEGRAL-B6] La señal del TURNO se combina con el
  // timeout propio: si el usuario detiene, la descarga aborta ya,
  // no cuando venza su temporizador (~115 s en la cadena completa).
  const onTurnAbort = () => { try { controller.abort(); } catch { /* ignore */ } };
  if (turnSignal) {
    if (turnSignal.aborted) controller.abort();
    else turnSignal.addEventListener("abort", onTurnAbort, { once: true });
  }
  try {
    return await fetcher(url, { signal: controller.signal, headers: headers || {} });
  } finally {
    clearTimeout(timer);
    if (turnSignal) { try { turnSignal.removeEventListener("abort", onTurnAbort); } catch { /* ignore */ } }
  }
}

// Cascada de búsqueda: fuentes en orden, y dentro de cada fuente la
// consulta traducida primero y la original como respaldo. Devuelve la
// primera fuente con candidatas; si ninguna da nada, candidates vacío
// y `tried` nombra lo consultado (para el mensaje honesto al modelo).
async function searchStockPhotos(opts = {}) {
  const query = String(opts.query || "").trim();
  const fetcher = typeof opts.fetcher === "function" ? opts.fetcher : globalThis.fetch;
  const keys = resolveApiKeys(opts);
  const turnSignal = opts.signal || null;
  const timeoutMs = Number(opts.timeoutMs || 15000);
  const baseHeaders = { "User-Agent": USER_AGENT, Accept: "application/json" };
  const fetchJson = async (url, hdrs) => {
    const res = await fetchWithTimeout(fetcher, url, timeoutMs, hdrs, turnSignal);
    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : "sin respuesta"}`);
    return res.json();
  };
  const sources = [
    { id: "openverse", run: async (q) => pickCandidates(await fetchJson(buildSearchUrl(q), baseHeaders)) },
    { id: "wikimedia", run: async (q) => pickWikimediaCandidates(await fetchJson(buildWikimediaUrl(q), baseHeaders)) },
  ];
  if (keys.pexels) {
    sources.push({ id: "pexels", run: async (q) => pickPexelsCandidates(await fetchJson(buildPexelsUrl(q), { ...baseHeaders, Authorization: keys.pexels })) });
  }
  if (keys.pixabay) {
    sources.push({ id: "pixabay", run: async (q) => pickPixabayCandidates(await fetchJson(buildPixabayUrl(q, keys.pixabay), baseHeaders)) });
  }
  const variants = queryVariants(query);
  const tried = [];
  for (const source of sources) {
    for (const variant of variants) {
      if (turnSignal?.aborted) return { candidates: [], provider: "", queryUsed: "", tried, aborted: true };
      tried.push(source.id);
      try {
        const candidates = await source.run(variant);
        if (Array.isArray(candidates) && candidates.length) {
          return { candidates, provider: source.id, queryUsed: variant, tried };
        }
      } catch { /* fuente caída o sin respuesta: se prueba la siguiente */ }
    }
  }
  return { candidates: [], provider: "", queryUsed: "", tried };
}

async function fetchStockPhoto(opts = {}) {
  const query = String(opts.query || "").trim();
  if (!query) return { ok: false, error: "Falta el término de búsqueda (query)." };
  const projectRoot = path.resolve(opts.projectRoot || process.cwd());
  const fetcher = typeof opts.fetcher === "function" ? opts.fetcher : globalThis.fetch;
  if (typeof fetcher !== "function") return { ok: false, error: "Este entorno no tiene fetch disponible." };
  const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
  // [EDITCORE-INTEGRAL-B6] Señal del turno (opts.signal): si el turno
  // fue detenido, NO se escribe el archivo — antes la foto aterrizaba
  // en el proyecto caiga el turno o no (mutación tras el stop).
  const turnSignal = opts.signal || null;
  const abortedResult = { ok: false, aborted: true, error: "Foto cancelada: el turno fue detenido por el usuario (Detener). No se escribió ningún archivo." };
  if (turnSignal?.aborted) return abortedResult;

  // [EDITCORE-V492-4] Búsqueda MULTIFUENTE en cascada (Openverse →
  // Wikimedia → Pexels/Pixabay si hay llave), con la consulta traducida
  // al inglés y la original como respaldo. Una fuente en cero ya no
  // cierra la búsqueda.
  let found;
  try {
    found = await searchStockPhotos({ ...opts, query, fetcher, signal: turnSignal });
  } catch (error) {
    if (turnSignal?.aborted) return abortedResult;
    return { ok: false, error: `No se pudo buscar fotos: ${String(error?.message || error).slice(0, 200)}` };
  }
  if (found.aborted) return abortedResult;
  const candidates = found.candidates || [];
  if (!candidates.length) {
    const triedNames = [...new Set(found.tried || [])].join(", ") || "openverse";
    return { ok: false, error: `Sin resultados de fotos para "${query}" en las fuentes consultadas (${triedNames}). Prueba con otra búsqueda, más concreta y en inglés.` };
  }

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
      if (turnSignal?.aborted) return abortedResult;
      const res = await fetchWithTimeout(fetcher, candidate.url, Number(opts.downloadTimeoutMs || 20000), { "User-Agent": headers["User-Agent"] }, turnSignal);
      if (!res || !res.ok) { lastError = `HTTP ${res ? res.status : "?"}`; continue; }
      const type = String(res.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
      const ext = EXT_BY_TYPE[type];
      if (!ext) { lastError = `Tipo no soportado: ${type || "desconocido"}`; continue; }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < MIN_IMAGE_BYTES) { lastError = "Imagen demasiado pequeña"; continue; }
      // [EDITCORE-INTEGRAL-B6] Chequeo JUSTO antes de escribir: si el
      // stop llegó durante la descarga, el archivo no aterriza.
      if (turnSignal?.aborted) return abortedResult;
      fs.mkdirSync(assetsDir, { recursive: true });
      let fileName = `${base}${ext}`;
      for (let n = 2; fs.existsSync(path.join(assetsDir, fileName)); n++) fileName = `${base}-${n}${ext}`;
      // [EDITCORE-INTEGRAL-B9] Lock del archivo destino ANTES de
      // escribir (costura inyectada por tools.execute con la
      // identidad de la corrida): si otra corrida lo retiene, la
      // foto no se escribe y el resultado explica el lock.
      let lockHandle = null;
      if (typeof opts.acquireLock === "function") {
        lockHandle = opts.acquireLock(`${folderName}/${fileName}`);
        if (!lockHandle || lockHandle.ok === false) {
          return { ok: false, locked: true, error: `Foto no escrita: ${String(lockHandle?.error || "el archivo destino está bloqueado por otra corrida")}` };
        }
      }
      try {
        fs.writeFileSync(path.join(assetsDir, fileName), buffer);
      } finally {
        try { lockHandle?.release?.(); } catch { /* liberar no tumba el resultado */ }
      }
      return {
        ok: true,
        path: `${folderName}/${fileName}`,
        bytes: buffer.length,
        source: candidate.url,
        provider: candidate.provider || found.provider || "",
        credit: { creator: candidate.creator, license: candidate.license, landing: candidate.landing },
        // [EDITCORE-V492-4] TODAS las candidatas de la fuente ganadora
        // en ESTA misma llamada (licencia y autor incluidos): el
        // modelo puede elegir otra sin pagar otra búsqueda.
        candidates: candidates.map((c) => ({ url: c.url, title: c.title, creator: c.creator, license: c.license, landing: c.landing, provider: c.provider })),
        queryUsed: found.queryUsed || query,
      };
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 200);
    }
  }
  return { ok: false, error: `Ninguna foto descargable para "${query}" (${lastError || "sin detalle"}).` };
}

module.exports = {
  buildSearchUrl, pickCandidates, slugify, fetchStockPhoto, SEARCH_ENDPOINT,
  // [EDITCORE-V492-4] Multifunción: cascada, traducción y demás fuentes.
  translateQuery, queryVariants, searchStockPhotos, resolveApiKeys,
  buildWikimediaUrl, pickWikimediaCandidates, buildPexelsUrl, pickPexelsCandidates, buildPixabayUrl, pickPixabayCandidates,
};
