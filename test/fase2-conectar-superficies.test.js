"use strict";
// [FASE2-CONECTAR] Batería de las conexiones de superficie del Grupo 4:
// C-2 (botones Aceptar/Revertir de diff), C-6 (llamada task:discard
// muerta), C-7 (fundación externa aplicada en el adaptador Claude) y
// C-9 (entrada del script de aceptación en package.json). C-2/C-6 se
// verifican como contrato de cableado sobre las fuentes reales (el
// renderer no corre en este entorno) y C-7 ejecutando el compositor
// de contexto real del adaptador.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const renderer = fs.readFileSync(path.join(RAIZ, "renderer.js"), "utf8");
const preload = fs.readFileSync(path.join(RAIZ, "preload.js"), "utf8");
const main = fs.readFileSync(path.join(RAIZ, "main.js"), "utf8");

test("C-2: los botones de diff escriben por el namespace real (saveEditor)", () => {
  assert.ok(!renderer.includes("window.editcoreBridge?."), "ninguna LLAMADA al namespace inexistente editcoreBridge (solo puede quedar la mención histórica en el comentario)");
  const seccionDiff = renderer.slice(renderer.indexOf("EditCoreDiffDecisions"));
  assert.match(seccionDiff, /editcoreProject\?\.saveEditor/);
  assert.match(seccionDiff, /saveEditor\(\{ projectRoot: state\.projectRoot \|\| "", path: filePath, content: newContent \}\)/, "Aceptar escribe el contenido nuevo");
  assert.match(seccionDiff, /saveEditor\(\{ projectRoot: state\.projectRoot \|\| "", path: filePath, content: oldContent \}\)/, "Revertir escribe el contenido anterior");
  // La cadena completa existe: preload expone el método y main el handler.
  assert.match(preload, /saveEditor: \(input\) => ipcRenderer\.invoke\("project:save-editor", input\)/);
  assert.match(main, /ipcMain\.handle\("project:save-editor"/);
});

test("C-6: la llamada muerta a editcoreTasks.discard ya no existe", () => {
  assert.ok(!renderer.includes("editcoreTasks?.discard"), "el renderer no llama a un método inexistente");
  const bloqueTasks = preload.slice(preload.indexOf("editcoreTasks"), preload.indexOf("editcoreTasks") + 1200);
  assert.ok(!/discard/.test(bloqueTasks), "el namespace editcoreTasks de preload no expone discard (la llamada del renderer era el único eslabón)");
  assert.match(renderer, /editcoreTasks\?\.cancel/, "la cancelación real se conserva");
});

test("C-7: la fundación externa entra en el contexto compuesto del adaptador", () => {
  const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");
  const adapter = new EditCoreClaudeAdapter({ logger: { log() {}, warn() {}, error() {} } });
  const ejecucion = adapter.buildPrefixMessages({ prompt: "corrige el login", projectRoot: "", allowWrite: true });
  const textoEjecucion = ejecucion.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  assert.match(textoEjecucion, /FUNDACION OPERATIVA EDITCORE/, "el bloque de fundación está en el prefijo compuesto");
  assert.match(textoEjecucion, /permite escritura/, "con el modo de la corrida (escritura)");
  const analisis = adapter.buildPrefixMessages({ prompt: "analiza el login", projectRoot: "", analysisMode: true });
  const textoAnalisis = analisis.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
  assert.match(textoAnalisis, /FUNDACION OPERATIVA EDITCORE/);
  assert.match(textoAnalisis, /solo lectura/, "en análisis el modo declarado es solo lectura");
});

test("C-9: package.json expone el script de aceptación y el script existe", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:acceptance"], "node scripts/acceptance-kernel.js");
  assert.ok(fs.existsSync(path.join(RAIZ, "scripts", "acceptance-kernel.js")));
});
