"use strict";

// DESBLOQUEOS v4.8.1 — tres correcciones de raíz destapadas por la batería
// en vivo de la v4.8.0 en la máquina de Luis:
//
// FIX 1 (P-3 en vivo, dos veces): un turno de REVISIÓN VISUAL en modo SOLO
// LECTURA no podía mirar — el agente intentaba capturar («Capturo el
// preview para verificar con la vista») y la compuerta única lo mataba con
// «Modo solo lectura: no se ejecutan herramientas de escritura», porque
// classify.js metía capture_preview_screenshot en WRITE_TOOLS (barrida
// protectora del contrato de turno). La captura es OBSERVACIÓN: su único
// efecto en disco es .editcore/vision, la carpeta del propio agente. Ahora
// vive en READ_ONLY_TOOLS, junto a screenshot_page, y la compuerta —que no
// se tocó— ya no la veta. write_file y demás escritura conservan su corte.
//
// FIX 2 (publicación en vivo): el límite de «acción repetida» no distinguía
// éxito de fracaso: publish_project falló a mitad y el reintento idéntico
// fue rechazado, forzando un rodeo manual con Git. Ahora el historial
// guarda el RESULTADO: éxito ⇒ bloqueo intacto; fallo ⇒ UN reintento; el
// tercer intento idéntico se bloquea con un mensaje que dice qué pasó.
//
// FIX 3 (publicación en vivo): .git/index.lock ocupado por otro proceso
// (probablemente un git del propio EditCoreAI) mataba el publish y nadie
// reintentaba. La ruta de publicación (publish-pipeline) ahora ejecuta su
// git con reintento acotado ante error de lock (espera 1.5 s, máx. 2). El
// lock JAMÁS se borra.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Fake de visión instalado ANTES de cargar el orquestador: tools.js y
// orchestrator.js desestructuran capture_preview_screenshot de
// vision-inspector al cargarse, así que sustituir la propiedad del módulo
// ya cargado hace que el despacho use el fake (sin Electron ni preview).
const vision = require("../editcore-chat-kernel/vision-inspector");
vision.capture_preview_screenshot = async () => ({
  ok: true,
  renderOk: true,
  fakeVision481: "VISION-FALSA-481",
  diagnostics: { consoleErrors: [], issues: [] },
  summary: "Captura falsa de prueba (desbloqueos v4.8.1)",
});

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const { READ_ONLY_TOOLS, WRITE_TOOLS } = require("../editcore-chat-kernel/classify");
const { isGitIndexLockError, withGitLockRetry } = require("../runtime/git-utils");

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-desbloqueos-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "public", "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "index.html"), "<!DOCTYPE html><html><head><title>Taller</title></head><body><div id=\"root\"></div></body></html>\n");
  fs.writeFileSync(path.join(root, "src", "App.tsx"), "export default function App() { return null; }\n");
  fs.writeFileSync(path.join(root, "public", "assets", "hero-taller.jpg"), "fake-jpeg-bytes");
  return root;
}

function capturingHelpers(calls, responder) {
  return {
    callChat: async (args) => {
      calls.push({
        tools: (args.tools || []).map((t) => t.function?.name || t.name).filter(Boolean),
        allText: (args.messages || []).map((m) => String(m.content || "")).join("\n"),
      });
      return responder(calls.length, args);
    },
  };
}

const P3 = "revisa la landing y dime si las imágenes corresponden al negocio";

// ---------- FIX 1: clasificación ----------

test("desbloqueos FIX 1: la captura es lectura (observación) y la escritura sigue clasificada como escritura", () => {
  assert.ok(READ_ONLY_TOOLS.includes("capture_preview_screenshot"), "capture_preview_screenshot vive en READ_ONLY_TOOLS");
  assert.ok(!WRITE_TOOLS.includes("capture_preview_screenshot"), "capture_preview_screenshot ya NO está en WRITE_TOOLS");
  for (const w of ["write_file", "replace_in_file", "delete_file", "run_command", "publish_project", "fetch_stock_photo"]) {
    assert.ok(WRITE_TOOLS.includes(w), `${w} conserva su clasificación de escritura`);
  }
});

