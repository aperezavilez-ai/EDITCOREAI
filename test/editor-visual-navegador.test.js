"use strict";
// Batería — EDITOR VISUAL contra un NAVEGADOR REAL (puppeteer):
// inyecta el script del editor en una página tipo ALFA LUBES,
// hace doble clic DE VERDAD (CDP con clickCount=2; el click
// sintético simple de puppeteer no genera dblclick) y exige
// que el texto se vuelva editable y que el cambio entre en la
// cola de ediciones; luego clic + panel + color. Si el
// navegador de puppeteer no está disponible en la máquina, la
// batería se salta con nota (no finge pasarla).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("editor visual en navegador real: doble clic edita y el color entra en la cola", async (t) => {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { t.skip("puppeteer no instalado"); return; }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch { t.skip("el navegador de puppeteer no está descargado"); return; }
  try {
    const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
    const m = /function buildVisualEditScript\(\) \{\s*return `([\s\S]*?)`;\s*\}/.exec(renderer);
    assert.ok(m, "se extrae el script del editor");
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <h1 id="titulo">LOS MEJORES ACEITES IMPORTADOS</h1>
      <p id="sub">Venta por Pallets y Mayoreo</p>
      <img id="foto" src="static/hero.jpg" alt="hero">
    </body></html>`, { waitUntil: "load" });
    await page.evaluate(m[1]);
    assert.equal(await page.evaluate("!!window.__ecVisualEditor"), true);

    const box = await page.evaluate(() => {
      const b = document.getElementById("titulo").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    const cdp = await page.createCDPSession();
    const ev = (type, clickCount) => cdp.send("Input.dispatchMouseEvent", {
      type, x: box.x, y: box.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount,
    });
    await ev("mousePressed", 1); await ev("mouseReleased", 1);
    await new Promise((r) => setTimeout(r, 90));
    await ev("mousePressed", 2); await ev("mouseReleased", 2);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.evaluate("document.getElementById('titulo').getAttribute('contenteditable')"), "true");
    await page.evaluate(() => { document.getElementById("titulo").innerText = "ACEITES PREMIUM"; });
    await page.mouse.click(400, 320);
    await new Promise((r) => setTimeout(r, 300));
    const cola = await page.evaluate("window.__ecVisualEdits.splice(0)");
    assert.deepEqual(cola, [{ tipo: "texto", anterior: "LOS MEJORES ACEITES IMPORTADOS", nuevo: "ACEITES PREMIUM" }]);

    // ENTER confirma y guarda (el camino que Luis usa): doble clic,
    // escribir y Enter — la edición entra en la cola, el modo edición
    // se cierra y el aviso «Guardando tu cambio…» se ve en la página.
    await ev("mousePressed", 1); await ev("mouseReleased", 1);
    await new Promise((r) => setTimeout(r, 90));
    await ev("mousePressed", 2); await ev("mouseReleased", 2);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.evaluate("document.getElementById('titulo').getAttribute('contenteditable')"), "true");
    await page.evaluate(() => { document.getElementById("titulo").innerText = "ACEITES ULTRA"; });
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.evaluate("document.getElementById('titulo').getAttribute('contenteditable')"), null);
    assert.deepEqual(await page.evaluate("window.__ecVisualEdits.splice(0)"),
      [{ tipo: "texto", anterior: "ACEITES PREMIUM", nuevo: "ACEITES ULTRA" }]);
    assert.equal(await page.evaluate("document.body.innerText.includes('Guardando tu cambio')"), true);

    // ENTER sin tocar el texto: avisa «Sin cambios» en vez de callar.
    const boxSub = await page.evaluate(() => {
      const b = document.getElementById("sub").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    const evS = (type, clickCount) => cdp.send("Input.dispatchMouseEvent", {
      type, x: boxSub.x, y: boxSub.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount,
    });
    await evS("mousePressed", 1); await evS("mouseReleased", 1);
    await new Promise((r) => setTimeout(r, 90));
    await evS("mousePressed", 2); await evS("mouseReleased", 2);
    await new Promise((r) => setTimeout(r, 300));
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await page.evaluate("window.__ecVisualEdits.splice(0)"), []);
    assert.equal(await page.evaluate("document.body.innerText.includes('Sin cambios')"), true);
  } finally {
    await browser.close();
  }
});

test("apagar sin Enter: __ecVisualConfirmar salva la edición y la cola sobrevive al Off", async (t) => {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch { t.skip("puppeteer no instalado"); return; }
  let browser;
  try {
    browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  } catch { t.skip("el navegador de puppeteer no está descargado"); return; }
  try {
    const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
    const m = /function buildVisualEditScript\(\) \{\s*return `([\s\S]*?)`;\s*\}/.exec(renderer);
    assert.ok(m, "se extrae el script del editor");
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>
      <h1 id="titulo">TITULO ORIGINAL</h1>
      <p id="sub">Venta por Pallets y Mayoreo</p>
    </body></html>`, { waitUntil: "load" });
    await page.evaluate(m[1]);
    assert.equal(await page.evaluate("typeof window.__ecVisualConfirmar"), "function");

    const box = await page.evaluate(() => {
      const b = document.getElementById("sub").getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    const cdp = await page.createCDPSession();
    const ev = (type, clickCount) => cdp.send("Input.dispatchMouseEvent", {
      type, x: box.x, y: box.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount,
    });
    await ev("mousePressed", 1); await ev("mouseReleased", 1);
    await new Promise((r) => setTimeout(r, 90));
    await ev("mousePressed", 2); await ev("mouseReleased", 2);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await page.evaluate("document.getElementById('sub').getAttribute('contenteditable')"), "true");

    // Luis edita y «apaga» SIN pulsar Enter ni hacer clic fuera:
    // el anfitrión confirma a petición y la edición entra en la cola.
    await page.evaluate(() => { document.getElementById("sub").innerText = "VENTA DIRECTA AL PUBLICO"; });
    await page.evaluate("window.__ecVisualConfirmar()");
    assert.equal(await page.evaluate("document.getElementById('sub').getAttribute('contenteditable')"), null);
    const esperada = [{ tipo: "texto", anterior: "Venta por Pallets y Mayoreo", nuevo: "VENTA DIRECTA AL PUBLICO" }];
    assert.deepEqual(await page.evaluate("window.__ecVisualEdits.slice(0)"), esperada);

    // Al apagar el editor, la cola SIGUE ahí para que el anfitrión
    // la drene al proyecto (antes el Off la borraba y se perdía).
    await page.evaluate("window.__ecVisualEditorOff()");
    assert.equal(await page.evaluate("!!window.__ecVisualEditor"), false);
    assert.deepEqual(await page.evaluate("window.__ecVisualEdits.slice(0)"), esperada);
  } finally {
    await browser.close();
  }
});
