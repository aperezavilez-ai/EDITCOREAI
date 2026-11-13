"use strict";

// [EDITCORE-INTEGRAL-B1] VERDAD DEL TURNO (Bloque 1 de la corrección
// integral v4.9.0): el cierre reporta HECHOS del kernel, no la prosa del
// modelo; las compuertas de cierre son persistentes y no se apagan al
// final; lo delegado se audita (planned:true jamás es «aplicado»); el
// verificador muestra la CAUSA real (runCommand devuelve `output`, no
// `stdout`); el timeout blando no es OK; y la «verificación real» debe
// guardar relación con el cambio. Patrón de publicacion-verificada:
// costuras/fakes inyectados (callChat guionado, runCommand parcheado en
// la costura del módulo), sin red ni CLI reales.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b1-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

const { ChatOrchestrator, buildKernelFactSummary, auditSubagentSteps, runPostWriteVerify, formatVerifyBlock } = require("../editcore-chat-kernel/orchestrator");
const tools = require("../editcore-chat-kernel/tools");
const { runVerifier } = require("../editcore-chat-kernel/subagents/verifier");
const guard = require("../editcore-chat-kernel/repair-guard");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-b1-proj-"));
}

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

const BARE_REPORT = "Revisé los archivos en disco: src/components/layout/Footer.tsx está escrito en una sola línea con secuencias literales y src/components/layout/Navbar.tsx presenta exactamente el mismo problema.";

test("B1-1 resumen del kernel: el cierre lleva el hunk REAL, no la exageración del modelo", async () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "components", "Hero.tsx"), "export function Hero() { return <div className=\"hero-overlay-radial\" />; }\n");

  // ACTUALIZADO A PROPÓSITO (v5.1.0, pieza B3): el cierre propositivo
  // mecánico generalizado devuelve TODO cierre de tarea sin propuesta
  // ni declaración de término — el cierre exagerado original ya no
  // llega intacto al ensamblado. El guion gana una tercera respuesta:
  // el mismo relato exagerado PERO con la declaración de término que
  // B3 exige; las aserciones de fondo no cambian (los hechos del
  // kernel van antes que el relato y nombran el hunk real).
  const script = [
    { text: "", toolCalls: [toolCall("replace_in_file", { path: "src/components/Hero.tsx", oldText: "hero-overlay-radial", newText: "hero-overlay-linear-red" })], usage: {} },
    { text: "Listo: cambié el FONDO PRINCIPAL de toda la página por un degradado rojo espectacular y rediseñé la portada completa del sitio, de arriba abajo.", toolCalls: [], usage: {} },
    { text: "Listo: cambié el FONDO PRINCIPAL de toda la página por un degradado rojo espectacular y rediseñé la portada completa del sitio, de arriba abajo. Doy por terminado el cambio del hero porque el ajuste quedó aplicado en el archivo.", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "cambia la capa radial del hero por una lineal roja",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 5, fullAccess: true, permissionMode: "full",
    helpers: { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } },
  });

  const text = String(out.text || "");
  assert.ok(text.includes("Hechos del turno (kernel)"), "el cierre antepone el resumen factual del kernel");
  assert.ok(text.includes("hero-overlay-radial") && text.includes("hero-overlay-linear-red"), "el resumen nombra el hunk real oldText → newText");
  assert.ok(text.indexOf("Hechos del turno (kernel)") < text.indexOf("FONDO PRINCIPAL"), "los hechos del kernel van ANTES del relato del modelo");
  assert.equal(fs.readFileSync(path.join(root, "src", "components", "Hero.tsx"), "utf8"), "export function Hero() { return <div className=\"hero-overlay-linear-red\" />; }\n", "en disco solo cambió la capa radial, no «el fondo principal»");
});

test("B1-2 compuerta propositiva: dispara en la penúltima iteración y por segunda vez tras un cierre evasivo", async () => {
  const root = tmpProject();
  const seen = [];
  let calls = 0;
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "mejora el hero de la landing",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 3, fullAccess: true, permissionMode: "full",
    helpers: {
      callChat: async (args) => {
        calls += 1;
        seen.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
        if (calls <= 2) return { text: BARE_REPORT, toolCalls: [], usage: {} };
        return { text: "Mi propuesta concreta es reescribir el hero con un degradado sobrio y verificarlo en el preview activo. ¿Sigo con eso?", toolCalls: [], usage: {} };
      },
    },
  });

  assert.equal(calls, 3, "el turno usó las 3 iteraciones: la compuerta no dejó cerrar en las dos primeras");
  const nudgesIn = (txt) => (String(txt).match(/No cierres «mocho»/g) || []).length;
  assert.equal(nudgesIn(seen[1]), 1, "tras el primer cierre evasivo, la compuerta disparó una vez");
  assert.equal(nudgesIn(seen[2]), 2, "en la PENÚLTIMA iteración la compuerta disparó por SEGUNDA vez (antes se apagaba con i < stepsLimit - 2)");
  assert.ok(String(out.text || "").includes("no registró ninguna escritura"), "sin escrituras, la garantía estructural del kernel lo declara al cerrar");
});

test("B1-3 auditoría de subagente: planned:true se declara NO aplicado y el rol degradado se anuncia", () => {
  const steps = [
    { name: "invoke_subagent", input: { role: "implementer", task: "aplica el patch" }, ok: true, result: { ok: false, applied: [{ path: "src/x.ts", ok: false, planned: true, mode: "write" }] } },
    { name: "invoke_subagent", input: { role: "security", task: "auditoría de seguridad" }, ok: true, result: { ok: true, mode: "parallel-explore", requestedRole: "security", degradedRole: true } },
  ];
  const audit = auditSubagentSteps(steps).join("\n");
  assert.match(audit, /PLANIFICADO, NO aplicado/);
  assert.match(audit, /no existe como especialista/);

  const summary = buildKernelFactSummary(steps);
  assert.ok(summary.includes("PLANIFICADO, NO aplicado"), "el resumen del kernel declara el patch no aplicado");
  assert.ok(!summary.includes("aplicado por el subagente implementer"), "ningún planned:true aparece como cambio aplicado");
  assert.ok(summary.includes("no registró ninguna escritura"), "el resumen dice que el kernel no aplicó escrituras");
});

