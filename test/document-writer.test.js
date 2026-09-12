"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ExcelJS = require("exceljs");
const { createExcel } = require("../runtime/document-writer");

test("createExcel genera hojas validas con filas y objetos usando exceljs", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-excel-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, "report.xlsx");
  const result = await createExcel({
    Resumen: [["Metrica", "Valor"], ["Pruebas", 75]],
    Detalle: [{ nombre: "chat", estado: "ok" }],
  }, output);

  assert.equal(result.success, true);
  assert.ok(result.size > 0);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(output);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Resumen", "Detalle"]);
  assert.equal(workbook.getWorksheet("Resumen").getCell("B2").value, 75);
  assert.equal(workbook.getWorksheet("Detalle").getCell("A2").value, "chat");
});
