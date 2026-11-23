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

test("isPreviewRequest detecta pedidos de ver el proyecto en navegador interno", () => {
  assert.equal(ProjectAnalysis.isPreviewRequest("QUIERO VER TODO EL PROYECTO EN EL NAVEGADOR INTERNO DE EDITCOREAI"), true);
  assert.equal(ProjectAnalysis.isPreviewRequest("abre el navegador interno"), true);
  assert.equal(ProjectAnalysis.isPreviewRequest("muestra el proyecto en el navegador"), true);
  assert.equal(ProjectAnalysis.isPreviewRequest("modifica el archivo package.json"), false);
});

test("isProjectIntentComment detecta apertura de trabajo natural", () => {
  assert.equal(ProjectAnalysis.isProjectIntentComment("VAMOS TRABAJAR EN ESTE PROYECTO"), true);
  assert.equal(ProjectAnalysis.isProjectIntentComment("vamos a trabajar en este proyecto"), true);
  assert.equal(ProjectAnalysis.isProjectIntentComment("arranquemos con este proyecto"), true);
  assert.equal(ProjectAnalysis.isProjectIntentComment("vamos a chambear en este repo"), true);
  assert.equal(ProjectAnalysis.isProjectIntentComment("a darle al proyecto"), true);
  assert.equal(ProjectAnalysis.isProjectIntentComment("manos a la obra"), true);
});

test("isChangeRequest detecta acciones de git y scraping", () => {
  assert.equal(ProjectAnalysis.isChangeRequest("haz commit de los cambios"), true);
  assert.equal(ProjectAnalysis.isChangeRequest("haz push al repo"), true);
  assert.equal(ProjectAnalysis.isChangeRequest("hazle scraping a esta página web"), true);
  assert.equal(ProjectAnalysis.isChangeRequest("clona esta plantilla"), true);
});

test("renderer ya no vuelca Carpeta abierta con ruta en openNamedProject", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.doesNotMatch(source, /Carpeta abierta: \*\*\$\{projectDisplayName/);
  assert.match(source, /isPureOpenProjectRequest/);
  assert.match(source, /isPreviewRequest/);
  assert.match(source, /continueWork: true/);
  assert.match(source, /silent: true/);
  assert.match(source, /Pensando \/ razonando/);
  // La ruta no debe ir al chat como bloque de codigo en el open exitoso
  assert.doesNotMatch(source, /Carpeta abierta:[\s\S]{0,80}\\`\$\{project\.projectRoot\}\\`/);
});
