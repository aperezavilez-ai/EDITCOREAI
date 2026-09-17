"use strict";

/**
 * Prueba de circuito: kernel + (simulación) respuestas críticas del chat.
 * NO abre Electron; valida la lógica que main/renderer deben usar.
 */
const path = require("path");
const assert = require("assert");

const projectRoot = path.join(__dirname, "..");
const {
  handleChat,
  stopChat,
  classify,
} = require(path.join(projectRoot, "editcore-chat-kernel"));

async function main() {
  const results = [];

  // 1) alto → STOP sin CONTINUA
  const stop = await handleChat({ message: "alto", projectRoot });
  assert.strictEqual(stop.kind, "STOP");
  assert.ok(typeof stop.text === "string" && stop.text.length > 0);
  assert.ok(!/CONTINUA|PROCEDE/i.test(stop.text));
  results.push({ test: "alto → STOP", ok: true, text: stop.text });

  // 2) meta → CHAT, 0 tools (sin steps)
  const meta = await handleChat({ message: "eso no te lo pedí", projectRoot });
  assert.strictEqual(meta.kind, "CHAT");
  assert.ok(!Array.isArray(meta.steps) || meta.steps.length === 0);
  results.push({ test: "meta → CHAT cero tools", ok: true, kind: meta.kind });

  // 3) classify analiza
  const a = classify("Analiza el proyecto, NO modifiques, dame reporte");
  assert.strictEqual(a.kind, "ANALYZE");
  results.push({ test: "analiza → ANALYZE", ok: true, kind: a.kind });

  // 4) main.js: kernel por defecto en agent:run (legacy solo con useLegacyAdapter)
  const fs = require("fs");
  const mainSrc = fs.readFileSync(path.join(projectRoot, "main.js"), "utf8");
  assert.ok(mainSrc.includes("handleChatKernel"), "main debe usar handleChatKernel");
  assert.ok(mainSrc.includes('ipcMain.handle("agent:run"'));
  const agentRunIdx = mainSrc.indexOf('ipcMain.handle("agent:run"');
  const agentCancelIdx = mainSrc.indexOf('ipcMain.handle("agent:cancel"');
  const agentSlice = mainSrc.slice(agentRunIdx, agentCancelIdx);
  assert.ok(agentSlice.includes("handleChatKernel"), "agent:run usa kernel");
  assert.ok(agentSlice.includes("useLegacyAdapter !== true"), "kernel es path por defecto");
  assert.ok(mainSrc.includes("attachPreviewLogStream"), "daemon de preview logs");
  assert.ok(mainSrc.includes("maybeAutoHealPreview"), "auto-heal preview");
  results.push({ test: "main agent:run → kernel + daemon", ok: true });

  // 4b) pilares: scaffold/execute + truncado + detector
  assert.ok(["SCAFFOLD", "EXECUTE"].includes(classify("crea una app next.js desde cero").kind));
  const tools = require(path.join(projectRoot, "editcore-chat-kernel", "tools"));
  assert.strictEqual(tools.TOOL_RESULT_CAP, 2000);
  const { detectDevLogIssue } = require(path.join(projectRoot, "editcore-chat-kernel", "dev-log-detector"));
  const issue = detectDevLogIssue("Failed to compile\nModule not found: Can't resolve './x'");
  assert.ok(issue && issue.kind === "compile");
  results.push({ test: "pilares scaffold/truncado/detector", ok: true });

  // 5) renderer no pide CONTINUA en stop
  const rendererSrc = fs.readFileSync(path.join(projectRoot, "renderer.js"), "utf8");
  assert.ok(rendererSrc.includes('const stopMsg = "Detenido."'), "renderer responde Detenido.");
  assert.ok(rendererSrc.includes("hardStopFromChat"), "renderer tiene hardStopFromChat");
  // Los únicos CONTINUA o PROCEDE en mensajes de stop no deben existir
  const stopBlocks = rendererSrc.match(/isUserStopCommand[\s\S]{0,800}stopMsg\s*=\s*"[^"]+"/g) || [];
  for (const block of stopBlocks) {
    assert.ok(!/CONTINUA|PROCEDE/i.test(block), "stop no debe pedir CONTINUA");
  }
  results.push({ test: "renderer stop → Detenido.", ok: true });

  // 6) stopChat idempotente
  const s2 = stopChat();
  assert.strictEqual(s2.kind, "STOP");
  assert.ok(typeof s2.text === "string" && s2.text.length > 0);
  results.push({ test: "stopChat()", ok: true });

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.stack || err) }, null, 2));
  process.exit(1);
});
