"use strict";

// Batería ÍTEM 1 del plan de auditoría — EL BLOQUE DE CONEXIONES DEL
// KERNEL RECIBE LA BÓVEDA REAL.
// Defecto probado: buildConnectionsBlock(projectRoot), en
// editcore-chat-kernel/orchestrator.js, llamaba
// connectionsForProject({}, projectRoot) con un objeto vacío y pasaba
// ese objeto plano a formatOperatorConnectionsMemory, que espera el
// snapshot de buildSafeConnectionsSnapshot. Resultado: todo turno con
// proyecto recibía «sin configurar» en todas las líneas aunque la
// bóveda estuviera llena, porque el canal correcto —
// helpers.readConnections, que main.js ya pasa al kernel vía
// buildKernelHelpers (runtime/chat-kernel-bridge.js) y que
// extra-tools.js y tools.js ya usan — era ignorado por esa función.
// La corrección: buildConnectionsBlock(projectRoot,
// helpers?.readConnections) lee la bóveda global real, construye el
// snapshot seguro con buildSafeConnectionsSnapshot (con el
// connectionSummary de service-harness.js cargado en lazy, como en
// main.js) y formatea ese snapshot; sin lector, el bloque se omite.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-item1-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");

const BASE_ARGS = {
  apiKey: ["sk", "fake", "item1"].join("-"),
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

function emptyProject(files = {}) {
  const root = fs.mkdtempSync(path.join(tmpBase, "proj-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function payloadText(captures) {
  return captures.map((c) => JSON.stringify(c.messages)).join("\n");
}

async function runTurn({ readConnections, threadId }) {
  const root = emptyProject({ "package.json": PKG });
  const captures = [];
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      captures.push({ messages: args?.messages || [], tools: args?.tools || [] });
      return {
        text: "Reviso el estado real de conexiones y te guío paso a paso para publicar el proyecto. Siguiente paso: dime si quieres que avancemos con la publicación.",
        toolCalls: [],
        usage: USAGE,
      };
    },
  };
  if (typeof readConnections === "function") helpers.readConnections = readConnections;
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "quiero publicar este proyecto",
    projectRoot: root,
    threadId,
    helpers,
  });
  assert.ok(calls >= 1, "hubo al menos una llamada al proveedor");
  return payloadText(captures);
}

// ------------------------------------------------------------ (1)
test("(1) bóveda completa vía helpers.readConnections: el bloque dice CONECTADO en GitHub, Vercel y Supabase Oficial", async () => {
  const payload = await runTurn({
    threadId: "hilo-item1-completa",
    readConnections: () => ({
      githubToken: "ghp_fixture",
      vercelToken: "vercel_fixture",
      supabaseUrl: "https://fixture-ref.supabase.co",
      supabaseAnonKey: "anon_fixture",
    }),
  });
  assert.match(payload, /MEMORIA DE CONEXIONES/, "el bloque de conexiones viaja en el payload");
  assert.match(payload, /GitHub: CONECTADO/, "GitHub figura conectado con la bóveda llena");
  assert.match(payload, /Vercel: CONECTADO/, "Vercel figura conectado con la bóveda llena");
  assert.match(payload, /Supabase Oficial \(DB & Auth\): CONECTADO/, "Supabase Oficial figura conectado con la bóveda llena");
  assert.doesNotMatch(payload, /GitHub: sin configurar/, "GitHub NO figura «sin configurar» con la bóveda llena");
});

// ------------------------------------------------------------ (2)
test("(2) contraste con bóveda vacía: el bloque aparece y dice «sin configurar» (verdad)", async () => {
  const payload = await runTurn({
    threadId: "hilo-item1-vacia",
    readConnections: () => ({}),
  });
  assert.match(payload, /MEMORIA DE CONEXIONES/, "el bloque de conexiones viaja en el payload");
  assert.match(payload, /GitHub: sin configurar/, "con la bóveda vacía, GitHub figura «sin configurar»");
});

// ------------------------------------------------------------ (3)
test("(3) sin lector readConnections en helpers: el bloque se omite por completo", async () => {
  const payload = await runTurn({
    threadId: "hilo-item1-sin-lector",
    readConnections: undefined,
  });
  assert.doesNotMatch(payload, /MEMORIA DE CONEXIONES/, "sin lector, el encabezado del bloque NO aparece en el payload");
});
