"use strict";
// ============================================================
// COMANDOS VISIBLES — la causa raíz del «falló run_command»
// (2026-11-18). El registro del turno en vivo (20:08–20:10Z,
// Auto → kimi-k2.6) mostró un turno de 51 pasos que exploró
// bien, concluyó que el SaaS ya existía y murió verificando:
// run_command falló 3 veces y el cierre lo redujo a «No pude
// completar el turno: falló run_command, run_command,
// run_command». Leyendo la costura se vio por qué: el resumen
// que el adaptador entrega al modelo tomaba SOLO r.output
// (stdout) — el código de salida y stderr jamás llegaban, y un
// comando fallido sin stdout llegaba como la palabra «fallo».
// El modelo volaba ciego: sin error a la vista no hay cambio
// de curso posible. Esta batería fija el contrato nuevo:
//   1. El modelo VE el resultado del comando: código, error
//      declarado y la cola de stderr antes que la de stdout.
//   2. Al segundo fallo seguido de la misma herramienta, el
//      resultado lleva la orden de cambiar de curso.
//   3. Si el bucle termina justo tras ejecutar herramientas,
//      el modelo cierra el turno con su voz (llamada de cierre),
//      no el piso anti-mudo.
//   4. Si aun así el piso habla, habla DESDE los hechos (pasos,
//      aciertos y el primer error con detalle), no con la
//      línea desnuda que borra el turno.
//   5. Cada herramienta ejecutada narra UNA línea de actividad
//      (✓/✗) por el canal de narración.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

const { manejarChatNuevo } = require("../editcore-chat-kernel/nuevo/adaptador");
const { componerCierre } = require("../editcore-chat-kernel/nuevo/cierre");

const ORDEN_SAAS = "Necesito un SaaS completo y funcional para una empresa de renta de equipos de impresión: reportes de servicio con número de folio automático, solicitudes de tóner con seguimiento de estado, y gestión de equipos con sus contadores y fechas de contrato. Con Next.js, TypeScript, Tailwind y Supabase (tablas profiles, equipment, service_reports y toner_requests, con autenticación y panel protegido). Hazlo en este proyecto.";

const DEFS = [
  { type: "function", function: { name: "list_files", description: "Lista.", parameters: { type: "object", properties: { path: { type: "string" } } } } },
  { type: "function", function: { name: "run_command", description: "Ejecuta.", parameters: { type: "object", properties: { command: { type: "string" }, timeoutMs: { type: "number" } }, required: ["command"] } } },
];

const TEXTO = (content) => ({ content, toolCalls: [], usage: { input_tokens: 10, output_tokens: 8 } });
const LLAMADA_RUN = { content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "run_command", arguments: JSON.stringify({ command: "npm run build", timeoutMs: 60000 }) } }], usage: { input_tokens: 10, output_tokens: 5 } };
const LLAMADA_LIST = { content: "", toolCalls: [{ id: "c2", type: "function", function: { name: "list_files", arguments: JSON.stringify({ path: "rental-equipment-saas" }) } }], usage: { input_tokens: 10, output_tokens: 5 } };
const BASE = { threadId: "t", runId: "r", apiBaseUrl: "x", apiKey: "k", model: "m", history: [] };

const FALLO_BUILD = { ok: false, code: 1, output: "", stderr: "npm ERR! Missing script: \"build\"\nnpm ERR! A complete log of this run can be found in: /logs" };
const LISTADO_REAL = { ok: true, path: "rental-equipment-saas", dirs: ["src", "supabase"], files: ["package.json"], totalDirs: 2, totalFiles: 1 };

function depsConGuion(guion, execute, capturas, actividad) {
  let llamada = 0;
  return {
    callChat: async (params) => {
      capturas.push(JSON.stringify(params || {}));
      const paso = guion[Math.min(llamada, guion.length - 1)];
      llamada += 1;
      return paso;
    },
    getToolDefinitions: () => DEFS,
    execute,
    construirMemoria: async () => "",
    ...(actividad ? { onActividad: (linea) => actividad.push(linea) } : {}),
  };
}

