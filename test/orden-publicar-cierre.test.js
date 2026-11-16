"use strict";

// Batería ÍTEM 2 del plan de auditoría — LAS ÓRDENES DE PUBLICACIÓN
// DEBEN QUEDAR DENTRO DE LAS COMPUERTAS ANTI-CIERRE-VACÍO.
// Defecto probado (B17+B18+B20): en editcore-chat-kernel/orchestrator.js,
// FIX_INTENT_RE (:598) y hasMutationIntent (:616-624) no conocían
// publicar/desplegar/push/commit, así que una orden «Publica este
// proyecto» no disparaba fixWithoutWrites (:4194), ni planClose
// (:4236), ni la nota B1 de finalización (:4473-4481): el cierre B3
// aceptó la declaración de término del modelo con 0 escrituras
// (prueba 6.2 en vivo). Y textClaimsDiskMutation (:771-774) no cubría
// publicado/desplegado/commiteado, así que groundUngroundedClaims
// (:1635-1651) no contrastaba una afirmación de publicación sin paso
// de publicación en el turno.
// La corrección: (a) FIX_INTENT_RE — la ÚNICA fuente que consumen
// userWantsDiskMutation, fixWithoutWrites y hasMutationIntent —
// incorpora los verbos de publicación/despliegue con las formas ES
// ya usadas en classify.js (TASK_DEPLOY_RE: deploy|publica(?:r)?;
// TASK_GIT_RE: commit|push) y la morfología del propio regex;
// (b) textClaimsDiskMutation incorpora los participios de publicación
// tras «he …»/«quedó …» y los pretéritos publiqué/desplegué, y
// groundUngroundedClaims exime el contraste cuando el turno SÍ trae
// un paso publish_project/deploy_one_click ok.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-item2-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
process.env.HOME = path.join(tmpBase, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });
process.env.EDITCORE_AGENT_NETWORK_PATH = path.join(tmpBase, "agent-network.json");

const { ChatOrchestrator, hasMutationIntent, groundUngroundedClaims } = require("../editcore-chat-kernel/orchestrator");

const USAGE = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
const PKG = JSON.stringify({ name: "demo", scripts: { build: "node -e \"process.exit(0)\"" } });

// Cierre tipo 6.2: declaración de término + propuesta, CERO tool calls.
const CIERRE_62 = "La publicación ya consta como hecha: el proyecto está en producción y responde HTTP 200. Doy por terminada la publicación porque ya consta en el Mapa y no hay despliegue pendiente. Propuesta concreta del siguiente paso: cuando haya cambios nuevos, conectar GitHub y Vercel y ejecutar publish_project.";

// ------------------------------------------------------------ (A)
test("(A) réplica 6.2 de turno completo: «Publica este proyecto» con cierre declarado y 0 escrituras dispara el empujón y deja la nota B1", async () => {
  const root = fs.mkdtempSync(path.join(tmpBase, "proj-"));
  fs.writeFileSync(path.join(root, "package.json"), PKG);
  const captures = [];
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "Publica este proyecto",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 8, fullAccess: true, permissionMode: "full",
    helpers: {
      callChat: async (args) => {
        captures.push({ messages: args?.messages || [], tools: args?.tools || [] });
        // El proveedor guionado responde SIEMPRE el mismo cierre 6.2,
        // sin tool calls, en cada llamada.
        return { text: CIERRE_62, toolCalls: [], usage: USAGE };
      },
    },
  });

  const finalText = String(out.text || "");
  assert.match(finalText, /Nota del kernel/, "el texto final lleva la nota B1 del kernel");
  assert.match(finalText, /no registró ninguna escritura/, "la nota B1 declara que el kernel no registró ninguna escritura");

  const payload = captures.map((c) => JSON.stringify(c.messages)).join("\n");
  assert.match(payload, /Todavía no modificaste ningún archivo/, "entre los mensajes capturados aparece el empujón de fixWithoutWrites exigiendo ejecutar");
});

// ------------------------------------------------------------ (B)
test("(B) hasMutationIntent conoce publicar/desplegar/push/commit y conserva el comportamiento previo", () => {
  assert.equal(hasMutationIntent("Publica este proyecto"), true, "«Publica este proyecto» SÍ es intención de mutación");
  assert.equal(hasMutationIntent("Publica los cambios y haz commit"), true, "«Publica los cambios y haz commit» SÍ es intención de mutación");
  assert.equal(hasMutationIntent("Despliega a producción"), true, "«Despliega a producción» SÍ es intención de mutación");
  assert.equal(hasMutationIntent("¿qué queda pendiente?"), false, "una pregunta de orientación NO es intención de mutación");
  assert.equal(hasMutationIntent("¿qué queda pendiente de este proyecto?"), false, "la pregunta de orientación con proyecto NO es intención de mutación");
  assert.equal(hasMutationIntent("Corrige el error en app.py"), true, "el léxico previo («corrige») sigue intacto");
});

// ------------------------------------------------------------ (C)
test("(C) groundUngroundedClaims contrasta la afirmación de publicación sin paso de publicación, y exime con paso ok", () => {
  const decision = { kind: "EXECUTE", allowWrite: true };
  const BANNER = /En este turno no se modificó ningún archivo en disco/;

  const sinPaso = groundUngroundedClaims("Ya quedó publicado en producción y desplegado.", [], "Publica este proyecto", decision);
  assert.match(sinPaso, BANNER, "afirmar «ya quedó publicado» sin paso publish_project lleva el banner de contraste");

  const conPaso = groundUngroundedClaims(
    "Ya quedó publicado en producción y desplegado.",
    [{ name: "publish_project", ok: true, result: { ok: true, sha: "934b683", url: "https://example.invalid" } }],
    "Publica este proyecto",
    decision
  );
  assert.doesNotMatch(conPaso, BANNER, "con un paso publish_project ok en el turno, NO lleva el banner (exención por publicación real)");

  const control = groundUngroundedClaims("He creado el archivo nuevo.", [], "crea el archivo nuevo", decision);
  assert.match(control, BANNER, "control intacto: «He creado el archivo nuevo» sin escrituras lleva el banner, como siempre");
});
