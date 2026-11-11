"use strict";

// RESPUESTAS ASK QUE COLAPSABAN A LISTADOS (v4.8.0, línea 4): en vivo,
// «Revisa la landing completa y dime qué secciones tiene y en qué
// archivo está cada una» (y la propia P-3) se respondieron con el
// formato 📁 de listados de archivos. Causa: listOnlyMode incluía a
// los ASK, y la finalización de runModelTask REEMPLAZABA el texto del
// modelo por formatListOnlyAnswer siempre que el turno hubiera hecho
// un list_files — aunque hubiera leído los archivos y escrito el mapa.
// Regla nueva (shouldFormatAsListing): el 📁 es solo para pedidos de
// LISTADO (kind LIST) y nunca pisa una respuesta sustantiva apoyada
// en lecturas reales más allá de list_files.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-lista-"));
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "components", "Hero.tsx"), "export function Hero() { return 'hero del taller'; }\n");
  fs.writeFileSync(path.join(root, "src", "components", "Features.tsx"), "export function Features() { return 'servicios del taller'; }\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "landing-taller" }));
  return root;
}

const MAP_TEXT = [
  "La landing tiene estas secciones y cada una vive en su propio archivo:",
  "- Hero — src/components/Hero.tsx: el titular principal del taller, la foto de portada y el botón de WhatsApp.",
  "- Servicios — src/components/Features.tsx: la lista de servicios (motor, frenos, suspensión) con su descripción.",
  "No hay más secciones montadas: el resto de la página se compone desde esos dos componentes.",
].join("\n");

test("respuestas-lista: la pregunta de secciones conserva el MAPA del modelo (no colapsa al 📁)", async () => {
  const root = tmpProject();
  let calls = 0;
  const helpers = {
    callChat: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: "",
          toolCalls: [
            { id: "l1", type: "function", function: { name: "list_files", arguments: JSON.stringify({ path: "src" }) } },
            { id: "r1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/components/Hero.tsx" }) } },
            { id: "r2", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "src/components/Features.tsx" }) } },
          ],
          usage: {},
        };
      }
      return { text: MAP_TEXT, toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "Revisa la landing completa y dime qué secciones tiene y en qué archivo está cada una",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: false, fullAccess: false,
    helpers, history: [],
  });

  const text = String(out.text || "");
  assert.ok(text.includes("Hero — src/components/Hero.tsx"), "el texto final es el mapa de secciones del modelo");
  assert.ok(!text.includes("## 📁"), "el formato de listado NO reemplazó la respuesta sustantiva");
  assert.ok(!text.includes("**Carpetas ("), "sin el esqueleto de carpetas del formato lista");
});

test("respuestas-lista: «lista los archivos de src/components» SIGUE recibiendo el formato lista", async () => {
  const root = tmpProject();
  let calls = 0;
  const helpers = {
    callChat: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: "",
          toolCalls: [
            { id: "l1", type: "function", function: { name: "list_files", arguments: JSON.stringify({ path: "src/components" }) } },
          ],
          usage: {},
        };
      }
      return { text: "Aquí están los archivos.", toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "lista los archivos de src/components",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: false, fullAccess: false,
    helpers, history: [],
  });

  const text = String(out.text || "");
  assert.ok(text.includes("## 📁"), "el pedido de listado conserva el formato 📁");
  assert.ok(text.includes("**Carpetas ("), "el formato lista incluye su esqueleto de carpetas");
  assert.ok(text.includes("src/components"), "el listado apunta a la carpeta pedida");
});