test("el modelo VE el error del comando: código de salida y stderr en el resultado", async () => {
  const capturas = [];
  const actividad = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: ORDEN_SAAS },
    depsConGuion(
      [LLAMADA_RUN, TEXTO("La verificación no pasó: falta el script build en el proyecto. El SaaS existe, pero no pude compilarlo.")],
      async (nombre) => (nombre === "run_command" ? FALLO_BUILD : LISTADO_REAL),
      capturas,
      actividad,
    ),
  );
  assert.equal(capturas.length, 2, "comando → cierre del modelo");
  assert.match(capturas[1], /FALLÓ \(código de salida 1\)/, "el modelo recibe el código de salida");
  assert.match(capturas[1], /npm ERR! Missing script/, "el modelo recibe el stderr, no la palabra «fallo»");
  assert.match(out.steps[0].resumen, /stderr:/, "el resumen del paso declara la sección stderr");
  assert.match(out.text, /no pude compilarlo/, "la voz final es la del modelo, no el piso");
  assert.ok(actividad.some((l) => l.startsWith("✗ run_command")), "la actividad narra el fallo en vivo");
});

test("al segundo fallo seguido de la misma herramienta, el resultado ordena cambiar de curso", async () => {
  const capturas = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: ORDEN_SAAS },
    depsConGuion(
      [LLAMADA_RUN, LLAMADA_RUN, TEXTO("El build no pasa por el script ausente; lo dejo declarado sin reintentar lo mismo.")],
      async () => FALLO_BUILD,
      capturas,
      null,
    ),
  );
  assert.equal(capturas.length, 3, "dos comandos → cierre");
  assert.match(capturas[2], /ya falló dos veces seguidas/, "la dirección llega al modelo en el segundo resultado");
  assert.match(out.text, /sin reintentar lo mismo/);
});

test("si el bucle termina justo tras ejecutar, el modelo cierra con su voz (llamada de cierre)", async () => {
  const capturas = [];
  const out = await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: ORDEN_SAAS },
    depsConGuion(
      [LLAMADA_LIST, TEXTO(""), TEXTO("Revisé el proyecto: el SaaS ya existe en rental-equipment-saas, con su base construida.")],
      async () => LISTADO_REAL,
      capturas,
      null,
    ),
  );
  assert.equal(capturas.length, 3, "exploración → respuesta vacía → llamada de cierre");
  assert.match(out.text, /ya existe en rental-equipment-saas/, "la voz es la del cierre del modelo, no el piso anti-mudo");
});

test("el piso anti-mudo habla desde los hechos cuando el turno trabajó", () => {
  const pasoFallo = { nombre: "run_command", ok: false, resumen: "Resultado: FALLÓ (código de salida 1).\nstderr:\nnpm ERR! Missing script: \"build\"" };
  const c = componerCierre({
    resultado: {
      carril: "ORDEN",
      textoFinal: "",
      hechos: {
        pasos: [{ nombre: "list_files", ok: true, resumen: "Carpeta rental-equipment-saas: 2 carpetas, 1 archivos." }, pasoFallo],
        aplicados: [],
        fallos: [pasoFallo],
        denegadas: [],
        listados: [],
        archivos: [],
      },
      resumen: "Carril: ORDEN",
    },
  });
  assert.match(c.voz, /ejecutó 2 paso\(s\), 1 con éxito/, "el piso cuenta el trabajo real del turno");
  assert.match(c.voz, /npm ERR!/, "el piso nombra el primer error con su detalle");
  assert.doesNotMatch(c.voz, /^No pude completar el turno: falló run_command\./, "ya no es la línea desnuda que borra el turno");
});

test("la actividad narra también el acierto, con el comando a la vista", async () => {
  const capturas = [];
  const actividad = [];
  await manejarChatNuevo(
    { ...BASE, projectRoot: "/tmp/x", message: ORDEN_SAAS },
    depsConGuion(
      [LLAMADA_RUN, TEXTO("Compilación verificada: el proyecto construye.")],
      async () => ({ ok: true, code: 0, output: "built in 3s", stderr: "" }),
      capturas,
      actividad,
    ),
  );
  const linea = actividad.find((l) => l.startsWith("✓ run_command"));
  assert.ok(linea, "hay línea de actividad del comando exitoso");
  assert.match(linea, /npm run build/, "la línea nombra el comando");
  assert.match(linea, /Resultado: OK/, "la línea nombra el resultado");
});
