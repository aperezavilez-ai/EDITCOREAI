"use strict";

// CONTRATO DE TURNO (corrección de raíz, 2026-11-10): en modo Agente el
// agente NUNCA se queda sin manos a mitad de conversación. Las herramientas
// se VEN siempre; lo que el modo de permisos decide es si la escritura se
// EJECUTA (Acceso completo / «procede») o se corta en el despacho con un
// pedido de autorización visible. Antes, en «Pregunta antes» sin
// autorización previa, el set de herramientas salía recortado y el agente
// decía "no tengo herramienta de escritura directa" y delegaba a ciegas
// (turno de reparación de TALLE PRUEBA: 139k tokens, cero archivos).
// Este archivo camina el camino COMPLETO (handle → clasificación →
// runModelTask → despacho), no el motor suelto.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const tools = require("../editcore-chat-kernel/tools");
const { parseTextToolCalls } = require("../editcore-chat-kernel/parse-text-tools");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-contrato-"));
}

// Modelo guionizado: la primera llamada pide write_file; captura las
// herramientas OFRECIDAS y los mensajes (para ver el resultado del despacho).
function scriptedHelpers(capture, extra = {}) {
  let calls = 0;
  return {
    ...extra,
    callChat: async (args) => {
      calls += 1;
      capture.push({
        tools: (args.tools || []).map((t) => t.function?.name || t.name),
        allText: (args.messages || []).map((m) => String(m.content || "")).join("\n"),
      });
      if (calls === 1) {
        return {
          text: "Voy a crear el archivo.",
          toolCalls: [{
            id: "call_w1",
            function: { name: "write_file", arguments: JSON.stringify({ path: "nota.txt", content: "hola\n" }) },
          }],
          usage: {},
        };
      }
      return { text: "Listo.", toolCalls: [], usage: {} };
    },
  };
}

test("contrato: en «Pregunta antes» SIN autorización el agente VE write_file y run_command, pero el despacho corta la escritura pidiendo autorización", async () => {
  const root = tmpProject();
  const capture = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "crea el archivo nota.txt con un saludo",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: true, fullAccess: false,
    helpers: scriptedHelpers(capture), history: [],
  });
  assert.ok(capture.length >= 1, "el modelo fue llamado");
  assert.ok(capture[0].tools.includes("write_file"), "write_file VISIBLE en step sin autorización (antes desaparecía)");
  assert.ok(capture[0].tools.includes("run_command"), "run_command VISIBLE en step sin autorización");
  assert.equal(fs.existsSync(path.join(root, "nota.txt")), false, "sin autorización el archivo NO se escribe");
  assert.ok(capture.length >= 2 && /autorización/i.test(capture[1].allText), "el resultado del despacho pide autorización en voz alta");
  assert.ok(out && typeof out.text === "string");
});

test("contrato: en «Pregunta antes» CON plan autorizado la escritura sí fluye", async () => {
  const root = tmpProject();
  const capture = [];
  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "crea el archivo nota.txt con un saludo",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: true, fullAccess: false, planAuthorizedExecution: true,
    helpers: scriptedHelpers(capture), history: [],
  });
  assert.ok(capture[0].tools.includes("write_file"));
  assert.equal(fs.existsSync(path.join(root, "nota.txt")), true, "con autorización el archivo se escribe");
});

test("contrato: en solo lectura las herramientas se ven pero el despacho bloquea con su mensaje", async () => {
  const root = tmpProject();
  const capture = [];
  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "crea el archivo nota.txt con un saludo",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "readonly", allowWrite: false, fullAccess: false,
    helpers: scriptedHelpers(capture), history: [],
  });
  assert.ok(capture.length >= 1);
  assert.equal(fs.existsSync(path.join(root, "nota.txt")), false, "en solo lectura nada se escribe");
  assert.ok(capture.length >= 2 && /solo lectura/i.test(capture[1].allText), "el bloqueo dice «solo lectura»");
});

test("integridad: el parser de texto desescapa un blob de una línea con \\n literales", () => {
  const blob = "import React from 'react';\\nimport { X } from './x';\\n\\nexport default function A() { return null; }";
  const text = `<tool_call><function=write_file><parameter=path>src/A.tsx</parameter><parameter=content>${blob}</parameter></function></tool_call>`;
  const calls = parseTextToolCalls(text, { projectRoot: "/tmp/p" });
  assert.equal(calls.length, 1);
  const args = JSON.parse(calls[0].function.arguments);
  assert.ok(args.content.includes("\n"), "el contenido llega con saltos de línea reales");
  assert.ok(!args.content.includes("\\n"), "no quedan escapes literales");
});

test("integridad: writeFile RECHAZA un blob escapado en código y no toca el disco; el contenido normal pasa", () => {
  const root = tmpProject();
  const blob = "import React from 'react';\\nimport { Wrench, Menu, X, Phone } from 'lucide-react';\\nimport { Button } from '@/components/ui/Button';\\n\\nexport default function Navbar() { return null; }\\n";
  const bad = tools.writeFile(root, "A.tsx", blob, {});
  assert.equal(bad.ok, false);
  assert.equal(bad.escapedBlob, true);
  assert.equal(fs.existsSync(path.join(root, "A.tsx")), false, "el blob nunca llega al disco");
  const good = tools.writeFile(root, "A.tsx", "import React from 'react';\n\nexport default function A() { return null; }\n", {});
  assert.equal(good.ok, true);
  assert.ok(fs.readFileSync(path.join(root, "A.tsx"), "utf8").includes("\n"));
});

test("temporizador: runCommand corta un proceso que no termina y lo dice", async () => {
  const root = tmpProject();
  const started = Date.now();
  const res = await tools.runCommand(root, "node -e \"setTimeout(() => {}, 30000)\"", { timeoutMs: 1000 });
  const elapsed = Date.now() - started;
  assert.equal(res.ok, false);
  assert.equal(res.timeout, true);
  assert.ok(elapsed < 15000, `el comando se cortó a tiempo (${elapsed} ms)`);
  assert.match(res.error, /límite/);
});

test("cerebro: el turno CONSULTA el Cerebro al abrir y RECUERDA el cierre; read_skill carga del catálogo", async () => {
  const root = tmpProject();
  const capture = [];
  const remembered = [];
  const orch = new ChatOrchestrator();
  const helpers = {
    callChat: async (args) => {
      capture.push({ allText: (args.messages || []).map((m) => String(m.content || "")).join("\n") });
      return { text: "Respuesta con lo consultado.", toolCalls: [], usage: {} };
    },
    brainSearch: async () => ({
      memory: [{ title: "Preferencia del usuario", content: "MARCA-CEREBRO-123: siempre Tailwind v4" }],
      knowledge: [], catalog: [],
    }),
    brainRemember: async (r, input) => { remembered.push({ root: r, input }); return { id: "x" }; },
  };
  await orch.handle({
    message: "crea el archivo nota.txt con un saludo",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [],
  });
  assert.ok(capture.some((c) => c.allText.includes("MARCA-CEREBRO-123")), "el contexto del turno incluye lo del Cerebro sin que el modelo lo pida");
  assert.equal(remembered.length, 1, "el cierre del turno se recuerda en el Cerebro");
  assert.equal(remembered[0].root, root);

  const skill = await tools.execute("read_skill", { name: "as-debugging-and-error-recovery" }, root, false, {});
  assert.equal(skill.ok, true, "read_skill encuentra la skill en el catálogo local");
  assert.ok(String(skill.content || "").length > 400, "read_skill devuelve el cuerpo completo");
});
