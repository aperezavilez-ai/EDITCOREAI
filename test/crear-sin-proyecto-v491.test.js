"use strict";

// [EDITCORE-V491-B] CREAR DESDE CHAT SIN PROYECTO (corrección v4.9.1,
// bloque B): en vivo (v4.9.0, batería B-1) el pedido «Créame un
// proyecto nuevo llamado PRUEBA B1 y dentro haz una landing sencilla
// para una barbería» murió en la compuerta: ningún patrón reconocía la
// CREACIÓN con nombre, resolveExecutionMode lo marcaba missingProject
// y el renderer respondía la enlatada «Abre un proyecto (boton Abrir)
// o indica su nombre», dejando inalcanzable la maquinaria de creación
// desde la conversación (deriveConversationProjectName /
// ensureDesktopProjectForAgent). La compuerta ahora reconoce la
// intención de creación (con o sin nombre) y el nombre explícito viaja
// para que la carpeta nazca con ÉL. Abrir/revisar por nombre, que ya
// funcionaba, no cambia.

const test = require("node:test");
const assert = require("node:assert/strict");

const ProjectAnalysis = require("../project-analysis.js");

const LIVE_PROMPT = "Créame un proyecto nuevo llamado PRUEBA B1 y dentro haz una landing sencilla para una barbería";

test("V491-B1 el prompt exacto de la B-1 ya NO es missingProject: es creación con nombre", () => {
  const mode = ProjectAnalysis.resolveExecutionMode(LIVE_PROMPT, { requestedAgent: true, projectOpen: false });
  assert.equal(mode.missingProject, false, "la compuerta ya no lo trata como «falta proyecto»");
  assert.equal(mode.createProject, true, "la decisión declara la intención de creación");
  assert.equal(mode.createProjectName, "PRUEBA B1", "el nombre explícito viaja en la decisión, con su capitalización");

  const chatMode = ProjectAnalysis.resolveExecutionMode(LIVE_PROMPT, { requestedAgent: false, projectOpen: false });
  assert.equal(chatMode.missingProject, false, "tampoco en modo Chat: la creación se enruta, no se enlatada");
});

test("V491-B2 extractCreateProjectName: nombre explícito, cola cortada, y silencio sin nombre o sin creación", () => {
  assert.equal(ProjectAnalysis.extractCreateProjectName(LIVE_PROMPT), "PRUEBA B1");
  assert.equal(
    ProjectAnalysis.extractCreateProjectName("crea un proyecto que se llame Barbería Don Pepe y haz la landing"),
    "Barbería Don Pepe",
  );
  assert.equal(
    ProjectAnalysis.extractCreateProjectName("créame un proyecto nuevo y haz una landing para una barbería"),
    "",
    "sin nombre explícito no se inventa ninguno (lo deriva el flujo de creación)",
  );
  assert.equal(
    ProjectAnalysis.extractCreateProjectName("revisa el proyecto llamado CALILI"),
    "",
    "«revisa» no es creación: el nombre de un proyecto EXISTENTE no se captura aquí",
  );
  assert.equal(ProjectAnalysis.isCreateProjectRequest("crea un archivo en el proyecto"), false, "el verbo debe gobernar a «proyecto», no a «archivo»");
  assert.equal(ProjectAnalysis.isCreateProjectRequest(LIVE_PROMPT), true);
});

test("V491-B3 creación sin nombre también se enruta (missingProject false) y abrir/revisar por nombre sigue igual", () => {
  const unnamed = ProjectAnalysis.resolveExecutionMode("créame un proyecto nuevo y haz una landing para una barbería", { requestedAgent: true, projectOpen: false });
  assert.equal(unnamed.createProject, true);
  assert.equal(unnamed.missingProject, false);

  // Abrir/revisar por nombre: la ruta que ya funcionaba no se mueve.
  assert.equal(ProjectAnalysis.extractReferencedProjectName("ANALIZA TAXIDRIV Y DAME UN REPORTE"), "TAXIDRIV");
  assert.equal(ProjectAnalysis.extractReferencedProjectName("revisa el proyecto CALILI"), "CALILI");
  const referenced = ProjectAnalysis.resolveExecutionMode("analiza el proyecto CALILI", { requestedAgent: false, projectOpen: false });
  assert.equal(referenced.missingProject, false, "el nombre resoluble sigue sin ser missingProject");
  assert.equal(referenced.createProject, false, "revisar un proyecto existente NO se confunde con crearlo");

  // Y un cambio sobre un proyecto inexistente sigue siendo missingProject.
  assert.equal(
    ProjectAnalysis.resolveExecutionMode("corrige este proyecto", { requestedAgent: false, projectOpen: false }).missingProject,
    true,
    "sin creación ni nombre ni proyecto abierto, la compuerta conserva su negativa",
  );
});
