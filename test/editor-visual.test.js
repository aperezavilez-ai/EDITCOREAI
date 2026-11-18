"use strict";
// Batería — EDITOR VISUAL del Navegador (función pedida por
// Luis, estilo Lovable): la edición hecha en la vista previa
// se mapea a la plantilla fuente y se guarda en el archivo.
// Aquí se prueba el mapeo puro (runtime/visual-edit.js) sobre
// proyectos temporales, la sintaxis del script inyectado y el
// cableado completo (botón → preload → handler → renderer).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const raizRepo = path.join(__dirname, "..");
const { aplicarEdicionVisual } = require("../runtime/visual-edit");

function proyectoTemporal(html) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-visual-"));
  fs.mkdirSync(path.join(root, "templates"), { recursive: true });
  fs.writeFileSync(path.join(root, "templates", "index.html"), html, "utf8");
  return root;
}
const leer = (root) => fs.readFileSync(path.join(root, "templates", "index.html"), "utf8");

test("texto: reemplazo literal en la plantilla", () => {
  const root = proyectoTemporal("<h1>Taller Luis</h1><p>Bienvenido</p>");
  try {
    const r = aplicarEdicionVisual(root, { tipo: "texto", anterior: "Taller Luis", nuevo: "ALFA LUBES" });
    assert.equal(r.ok, true);
    assert.equal(r.archivo, "templates/index.html");
    assert.match(leer(root), /<h1>ALFA LUBES<\/h1>/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("texto: tolerante a saltos y sangría de la fuente", () => {
  const root = proyectoTemporal("<h1>\n    Taller\n    Luis\n  </h1>");
  try {
    const r = aplicarEdicionVisual(root, { tipo: "texto", anterior: "Taller Luis", nuevo: "Mi Taller" });
    assert.equal(r.ok, true);
    assert.match(leer(root), /Mi Taller/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("texto: si no vive en una plantilla, NO se finge el guardado", () => {
  const root = proyectoTemporal("<h1>Hola</h1>");
  try {
    const r = aplicarEdicionVisual(root, { tipo: "texto", anterior: "Texto desde la base de datos", nuevo: "X" });
    assert.equal(r.ok, false);
    assert.match(r.error, /no lo guardé/);
    assert.equal(leer(root), "<h1>Hola</h1>");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("foto: reemplaza el src literal", () => {
  const root = proyectoTemporal('<img src="static/vieja.jpg" alt="taller">');
  try {
    const r = aplicarEdicionVisual(root, { tipo: "foto", anterior: "static/vieja.jpg", nuevo: "static/nueva.jpg" });
    assert.equal(r.ok, true);
    assert.match(leer(root), /src="static\/nueva\.jpg"/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("color: inserta el style en la etiqueta localizada por su texto", () => {
  const root = proyectoTemporal("<h1>ALFA LUBES</h1>");
  try {
    const r = aplicarEdicionVisual(root, { tipo: "color-texto", texto: "ALFA LUBES", valor: "#ff0000" });
    assert.equal(r.ok, true);
    assert.match(leer(root), /<h1 style="color: #ff0000">ALFA LUBES<\/h1>/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("color: se fusiona con el style existente sin pisar lo demás", () => {
  const root = proyectoTemporal('<p style="font-weight: bold">Ofertas</p>');
  try {
    const r = aplicarEdicionVisual(root, { tipo: "color-fondo", texto: "Ofertas", valor: "#00ff00" });
    assert.equal(r.ok, true);
    const html = leer(root);
    assert.match(html, /font-weight: bold/);
    assert.match(html, /background-color: #00ff00/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("color: ancla por id cuando el elemento no tiene texto", () => {
  const root = proyectoTemporal('<div id="hero"></div>');
  try {
    const r = aplicarEdicionVisual(root, { tipo: "color-fondo", texto: "", idElemento: "#hero", valor: "#0000ff" });
    assert.equal(r.ok, true);
    assert.match(leer(root), /<div id="hero" style="background-color: #0000ff">/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("el script inyectado es sintácticamente válido y trae el editor", () => {
  const src = fs.readFileSync(path.join(raizRepo, "renderer.js"), "utf8");
  const m = /function buildVisualEditScript\(\) \{\s*return `([\s\S]*?)`;\s*\}/.exec(src);
  assert.ok(m, "buildVisualEditScript devuelve su plantilla");
  new vm.Script(m[1]); // lanza si la sintaxis es inválida
  assert.match(m[1], /__ecVisualEdits/);
  assert.match(m[1], /dblclick/);
  assert.match(m[1], /contenteditable/);
  assert.match(m[1], /__ecVisualEditorOff/);
});

test("cableado: botón, preload, handler y sondeo del anfitrión", () => {
  const html = fs.readFileSync(path.join(raizRepo, "index.html"), "utf8");
  assert.match(html, /id="visualEditBtn"/);
  // El botón TAMBIÉN vive bajo el cuadro del chat (donde Luis
  // lo busca, como en Lovable) y ambos reflejan el estado.
  assert.match(html, /id="visualEditBtnChat"/);
  assert.match(fs.readFileSync(path.join(raizRepo, "renderer.js"), "utf8"), /reflejarEstadoVisualEdit/);
  assert.match(fs.readFileSync(path.join(raizRepo, "renderer.js"), "utf8"), /visualEditBtnChat/);
  const preload = fs.readFileSync(path.join(raizRepo, "preload.js"), "utf8");
  assert.match(preload, /applyVisualEdit: \(input = \{\}\) => ipcRenderer\.invoke\("project:apply-visual-edit", input\)/);
  const main = fs.readFileSync(path.join(raizRepo, "main.js"), "utf8");
  assert.match(main, /ipcMain\.handle\("project:apply-visual-edit"/);
  assert.match(main, /require\("\.\/runtime\/visual-edit"\)/);
  const renderer = fs.readFileSync(path.join(raizRepo, "renderer.js"), "utf8");
  const i = renderer.indexOf("async function toggleVisualEdit()");
  assert.ok(i > 0);
  const seg = renderer.slice(i, i + 4500);
  assert.match(seg, /isLocalPreviewUrl/);
  assert.match(renderer, /drenarEdicionesVisuales/);
  // El resultado del guardado se anuncia DENTRO de la página
  // (donde Luis mira), no solo en la barra de estado.
  assert.match(renderer, /__ecVisualAviso/);
  const j = renderer.indexOf("async function aplicarEdicionVisualAlProyecto");
  assert.ok(j > 0);
  assert.match(renderer.slice(j, j + 1600), /avisoVisualEdit/);
  const av = renderer.indexOf("function avisoVisualEdit");
  assert.ok(av > 0);
  assert.match(renderer.slice(av, av + 900), /__ecVisualAviso/);
});

test("apagar el editor NO pierde la edición en curso: confirmar → drenar → apagar", () => {
  const src = fs.readFileSync(path.join(raizRepo, "renderer.js"), "utf8");
  const m = /function buildVisualEditScript\(\) \{\s*return `([\s\S]*?)`;\s*\}/.exec(src);
  assert.ok(m, "buildVisualEditScript devuelve su plantilla");
  // El inyectado expone la confirmación a petición del anfitrión…
  assert.match(m[1], /window\.__ecVisualConfirmar = function \(\) \{ confirmarEdicion\(\); \};/);
  // …y al apagar la cola SOBREVIVE: el Off ya no la vacía.
  assert.doesNotMatch(m[1], /__ecVisualEdits = \[\]/);
  // En la rama OFF de toggleVisualEdit el orden es Confirmar →
  // drenar → (detener el drenador + Off): nada se descarta antes
  // de que la cola llegue al proyecto.
  const i = src.indexOf("async function toggleVisualEdit()");
  assert.ok(i > 0);
  const seg = src.slice(i, i + 3000);
  const iConfirmar = seg.indexOf("__ecVisualConfirmar");
  const iDrenar = seg.indexOf("drenarEdicionesVisuales()");
  const iClear = seg.indexOf("clearInterval");
  const iOff = seg.indexOf("__ecVisualEditorOff");
  assert.ok(iConfirmar > -1 && iDrenar > -1 && iClear > -1 && iOff > -1, "la rama OFF confirma, drena, detiene y apaga");
  assert.ok(iConfirmar < iDrenar, "primero se confirma la edición en curso");
  assert.ok(iDrenar < iClear, "el drenador se detiene DESPUÉS de drenar");
  assert.ok(iDrenar < iOff, "el editor se apaga DESPUÉS de drenar la cola");
});

test("los avisos del editor NUNCA usan la cortina de carga del navegador", () => {
  const renderer = fs.readFileSync(path.join(raizRepo, "renderer.js"), "utf8");
  const i = renderer.indexOf("function avisoVisualEdit");
  assert.ok(i >= 0, "existe avisoVisualEdit");
  const segAviso = renderer.slice(i, i + 900);
  assert.match(segAviso, /hidePreviewLoading/);
  const j = renderer.indexOf("async function toggleVisualEdit");
  const segToggle = renderer.slice(j, j + 4500);
  assert.ok(!segToggle.includes("showPreviewStatus"), "toggleVisualEdit no toca la cortina");
  const k = renderer.indexOf("async function aplicarEdicionVisualAlProyecto");
  const segAplicar = renderer.slice(k, k + 1200);
  assert.ok(!segAplicar.includes("showPreviewStatus"), "el resultado del guardado no toca la cortina");
  assert.match(segAplicar, /avisoVisualEdit/);
});

test("mapeo con pegamento JSX: {\" \"}, &nbsp;, texto partido en dos span y <br/>", async () => {
  const casos = [
    `<span class="naranja">SIN{" "}SORPRESAS</span>`,
    `<span class="naranja">SIN&nbsp;SORPRESAS</span>`,
    `<span>SIN</span> <span class="naranja">SORPRESAS</span>`,
  ];
  for (const html of casos) {
    const root = proyectoTemporal(html);
    const r = await aplicarEdicionVisual(root, { tipo: "texto", anterior: "SIN SORPRESAS", nuevo: "SIN PROBLEMAS" });
    assert.equal(r.ok, true, html + " → " + JSON.stringify(r));
    assert.ok(leer(root).includes("SIN PROBLEMAS"), html);
  }
  const root = proyectoTemporal(`<h1>TU AUTO EN<br/>BUENAS MANOS,<br/><span>SIN SORPRESAS</span></h1>`);
  const r = await aplicarEdicionVisual(root, { tipo: "texto", anterior: "TU AUTO EN BUENAS MANOS, SIN SORPRESAS", nuevo: "TU AUTO EN BUENAS MANOS, SIN PROBLEMAS" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(leer(root).includes("SIN PROBLEMAS"));
});

test("la guarda de longitud: dos palabras lejanas unidas por etiquetas NO se tocan", async () => {
  const relleno = "<span></span>".repeat(30);
  const root = proyectoTemporal(`<div>SIN</div>${relleno}<div>SORPRESAS</div>`);
  const r = await aplicarEdicionVisual(root, { tipo: "texto", anterior: "SIN SORPRESAS", nuevo: "SIN PROBLEMAS" });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.ok(leer(root).includes("SORPRESAS"));
});

function proyectoArchivos(mapa) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-visual-caso-"));
  for (const [rel, contenido] of Object.entries(mapa)) {
    const destino = path.join(root, rel);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido, "utf8");
  }
  return root;
}

test("texto mostrado en mayúsculas por CSS: la fuente en minúsculas SÍ se encuentra y se guarda con su caso", () => {
  // Caso real cazado en TALLE PRUEBA (Hero.tsx:23): la fuente dice
  // «sin sorpresas» y la clase uppercase del titular lo pinta
  // «SIN SORPRESAS»; el editor captura el texto renderizado.
  const root = proyectoArchivos({
    "src/components/sections/Hero.tsx":
      'export default function Hero() {\n  return <h1>Tu auto en buenas manos, <span className="text-primary">sin sorpresas</span></h1>;\n}\n',
  });
  const r = aplicarEdicionVisual(root, { tipo: "texto", anterior: "SIN SORPRESAS", nuevo: "SIN PROBLEMAS" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const hero = fs.readFileSync(path.join(root, "src/components/sections/Hero.tsx"), "utf8");
  assert.match(hero, />sin problemas<\/span>/);
  assert.doesNotMatch(hero, /SIN PROBLEMAS/);
});

test("caso capitalizado en la fuente: el reemplazo conserva la capitalización", () => {
  const root = proyectoArchivos({ "src/App.tsx": "<h1>Sin sorpresas</h1>\n" });
  const r = aplicarEdicionVisual(root, { tipo: "texto", anterior: "SIN SORPRESAS", nuevo: "SIN PROBLEMAS" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(fs.readFileSync(path.join(root, "src/App.tsx"), "utf8"), /Sin problemas/);
});

test("fuente en mayúsculas de verdad: el reemplazo queda en mayúsculas", () => {
  const root = proyectoArchivos({ "src/App.tsx": "<h1>SIN SORPRESAS</h1>\n" });
  const r = aplicarEdicionVisual(root, { tipo: "texto", anterior: "SIN SORPRESAS", nuevo: "Sin problemas" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(fs.readFileSync(path.join(root, "src/App.tsx"), "utf8"), /SIN PROBLEMAS/);
});

test("párrafo con <strong> dentro de las palabras (caso real ALFA LUBES): se localiza y se guarda", () => {
  // templates/index.html:18-19 de ALFA LUBES: la coma de
  // «DCT/DSG,» vive tras el </strong> y el párrafo se parte en
  // dos líneas con sangría; el texto renderizado es una sola
  // corrida. La edición de Luis quitó «tambores industriales».
  const html = [
    "<p>",
    "        Accede a precios de importador directo sin intermediarios. Tarimas completas selladas de fábrica con cajas de fluidos de transmisión <strong>DCT/DSG</strong>,",
    "        aceites sintéticos premium <strong>0W-20, 5W-30</strong> y tambores industriales con flete seguro a todo México.",
    "</p>",
    "",
  ].join("\n");
  const root = proyectoArchivos({ "templates/index.html": html });
  const anterior = "Accede a precios de importador directo sin intermediarios. Tarimas completas selladas de fábrica con cajas de fluidos de transmisión DCT/DSG, aceites sintéticos premium 0W-20, 5W-30 y tambores industriales con flete seguro a todo México.";
  const nuevo = "Accede a precios de importador directo sin intermediarios. Tarimas completas selladas de fábrica con cajas de fluidos de transmisión DCT/DSG, aceites sintéticos premium 0W-20, 5W-30 y con flete seguro a todo México.";
  const r = aplicarEdicionVisual(root, { tipo: "texto", anterior, nuevo });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.archivo, "templates/index.html");
  const guardado = fs.readFileSync(path.join(root, "templates/index.html"), "utf8");
  assert.match(guardado, /5W-30 y con flete seguro a todo México\./);
  assert.doesNotMatch(guardado, /tambores industriales/);
});

test("esqueleto: palabra partida por una etiqueta a mitad (transmi<strong>sión)", () => {
  const root = proyectoArchivos({
    "templates/index.html": "<p>Repuestos de transmi<strong>sión</strong> garantizados</p>\n",
  });
  const r = aplicarEdicionVisual(root, {
    tipo: "texto",
    anterior: "Repuestos de transmisión garantizados",
    nuevo: "Repuestos de transmisión reforzados",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(fs.readFileSync(path.join(root, "templates/index.html"), "utf8"), /Repuestos de transmisión reforzados/);
});

test("esqueleto: &nbsp; entre palabras y párrafo envuelto en etiquetas por frase", () => {
  const root = proyectoArchivos({
    "templates/index.html": "<p><b>Venta</b> por&nbsp;<b>Pallets</b> y <b>Mayoreo</b> para <b>Talleres</b></p>\n",
  });
  const r = aplicarEdicionVisual(root, {
    tipo: "texto",
    anterior: "Venta por Pallets y Mayoreo para Talleres",
    nuevo: "Venta por Pallets y Mayoreo para Flotillas",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(fs.readFileSync(path.join(root, "templates/index.html"), "utf8"), /Venta por Pallets y Mayoreo para Flotillas/);
});

test("plantilla grande (>512 KB): el texto SÍ se busca y se guarda", () => {
  const relleno = "<!-- " + "x".repeat(600 * 1024) + " -->\n";
  const root = proyectoArchivos({
    "templates/index.html": relleno + "<p>Envíos a Todo México sin costo</p>\n",
  });
  const r = aplicarEdicionVisual(root, {
    tipo: "texto",
    anterior: "Envíos a Todo México sin costo",
    nuevo: "Envíos a Todo México con flete seguro",
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(fs.readFileSync(path.join(root, "templates/index.html"), "utf8"), /con flete seguro/);
});
