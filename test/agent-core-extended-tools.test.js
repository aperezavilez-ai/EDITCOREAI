"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const srcDir = path.join(__dirname, "..", "agent-core", "src");
const { runLlmToolLoop, systemPromptForMode } = require(path.join(srcDir, "llm-loop"));

function loadOrchestratorWithoutExtendedTools() {
  const orchestratorPath = require.resolve(path.join(srcDir, "orchestrator"));
  delete require.cache[orchestratorPath];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, ...rest) {
    if (request === "./tools-extended" && parent?.filename === orchestratorPath) {
      throw new Error("Cannot find module 'axios'");
    }
    return originalLoad.call(this, request, parent, ...rest);
  };
  try {
    return require(orchestratorPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[orchestratorPath];
  }
}

test("el prompt de sistema avisa qué herramientas no están disponibles solo cuando faltan", () => {
  const without = systemPromptForMode("explain", false, { unavailableTools: ["web_search", "git_clone"] });
  assert.match(without, /HERRAMIENTAS NO DISPONIBLES EN ESTA CORRIDA: web_search, git_clone/);
  const normal = systemPromptForMode("explain", false, {});
  assert.doesNotMatch(normal, /HERRAMIENTAS NO DISPONIBLES/);
});

test("runLlmToolLoop pasa al modelo el aviso de herramientas no disponibles", async () => {
  let systemText = "";
  await runLlmToolLoop({
    prompt: "busca en internet la versión de electron",
    projectRoot: os.tmpdir(),
    unavailableTools: ["web_search", "web_fetch"],
    tools: { async execute() { return { ok: true }; } },
    providerApi: {
      async call({ messages }) {
        systemText = messages.find((m) => m.role === "system")?.content || "";
        return { text: "No tengo acceso a internet en esta corrida." };
      },
    },
  }, { mode: "explain", maxIterations: 1 });
  assert.match(systemText, /HERRAMIENTAS NO DISPONIBLES EN ESTA CORRIDA: web_search, web_fetch/);
});

test("sin tools-extended, runAgent devuelve una advertencia estructurada y el executor explica el motivo", async () => {
  const core = loadOrchestratorWithoutExtendedTools();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-agent-core-"));
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n");
  const result = await core.runAgent({ prompt: "lista los archivos del proyecto", projectRoot: root, allowWrite: false });
  assert.equal(result.usage.extendedTools, false);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].code, "EXTENDED_TOOLS_UNAVAILABLE");
  assert.ok(result.warnings[0].tools.includes("web_search"));
  const executor = core.buildDefaultExecutor({ projectRoot: root });
  const out = await executor.execute("web_search", { query: "x" });
  assert.equal(out.ok, false);
  assert.match(out.error, /no disponible/);
});

test("con tools-extended cargado o executor propio no hay advertencias", async () => {
  const core = require(path.join(srcDir, "orchestrator"));
  const result = await core.runAgent({
    prompt: "lista los archivos del proyecto",
    projectRoot: os.tmpdir(),
    allowWrite: false,
    tools: { async execute(name) { return name === "list_files" ? { entries: [] } : { ok: true }; } },
  });
  assert.deepEqual(result.warnings, []);
});
