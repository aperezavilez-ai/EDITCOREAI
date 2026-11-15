"use strict";

// Batería v5.2.0 — LA COMPUERTA DE CONEXIONES, eliminada.
// Dos turnos reales de corrección de memoria en ALFA LUBES murieron el
// 2026-11-15 (233.793 y 164.366 tokens, 0 aplicados): cualquier
// MENCIÓN de publicar/Vercel/Supabase/conectar — incluso en
// prohibiciones («No ejecutes publish_project…») — inyectaba la guía
// CONNECT_GUIDE_PROMPT en tier ESSENTIAL y, a mitad de bucle, un
// mensaje de usuario falso («Ejecuta AHORA check_connections y
// muestra checklist. Cierra SIN preguntar opciones.») que imponía el
// checklist sobre la tarea literal; el reporte resultante prescribía
// «Siguiente paso: publish_project» y etiquetaba la Supabase del
// proyecto como «Supabase propio / GAFCORE», opción que Luis eliminó
// del producto (solo Supabase oficial). Es la misma especie que
// wantsCodeSearch (eliminado en la v5.1.6-P1) y viola el invariante
// asentado ahí: ninguna compuerta del kernel inyecta un tema fijo ni
// prescribe una herramienta fuera del pedido literal.
// La corrección: fuera la inyección y el empujón con su detector
// wantsConnectionsCheck; check_connections QUEDA en el set (la elige
// el modelo cuando la tarea literal es de conexiones/publicación) sin
// el «SIEMPRE» en su descripción; el reporte ya no trae la fila
// Supabase ni prescribe publish_project (nextSteps = solo huecos
// reales de conexión); la doctrina Supabase queda corregida
// (Supabase Cloud oficial, un proyecto por app; GAFCORE dado de baja).
// La guía CONNECT_GUIDE_PROMPT, su detector wantsConnectGuide y su
// regex CONNECT_INTENT quedaron eliminados de self-knowledge.js en
// la segunda pasada (decisión de Lu, 2026-11-15), re-delimitando el
// caso de test/agent-network-memory.test.js que los afirmaba con la
// justificación escrita dentro del test (precedente v5.1.7); la
// compuerta espejo de web-portal/js/web-agent.js salió con el mismo
// criterio.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v520-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const selfKnowledge = require("../editcore-chat-kernel/self-knowledge");
const {
  SELF_KNOWLEDGE_PROMPT,
  formatConnectionsChecklist,
} = selfKnowledge;
const extraTools = require("../editcore-chat-kernel/extra-tools");
const orientationMap = require("../editcore-chat-kernel/orientation-map");

const BASE_ARGS = {
  apiKey: ["sk", "fake", "v520"].join("-"),
  apiBaseUrl: "https://example.invalid",
  model: "gpt-5",
  permissionMode: "full",
  allowWrite: true,
  fullAccess: true,
  history: [],
};
const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

