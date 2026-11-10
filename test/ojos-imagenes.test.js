"use strict";

// Ojos e imágenes (v4.6.9). La landing de Taller Luis salió ciega y sin
// fotos: capture_preview_screenshot moría con "Cannot find module
// 'playwright'" (puppeteer/playwright no viajan en el instalador) y el
// agente no tenía ninguna herramienta para conseguir una fotografía.
// 1) vision-inspector gana el motor Electron nativo (ventana fuera de
//    pantalla del proceso principal) como PRIMERA opción; fuera de
//    Electron se descarta sin ruido y la cadena sigue.
// 2) fetch_stock_photo busca fotos reales (Openverse, sin llave) y las
//    descarga a assets/ del proyecto; está clasificada como escritura.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const vision = require("../editcore-chat-kernel/vision-inspector");
const stock = require("../editcore-chat-kernel/stock-photos");
const tools = require("../editcore-chat-kernel/tools");
const { WRITE_TOOLS } = require("../editcore-chat-kernel/classify");

test("ojos: el motor Electron se descarta con error claro fuera de la app (no explota)", async () => {
  await assert.rejects(
    () => vision.withElectronCapture("http://127.0.0.1:9/", { width: 800, height: 600 }, path.join(os.tmpdir(), "ec-x.png")),
    /Electron no disponible/,
  );
});

test("ojos: sin motores disponibles la captura devuelve ok:false con hint de la app, no de npm", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-ojos-"));
  const res = await vision.capture_preview_screenshot({ url: "http://127.0.0.1:9/", projectRoot: tmp });
  assert.equal(res.ok, false);
  assert.match(res.hint, /navegador interno de la app/);
});

test("fotos: buildSearchUrl codifica la búsqueda y pide tamaño grande", () => {
  const url = stock.buildSearchUrl("taller mecánico & autos");
  assert.match(url, /api\.openverse\.org/);
  assert.match(url, /q=taller/);
  assert.match(url, /size=large/);
});

test("fotos: pickCandidates filtra URLs inválidas y conserva el crédito", () => {
  const out = stock.pickCandidates({
    results: [
      { url: "https://img.example/1.jpg", title: "Mecánico", creator: "Ana", license: "by", foreign_landing_url: "https://src.example/1" },
      { url: "ftp://nope", title: "x" },
      { title: "sin url" },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].creator, "Ana");
  assert.equal(out[0].license, "BY");
});

test("fotos: fetchStockPhoto salta la candidata mala y guarda la buena en assets/", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-foto-"));
  const jpeg = Buffer.alloc(20480, 7);
  const fetcher = async (url) => {
    if (String(url).includes("openverse")) {
      return {
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({
          results: [
            { url: "https://img.example/mala.jpg", title: "mala", creator: "", license: "cc0", foreign_landing_url: "" },
            { url: "https://img.example/buena.jpg", title: "buena", creator: "Luis Foto", license: "by", foreign_landing_url: "https://src.example/buena" },
          ],
        }),
      };
    }
    if (String(url).includes("mala")) {
      return { ok: true, status: 200, headers: { get: () => "text/html" }, arrayBuffer: async () => new ArrayBuffer(30000) };
    }
    return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) };
  };
  const res = await stock.fetchStockPhoto({ query: "mechanic workshop", name: "hero-taller", projectRoot: tmp, fetcher });
  assert.equal(res.ok, true);
  assert.equal(res.path, "assets/hero-taller.jpg");
  assert.equal(res.credit.creator, "Luis Foto");
  assert.ok(fs.existsSync(path.join(tmp, "assets", "hero-taller.jpg")));
});

test("fotos: sin resultados o sin red, fetchStockPhoto devuelve ok:false sin lanzar", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-foto2-"));
  const empty = async () => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ results: [] }) });
  const res1 = await stock.fetchStockPhoto({ query: "zzzz", projectRoot: tmp, fetcher: empty });
  assert.equal(res1.ok, false);
  const down = async () => { throw new Error("ECONNREFUSED"); };
  const res2 = await stock.fetchStockPhoto({ query: "autos", projectRoot: tmp, fetcher: down });
  assert.equal(res2.ok, false);
  const res3 = await stock.fetchStockPhoto({ query: "", projectRoot: tmp, fetcher: empty });
  assert.equal(res3.ok, false);
});

test("fotos: la herramienta existe en el catálogo y está clasificada como escritura", () => {
  const defs = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true, isAnalysis: false });
  assert.ok(defs.some((t) => (t.function?.name || t.name) === "fetch_stock_photo"), "la definición debe existir");
  assert.ok(WRITE_TOOLS.includes("fetch_stock_photo"), "debe estar en WRITE_TOOLS (escribe en assets/)");
});
