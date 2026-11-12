"use strict";

// [EDITCORE-V491-C] EL «PROCEDE» EJECUTA LO PRESENTADO (corrección
// v4.9.1, bloque C), dos raíces:
//  (1) La autorización viajaba como booleano y el turno de ejecución
//      RECONSTRUÍA la tarea desde el historial, re-derivando otro
//      cambio (en vivo, v4.9.0, C-1: el «procede» terminó revirtiendo
//      desde un snapshot y quitando un badge que no era lo
//      presentado). Ahora, cuando el despacho corta una escritura con
//      needsAuthorization, el kernel PERSISTE el plan presentado
//      (herramienta, archivo, cambio) asociado a la conversación; al
//      autorizarse, el turno recibe ese plan como instrucción
//      vinculante y el cierre declara cualquier escritura fuera de él.
//  (2) El verificador delegado entraba con autoRollback=true por
//      defecto (agent-worker) y revertía la última escritura global
//      ante CUALQUIER error de compilación — incluido el TS2339
//      preexistente de src/main.tsx, ajeno a cada turno. Ahora el
//      delegado entra con autoRollback=false salvo opt-in explícito,
//      y el rollback automático solo procede si el error implica
//      archivos cambiados en ESTE turno.
//
// Camino completo: handle → despacho (corte) → persistencia en disco →
// handle («procede») → ejecución; y runVerifier real contra un tsc
// falso en un repo temporal.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const tools = require("../editcore-chat-kernel/tools");
const { runVerifier } = require("../editcore-chat-kernel/subagents/verifier");

const FOOTER_REL = "src/components/layout/Footer.tsx";
const FOOTER_V1 = "export function Footer() { return (<p>© Taller Prueba. Todos los derechos reservados.</p>); }\n";
const OLD_TEXT = "<p>© Taller Prueba. Todos los derechos reservados.</p>";
const NEW_TEXT = "<p>Hecho en México</p>";
const TURN1_MESSAGE = "Cambia el texto del pie del Footer de la landing por «Hecho en México»";

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v491-plan-"));
  fs.mkdirSync(path.join(root, "src", "components", "layout"), { recursive: true });
  fs.writeFileSync(path.join(root, FOOTER_REL), FOOTER_V1);
  return root;
}

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function readPersistedPlan(root) {
  const file = path.join(root, ".editcore", "presented-plan.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Turno 1 (step): el modelo intenta EL cambio; el despacho lo corta.
async function runPresentationTurn(orch, root) {
  const script = [
    { text: "", toolCalls: [toolCall("replace_in_file", { path: FOOTER_REL, oldText: OLD_TEXT, newText: NEW_TEXT })], usage: {} },
    { text: `Voy a cambiar el texto del pie en ${FOOTER_REL}: «${OLD_TEXT}» por «${NEW_TEXT}». ¿Procedo?`, toolCalls: [], usage: {} },
  ];
  return orch.handle({
    message: TURN1_MESSAGE,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: true, fullAccess: false,
    chatId: "chat-v491-c1", history: [],
    helpers: { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } },
  });
}

// Turno 2 («procede»): el proveedor ejecuta lo que el guion diga.
async function runProceedTurn(orch, root, execute) {
  const seen = [];
  const script = [
    () => execute(),
    () => ({ text: "Listo: apliqué el cambio presentado y quedó aplicado en el proyecto.", toolCalls: [], usage: {} }),
  ];
  const out = await orch.handle({
    message: "procede",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: true, fullAccess: false,
    planAuthorized: true,
    chatId: "chat-v491-c1",
    history: [
      { role: "user", content: TURN1_MESSAGE },
      { role: "assistant", content: `Voy a cambiar el texto del pie en ${FOOTER_REL}. ¿Procedo?` },
    ],
    helpers: {
      callChat: async (args) => {
        seen.push((args.messages || []).map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""))).join("\n"));
        const next = script.shift();
        return next ? next() : { text: "Listo.", toolCalls: [], usage: {} };
      },
    },
  });
  return { out, seen };
}

test("V491-C1 step presenta un cambio → el plan queda PERSISTIDO y el «procede» ejecuta ESE archivo y ningún otro", async () => {
  const root = tmpProject();
  const orch = new ChatOrchestrator();

  const out1 = await runPresentationTurn(orch, root);
  assert.equal(fs.readFileSync(path.join(root, FOOTER_REL), "utf8"), FOOTER_V1, "en step no se escribió nada");
  assert.ok((out1.steps || []).some((s) => s.result && s.result.needsAuthorization), "el despacho cortó con needsAuthorization");

  const persisted = readPersistedPlan(root);
  assert.ok(persisted, "el plan presentado quedó persistido en .editcore/presented-plan.json");
  const records = Object.values(persisted);
  assert.equal(records.length, 1, "un plan para la conversación");
  assert.equal(records[0].calls.length, 1, "una llamada propuesta");
  assert.equal(records[0].calls[0].name, "replace_in_file");
  assert.equal(records[0].calls[0].path, FOOTER_REL, "el plan guarda el archivo exacto");
  assert.equal(records[0].calls[0].oldText, OLD_TEXT, "el plan guarda el texto exacto a reemplazar");
  assert.equal(records[0].calls[0].newText, NEW_TEXT, "el plan guarda el texto exacto nuevo");

  const { out, seen } = await runProceedTurn(orch, root, () => ({
    text: "",
    toolCalls: [toolCall("replace_in_file", { path: FOOTER_REL, oldText: OLD_TEXT, newText: NEW_TEXT })],
    usage: {},
  }));

  assert.ok(seen.some((t) => t.includes("PLAN PRESENTADO Y AUTORIZADO")), "el turno de ejecución recibió el plan como instrucción vinculante");
  assert.ok(seen.some((t) => t.includes(FOOTER_REL) && t.includes("Hecho en México")), "la instrucción nombra el archivo y el cambio presentados");
  const after = fs.readFileSync(path.join(root, FOOTER_REL), "utf8");
  assert.ok(after.includes("Hecho en México"), "se escribió el archivo del plan");
  assert.ok(!String(out.text || "").includes("FUERA del plan presentado"), "escribir lo presentado no se declara como exceso");
  assert.equal(readPersistedPlan(root) && Object.keys(readPersistedPlan(root)).length, 0, "el plan se consumió: no se re-aplica en turnos posteriores");
});

