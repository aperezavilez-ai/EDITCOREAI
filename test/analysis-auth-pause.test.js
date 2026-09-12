"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ActionRegistry } = require("../runtime/action-registry");
const { EditCoreClaudeAdapter } = require("../runtime/editcore-claude-adapter");

function temporaryProject(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  return dir;
}

function toolCall(name, input, id = "call-1") {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(input) },
  };
}

test("analisis: al pedir autorizacion cierra y NO sigue con mas tools", async (t) => {
  const projectRoot = temporaryProject(t, "editcore-auth-pause-");
  fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }, null, 2));
  fs.writeFileSync(path.join(projectRoot, "README.md"), "# demo\n");

  const executed = [];
  let providerCalls = 0;
  const adapter = new EditCoreClaudeAdapter({
    maxIterations: 6,
    tokenBudget: 50_000,
    logger: { log() {}, warn() {}, error() {} },
  });
  adapter.actionRegistry = new ActionRegistry();
  adapter.providerApi = {
    call: async () => {
      providerCalls += 1;
      if (providerCalls === 1) {
        return {
          text: "",
          toolCalls: [toolCall("list_files", { path: "" }, "list-1")],
          usage: { total_tokens: 5 },
        };
      }
      // Segundo turno: pide autorizacion Y ademas intenta mas tools (bug historico).
      return {
        text: [
          "## Qué sí funcionó",
          "",
          "Hay package.json y README.md en disco.",
          "",
          "## Qué falló / hallazgos",
          "",
          "- Falta documentacion de arranque detallada.",
          "",
          "## Evidencia",
          "",
          "- list_files: package.json, README.md",
          "",
          "## Cómo lo corregiré",
          "",
          "- Ampliar README.md con pasos de instalacion.",
          "",
          "Cuando autorices procedo con las correcciones.",
        ].join("\n"),
        toolCalls: [toolCall("read_file", { path: "package.json" }, "read-extra")],
        usage: { total_tokens: 20 },
      };
    },
  };
  adapter.toolExecutor = {
    execute: async (name, input) => {
      executed.push({ name, path: input?.path || "", id: input?.__callId || "" });
      if (name === "list_files") {
        return fs.readdirSync(projectRoot, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          path: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
        }));
      }
      if (name === "read_file") {
        return { path: input.path, content: fs.readFileSync(path.join(projectRoot, input.path), "utf8") };
      }
      throw new Error(`tool inesperada: ${name}`);
    },
  };

  const result = await adapter.executeTask({
    prompt: "dame un reporte completo del estado del proyecto",
    projectRoot,
    analysisMode: true,
    allowWrite: false,
    requireEvidence: true,
    enforceController: true,
  });

  assert.equal(result.completed, true, result.stopReason || result.text);
  assert.match(String(result.report?.stopReason || result.stopReason || ""), /autorizacion/i);
  assert.equal(result.report?.awaitingAuthorization, true);
  assert.equal(result.report?.autoResumeRecommended, false);
  assert.equal(providerCalls, 2, "no debe seguir llamando al modelo tras pedir autorizacion");
  // Lecturas de bootstrap OK; lo prohibido es seguir el tool_call del turno que ya pidio autorizacion.
  assert.ok(
    !result.steps?.some((step) => step.name === "read_file" && step.callId === "read-extra"),
    "no debe ejecutar el read_file del turno que pide autorizacion",
  );
  assert.match(result.text || "", /Cuando autorices|package\.json|README/i);
});
