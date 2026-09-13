"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ProjectAnalysis = require("../project-analysis");

test("sin proyecto abierto, una ruta absoluta no bloquea el agente", () => {
  const mode = ProjectAnalysis.resolveExecutionMode("enlistame todo D:\\PROGRAMAS IA", {
    requestedAgent: true,
    projectOpen: false,
  });
  assert.equal(mode.missingProject, false);
  assert.equal(mode.pathGiven, true);
  assert.equal(ProjectAnalysis.hasUsableAbsolutePath("enlistame todo D:\\PROGRAMAS IA"), true);
});

test("reház SOLO package.json no es steering: va a DISCOVER con tools", () => {
  const prompt = [
    "Para. No explores mas.",
    "Rehaz el analisis SOLO de package.json (raiz).",
    "No leas .md ni android/ios/docs.",
    "Si no hay nada que corregir, dilo claro y NO pidas PROCEDE.",
  ].join("\n");
  assert.equal(ProjectAnalysis.isScopedDiskFileRequest(prompt), false);
  assert.equal(ProjectAnalysis.isPromptOnlySteering(prompt), false);
  assert.equal(ProjectAnalysis.isFreshAnalysisRequest(prompt), true);
  const { resolveUnifiedAgentPlan } = require("../runtime/intent-orchestrator");
  const plan = resolveUnifiedAgentPlan({
    prompt,
    requestedAgent: true,
    permissionMode: "full",
    projectOpen: true,
    allowWrite: true,
  });
  assert.equal(plan.mode, "discover");
  assert.equal(plan.analysisMode, true);
  assert.equal(plan.promptOnlyMode, false);
  assert.equal(plan.scopedDiskFocus, false);
  assert.doesNotMatch(plan.runProfile?.orchestrationBlock || "", /FOCO ESTRECHO/i);
  assert.match(plan.runProfile?.orchestrationBlock || "", /list_files|read_file/i);
});

test("prosa con 'breve: qué' NO es ruta absoluta ni proyecto 'solo'", () => {
  const prompt = "Analiza solo el archivo resources/app/package.json. Haz un informe forense breve: qué contiene, si hay algo raro, y 1 corrección concreta si aplica. No explores todo el repo. Cuando termines el análisis, espera mi autorización antes de cambiar nada.";
  assert.equal(ProjectAnalysis.extractReferencedProjectName(prompt), "");
  assert.deepEqual(ProjectAnalysis.extractAbsolutePathHints(prompt), []);
  assert.equal(ProjectAnalysis.hasUsableAbsolutePath(prompt), false);
  const mode = ProjectAnalysis.resolveExecutionMode(prompt, {
    requestedAgent: true,
    projectOpen: true,
  });
  assert.equal(mode.referencedProjectName, "");
  assert.equal(mode.pathGiven, false);
  assert.equal(mode.missingProject, false);
});

test("analiza unicamente package.json NO abre proyecto 'unicamente'", () => {
  const prompt = [
    "Analiza unicamente package.json de la raiz.",
    "No explores android/ios/docs.",
    "Si no hay nada que corregir, dilo y NO pidas PROCEDE.",
  ].join(" ");
  assert.equal(ProjectAnalysis.isScopedDiskFileRequest(prompt), false);
  assert.equal(ProjectAnalysis.extractReferencedProjectName(prompt), "");
  assert.deepEqual(ProjectAnalysis.extractAbsolutePathHints(prompt), []);
  const mode = ProjectAnalysis.resolveExecutionMode(prompt, {
    requestedAgent: true,
    projectOpen: true,
  });
  assert.equal(mode.referencedProjectName, "");
  assert.equal(mode.missingProject, false);
  assert.equal(mode.pathGiven, false);
});

test("analiza porque ... NO abre proyecto 'porque'", () => {
  const prompt = "analiza porque la ia de fuxion servise no esta funcionando, la ia se alimenta desde el proyecto gafcore gateway";
  assert.equal(ProjectAnalysis.extractReferencedProjectName(prompt), "");
  assert.equal(ProjectAnalysis.extractOpenProjectName(prompt), "");
  const mode = ProjectAnalysis.resolveExecutionMode(prompt, {
    requestedAgent: true,
    projectOpen: true,
  });
  assert.equal(mode.referencedProjectName, "");
  assert.equal(mode.missingProject, false);
});

test("acepta atajo Windows D:PROGRAMAS IA sin barra", () => {
  assert.equal(ProjectAnalysis.hasUsableAbsolutePath("enlistame D:PROGRAMAS IA"), true);
  const hints = ProjectAnalysis.extractAbsolutePathHints("enlistame D:PROGRAMAS IA");
  assert.ok(hints.some((item) => /^D:\\PROGRAMAS IA$/i.test(item)));
  const mode = ProjectAnalysis.resolveExecutionMode("enlistame D:PROGRAMAS IA", {
    requestedAgent: true,
    projectOpen: false,
  });
  assert.equal(mode.missingProject, false);
  assert.equal(mode.pathGiven, true);
});