// ---------- FIX 1: camino completo en SOLO LECTURA ----------

test("desbloqueos FIX 1: revisión visual en SOLO LECTURA — la captura EJECUTA y write_file sigue blockedReadOnly", async () => {
  const root = tmpProject();
  const calls = [];
  const helpers = capturingHelpers(calls, async (n) => {
    if (n === 1) {
      return {
        text: "Capturo el preview para verificar con la vista.",
        toolCalls: [
          { id: "cap1", type: "function", function: { name: "capture_preview_screenshot", arguments: JSON.stringify({}) } },
          { id: "w1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "nota.txt", content: "hola\n" }) } },
        ],
        usage: {},
      };
    }
    return { text: "Ya miré la captura del preview: el hero NO corresponde al negocio (gente saltando en blanco y negro) y las tarjetas de servicios SÍ son de taller mecánico.", toolCalls: [], usage: {} };
  });

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: P3,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "readonly", allowWrite: false, fullAccess: false,
    helpers, history: [],
  });

  const steps = out.steps || [];
  const capStep = steps.find((s) => s.name === "capture_preview_screenshot");
  assert.ok(capStep, "el paso de captura quedó registrado en el turno");
  assert.equal(capStep.ok, true, "la captura se EJECUTÓ en solo lectura (paso ok)");
  assert.notEqual(capStep.result?.blockedReadOnly, true, "la captura NO fue vetada por la compuerta de escritura");
  assert.equal(capStep.result?.fakeVision481, "VISION-FALSA-481", "el resultado es el de la visión (fake), no un bloqueo");

  const writeStep = steps.find((s) => s.name === "write_file");
  assert.ok(writeStep, "el paso de escritura quedó registrado");
  assert.equal(writeStep.result?.blockedReadOnly, true, "write_file en solo lectura sigue blockedReadOnly");
  assert.equal(fs.existsSync(path.join(root, "nota.txt")), false, "en solo lectura el archivo NO se escribió");

  assert.ok(calls.length >= 2 && calls[1].allText.includes("VISION-FALSA-481"), "el resultado de la captura llegó al modelo en la siguiente llamada");
  assert.ok(!String(out.text || "").includes("NO se verificó con la vista"), "sin banner de no verificado: el turno SÍ miró");
});

// ---------- FIX 2: reintento tras fallo / bloqueo tras éxito ----------

const EXEC_MSG = "ejecuta el comando de diagnóstico del proyecto y dime el resultado";
const FAIL_CMD = "node -e \"process.exit(3)\"";
const OK_CMD = "node -e \"process.exit(0)\"";

function commandHelpers(calls, command, attemptsBeforeClose) {
  return capturingHelpers(calls, async (n) => {
    if (n <= attemptsBeforeClose) {
      return {
        text: "",
        toolCalls: [{ id: `cmd${n}`, type: "function", function: { name: "run_command", arguments: JSON.stringify({ command }) } }],
        usage: {},
      };
    }
    return { text: "Cierro con lo observado en los pasos anteriores.", toolCalls: [], usage: {} };
  });
}

test("desbloqueos FIX 2: una llamada idéntica que FALLA puede reintentarse UNA vez; el tercer intento se bloquea diciendo que ya falló", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: EXEC_MSG,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: commandHelpers(calls, FAIL_CMD, 3), history: [],
  });

  const cmdSteps = (out.steps || []).filter((s) => s.name === "run_command");
  assert.equal(cmdSteps.length, 2, "el comando fallido se ejecutó exactamente 2 veces (original + un reintento)");
  assert.ok(cmdSteps.every((s) => s.ok === false), "ambas ejecuciones fallaron de verdad (exit 3)");
  const lastCallText = calls[calls.length - 1].allText;
  assert.ok(lastCallText.includes("Límite alcanzado para esta acción repetida"), "el tercer intento idéntico fue bloqueado por la compuerta");
  assert.ok(/FALLÓ/.test(lastCallText), "el mensaje de bloqueo dice que el intento anterior FALLÓ (el modelo puede cambiar de estrategia)");
});

