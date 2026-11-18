"use strict";
// Batería — EDITOR VISUAL, FLUJO COMPLETO DEL ANFITRIÓN: corre las
// funciones REALES del renderer (buildVisualEditScript,
// toggleVisualEdit, drenarEdicionesVisuales,
// aplicarEdicionVisualAlProyecto extraídas de renderer.js) contra
// una página real de Chromium que hace de webview, y el guardado
// REAL de runtime/visual-edit.js sobre un proyecto temporal.
// Cubre el camino que falló en vivo: activar → doble clic → escribir
// → APAGAR con el botón sin Enter → el archivo debe quedar guardado
// y la vista NO debe recargarse. Si puppeteer no está disponible,
// se salta con nota.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { aplicarEdicionVisual } = require("../runtime/visual-edit");

const RAIZ = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(RAIZ, "renderer.js"), "utf8");
function extraer(nombre, esAsync) {
  const i = renderer.indexOf((esAsync ? "async function " : "function ") + nombre);
  assert.ok(i >= 0, "función presente: " + nombre);
  const j = renderer.indexOf("\n}\n", i);
  return renderer.slice(i, j + 3);
}

test("flujo completo: apagar con el botón guarda el cambio y no recarga la vista", async (t) => {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { t.skip("puppeteer no instalado"); return; }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch { t.skip("el navegador de puppeteer no está descargado"); return; }
  try {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-flujo-"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "App.tsx"), `export default function App() {
  return (
    <h1 className="hero">
      TU AUTO EN<br />BUENAS MANOS,<br />
      <span className="text-orange">SIN SORPRESAS</span>
    </h1>
  );
}
`);
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <h1 class="hero">TU AUTO EN<br>BUENAS MANOS,<br><span id="obj" class="text-orange">SIN SORPRESAS</span></h1>
    </body></html>`, { waitUntil: "load" });

    let recargas = 0;
    const fakeWebview = {
      executeJavaScript: (code) => page.evaluate(code),
      reload: () => { recargas++; },
      getURL: () => "http://127.0.0.1:5442/",
    };
    const elementos = {};
    const $ = (id) => {
      if (id === "previewWebview") return fakeWebview;
      if (!elementos[id]) elementos[id] = { textContent: "", value: "http://127.0.0.1:5442/", classList: { toggle() {}, add() {}, remove() {} }, style: {} };
      return elementos[id];
    };
    const ctx = {
      $, state: { projectRoot: root }, console, setInterval, clearInterval,
      window: { editcoreProject: { applyVisualEdit: async ({ projectRoot, edicion }) => aplicarEdicionVisual(projectRoot, edicion) } },
      hidePreviewLoading: () => {},
      isLocalPreviewUrl: (u) => /^https?:\/\/(127\.0\.0\.1|localhost)/.test(String(u || "")),
    };
    vm.createContext(ctx);
    vm.runInContext("let visualEditActivo = false; let visualEditTimer = null;\n" + [
      extraer("buildVisualEditScript"),
      extraer("reflejarEstadoVisualEdit"),
      extraer("avisoVisualEdit"),
      extraer("drenarEdicionesVisuales", true),
      extraer("aplicarEdicionVisualAlProyecto", true),
      extraer("toggleVisualEdit", true),
      "globalThis.__toggle = toggleVisualEdit;",
    ].join("\n"), ctx);

    await ctx.__toggle(); // ACTIVAR
    assert.equal(await page.evaluate("!!window.__ecVisualEditor"), true);

    const box = await page.evaluate(() => {
      const b = document.getElementById("obj").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    const cdp = await page.createCDPSession();
    const ev = (type, cc) => cdp.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: cc });
    await ev("mousePressed", 1); await ev("mouseReleased", 1);
    await new Promise((r) => setTimeout(r, 90));
    await ev("mousePressed", 2); await ev("mouseReleased", 2);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.evaluate("document.getElementById('obj').getAttribute('contenteditable')"), "true");
    await page.evaluate(() => { document.getElementById("obj").innerText = "SIN PROBLEMA"; });

    await ctx.__toggle(); // APAGAR con el botón, sin Enter
    const contenido = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
    assert.ok(contenido.includes("SIN PROBLEMA"), "el archivo guarda el cambio al apagar");
    assert.ok(!contenido.includes("SIN SORPRESAS"), "el texto anterior desaparece del archivo");
    assert.equal(recargas, 0, "apagar NO recarga la vista (nada de pantalla en blanco)");
  } finally {
    await browser.close();
  }
});

test("el mapeo también encuentra textos que viven en archivos .ts y .json", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-flujo-ts-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "datos.ts"), `export const HERO = { titulo: "SIN SORPRESAS" };\n`);
  const r = await aplicarEdicionVisual(root, { tipo: "texto", anterior: "SIN SORPRESAS", nuevo: "SIN PROBLEMA" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(fs.readFileSync(path.join(root, "src", "datos.ts"), "utf8").includes("SIN PROBLEMA"));
});
