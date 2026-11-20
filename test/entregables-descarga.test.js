"use strict";
// Batería — entregables como ENLACE DE DESCARGA (regla de Luis,
// juicio v5.2.7): el documento que el agente crea no se queda
// en la raíz del proyecto ni se abre con botones-caja: se
// genera en .editcore/entregables/ y el chat lo ofrece como
// enlace «Descargar» que lo baja a la carpeta de Descargas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const raizRepo = path.join(__dirname, "..");

test("create_csv genera el entregable en .editcore/entregables, no en la raíz", async () => {
  const tools = require("../runtime/tools/tools");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-entregables-"));
  try {
    const r = await tools.execute("create_csv", { path: "resumen.csv", rows: [["a", "b"], ["1", "2"]] }, root, true, {});
    assert.equal(r.ok, true);
    const esperado = path.join(root, ".editcore", "entregables", "resumen.csv");
    assert.equal(path.resolve(r.path), path.resolve(esperado));
    assert.equal(fs.existsSync(esperado), true);
    assert.equal(fs.existsSync(path.join(root, "resumen.csv")), false);
    // Una ruta absoluta DENTRO del proyecto también se redirige.
    const r2 = await tools.execute("create_csv", { path: path.join(root, "otro.csv"), rows: [["x"]] }, root, true, {});
    assert.equal(path.resolve(r2.path), path.resolve(path.join(root, ".editcore", "entregables", "otro.csv")));
    // Una ruta absoluta FUERA del proyecto se respeta tal cual.
    const fuera = path.join(os.tmpdir(), `ec-fuera-${Date.now()}.csv`);
    const r3 = await tools.execute("create_csv", { path: fuera, rows: [["y"]] }, root, true, {});
    assert.equal(path.resolve(r3.path), path.resolve(fuera));
    fs.rmSync(fuera, { force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("la cadena de descarga existe: preload, handler y tarjeta", () => {
  const preload = fs.readFileSync(path.join(raizRepo, "preload.js"), "utf8");
  assert.match(preload, /downloadFile: \(input = \{\}\) => ipcRenderer\.invoke\("project:download-file", input\)/);
  const main = fs.readFileSync(path.join(raizRepo, "main.js"), "utf8");
  const i = main.indexOf("project:download-file");
  assert.ok(i > 0, "handler project:download-file");
  const seg = main.slice(i, i + 1600);
  assert.match(seg, /os\.homedir\(\), "Downloads"/);
  assert.match(seg, /copyFileSync/);
  assert.match(seg, /\(\$\{n\}\)/); // numeración ante choque de nombre
  const renderer = fs.readFileSync(path.join(raizRepo, "renderer.js"), "utf8");
  const j = renderer.indexOf("function pintarArchivosEntregados");
  const segR = renderer.slice(j, j + 2400);
  assert.match(segR, /downloadFile/);
  assert.match(segR, /En Descargas/);
});
