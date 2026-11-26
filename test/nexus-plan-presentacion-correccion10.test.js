// ============================================================
// CORRECCIÓN 10 — el plan se presenta como lista viva (2026-11-26)
//
// Juicio en vivo de Luis (2026-11-26 12:17): el plan de la C9
// SÍ apareció, pero como texto plano roto (los números
// huérfanos en su línea) — «se ve mal, parece algo tan simple,
// poco profesional», no como en Antigravity. La presentación
// que esta batería exige:
//  - El plan se parsea a pasos (extractPlanTodos, ya existía).
//  - marcarPasosPlan cruza los pasos del plan con las
//    herramientas REALES del turno y les da estado: hecho,
//    activo, pendiente, error — por clase de trabajo (explorar/
//    revisar, escribir/aplicar, verificar, reportar).
//  - El renderer pinta el plan como TARJETA con lista de
//    estados dentro del chat (agent-plan-inline), no como
//    prosa; el panel lateral sigue apagado a propósito.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const view = require("../runtime/agent-plan-view");

const PLAN_REVISION = "Voy a trabajar así:\n1. Revisar la seguridad\n2. Revisar los datos\n3. Reportar lo hecho y proponer el siguiente paso";
const paso = (name, ok = true) => ({ name, ok });

test("V-1: el plan de la captura se parsea a sus 3 pasos", () => {
  const todos = view.extractPlanTodos(PLAN_REVISION);
  assert.equal(todos.length, 3);
  assert.equal(todos[0].label, "Revisar la seguridad");
  assert.equal(todos[2].label, "Reportar lo hecho y proponer el siguiente paso");
});

test("V-2: en vivo, explorar marca los frentes y el reporte queda activo", () => {
  const marcados = view.marcarPasosPlan(PLAN_REVISION, [paso("list_files"), paso("read_file"), paso("delegate_parallel")], false);
  assert.equal(marcados[0].status, "done");
  assert.equal(marcados[1].status, "done");
  assert.equal(marcados[2].status, "active");
});

test("V-3: al cerrar el turno, el reporte queda hecho", () => {
  const marcados = view.marcarPasosPlan(PLAN_REVISION, [paso("list_files"), paso("read_file")], true);
  assert.equal(marcados[0].status, "done");
  assert.equal(marcados[2].status, "done");
});

test("V-4: construir hecho y verificación fallida se reflejan", () => {
  const plan = "Voy a trabajar así:\n1. Explorar el proyecto para ubicar dónde va\n2. Construir lo pedido\n3. Verificar el resultado\n4. Reportar lo hecho y proponer el siguiente paso";
  const marcados = view.marcarPasosPlan(plan, [paso("read_file"), paso("write_file"), paso("run_command", false)], false);
  assert.equal(marcados[0].status, "done");
  assert.equal(marcados[1].status, "done");
  assert.equal(marcados[2].status, "error");
});

test("V-5: sin pasos ejecutados, todo queda pendiente", () => {
  const marcados = view.marcarPasosPlan(PLAN_REVISION, [], false);
  assert.ok(marcados.every((t) => t.status === "pending"));
});

test("V-6: el renderer pinta la tarjeta del plan y styles la define", () => {
  const renderer = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
  assert.ok(renderer.includes("agent-plan-inline"), "el renderer crea la tarjeta del plan en el chat");
  assert.ok(renderer.includes("marcarPasosPlan"), "el renderer marca estados desde los pasos reales");
  assert.ok(styles.includes(".agent-plan-inline"), "styles.css define la tarjeta");
});
