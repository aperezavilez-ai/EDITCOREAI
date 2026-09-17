"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { MultimodalVoiceCanvas, VOICE_COMMAND_MAP } = require("../runtime/multimodal-voice-canvas");
const { CURSOR_ICONS } = require("../runtime/cursor-icons");

test("MultimodalVoiceCanvas formats image prompts, interprets voice commands and renders Cursor icons", () => {
  const canvas = new MultimodalVoiceCanvas();

  // 1. Procesamiento de imagen para Image-to-Code
  const base64Dummy = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const imgRes = canvas.processImageForCodeGeneration(base64Dummy, { language: "tsx", framework: "tailwind" });
  assert.equal(imgRes.ok, true);
  assert.equal(imgRes.isBase64, true);
  assert.equal(imgRes.mimeType, "image/png");
  assert.ok(imgRes.promptTemplate.includes("Pixel-Perfect Design"));
  assert.ok(imgRes.promptTemplate.includes("TSX"));
  assert.ok(imgRes.promptTemplate.includes("TAILWIND"));

  // 2. Interpretación de comandos por voz
  const cmd1 = canvas.interpretVoiceTranscript("ejecuta los tests unitarios");
  assert.equal(cmd1.intent, "run_tests");
  assert.equal(cmd1.action, "run_command");
  assert.equal(cmd1.payload.command, "npm test");

  const cmd2 = canvas.interpretVoiceTranscript("deshacer los últimos cambios");
  assert.equal(cmd2.intent, "rollback");
  assert.equal(cmd2.action, "rollback_last_session");

  const cmd3 = canvas.interpretVoiceTranscript("crea un botón de comprar en azul");
  assert.equal(cmd3.intent, "general_ai_prompt");
  assert.equal(cmd3.prompt, "crea un botón de comprar en azul");

  // 3. Renderizado de botón de micrófono con SVG Cursor
  const micHtml = canvas.renderMicButtonHTML({ isActive: false });
  assert.ok(micHtml.includes("ec-voice-trigger-btn"));
  assert.ok(micHtml.includes("<svg"));

  const micActiveHtml = canvas.renderMicButtonHTML({ isActive: true });
  assert.ok(micActiveHtml.includes("active"));
  assert.ok(micActiveHtml.includes("#ef4444"));

  // 4. Verificación de iconos del suite Cursor
  assert.ok(CURSOR_ICONS.sparkles.includes("<svg"));
  assert.ok(CURSOR_ICONS.gitBranch.includes("<svg"));
  assert.ok(CURSOR_ICONS.timeTravel.includes("<svg"));
});
