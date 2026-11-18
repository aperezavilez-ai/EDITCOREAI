"use strict";
// ============================================================
// BATERÍA — HERRAMIENTAS DE DOCUMENTOS (create_pdf /
// create_word / create_excel / create_csv).
// En la v5.2.5 estos nombres existen SOLO en la lista de
// escritura de classify.js: sin definición y sin despacho —
// herramientas fantasma. El agente no podía crear un PDF
// aunque las librerías (pdfkit, docx, exceljs) ya son
// dependencias declaradas de la app. Aquí se prueba la vuelta
// completa y REAL: crear el archivo en disco y LEERLO de
// vuelta con la herramienta read_pdf existente.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tools = require("../editcore-chat-kernel/tools");

function raizTemporal() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "editcore-docs-"));
}

test("create_pdf crea un PDF real y read_pdf lo lee de vuelta", async () => {
  const root = raizTemporal();
  const r = await tools.execute("create_pdf", {
    path: "informe.pdf",
    title: "Informe de prueba",
    paragraphs: ["Hola mundo desde EditCoreAI.", "Segundo parrafo del documento."],
  }, root, true, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const file = path.join(root, ".editcore", "entregables", "informe.pdf");
  assert.ok(fs.existsSync(file));
  assert.equal(fs.readFileSync(file).subarray(0, 4).toString("latin1"), "%PDF");
  assert.ok(fs.statSync(file).size > 400);
  const leido = await tools.execute("read_pdf", { path: ".editcore/entregables/informe.pdf" }, root, false, {});
  assert.equal(leido.ok, true, JSON.stringify(leido));
  assert.match(leido.text, /Hola mundo desde EditCoreAI/);
});

test("create_word crea un DOCX real y read_pdf lo lee de vuelta", async () => {
  const root = raizTemporal();
  const r = await tools.execute("create_word", {
    path: "carta.docx",
    title: "Carta de prueba",
    paragraphs: ["Contenido de la carta en Word."],
  }, root, true, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const file = path.join(root, ".editcore", "entregables", "carta.docx");
  assert.ok(fs.existsSync(file));
  assert.equal(fs.readFileSync(file).subarray(0, 2).toString("latin1"), "PK"); // ZIP
  const leido = await tools.execute("read_pdf", { path: ".editcore/entregables/carta.docx" }, root, false, {});
  assert.equal(leido.ok, true, JSON.stringify(leido));
  assert.match(leido.text, /Contenido de la carta en Word/);
});

test("create_excel crea un XLSX real con las celdas pedidas", async () => {
  const root = raizTemporal();
  const r = await tools.execute("create_excel", {
    path: "datos.xlsx",
    sheets: [{ name: "Ventas", rows: [["Producto", "Total"], ["Tornillos", 150], ["Tuercas", 200]] }],
  }, root, true, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const file = path.join(root, ".editcore", "entregables", "datos.xlsx");
  assert.ok(fs.existsSync(file));
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("Ventas");
  assert.equal(ws.getCell("A2").value, "Tornillos");
  assert.equal(ws.getCell("B3").value, 200);
  const leido = await tools.execute("read_pdf", { path: ".editcore/entregables/datos.xlsx" }, root, false, {});
  assert.equal(leido.ok, true, JSON.stringify(leido));
  assert.match(leido.text, /Tornillos/);
});

test("create_csv escribe filas con comillas escapadas", async () => {
  const root = raizTemporal();
  const r = await tools.execute("create_csv", {
    path: "lista.csv",
    rows: [["nombre", "nota"], ["uno", 'dijo "hola", y se fue']],
  }, root, true, {});
  assert.equal(r.ok, true, JSON.stringify(r));
  const contenido = fs.readFileSync(path.join(root, ".editcore", "entregables", "lista.csv"), "utf8");
  assert.match(contenido, /nombre,nota/);
  assert.match(contenido, /"dijo ""hola"", y se fue"/);
});

test("compuerta de escritura: sin allowWrite las create_* no escriben", async () => {
  const root = raizTemporal();
  for (const nombre of ["create_pdf", "create_word", "create_excel", "create_csv"]) {
    const r = await tools.execute(nombre, { path: `x.${nombre === "create_pdf" ? "pdf" : nombre === "create_word" ? "docx" : nombre === "create_excel" ? "xlsx" : "csv"}`, paragraphs: ["x"], rows: [["x"]], sheets: [{ name: "H", rows: [["x"]] }] }, root, false, {});
    assert.equal(r.ok, false, `${nombre} escribio sin permiso`);
  }
  assert.deepEqual(fs.readdirSync(root), []);
});

test("definiciones: las create_* existen, son de escritura y read_pdf sigue de lectura", () => {
  const todas = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true }).map((d) => d.function.name);
  for (const n of ["create_pdf", "create_word", "create_excel", "create_csv"]) {
    assert.ok(todas.includes(n), `falta la definicion de ${n}`);
  }
  const soloLectura = tools.getToolDefinitions({ allowWrite: false }).map((d) => d.function.name);
  for (const n of ["create_pdf", "create_word", "create_excel", "create_csv"]) {
    assert.ok(!soloLectura.includes(n), `${n} se ofrece en solo lectura`);
  }
  assert.ok(soloLectura.includes("read_pdf"));
});

test("extension equivocada: error claro, sin archivo a medias", async () => {
  const root = raizTemporal();
  const r = await tools.execute("create_pdf", { path: "mal.docx", paragraphs: ["x"] }, root, true, {});
  assert.equal(r.ok, false);
  assert.match(String(r.error || ""), /pdf/i);
  assert.deepEqual(fs.readdirSync(root), []);
});
