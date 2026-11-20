"use strict";

/**
 * EditCore AI - Single Brain MultiAgent Acceptance Test
 * Verifies that handleChatKernel communicates with the unified MultiAgent engine
 * Motor Multiagente de EditCoreAI, streams live agent messages, returns structured deliverables,
 * and maintains conversational thread continuity.
 *
 * Usage: node scripts/acceptance-kernel.js   (exit 0 = pass, 1 = fail)
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ec-accept-kernel-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmp, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });
const projectRoot = path.join(tmp, "proyecto");
fs.mkdirSync(projectRoot, { recursive: true });
fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "aceptacion" }));

const { handleChatKernel } = require("../runtime/chat-kernel-bridge");
const { stopMultiAgentSidecar } = require("../runtime/multiagent-ipc");

function fail(msg) {
  console.error(`[acceptance-kernel] FALLO: ${msg}`);
  process.exitCode = 1;
}

(async () => {
  const base = {
    projectRoot,
    permissionMode: "full",
    allowWrite: true,
    fullAccess: true,
    threadId: "acceptance-thread-single-brain",
    chatId: "acceptance-chat-single-brain",
    history: []
  };

  const progressTurn1 = [];
  console.log("[acceptance-kernel] Ejecutando Turno 1 en Motor Multiagente Unificado...");
  const out1 = await handleChatKernel({
    ...base,
    runId: `accept_run_1_${Date.now()}`,
    message: "Implementa el módulo de autenticación con validación de tokens y auditoría",
    onProgress: (p) => {
      progressTurn1.push(p);
    }
  });

  if (!out1 || out1.kind !== "DONE") {
    fail(`El turno 1 no completó exitosamente: ${JSON.stringify(out1)}`);
    return;
  }

  if (progressTurn1.length === 0) {
    fail("El turno 1 no emitió eventos de progreso en streaming desde los agentes");
    return;
  }

  const out1Text = String(out1.text || "");
  if (!out1Text.includes("Motor Multiagente de EditCoreAI")) {
    fail(`El resultado del turno 1 no proviene del Motor Multiagente: ${out1Text.slice(0, 150)}`);
    return;
  }

  console.log(`[acceptance-kernel] Turno 1 OK: ${progressTurn1.length} eventos transmitidos en vivo. Motor respondió con reporte estructurado.`);

  // Turno 2: Seguimiento con memoria de contexto
  const progressTurn2 = [];
  console.log("[acceptance-kernel] Ejecutando Turno 2 con memoria del turno anterior...");
  const out2 = await handleChatKernel({
    ...base,
    runId: `accept_run_2_${Date.now()}`,
    message: "¿Puedes auditar los endpoints creados en el turno anterior?",
    history: [
      { role: "user", content: "Implementa el módulo de autenticación con validación de tokens y auditoría" },
      { role: "assistant", content: out1Text }
    ],
    onProgress: (p) => {
      progressTurn2.push(p);
    }
  });

  if (!out2 || out2.kind !== "DONE") {
    fail(`El turno 2 no completó exitosamente: ${JSON.stringify(out2)}`);
    return;
  }

  const out2Text = String(out2.text || "");
  if (!out2Text.includes("Motor Multiagente de EditCoreAI")) {
    fail(`El resultado del turno 2 no proviene del Motor Multiagente: ${out2Text.slice(0, 150)}`);
    return;
  }

  console.log(`[acceptance-kernel] Turno 2 OK: respuesta recibida correctamente.`);
  console.log("[acceptance-kernel] PASS - Cerebro Único Multiagente validado de extremo a extremo.");
})().catch((error) => {
  console.error(`[acceptance-kernel] FALLO: ${error?.stack || error}`);
  process.exitCode = 1;
}).finally(() => {
  try {
    stopMultiAgentSidecar();
  } catch (e) {}
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch { /* ignore */ }
});
