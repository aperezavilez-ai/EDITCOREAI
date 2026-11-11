"use strict";

// PRESENCIA / CIERRE PROPOSITIVO (v4.7.4): la C-1 en vivo mostró dos cierres
// «mochos» seguidos — el agente traía la evidencia correcta y terminaba el
// turno sin proponer nada y sin pedir la autorización, dejando al usuario
// sin siguiente paso. La compuerta del despacho (contrato v4.7.2) solo
// habla si el modelo INTENTA escribir; esta disciplina de cierre cubre al
// modelo que nunca intenta: si el pedido implica mutación, no se escribió
// nada y el cierre no trae ni propuesta ni pregunta, el turno se devuelve
// UNA vez con la orden de cerrar como agente propositivo.
// También: la directiva de idioma del turno (espejo del usuario) y la
// pertinencia visual en la política de UI élite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-presencia-"));
}

const BARE_REPORT = "Revisé los archivos en disco: src/components/layout/Footer.tsx está escrito en una sola línea con secuencias literales y src/components/layout/Navbar.tsx presenta exactamente el mismo problema.";
const PROPOSAL = "Con la evidencia de disco, mi propuesta es reescribir Footer.tsx y Navbar.tsx con saltos de línea reales y verificar con el preview activo hasta que cargue sin overlay. ¿Procedo?";

test("presencia: en «Pregunta antes» el turno NO cierra en reporte pelado — el kernel exige propuesta y pedido de autorización", async () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "src", "components", "layout"), { recursive: true });
  const blob = "import * as React from 'react';\\nimport { Wrench } from 'lucide-react';\\n\\nexport default function Footer() { return null; }\\n";
  fs.writeFileSync(path.join(root, "src", "components", "layout", "Footer.tsx"), blob);

  const capture = [];
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      const allText = (args.messages || []).map((m) => String(m.content || "")).join("\n");
      capture.push(allText);
      if (allText.includes("reporte pelado")) {
        return { text: PROPOSAL, toolCalls: [], usage: {} };
      }
      if (calls === 1) return { text: BARE_REPORT, toolCalls: [], usage: {} };
      return { text: PROPOSAL, toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "corrige los archivos Footer.tsx y Navbar.tsx que quedaron escritos en una sola línea",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: true, fullAccess: false,
    helpers, history: [],
  });

  assert.ok(capture.some((t) => t.includes("No cierres con un reporte pelado")), "el kernel devolvió el turno exigiendo propuesta + autorización");
  assert.ok(String(out.text || "").includes("¿Procedo?"), "el cierre final trae la propuesta y la pregunta al usuario");
  assert.equal(fs.readFileSync(path.join(root, "src", "components", "layout", "Footer.tsx"), "utf8"), blob, "sin autorización, el archivo sigue intacto");
});

test("presencia: la directiva de idioma del turno sigue al usuario (español e inglés)", async () => {
  async function run(message) {
    const capture = [];
    const orch = new ChatOrchestrator();
    await orch.handle({
      message,
      projectRoot: tmpProject(), apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
      permissionMode: "full", allowWrite: true, fullAccess: true,
      helpers: {
        callChat: async (args) => {
          capture.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
          return { text: "Entendido.", toolCalls: [], usage: {} };
        },
      },
      history: [],
    });
    return capture.join("\n");
  }

  const es = await run("crea el archivo nota.txt con un saludo para el cliente");
  assert.ok(es.includes("IDIOMA DEL USUARIO: ESPAÑOL"), "con mensaje en español, la directiva ordena salida visible en español");

  const en = await run("create the file note.txt with a greeting for the client");
  assert.ok(en.includes("USER LANGUAGE: ENGLISH"), "con mensaje en inglés, la directiva cambia a inglés");
});

test("presencia: la política de UI élite exige pertinencia visual del hero", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "runtime", "elite-ui-policy.js"), "utf8");
  assert.match(source, /PERTINENCIA/);
  assert.match(source, /corresponde al negocio/);
  assert.match(source, /NO está terminada/);
});