test("desbloqueos FIX 2: una llamada idéntica que tuvo ÉXITO no se repite", async () => {
  const root = tmpProject();
  const calls = [];
  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: EXEC_MSG,
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: commandHelpers(calls, OK_CMD, 2), history: [],
  });

  const cmdSteps = (out.steps || []).filter((s) => s.name === "run_command");
  assert.equal(cmdSteps.length, 1, "el comando exitoso se ejecutó una sola vez");
  assert.equal(cmdSteps[0].ok, true, "la única ejecución tuvo éxito");
  const lastCallText = calls[calls.length - 1].allText;
  assert.ok(lastCallText.includes("Límite alcanzado para esta acción repetida"), "la repetición idéntica tras éxito fue bloqueada");
  assert.ok(/ÉXITO/.test(lastCallText), "el mensaje de bloqueo dice que la acción ya se ejecutó con ÉXITO");
});

// ---------- FIX 3: reintento ante index.lock (sin git real) ----------

const LOCK_RESULT = {
  code: 128,
  stdout: "",
  stderr: "fatal: Unable to create '/repo/.git/index.lock': File exists.\n\nAnother git process seems to be running in this repository, e.g.\nan editor opened by 'git commit'.",
};

test("desbloqueos FIX 3: el detector reconoce el error de index.lock y no confunde otros fallos", () => {
  assert.equal(isGitIndexLockError(LOCK_RESULT), true, "el error clásico de lock se detecta");
  assert.equal(isGitIndexLockError({ code: 0, stdout: "", stderr: "index.lock" }), false, "un comando exitoso nunca cuenta como error de lock");
  assert.equal(isGitIndexLockError({ code: 1, stdout: "", stderr: "error: pathspec 'x' did not match" }), false, "otro fallo git no se confunde con lock");
  assert.equal(isGitIndexLockError(null), false, "sin resultado no hay lock");
});

test("desbloqueos FIX 3: withGitLockRetry reintenta tras lock y se detiene en fallos ajenos o al agotar", async () => {
  const noSleep = async () => {};

  // Falla 1 vez con lock y luego tiene éxito: 2 ejecuciones, resultado bueno.
  let runs1 = 0;
  const recovered = await withGitLockRetry(async () => {
    runs1 += 1;
    return runs1 === 1 ? LOCK_RESULT : { code: 0, stdout: "ok", stderr: "" };
  }, { retries: 2, delayMs: 1500, sleepFn: noSleep });
  assert.equal(runs1, 2, "tras el lock se reintentó una vez");
  assert.equal(recovered.code, 0, "el resultado final es el del reintento exitoso");

  // Fallo ajeno al lock: no se reintenta.
  let runs2 = 0;
  const other = await withGitLockRetry(async () => {
    runs2 += 1;
    return { code: 1, stdout: "", stderr: "error: pathspec 'x' did not match" };
  }, { retries: 2, delayMs: 1500, sleepFn: noSleep });
  assert.equal(runs2, 1, "un fallo que no es de lock NO se reintenta");
  assert.equal(other.code, 1, "el fallo original se devuelve tal cual");

  // Lock persistente: 1 + 2 reintentos y se devuelve el último resultado.
  let runs3 = 0;
  const exhausted = await withGitLockRetry(async () => {
    runs3 += 1;
    return LOCK_RESULT;
  }, { retries: 2, delayMs: 1500, sleepFn: noSleep });
  assert.equal(runs3, 3, "lock persistente: ejecución inicial + 2 reintentos, ni uno más");
  assert.equal(exhausted.code, 128, "agotado el presupuesto se devuelve el último error de lock");
});