test("B1-3b implementer delegado CABLEADO: con applyWrite del orquestador, el patch se aplica de verdad", async () => {
  const root = tmpProject();
  const script = [
    { text: "", toolCalls: [toolCall("invoke_subagent", { role: "implementer", task: "crea delegado.txt", patches: [{ path: "delegado.txt", content: "contenido delegado\n" }] })], usage: {} },
    { text: "Listo: el subagente implementer creó delegado.txt con el contenido pedido para esta delegación.", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "delega al subagente la creación de delegado.txt",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 5, fullAccess: true, permissionMode: "full",
    helpers: { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } },
  });

  assert.equal(fs.readFileSync(path.join(root, "delegado.txt"), "utf8"), "contenido delegado\n", "el patch delegado se escribió en disco pasando por tools.writeFile con lock");
  assert.ok(String(out.text || "").includes("aplicado por el subagente implementer"), "el resumen del kernel registra la escritura delegada como hecho");
});

test("B1-3c rol especialista inexistente: tools.execute ANUNCIA que degrada a exploración", async () => {
  const root = tmpProject();
  const result = await tools.execute("invoke_subagent", { role: "security", task: "auditoría de seguridad del proyecto" }, root, false, {});
  assert.equal(result.degradedRole, true);
  assert.equal(result.effectiveRole, "explorer");
  assert.match(String(result.roleNotice || ""), /no existe como subagente especialista/);
});

test("B1-4 verifier: el error de tsc que sale en `output` llega al bloque ⚠️; el timeout blando NO es ok", async () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "Hero.tsx"), "export const x: number = 'no';\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ devDependencies: { typescript: "^5" } }));
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");

  const original = tools.runCommand;
  try {
    tools.runCommand = async () => ({ ok: false, code: 2, output: "src/Hero.tsx(1,14): error TS2322: Type 'string' is not assignable to type 'number'.", stderr: "" });
    const v = await runVerifier({ projectRoot: root, path: "src/Hero.tsx", learn: false });
    assert.equal(v.ok, false);
    assert.ok(String(v.result?.error || "").includes("error TS2322"), "result.error trae la causa de tsc que venía en `output`");

    const reports = await runPostWriteVerify(root, ["src/Hero.tsx"], null);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].ok, false);
    assert.ok(reports[0].note.includes("error TS2322"), "la nota del reporte es la causa concreta, no la frase genérica");
    assert.ok(formatVerifyBlock(reports).includes("error TS2322"), "el bloque ⚠️ visible muestra la causa");

    tools.runCommand = async () => ({ ok: false, code: null, output: "", stderr: "", error: "timeout: el comando superó el límite" });
    const softReports = await runPostWriteVerify(root, ["src/Hero.tsx"], null);
    assert.equal(softReports[0].softTimeout, true);
    assert.equal(softReports[0].ok, false, "timeout blando: ok=false a efectos de «verificado»");
    const softBlock = formatVerifyBlock(softReports);
    assert.ok(softBlock.includes("⏱️"), "el bloque visible marca el timeout con ⏱️");
    assert.ok(!softBlock.includes("✅"), "el bloque visible NO marca el timeout como OK");
  } finally {
    tools.runCommand = original;
  }
});

test("B1-5 repair-guard: un comando verde SIN relación con el cambio no es verificación real; la captura fallida no libera la evidencia", () => {
  const touched = ["src/components/Hero.tsx"];
  const writeStep = { name: "replace_in_file", input: { path: "src/components/Hero.tsx" }, ok: true, result: { ok: true } };

  const unrelated = { name: "run_command", input: { command: "npm test -- tests/footer.test.js" }, ok: true, result: { ok: true } };
  assert.equal(guard.turnHasPassingRealVerification([writeStep, unrelated], touched), false, "tests verdes de OTRO archivo no verifican este cambio");

  const genericBuild = { name: "run_command", input: { command: "npm run build" }, ok: true, result: { ok: true } };
  assert.equal(guard.turnHasPassingRealVerification([writeStep, genericBuild], touched), true, "el build genérico del proyecto sí cubre el cambio");

  const namedBuild = { name: "run_command", input: { command: "npm test -- src/components/Hero.tsx" }, ok: true, result: { ok: true } };
  assert.equal(guard.turnHasPassingRealVerification([writeStep, namedBuild], touched), true, "el comando que nombra el archivo tocado sí guarda relación");

  assert.equal(guard.turnHasPassingRealVerification([genericBuild, writeStep], touched), false, "verificar ANTES de la última escritura no prueba el cambio");

  const failedCapture = { name: "capture_preview_screenshot", ok: false, result: { ok: false, error: "sin preview activo" } };
  assert.equal(guard.turnHasEvidence([failedCapture]), false, "captura fallida: no hay evidencia");
  const blocked = guard.maybeBlockWriteBeforeEvidence("write_file", [failedCapture], 0);
  assert.equal(blocked?.evidenceGate, true, "sin evidencia real, la compuerta sigue bloqueando la primera escritura");
  assert.equal(guard.maybeBlockWriteBeforeEvidence("write_file", [failedCapture], 2), null, "fail-open solo tras agotar los bloqueos previstos");
});
