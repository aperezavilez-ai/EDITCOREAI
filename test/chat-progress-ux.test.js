"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ProjectAnalysis = require("../project-analysis");

test("analisis con nombre de proyecto NO es open puro", () => {
  assert.equal(ProjectAnalysis.isPureOpenProjectRequest("abre TAXIDRIV"), true);
  assert.equal(ProjectAnalysis.isPureOpenProjectRequest("ANALIZA TAXIDRIV Y DAME REPORTE"), false);
  assert.equal(ProjectAnalysis.isPureOpenProjectRequest("VAMOS ANALIZARLO QUIRURJICAMENTE CON REPORTE"), false);
});

test("extractReferencedProjectName saca el proyecto del pedido de analisis", () => {
  assert.equal(ProjectAnalysis.extractReferencedProjectName("ANALIZA TAXIDRIV Y DAME UN REPORTE"), "TAXIDRIV");
  assert.equal(ProjectAnalysis.extractReferencedProjectName("revisa el proyecto CALILI"), "CALILI");
});

test("renderer ya no vuelca Carpeta abierta con ruta en openNamedProject", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.doesNotMatch(source, /Carpeta abierta: \*\*\$\{projectDisplayName/);
  assert.match(source, /isPureOpenProjectRequest/);
  assert.match(source, /continueWork: true/);
  assert.match(source, /silent: true/);
  assert.match(source, /Pensando \/ razonando/);
  // La ruta no debe ir al chat como bloque de codigo en el open exitoso
  assert.doesNotMatch(source, /Carpeta abierta:[\s\S]{0,80}\\`\$\{project\.projectRoot\}\\`/);
});
