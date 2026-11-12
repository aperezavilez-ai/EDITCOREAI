"use strict";

// [EDITCORE-V492-4] BANCOS DE IMÁGENES AMPLIOS (pendiente de Luis,
// 2026-11-11): fetch_stock_photo solo usaba Openverse y una búsqueda
// real devolvió CERO resultados (hero de la M-6 en la v4.9.0). Ahora:
// cascada Openverse → Wikimedia Commons (sin llave) → Pexels/Pixabay
// (SOLO con llave configurada), traducción de la consulta al inglés
// para los índices y candidatas con licencia/autor en UNA llamada.
//
// TODO con fetch simulado (sin red real en la suite): las fuentes
// nuevas quedan verificadas solo con mock; su prueba en vivo con red
// (y llaves de Luis para Pexels/Pixabay) queda declarada pendiente.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const stock = require("../editcore-chat-kernel/stock-photos");

const JPEG = Buffer.alloc(20480, 9);
const jpegDownload = async () => ({
  ok: true, status: 200,
  headers: { get: () => "image/jpeg" },
  arrayBuffer: async () => JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.byteLength),
});
const jsonOk = (payload) => async () => ({
  ok: true, status: 200,
  headers: { get: () => "application/json" },
  json: async () => payload,
});

const WIKIMEDIA_PAYLOAD = {
  query: {
    pages: {
      101: {
        title: "File:Barber working.jpg",
        imageinfo: [{
          url: "https://upload.wikimedia.org/barber-full.jpg",
          thumburl: "https://upload.wikimedia.org/barber-1600.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Barber_working.jpg",
          extmetadata: {
            LicenseShortName: { value: "CC BY-SA 4.0" },
            Artist: { value: "<a href=\"https://example.com\">Foto Commons</a>" },
          },
        }],
      },
      102: {
        title: "File:Barbershop interior.jpg",
        imageinfo: [{
          url: "https://upload.wikimedia.org/shop-full.jpg",
          thumburl: "https://upload.wikimedia.org/shop-1600.jpg",
          descriptionurl: "https://commons.wikimedia.org/wiki/File:Barbershop_interior.jpg",
          extmetadata: {
            LicenseShortName: { value: "CC0" },
            Artist: { value: "Interiorista" },
          },
        }],
      },
    },
  },
};

test("V492-4a cero resultados en Openverse → cae a Wikimedia y devuelve fotos con licencia y autor", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-foto-"));
  const seen = [];
  const fetcher = async (url) => {
    seen.push(String(url));
    if (String(url).includes("api.openverse.org")) return jsonOk({ results: [] })();
    if (String(url).includes("commons.wikimedia.org")) return jsonOk(WIKIMEDIA_PAYLOAD)();
    return jpegDownload();
  };
  const res = await stock.fetchStockPhoto({ query: "barber working", name: "hero-barberia", projectRoot: tmp, fetcher });
  assert.equal(res.ok, true, "la búsqueda NO se declaró vacía: cayó a la segunda fuente");
  assert.equal(res.provider, "wikimedia");
  assert.equal(res.path, "assets/hero-barberia.jpg");
  assert.ok(fs.existsSync(path.join(tmp, "assets", "hero-barberia.jpg")), "la foto quedó en la carpeta de assets del proyecto");
  assert.equal(res.credit.creator, "Foto Commons", "el autor llega limpio (sin HTML)");
  assert.equal(res.credit.license, "CC BY-SA 4.0");
  assert.ok(Array.isArray(res.candidates) && res.candidates.length === 2, "las candidatas vienen en la MISMA llamada");
  assert.ok(res.candidates.every((c) => c.license && c.provider === "wikimedia"), "cada candidata trae licencia y fuente");
  assert.ok(seen.some((u) => u.includes("api.openverse.org")) && seen.some((u) => u.includes("commons.wikimedia.org")), "se consultaron ambas fuentes en orden");
});

