// ============================================================
// CORRECCIÓN 8 — cierre-recibo y fuera el menú «procede» (2026-11-26)
//
// Réplica del turno real con Groq (AI ANALYTICS, 2026-11-26
// 11:47, captura de Luis): el agente exploró 74 archivos, su
// voz anunció «Los subagentes no están entregando. Leo
// directamente los archivos críticos…» — y el cierre le cosió
// el menú enlatado «¿Cómo deseas continuar? / Escribe
// «procede»…» (cierre.js: la sugerencia se pega a TODO turno
// sin archivos aplicados cuya voz no traiga ya una pregunta).
// El informe nunca llegó; el turno murió en el menú.
//
// Contrato que esta batería exige:
//  1. El menú «procede» MUERE: ningún cierre lo contiene, en
//     ningún carril ni con ningún tipo de turno.
//  2. Si el modelo no cerró con propuesta, el cierre agrega la
//     PROPUESTA del agente, concreta y derivada de los hechos
//     (si la delegación falló: leer directamente los frentes;
//     si hubo fallos: corregir el primero; si aplicó: verificar;
//     si exploró: aplicar las correcciones de la revisión).
//  3. Si la voz la compuso el piso (voz vacía), además va el
//     RECIBO del turno: lo explorado, lo aplicado, lo que falló
//     — sin duplicar lo que la voz ya dice.
//  4. Si el modelo SÍ cerró con su propuesta, el cierre no
//     agrega nada. Y un turno de conversación sin trabajo no
//     recibe ni recibo ni menú: la conversación queda natural.
// ============================================================
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { componerCierre } = require("../runtime/tools/nuevo/cierre");

const MENU = "¿Cómo deseas continuar?";
const pasoLectura = (ruta) => ({ nombre: "read_file", ok: true, resumen: `Leído: ${ruta}` });

// El turno de la captura: delegación sin entregas + exploración
// real + la voz real del modelo (anuncia, no propone).
function turnoCaptura(textoFinal) {
  return {
    carril: "ORDEN",
    textoFinal,
    resumen: "Turno ORDEN · 7 herramientas ejecutadas",
    herramientasEjecutadas: 7,
    hechos: {
      aplicados: [],
      archivos: [],
      fallos: [{ nombre: "delegate_parallel", ok: false, resumen: "Subagentes: 0/2 entregaron" }],
      denegadas: [],
      listados: [],
      pasos: [
        { nombre: "delegate_parallel", ok: false, resumen: "Subagentes: 0/2 entregaron" },
        pasoLectura("src/app/page.tsx"),
        pasoLectura("prisma/schema.prisma"),
        pasoLectura("src/lib/auth.js"),
        pasoLectura("package.json"),
        { nombre: "list_files", ok: true, resumen: "Carpeta .: 6 carpetas, 17 archivos" },
        { nombre: "search_files", ok: true, resumen: "3 coincidencias de «password»" },
      ],
    },
  };
}

test("C8-1: el turno de la captura cierra con propuesta real, no con el menú", () => {
  const { voz } = componerCierre({
    resultado: turnoCaptura("Los subagentes no están entregando. Leo directamente los archivos críticos que faltan para cerrar el diagnóstico de seguridad y datos."),
  });
  assert.ok(voz.startsWith("Los subagentes no están entregando."), "la voz del modelo se conserva");
  assert.ok(!voz.includes(MENU), "el menú enlatado no aparece");
  assert.ok(!voz.includes("«procede»"), "nada de «procede» enlatado");
  assert.ok(voz.includes("Siguiente paso que propongo"), "el cierre propone");
  assert.match(voz, /leo directamente los frentes/i, "la propuesta responde al hecho: la delegación no entregó");
});

test("C8-2: el mismo turno con la voz vacía trae recibo + propuesta", () => {
  const { voz } = componerCierre({ resultado: turnoCaptura("") });
  assert.ok(!voz.includes(MENU), "sin menú");
  assert.match(voz, /Exploré \d+ archivos/, "el recibo cuenta la exploración real");
  assert.ok(voz.includes("Siguiente paso que propongo"), "y propone");
});

test("C8-3: con archivos aplicados, la propuesta es verificar el resultado", () => {
  const { voz } = componerCierre({
    resultado: {
      carril: "ORDEN",
      textoFinal: "Ya quedó el archivo de notas con el resumen.",
      resumen: "",
      herramientasEjecutadas: 1,
      hechos: {
        aplicados: ["notas.md"], archivos: [{ path: "notas.md" }], fallos: [], denegadas: [], listados: [],
        pasos: [{ nombre: "write_file", ok: true, resumen: "Archivo creado: notas.md" }],
      },
    },
  });
  assert.ok(!voz.includes(MENU), "sin menú");
  assert.ok(voz.includes("Siguiente paso que propongo"), "propone");
  assert.match(voz, /verificar el resultado/i, "tras aplicar, lo que sigue es verificar");
});

test("C8-4: si el modelo ya cerró con su propuesta, el cierre no agrega nada", () => {
  const texto = "Revisé los dos frentes y los datos están definidos en el esquema. Te propongo corregir primero las políticas de acceso. ¿Empezamos por ahí?";
  const { voz } = componerCierre({
    resultado: {
      carril: "ORDEN", textoFinal: texto, resumen: "", herramientasEjecutadas: 3,
      hechos: {
        aplicados: [], archivos: [], fallos: [], denegadas: [], listados: [],
        pasos: [pasoLectura("prisma/schema.prisma"), pasoLectura("src/lib/auth.js"), pasoLectura("package.json")],
      },
    },
  });
  assert.equal(voz, texto, "la voz del modelo queda intacta");
});

test("C8-5: conversación sin trabajo: ni recibo ni menú", () => {
  const { voz } = componerCierre({
    resultado: {
      carril: "CONVERSACION", textoFinal: "Claro: una API es la interfaz con la que dos programas se hablan.", resumen: "",
      herramientasEjecutadas: 0,
      hechos: { aplicados: [], archivos: [], fallos: [], denegadas: [], listados: [], pasos: [] },
    },
  });
  assert.ok(!voz.includes(MENU), "sin menú");
  assert.ok(!voz.includes("Siguiente paso que propongo"), "sin recibo cosido a la conversación");
  assert.ok(!voz.includes("Exploré"), "sin contabilidad en la voz");
});

test("C8-6: con un fallo en el turno, la propuesta es corregirlo", () => {
  const { voz } = componerCierre({
    resultado: {
      carril: "ORDEN", textoFinal: "", resumen: "", herramientasEjecutadas: 3,
      hechos: {
        aplicados: [], archivos: [],
        fallos: [{ nombre: "run_command", ok: false, resumen: "npm run build salió con código 1" }],
        denegadas: [], listados: [],
        pasos: [
          pasoLectura("package.json"),
          { nombre: "run_command", ok: false, resumen: "npm run build salió con código 1" },
          pasoLectura("src/app/page.tsx"),
        ],
      },
    },
  });
  assert.ok(!voz.includes(MENU), "sin menú");
  assert.ok(voz.includes("Siguiente paso que propongo"), "propone");
  assert.match(voz, /corregir el fallo en run_command/i, "la propuesta nombra el fallo real");
});
