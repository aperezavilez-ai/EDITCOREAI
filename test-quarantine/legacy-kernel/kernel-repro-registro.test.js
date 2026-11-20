"use strict";
// ============================================================
// REPRODUCCIÓN DE LOS TRES TURNOS REALES DEL REGISTRO
// (turnos.jsonl en la máquina de Luis), de punta a punta por
// el puente real con las herramientas reales sobre carpetas
// temporales — el mismo recorrido que corre en producción:
//   A) «procede» sustituido por el enlatado AUTORIZACION con
//      plan guardado ajeno → debe construir EN LA RAÍZ.
//   B) Orden del SaaS con el SaaS YA EXISTENTE en una
//      subcarpeta → el reporte veraz del agente («Ya tienes…»)
//      debe LLEGAR al chat, no el aviso de la guarda.
//   C) Propuesta pedida y el modelo «ya creó» todo sin tocar
//      una herramienta → la corrección dentro del turno debe
//      terminar entregando LA PROPUESTA.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { handleChatKernel } = require("../runtime/chat-kernel-bridge");

function llamada(texto, toolCalls = []) {
  return { text: texto, toolCalls, usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 } };
}
function tc(id, nombre, args) {
  return { id, function: { name: nombre, arguments: JSON.stringify(args) } };
}
function mockDe(respuestas) {
  let i = 0;
  return async () => respuestas[Math.min(i++, respuestas.length - 1)];
}
function base(tmpDir, mockCallChat, extra = {}) {
  return {
    projectRoot: tmpDir,
    apiKey: "test",
    model: "test-model",
    allowWrite: true,
    permissionMode: "full",
    fullAccess: true,
    helpers: { callChat: mockCallChat },
    onProgress: () => {},
    ...extra,
  };
}

const BLOB = [
  "AUTORIZACION DE EJECUCION (PROCEDE): las reglas de DIAGNOSTICO / NO MODIFICAR del analisis previo quedan ANULADAS para esta corrida.",
  "Puedes usar write_file y replace_in_file sobre codigo real del proyecto abierto.",
  "SOLICITUD ORIGINAL (sanitizada):\nnecesito un saas donde los clientes levanten reportes de fallas y pidan toner con folio",
  "PLAN YA AUTORIZADO POR EL USUARIO:\nseguir construyendo sobre rental-equipment-saas e instalar sus dependencias",
  "INSTRUCCION DE EJECUCION:",
  "Al terminar incluye ## Evidencia de correccion.",
].join("\n\n");

test("A) procede con enlatado: construye en la RAÍZ, no en la subcarpeta del plan guardado", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-a-"));
  const mock = mockDe([
    llamada("", [tc("1", "write_file", { path: "package.json", content: "{\"name\":\"saas\"}" })]),
    llamada("", [tc("2", "write_file", { path: "app/page.tsx", content: "export default function Page() { return null; }" })]),
    llamada("Listo: package.json y app/page.tsx creados en la raíz del proyecto."),
  ]);
  const res = await handleChatKernel(base(tmpDir, mock, {
    message: BLOB,
    planAuthorizedExecution: true,
    history: [
      { role: "user", content: "necesito un saas donde los clientes levanten reportes de fallas y pidan toner con folio" },
      { role: "assistant", content: "Propuesta: SaaS en la raíz con package.json, app/ y prisma/. ¿Apruebas esta propuesta o quieres ajustar algo?" },
    ],
  }));
  assert.equal(res.ok, true);
  assert.equal(res.kind, "ORDEN");
  assert.ok(fs.existsSync(path.join(tmpDir, "package.json")), "package.json en la raíz");
  assert.ok(fs.existsSync(path.join(tmpDir, "app", "page.tsx")), "app/page.tsx en la raíz");
  assert.ok(!fs.existsSync(path.join(tmpDir, "rental-equipment-saas")), "nada en la subcarpeta del plan guardado");
});

test("B) el SaaS ya existe en una subcarpeta: el reporte veraz llega al chat", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-b-"));
  fs.mkdirSync(path.join(tmpDir, "rental-equipment-saas", "src"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "rental-equipment-saas", "package.json"), "{\"name\":\"rental-equipment-saas\"}");
  const reporte = "¡Ya tienes un proyecto SaaS completo implementado en la carpeta `rental-equipment-saas`! Reportes de servicio con número de folio (se genera automáticamente al crear el reporte), solicitudes de toner y gestión de equipos con contador. ¿Qué quieres hacer ahora: revisarlo, desplegarlo o ampliarlo?";
  const mock = mockDe([
    llamada("", [tc("1", "list_files", { path: "" })]),
    llamada("", [tc("2", "read_file", { path: "rental-equipment-saas/package.json" })]),
    llamada(reporte),
  ]);
  const res = await handleChatKernel(base(tmpDir, mock, {
    message: "crea una aplicacion o un saas donde los clientes puedan hacer levantamientos de reportes de sus equipos que tienen bajo contrato de renta y les pueda asignar un numero de folio",
  }));
  assert.equal(res.ok, true);
  assert.match(res.text, /Ya tienes un proyecto SaaS/);
  assert.ok(!/Este turno no aplicó cambios/.test(res.text), "la guarda no tapa el reporte veraz");
});

test("C) propuesta pedida, autoría fingida: el turno termina entregando la propuesta", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repro-c-"));
  const mock = mockDe([
    llamada("Ya creé tu SaaS completo: package.json, app/page.tsx y prisma/schema.prisma quedaron listos."),
    llamada("Propuesta: construir el SaaS en la raíz del proyecto — primero package.json y la base, después prisma/schema.prisma con los modelos de reportes y tóner, y al final las páginas de app/. ¿La apruebas o quieres ajustar algo?"),
  ]);
  const res = await handleChatKernel(base(tmpDir, mock, {
    message: "quiero un saas de reportes para mis clientes, espero tu mejor propuesta o que me propones tu",
  }));
  assert.equal(res.ok, true);
  assert.equal(res.kind, "PROPUESTA");
  assert.match(res.text, /^Propuesta:/);
});
