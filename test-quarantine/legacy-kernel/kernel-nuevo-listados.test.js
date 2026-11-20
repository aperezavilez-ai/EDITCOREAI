"use strict";
// ============================================================
// BATERÍA — LISTADOS CON TOTALES.
// En el juicio en vivo, «lista la carpeta api» cerró con
// «contiene 3 archivos» desde un resultado cortado: el
// resumen que veía el modelo era un JSON truncado a 2.000
// caracteres y la herramienta ni siquiera contaba el total.
// Ahora: la herramienta cuenta ANTES de cortar (totalDirs,
// totalFiles, truncated), el adaptador entrega al modelo un
// texto determinista con los conteos PRIMERO, y los conteos
// quedan en los hechos del turno y en su resumen.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const tools = require("../editcore-chat-kernel/tools");
const { crearEjecutarHerramienta } = require("../editcore-chat-kernel/nuevo/adaptador");
const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");

function poblar(root, nombre, nArchivos, nCarpetas) {
  const dir = path.join(root, nombre);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < nArchivos; i++) fs.writeFileSync(path.join(dir, `archivo-${String(i).padStart(3, "0")}.txt`), "x");
  for (let i = 0; i < nCarpetas; i++) fs.mkdirSync(path.join(dir, `carpeta-${i}`));
  return dir;
}

test("tools.execute list_files: carpeta grande trae totales reales y truncated", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-lista-grande-"));
  poblar(root, "sub", 90, 5);
  const r = await tools.execute("list_files", { path: "sub" }, root, false, {});
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.totalFiles, 90);
  assert.equal(r.totalDirs, 5);
  assert.equal(r.truncated, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("tools.execute list_files: carpeta chica trae totales exactos y truncated false", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-lista-chica-"));
  poblar(root, "chica", 3, 2);
  const r = await tools.execute("list_files", { path: "chica" }, root, false, {});
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
  assert.equal(r.totalFiles, 3);
  assert.equal(r.totalDirs, 2);
  assert.equal(r.truncated, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("adaptador: el resumen de list_files para el modelo abre con los conteos", async () => {
  const ejecutar = crearEjecutarHerramienta({
    root: "/proyecto",
    helpers: {},
    execute: async () => ({
      ok: true, path: "api", dirs: ["v1"], files: ["ai.js", "turn-credentials.js", "_middleware.js"],
      totalDirs: 1, totalFiles: 3, truncated: false,
    }),
  });
  const r = await ejecutar("list_files", { path: "api" });
  assert.equal(r.ok, true);
  assert.match(r.resumen, /^Carpeta api: 1 carpetas, 3 archivos\./);
  assert.match(r.resumen, /ai\.js/);
  assert.deepEqual(r.listado, { path: "api", totalDirs: 1, totalFiles: 3, truncated: false });
});

test("adaptador: listado truncado avisa que hay más elementos de los mostrados", async () => {
  const ejecutar = crearEjecutarHerramienta({
    root: "/proyecto",
    helpers: {},
    execute: async () => ({
      ok: true, path: "sub", dirs: ["a", "b"], files: ["f1.txt", "f2.txt"],
      totalDirs: 5, totalFiles: 90, truncated: true,
    }),
  });
  const r = await ejecutar("list_files", { path: "sub" });
  assert.match(r.resumen, /^Carpeta sub: 5 carpetas, 90 archivos\./);
  assert.match(r.resumen, /parcial|más elementos|de 95/);
  assert.equal(r.listado.truncated, true);
});

test("turno simulado: el cierre declara los conteos del listado desde los hechos", async () => {
  let llamada = 0;
  const r = await ejecutarTurno({
    texto: "lista la carpeta datos",
    llamarModelo: async () => {
      llamada += 1;
      if (llamada === 1) return { toolCalls: [{ nombre: "list_files", args: { path: "datos" } }], uso: { total: 1000 } };
      return { texto: "Esto es lo que hay.", uso: { total: 800 } };
    },
    ejecutarHerramienta: async () => ({
      ok: true,
      resumen: "Carpeta datos: 9 carpetas, 3 archivos.",
      listado: { path: "datos", totalDirs: 9, totalFiles: 3, truncated: false },
    }),
    herramientasCompletas: ["list_files"],
  });
  assert.equal(r.carril, "CONSULTA");
  assert.equal(r.hechos.listados.length, 1);
  assert.match(r.resumen, /9 carpetas, 3 archivos/);
});