test("sin proyecto ni ruta, un analisis si exige carpeta", () => {
  const mode = ProjectAnalysis.resolveExecutionMode("analiza el proyecto", {
    requestedAgent: true,
    projectOpen: false,
  });
  assert.equal(mode.missingProject, true);
});

test("abre TAXIDRIV / Documentos / ruta absoluta se reconocen", () => {
  assert.equal(ProjectAnalysis.extractOpenProjectName("ABRE EL PROYECTO TAXIDRIV"), "TAXIDRIV");
  assert.equal(ProjectAnalysis.extractOpenProjectName("abre TAXIDRIV"), "TAXIDRIV");
  assert.equal(ProjectAnalysis.extractOpenProjectName("entra a Documentos"), "Documentos");
  assert.equal(ProjectAnalysis.knownFolderAliasKey("Documentos"), "documents");
  assert.equal(ProjectAnalysis.knownFolderAliasKey("mis documentos"), "documents");
  assert.equal(ProjectAnalysis.isOpenNamedProjectRequest("ABRE EL PROYECTO TAXIDRIV"), true);
  assert.equal(ProjectAnalysis.isOpenNamedProjectRequest("abre C:\\Users\\apere\\Documents"), true);
  assert.equal(ProjectAnalysis.isOpenNamedProjectRequest("abre el proyecto"), true);
  assert.equal(ProjectAnalysis.isOpenNamedProjectRequest("abrir"), true);
  assert.equal(
    ProjectAnalysis.resolveNamedProjectPath("TAXIDRIV", "D:\\PROGRAMAS IA"),
    "D:\\PROGRAMAS IA\\TAXIDRIV",
  );
  const mode = ProjectAnalysis.resolveExecutionMode("ABRE EL PROYECTO TAXIDRIV", {
    requestedAgent: true,
    projectOpen: false,
  });
  assert.equal(mode.missingProject, false);
  assert.equal(mode.openNamedProject, true);
});

test("cierra el proyecto no exige ruta ni va al agente como analisis", () => {
  assert.equal(ProjectAnalysis.isCloseProjectRequest("CIERRA EL PROYECTO"), true);
  assert.equal(ProjectAnalysis.isCloseProjectRequest("cerrar proyecto"), true);
  assert.equal(ProjectAnalysis.isCloseProjectRequest("analiza el proyecto"), false);
  const mode = ProjectAnalysis.resolveExecutionMode("CIERRA EL PROYECTO", {
    requestedAgent: true,
    projectOpen: true,
  });
  assert.equal(mode.closeProject, true);
  assert.equal(mode.missingProject, false);
});

test("cierra este y abre otro se reconoce como switch de workspace", () => {
  const prompt = "vamos a trabajar en otro proyecto requiero que cierres este fuxion service y abras el proyecto, editcoreai";
  assert.equal(ProjectAnalysis.isSwitchProjectRequest(prompt), true);
  assert.equal(ProjectAnalysis.isCloseProjectRequest(prompt), false);
  assert.equal(String(ProjectAnalysis.extractSwitchProjectName(prompt) || "").toLowerCase(), "editcoreai");
  assert.equal(ProjectAnalysis.isSwitchProjectRequest("cierrame este y abrime TAXIDRIV"), true);
  assert.equal(ProjectAnalysis.extractSwitchProjectName("cierrame este y abrime TAXIDRIV"), "TAXIDRIV");
  const mode = ProjectAnalysis.resolveExecutionMode(prompt, {
    requestedAgent: false,
    projectOpen: true,
  });
  assert.equal(mode.switchProject, true);
  assert.equal(mode.missingProject, false);
});

test("auditorias largas con cerrar/abrir en prosa NO son switch de workspace", () => {
  const audit = [
    "Rol: Auditor Principal de Arquitectura y Estabilidad en EDITCOREAI",
    "Realiza un analisis integral, profundo y sin concesiones de todo el codigo fuente de EDITCOREAI",
    "(procesos de Electron main.js, preload.js, carpeta runtime/, manejadores IPC).",
    "Capacidades de Control de Workspace:",
    "Verifica si el codigo actual permite cerrar el proyecto activo, guardar/publicar",
    "de forma atomica y abrir un directorio nuevo, o si carece de dichos metodos.",
    "Objetivos obligatorios de la auditoria: Mapeo y Validacion de Canales IPC.",
  ].join("\n");
  assert.ok(audit.length > 360);
  assert.equal(ProjectAnalysis.isSwitchProjectRequest(audit), false);
  assert.equal(ProjectAnalysis.isCloseProjectRequest(audit), false);
  const mode = ProjectAnalysis.resolveExecutionMode(audit, {
    requestedAgent: true,
    projectOpen: true,
  });
  assert.equal(mode.switchProject, false);
  assert.equal(mode.missingProject, false);
});

test("sin proyecto, un saludo no exige carpeta", () => {
  const mode = ProjectAnalysis.resolveExecutionMode("hola", {
    requestedAgent: true,
    projectOpen: false,
  });
  assert.equal(mode.missingProject, false);
});
