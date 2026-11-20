"use strict";
// ============================================================
// COMANDOS EN POWERSHELL — el modelo emite dialecto cmd
// («cd /d "ruta" && npm install», visto en el registro de
// turnos de Luis, 2026-11-17) y el run_command del kernel
// corre con powershell.exe, donde «/d» no existe y «&&» no
// separa en Windows PowerShell 5.1: el comando moría al
// instante y el turno cerraba con «falló run_command».
// traducirParaPowerShell adapta SOLO esas dos formas; el
// resto del comando queda intacto.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { traducirParaPowerShell } = require("../runtime/tools/process-runner");

test("el comando exacto del registro: cd /d + && se vuelve PowerShell válido", () => {
  const original = 'cd /d "D:\\PROGRAMAS IA\\sistemas contino\\rental-equipment-saas" && npm install';
  const traducido = traducirParaPowerShell(original);
  assert.equal(traducido, 'cd "D:\\PROGRAMAS IA\\sistemas contino\\rental-equipment-saas"; npm install');
});

test("sin formas cmd, el comando no se toca", () => {
  assert.equal(traducirParaPowerShell("npm run build"), "npm run build");
  assert.equal(traducirParaPowerShell("git status"), "git status");
});

test("cadenas largas: cada && se separa y el cd /d intermedio también se adapta", () => {
  assert.equal(
    traducirParaPowerShell("npm install && cd /d \"D:\\x\" && npm run dev"),
    'npm install; cd "D:\\x"; npm run dev',
  );
});