test("V491-C1b si el turno del «procede» escribe FUERA del plan, el cierre lo declara", async () => {
  const root = tmpProject();
  const orch = new ChatOrchestrator();
  await runPresentationTurn(orch, root);

  const { out } = await runProceedTurn(orch, root, () => ({
    text: "",
    toolCalls: [toolCall("write_file", { path: "src/Otro.tsx", content: "export const Otro = 1;\n" })],
    usage: {},
  }));

  assert.ok(fs.existsSync(path.join(root, "src", "Otro.tsx")), "la escritura fuera del plan ocurrió (se declara, no se impide en silencio)");
  assert.ok(String(out.text || "").includes("FUERA del plan presentado"), "el cierre DECLARA la escritura fuera del plan");
  assert.ok(String(out.text || "").includes("src/Otro.tsx"), "la declaración nombra el archivo excedido");
  assert.equal(fs.readFileSync(path.join(root, FOOTER_REL), "utf8"), FOOTER_V1, "el archivo del plan no se tocó en esta variante");
});

// ---------- (2) verifier: el error ajeno no revierte trabajo sano ----------

function tmpVerifierProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-v491-verifier-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fake", private: true }) + "\n");
  // tsc falso: SIEMPRE falla con el error preexistente de main.tsx.
  fs.writeFileSync(path.join(root, "fake-tsc.js"), [
    "console.log(\"src/main.tsx(6,17): error TS2339: Property 'env' does not exist on type 'ImportMeta'.\");",
    "process.exit(1);",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(root, "src", "main.tsx"), "export const env = (import.meta as any).env;\n");
  fs.writeFileSync(path.join(root, "src", "Footer.tsx"), "export const Footer = () => null; // v1\n");
  return root;
}

test("V491-C2 error TS preexistente en un archivo NO tocado + verificación delegada: la escritura del turno NO se revierte", async () => {
  const root = tmpVerifierProject();
  const w = tools.writeFile(root, "src/Footer.tsx", "export const Footer = () => null; // v2 cambio del turno\n");
  assert.equal(w.ok, true, "la escritura del turno se aplicó (con su snapshot)");

  const v = await runVerifier({
    projectRoot: root,
    command: "node fake-tsc.js",
    autoRollback: true, // ni siquiera con el rollback autorizado…
    changedFiles: ["src/Footer.tsx"], // …si el error no implica lo cambiado
    learn: false,
  });

  assert.equal(v.result.rolledBack, false, "no hubo rollback");
  assert.equal(v.rollbackSkipped, true, "la omisión del rollback quedó declarada");
  assert.match(String(v.rollbackSkippedReason || ""), /no implica ningún archivo cambiado en este turno/i);
  assert.equal(
    fs.readFileSync(path.join(root, "src", "Footer.tsx"), "utf8"),
    "export const Footer = () => null; // v2 cambio del turno\n",
    "el cambio sano del turno sigue en disco",
  );
});

test("V491-C2b control: si el error SÍ implica un archivo cambiado en el turno, el rollback autorizado procede; sin autoRollback, nunca", async () => {
  const root = tmpVerifierProject();
  const w = tools.writeFile(root, "src/Footer.tsx", "export const Footer = () => null; // v2\n");
  assert.equal(w.ok, true);

  const implicated = await runVerifier({
    projectRoot: root,
    command: "node fake-tsc.js",
    autoRollback: true,
    changedFiles: ["src/main.tsx"], // el error nombra main.tsx: SÍ implica
    learn: false,
  });
  assert.equal(implicated.result.rolledBack, true, "con el error implicando lo cambiado, el rollback autorizado procede");
  assert.equal(
    fs.readFileSync(path.join(root, "src", "Footer.tsx"), "utf8"),
    "export const Footer = () => null; // v1\n",
    "el rollback revirtió la última escritura, como antes",
  );

  const root2 = tmpVerifierProject();
  const w2 = tools.writeFile(root2, "src/Footer.tsx", "export const Footer = () => null; // v2\n");
  assert.equal(w2.ok, true);
  const byDefault = await runVerifier({
    projectRoot: root2,
    command: "node fake-tsc.js",
    changedFiles: ["src/main.tsx"],
    learn: false,
  });
  assert.equal(byDefault.result.rolledBack, false, "sin autoRollback explícito (el nuevo defecto del delegado) nunca se revierte");
  assert.equal(
    fs.readFileSync(path.join(root2, "src", "Footer.tsx"), "utf8"),
    "export const Footer = () => null; // v2\n",
  );
});