test("V492-4b sin llaves configuradas NO se llama a Pexels ni a Pixabay (se saltan en silencio)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-foto-"));
  delete process.env.PEXELS_API_KEY;
  delete process.env.PIXABAY_API_KEY;
  const seen = [];
  const fetcher = async (url) => {
    seen.push(String(url));
    return jsonOk({ results: [] })();
  };
  const res = await stock.fetchStockPhoto({ query: "zzzz sin resultados", projectRoot: tmp, fetcher });
  assert.equal(res.ok, false, "sin resultados en las fuentes sin llave, ok:false honesto");
  assert.ok(!seen.some((u) => u.includes("pexels.com")), "Pexels jamás fue llamado sin llave");
  assert.ok(!seen.some((u) => u.includes("pixabay.com")), "Pixabay jamás fue llamado sin llave");
  assert.match(res.error, /openverse/, "el error nombra las fuentes consultadas");
});

test("V492-4c con llave de Pexels configurada, la cascada llega a Pexels con su Authorization y devuelve sus candidatas", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-foto-"));
  const seen = [];
  let pexelsAuth = "";
  const fetcher = async (url, opts = {}) => {
    seen.push(String(url));
    if (String(url).includes("api.openverse.org")) return jsonOk({ results: [] })();
    if (String(url).includes("commons.wikimedia.org")) return jsonOk({ query: { pages: {} } })();
    if (String(url).includes("api.pexels.com")) {
      pexelsAuth = String(opts.headers?.Authorization || "");
      return jsonOk({
        photos: [{
          id: 1,
          alt: "Barber cutting hair",
          photographer: "Pexels Autor",
          url: "https://www.pexels.com/photo/1",
          src: { large: "https://images.pexels.com/1-large.jpg", original: "https://images.pexels.com/1.jpg" },
        }],
      })();
    }
    return jpegDownload();
  };
  const res = await stock.fetchStockPhoto({
    query: "barber working", name: "hero", projectRoot: tmp, fetcher,
    apiKeys: { pexels: "llave-de-prueba" },
  });
  assert.equal(res.ok, true);
  assert.equal(res.provider, "pexels");
  assert.equal(pexelsAuth, "llave-de-prueba", "la llave viajó en el header Authorization");
  assert.equal(res.credit.creator, "Pexels Autor");
  assert.match(res.credit.license, /PEXELS/);
  assert.ok(seen.some((u) => u.includes("api.pexels.com")), "Pexels fue consultado tras agotar las fuentes sin llave");
});

test("V492-4d la consulta sale TRADUCIDA al inglés para los índices («barbero trabajando» → «barber working»)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v492-foto-"));
  const searchUrls = [];
  const fetcher = async (url) => {
    const u = String(url);
    if (u.includes("api.openverse.org") || u.includes("commons.wikimedia.org")) {
      searchUrls.push(u);
      return jsonOk({ results: [] })();
    }
    return jpegDownload();
  };
  await stock.fetchStockPhoto({ query: "barbero trabajando", projectRoot: tmp, fetcher });
  assert.ok(searchUrls.length >= 1, "hubo búsquedas");
  const first = decodeURIComponent(searchUrls[0].replace(/\+/g, " "));
  assert.ok(first.includes("barber working"), `la primera búsqueda ya va en inglés: ${first}`);
  assert.equal(stock.translateQuery("barbero trabajando"), "barber working");
  assert.deepEqual(stock.queryVariants("barbero trabajando"), ["barber working", "barbero trabajando"], "la original queda como respaldo");
  assert.deepEqual(stock.queryVariants("barber working"), ["barber working"], "una consulta ya en inglés no se duplica");
});

test("V492-4e searchStockPhotos: la cascada se detiene en la primera fuente con resultados", async () => {
  const seen = [];
  const fetcher = async (url) => {
    seen.push(String(url));
    if (String(url).includes("api.openverse.org")) {
      return jsonOk({ results: [{ url: "https://img.example/1.jpg", title: "t", creator: "A", license: "cc0", foreign_landing_url: "" }] })();
    }
    throw new Error("no debería llegar aquí");
  };
  const found = await stock.searchStockPhotos({ query: "mechanic", fetcher });
  assert.equal(found.provider, "openverse");
  assert.equal(found.candidates.length, 1);
  assert.ok(!seen.some((u) => u.includes("wikimedia")), "con resultados en la primera fuente no se consulta la segunda");
});