let callSeq = 0;
function toolCall(name, args) {
  callSeq += 1;
  return { id: `call_${name}_${callSeq}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedHelpers(script, captures) {
  let calls = 0;
  return {
    callChat: async (args) => {
      calls += 1;
      if (captures) captures.push({ messages: args?.messages || [], tools: args?.tools || [] });
      const step = script[Math.min(calls - 1, script.length - 1)];
      return typeof step === "function" ? step(calls, args) : step;
    },
  };
}

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

// ------------------------------------------------------------ (a)
test("(a) corrección de memoria que MENCIONA publicar/Vercel/Supabase en prohibición ejecuta la tarea literal, sin guía ni empujón ni check_connections", async () => {
  const root = emptyProject({ "package.json": PKG });
  orientationMap.openMapFront(root, "Publicación a producción del sitio", "batería v520");
  const captures = [];
  const res = await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "No ejecutes publish_project ni revises conexiones de Vercel o Supabase. Cierra el frente «Publicación a producción del sitio» en el Mapa asentando que la publicación ya se hizo el 2026-11-14 (commit cc75c0a) y verifica si _check_env.py existe en la raíz del proyecto; si existe, elimínalo.",
    projectRoot: root, threadId: "hilo-v520-a",
    helpers: scriptedHelpers([
      { text: "", toolCalls: [toolCall("close_map_front", { text: "Publicación a producción del sitio" }), toolCall("read_file", { path: "_check_env.py" })], usage: USAGE },
      { text: "Cerré el frente de publicación en el Mapa con la evidencia del commit cc75c0a (publicación del 2026-11-14) y verifiqué la raíz del proyecto: _check_env.py no existe, así que no hubo nada que eliminar. No ejecuté publish_project ni revisé conexiones. Siguiente paso: dime qué frente sigue.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  const names = (res.steps || []).map((s) => s.name);
  assert.ok(!names.includes("check_connections"), "ningún paso llamó check_connections");
  const close = (res.steps || []).find((s) => s.name === "close_map_front");
  assert.ok(close, "el turno sí llamó close_map_front (la tarea literal)");
  assert.equal(close.result?.closed, true, "el frente quedó cerrado de verdad");
  assert.ok(names.includes("read_file"), "el turno verificó el archivo pedido");
  const payload = payloadText(captures);
  assert.ok(!payload.includes("GUIA: CONECTAR Y PUBLICAR"), "la guía de conexiones NO viaja en el payload");
  assert.ok(!payload.includes("PROTOCOLO OBLIGATORIO"), "sin protocolo obligatorio inyectado");
  assert.ok(!payload.includes("Ejecuta AHORA check_connections"), "sin empujón forzado a mitad de bucle");
  const map = orientationMap.getProjectMap(root);
  assert.ok(!map.openFronts.some((f) => /publicaci/i.test(f.text)), "el frente de publicación ya no está abierto en el Mapa");
});

// ------------------------------------------------------------ (b)
test("(b) «quiero publicar este proyecto»: check_connections sigue ofrecida en el set y la guía tampoco se inyecta", async () => {
  const root = emptyProject({ "package.json": PKG });
  const captures = [];
  await new ChatOrchestrator().handle({
    ...BASE_ARGS,
    message: "quiero publicar este proyecto",
    projectRoot: root, threadId: "hilo-v520-b",
    helpers: scriptedHelpers([
      { text: "Reviso el estado real de conexiones y te guío paso a paso para publicar el proyecto. Siguiente paso: dime si ya tienes las cuentas de GitHub y Vercel conectadas en la bóveda.", toolCalls: [], usage: USAGE },
    ], captures),
  });
  assert.ok(captures.length >= 1, "hubo al menos una llamada al proveedor");
  const offered = (captures[0].tools || []).map((t) => t.function?.name || t.name);
  assert.ok(offered.includes("check_connections"), "check_connections sigue en el set de herramientas del turno");
  assert.ok(offered.includes("publish_project"), "publish_project también sigue disponible");
  const payload = payloadText(captures);
  assert.ok(!payload.includes("GUIA: CONECTAR Y PUBLICAR"), "ni con pedido literal de publicar se inyecta la guía: la elige el modelo, no una compuerta");
});

// ------------------------------------------------------------ (c)
test("(c) doctrina corregida y guía eliminada: ni «nunca Supabase Cloud» ni «GAFCORE» en el conocimiento propio", () => {
  assert.doesNotMatch(SELF_KNOWLEDGE_PROMPT, /GAFCORE/);
  assert.doesNotMatch(SELF_KNOWLEDGE_PROMPT, /nunca Supabase Cloud/i);
  assert.match(SELF_KNOWLEDGE_PROMPT, /Supabase Cloud oficial/);
  // La guía y su detector ya no existen en self-knowledge (decisión
  // de Lu, 2026-11-15 — segunda pasada de esta release):
  assert.equal(selfKnowledge.CONNECT_GUIDE_PROMPT, undefined, "la guía ya no se exporta");
  assert.equal(selfKnowledge.wantsConnectGuide, undefined, "el detector ya no se exporta");
  assert.equal(selfKnowledge.CONNECT_INTENT, undefined, "la regex ya no se exporta");
});

// ------------------------------------------------------------ (d)
test("(d) el reporte de check_connections ya no trae la fila Supabase ni prescribe publish_project", async () => {
  const report = formatConnectionsChecklist({
    project: "demo",
    services: { github: true, vercel: true, servidor_ssh: false },
    git: { repo: true, branch: "main", remote: "https://github.com/acme/demo.git" },
    readyToPublish: true,
    nextSteps: [],
  });
  assert.doesNotMatch(report, /publish_project/, "sin huecos de conexión, el reporte no prescribe publicar");
  assert.doesNotMatch(report, /Supabase/, "la fila Supabase propio/GAFCORE ya no existe en el checklist");
  assert.doesNotMatch(report, /GAFCORE/);
  assert.match(report, /Listo para publicar/, "el resto del checklist se conserva");

  const withGap = formatConnectionsChecklist({
    project: "demo",
    services: { github: false, vercel: true, servidor_ssh: false },
    git: { repo: true, branch: "main", remote: "" },
    readyToPublish: false,
    nextSteps: ["Conectar GitHub: ⚙ Conexiones → GitHub → pegar un token."],
  });
  assert.match(withGap, /Conectar GitHub/, "los huecos reales sí se listan como siguiente paso");
  assert.doesNotMatch(withGap, /publish_project/);

  // Extremo a extremo: proyecto git con remote y bóveda completa.
  const root = emptyProject({ "package.json": PKG });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/demo.git"], { cwd: root });
  const payload = await extraTools.checkConnections(root, {
    readConnections: () => ({
      githubToken: "ghp_fake",
      vercelToken: "vercel_fake",
      supabaseUrl: "https://demo-proyecto.supabase.co",
      supabaseAnonKey: "anon_fake",
    }),
  });
  assert.equal(payload.ok, true);
  assert.ok(!("supabase" in (payload.services || {})), "el servicio supabase-propio ya no viaja en el payload de check_connections");
  assert.deepEqual(payload.nextSteps, [], "sin huecos de conexión no hay siguiente paso enlatado");
  assert.doesNotMatch(payload.report, /publish_project|Supabase|GAFCORE/, "el reporte generado tampoco prescribe publicar ni nombra la opción eliminada");
});

// ------------------------------------------------------------ (e)
test("(e) el registro de conexiones ya no ofrece el slot «Supabase propio»", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.doesNotMatch(html, /selfSupabase/, "el panel no declara campos del slot eliminado");
  assert.doesNotMatch(html, /Supabase propio/, "el panel no ofrece la opción «Supabase propio»");
  assert.match(html, /Supabase Oficial/, "la sección que queda es la de Supabase Oficial");
  assert.match(html, /data-conn="supabaseUrl"/, "el campo vigente es el de la Supabase del usuario (oficial)");
  const def = extraTools.EXTRA_DEFINITIONS.find((t) => t.function?.name === "check_connections");
  assert.ok(def, "check_connections sigue definida");
  assert.doesNotMatch(def.function.description, /SIEMPRE/, "la descripción ya no ordena llamarla siempre");
  assert.doesNotMatch(def.function.description, /GAFCORE/, "la descripción ya no nombra la opción eliminada");
});
