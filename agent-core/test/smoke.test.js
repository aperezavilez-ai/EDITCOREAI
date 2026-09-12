"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const core = require("../index.js");

function resolveRuntimeDir() {
  const candidates = [
    path.join(__dirname, "..", "..", "app", "runtime"), // resources/editcore-agent-core/test
    path.join(__dirname, "..", "..", "runtime"), // resources/app/agent-core/test
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function resolveBridge() {
  const candidates = [
    path.join(__dirname, "..", "..", "app", "runtime", "agent-core-bridge.js"),
    path.join(__dirname, "..", "..", "runtime", "agent-core-bridge.js"),
  ];
  const hit = candidates.find((p) => fs.existsSync(p));
  return hit ? require(hit) : null;
}

test("classifyMode: list+explain", () => {
  assert.equal(
    core.classifyMode("Lista los archivos de resources/app/runtime y explica qué hace action-registry.js"),
    "explain",
  );
});

test("classifyMode: diagnostico", () => {
  assert.equal(
    core.classifyMode("MODO: DIAGNÓSTICO — NO MODIFICAR ARCHIVOS\nAudita SOLO estos archivos"),
    "diagnose",
  );
});

test("planTask list+explain incluye list_files y read_file", () => {
  const plan = core.planTask({
    prompt: "Lista los archivos de resources/app/runtime y explica qué hace action-registry.js",
    allowWrite: true,
  });
  assert.equal(plan.mode, "explain");
  assert.ok(plan.steps.some((s) => s.tool === "list_files"));
  assert.ok(plan.steps.some((s) => s.tool === "read_file"));
});

test("runAgent con tools mock responde en español sin meta-verificacion", async () => {
  const runtimeDir = resolveRuntimeDir();
  assert.ok(runtimeDir, "runtime dir");
  const entries = fs.readdirSync(runtimeDir).slice(0, 40).map((name) => {
    const full = path.join(runtimeDir, name);
    return { name, kind: fs.statSync(full).isDirectory() ? "directory" : "file" };
  });
  const actionRegistry = fs.readFileSync(path.join(runtimeDir, "action-registry.js"), "utf8").slice(0, 4000);

  const result = await core.runAgent({
    prompt: "Lista los archivos de resources/app/runtime y explica qué hace action-registry.js",
    projectRoot: path.join(__dirname, "..", "..", ".."),
    allowWrite: false,
    permissionMode: "full",
    tools: {
      async execute(name, input) {
        if (name === "list_files") return { entries, path: input.path };
        if (name === "read_file") {
          return {
            path: input.path || "resources/app/runtime/action-registry.js",
            content: actionRegistry,
          };
        }
        throw new Error(`tool no mockeada: ${name}`);
      },
    },
  });

  assert.equal(result.completed, true);
  assert.match(result.text, /Archivos en|Qué hace/i);
  assert.doesNotMatch(result.text, /Verificacion completada con evidencia real/i);
  assert.ok(result.steps.some((s) => s.name === "list_files" && s.ok));
  assert.ok(result.steps.some((s) => s.name === "read_file" && s.ok));
});

test("explain agent-core-bridge anclado a evidencia (no inventa IPC)", async () => {
  const bridgePath = [
    path.join(__dirname, "..", "..", "app", "runtime", "agent-core-bridge.js"),
    path.join(__dirname, "..", "..", "runtime", "agent-core-bridge.js"),
  ].find((p) => fs.existsSync(p));
  assert.ok(bridgePath, "bridge file");
  const content = fs.readFileSync(bridgePath, "utf8");
  const entries = [
    { name: "agent-core-bridge.js", kind: "file" },
    { name: "agent-runtime.js", kind: "file" },
    { name: "editcore-claude-adapter.js", kind: "file" },
  ];

  const result = await core.runAgent({
    prompt: "Lista los archivos en resources/app/runtime y explica brevemente para qué sirve agent-core-bridge.js",
    projectRoot: path.join(__dirname, "..", "..", ".."),
    allowWrite: false,
    tools: {
      async execute(name, input) {
        if (name === "list_files") return { entries, path: input.path };
        if (name === "read_file") {
          return { path: "resources/app/runtime/agent-core-bridge.js", content };
        }
        throw new Error(`tool no mockeada: ${name}`);
      },
    },
    // Si alguien inyecta un modelo alucinador, el verifier debe ignorarlo.
    providerApi: {
      async call() {
        return {
          content: "Expone window.agentBridge via contextBridge IPC de Electron al proceso de renderizado.",
          tool_calls: [],
        };
      },
    },
  });

  assert.equal(result.completed, true);
  assert.match(result.text, /agent-core-bridge/i);
  assert.match(result.text, /editcore-agent-core|Agent Core/i);
  assert.doesNotMatch(result.text, /window\.agentBridge|contextBridge/i);
});

test("packEvidence prioriza invocacion tryRunAgentCore en main.js", () => {
  const { packEvidenceForModel } = require("../src/llm-loop");
  const head = Array.from({ length: 400 }, (_, i) => `// head ${i}`).join("\n")
    + '\nconst { tryRunAgentCore, isAgentCoreEnabled } = require("./runtime/agent-core-bridge");\n';
  const invoke = [
    "const useCore = isAgentCoreEnabled({});",
    'sendAgentProgress({ phase: "startup", text: "Agent Core (motor instalado)..." });',
    "const coreResult = await tryRunAgentCore({",
    '  prompt: String(input.prompt || task || ""),',
    "  tools: adapter.toolExecutor,",
    "  providerApi: adapter.providerApi,",
    "});",
  ].join("\n");
  const packed = packEvidenceForModel([
    {
      name: "read_file",
      ok: true,
      input: { path: "resources/app/main.js", startLine: 1, endLine: 500 },
      result: { path: "resources/app/main.js", content: head, startLine: 1, endLine: 500, totalLines: 6000, truncated: true },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "resources/app/main.js", startLine: 5280, endLine: 5380 },
      result: { path: "resources/app/main.js", content: invoke, startLine: 5280, endLine: 5380, totalLines: 6000, truncated: true },
    },
  ], { prompt: "diagnostica main.js", maxChars: 8000 });

  assert.match(packed.text, /tryRunAgentCore\s*\(/);
  assert.match(packed.text, /CONTIENE_INVOCACION=tryRunAgentCore/);
  assert.match(packed.text, /MATCH tryRunAgentCore|ventana|OBLIGATORIO/i);
});

test("PROCEDE + crea archivo .txt ejecuta write_file real", async () => {
  const writes = [];
  const files = {};
  const result = await core.runAgent({
    prompt: [
      "PROCEDE",
      "Crea SOLO el archivo resources/app/agent-core/SMOKE_AGENT_CORE.txt",
      "con exactamente este contenido de una línea:",
      "agent-core-ok-0.2.7",
      "No toques ningún otro archivo.",
    ].join("\n"),
    projectRoot: "D:/PROGRAMAS IA/EDITCOREAI",
    allowWrite: false, // incluso si la UI manda allowWrite false, createSpec fuerza el write pedido
    planAuthorized: true,
    analysisMode: true,
    tools: {
      async execute(name, input) {
        if (name === "write_file") {
          writes.push(input);
          files[input.path] = String(input.content || "");
          return { path: input.path, bytes: files[input.path].length };
        }
        if (name === "read_file") {
          return { path: input.path, content: files[input.path] || "" };
        }
        throw new Error(name);
      },
    },
  });

  assert.equal(result.mode, "execute");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "resources/app/agent-core/SMOKE_AGENT_CORE.txt");
  assert.equal(writes[0].content, "agent-core-ok-0.2.7");
  assert.match(result.text, /SMOKE_AGENT_CORE\.txt/);
  assert.match(result.text, /agent-core-ok-0\.2\.7/);
  assert.equal(result.steps.some((s) => s.name === "write_file" && s.ok), true);
  assert.doesNotMatch(result.text, /evidence-grounding|action-registry|editcore-claude-adapter/i);
});

test("createSpec no deja al LLM tocar otros archivos si write falla", async () => {
  const writes = [];
  const result = await core.runAgent({
    prompt: [
      "PROCEDE",
      "Crea SOLO el archivo resources/app/agent-core/SMOKE_AGENT_CORE.txt",
      "agent-core-ok-0.2.7",
    ].join("\n"),
    allowWrite: true,
    planAuthorized: true,
    tools: {
      async execute(name, input) {
        writes.push({ name, path: input.path });
        if (name === "write_file") throw new Error("disk denied");
        throw new Error(name);
      },
    },
    providerApi: {
      async call() {
        return {
          tool_calls: [{
            id: "x",
            function: {
              name: "replace_in_file",
              arguments: JSON.stringify({
                path: "resources/app/runtime/action-registry.js",
                oldText: "a",
                newText: "b",
              }),
            },
          }],
        };
      },
    },
  });

  assert.equal(writes.some((w) => /action-registry/.test(w.path || "")), false);
  assert.match(result.text, /No pude crear|disk denied/i);
  assert.doesNotMatch(result.text, /Corrección aplicada|Evidencia de correccion[\s\S]*action-registry/i);
});

test("createSpec no secuestra editcore-claude-adapter del historial", () => {
  const { extractCreateFileSpec } = require("../src/modes");
  const poisoned = [
    "PROCEDE",
    "Antes leimos resources/app/runtime/editcore-claude-adapter.js",
    "Crea SOLO el archivo resources/app/agent-core/SMOKE_AGENT_CORE.txt",
    "agent-core-ok-0.2.8",
  ].join("\n");
  const spec = extractCreateFileSpec(poisoned);
  assert.equal(spec.path, "resources/app/agent-core/SMOKE_AGENT_CORE.txt");
  assert.equal(spec.content, "agent-core-ok-0.2.8");

  const onlyHistory = [
    "PROCEDE",
    "Corrige resources/app/runtime/editcore-claude-adapter.js",
    "resources/app/runtime/action-registry.js",
  ].join("\n");
  assert.equal(extractCreateFileSpec(onlyHistory), null);
});

test("diagnose sintetiza con el modelo sobre evidencia real (no plantilla fija)", async () => {
  const files = {
    "resources/app/runtime/agent-core-bridge.js": "/** Puente IDE ↔ editcore-agent-core */\nfunction isAgentCoreEnabled(){return true}\nmodule.exports={isAgentCoreEnabled,tryRunAgentCore};",
    "resources/app/agent-core/index.js": "module.exports={runAgent(){},version:'0.2.2'};",
    "resources/app/agent-core/src/orchestrator.js": "async function runAgent(){}\nmodule.exports={runAgent};",
    "resources/app/main.js": (() => {
      const lines = [];
      for (let i = 1; i <= 5400; i += 1) {
        if (i === 70) lines.push('const { deployOneClick } = require("./runtime/deploy-one-click");');
        else if (i === 102) lines.push('const { tryRunAgentCore, isAgentCoreEnabled } = require("./runtime/agent-core-bridge");');
        else if (i === 5314) lines.push("const useCore = isAgentCoreEnabled({});");
        else if (i === 5320) lines.push("const coreResult = await tryRunAgentCore({ prompt: \"x\" });");
        else lines.push(`// line ${i}`);
      }
      return lines.join("\n");
    })(),
  };
  let providerCalls = 0;
  let sawEvidence = false;
  let sawBridgeUse = false;
  const result = await core.runAgent({
    prompt: [
      "MODO: DIAGNÓSTICO — NO MODIFICAR ARCHIVOS",
      "Audita SOLO estos archivos:",
      "1) resources/app/runtime/agent-core-bridge.js",
      "2) resources/app/agent-core/index.js",
      "3) resources/app/agent-core/src/orchestrator.js",
      "4) resources/app/main.js",
    ].join("\n"),
    projectRoot: "D:/PROGRAMAS IA/EDITCOREAI",
    allowWrite: false,
    analysisMode: true,
    tools: {
      async execute(name, input) {
        if (name === "read_file" && files[input.path]) {
          const lines = files[input.path].split(/\n/);
          const start = Math.max(1, Number(input.startLine) || 1);
          const end = Math.min(lines.length, Number(input.endLine) || start + 299);
          return {
            path: input.path,
            content: lines.slice(start - 1, end).join("\n"),
            startLine: start,
            endLine: end,
            totalLines: lines.length,
            truncated: end < lines.length || start > 1,
          };
        }
        throw new Error(`unexpected ${name} ${input.path || ""}`);
      },
    },
    providerApi: {
      async call({ messages, tools }) {
        providerCalls += 1;
        assert.ok(!tools || tools.length === 0, "sintesis no debe pedir tools");
        const blob = JSON.stringify(messages);
        sawEvidence = /Puente IDE|tryRunAgentCore|FILE resources\/app\/runtime\/agent-core-bridge/.test(blob);
        sawBridgeUse = /tryRunAgentCore/.test(blob);
        assert.match(blob, /PACK_TRUNCATED|AVISO|BYTES_IN_TOOL_RESULT|ventana|HEAD|MATCH|evidencia completa/i);
        assert.doesNotMatch(blob.slice(0, 500), /^FILE main\.js\nconst/); // must have headers
        return {
          content: [
            "## Qué sí funcionó",
            "Leí los archivos objetivos. main.js usa tryRunAgentCore del bridge.",
            "## Resumen por archivo",
            "agent-core-bridge.js conecta IDE con editcore-agent-core.",
            "main.js integra Agent Core (tryRunAgentCore).",
            "## Qué falló / hallazgos",
            "Sin defectos reales en esta evidencia.",
            "## Evidencia",
            "- read_file OK en 4 archivos (+ ventana main)",
            "## Cómo lo corregiré",
            "Sin correcciones pendientes.",
          ].join("\n"),
        };
      },
    },
  });

  assert.equal(result.completed, true);
  assert.equal(providerCalls, 1);
  assert.equal(sawEvidence, true);
  assert.equal(sawBridgeUse, true);
  assert.equal(result.usage.provider_calls, 1);
  assert.ok(result.steps.filter((s) => s.name === "read_file" && s.ok).length >= 4);
  assert.match(result.text, /Qué sí funcionó|tryRunAgentCore|agent-core-bridge/i);
  assert.doesNotMatch(result.text, /view_file|edit_file|file_reader/i);
  assert.doesNotMatch(result.text, /URGENTE:\s*Completar|sintaxis incompleta|archivo incompleto/i);
});

test("verifier rechaza falso truncamiento de main.js", () => {
  const { verifyAndReport, hasFalseTruncationClaim } = require("../src/verifier");
  const steps = [{
    name: "read_file",
    ok: true,
    input: { path: "resources/app/main.js" },
    result: { path: "resources/app/main.js", content: "const { deployOneClick } = require(\"./runtime/deploy-one-click\");", truncated: true, totalLines: 6000 },
  }];
  const fake = [
    "## Qué sí funcionó",
    "Lei main.js",
    "## Resumen por archivo",
    "main.js",
    "## Qué falló / hallazgos",
    "main.js está TRUNCADO. require incompleto. Error de sintaxis.",
    "URGENTE: Completar la línea 62 de main.js",
    "## Evidencia",
    "- read_file OK",
    "## Cómo lo corregiré",
    "Completar require",
  ].join("\n");
  assert.equal(hasFalseTruncationClaim(fake, steps), true);
  const out = verifyAndReport({
    plan: { mode: "diagnose" },
    steps,
    input: { projectRoot: "D:/x" },
    finalText: fake,
  });
  assert.doesNotMatch(out.text, /URGENTE:\s*Completar|sintaxis incompleta/i);
});

test("limitacion de evidencia no se confunde con archivo roto", () => {
  const { verifyAndReport, hasFalseTruncationClaim } = require("../src/verifier");
  const steps = [
    {
      name: "read_file",
      ok: true,
      input: { path: "resources/app/main.js", startLine: 1, endLine: 500 },
      result: {
        path: "resources/app/main.js",
        content: "const { tryRunAgentCore } = require(\"./runtime/agent-core-bridge\");\nfunction addExistingPathEntries(){}",
        startLine: 1,
        endLine: 500,
        totalLines: 6000,
        truncated: true,
      },
    },
    {
      name: "read_file",
      ok: true,
      input: { path: "resources/app/main.js", startLine: 5280, endLine: 5380 },
      result: {
        path: "resources/app/main.js",
        content: "const useCore = isAgentCoreEnabled({});\nconst coreResult = await tryRunAgentCore({ prompt: \"x\" });",
        startLine: 5280,
        endLine: 5380,
        totalLines: 6000,
        truncated: true,
      },
    },
  ];
  const model = [
    "INFORME",
    "main.js integra Agent Core via tryRunAgentCore.",
    "Hay limitacion de evidencia por ventanas (no implica archivo incompleto en disco).",
    "Sin defectos reales.",
  ].join("\n");
  assert.equal(hasFalseTruncationClaim(model, steps), false);
  const out = verifyAndReport({
    plan: { mode: "diagnose" },
    steps,
    input: { projectRoot: "D:/x" },
    finalText: model,
  });
  assert.equal(out.stopReason, "diagnose_model");
  assert.match(out.text, /tryRunAgentCore/);

  const fallback = verifyAndReport({
    plan: { mode: "diagnose" },
    steps,
    input: { projectRoot: "D:/x" },
    finalText: "",
  });
  assert.match(fallback.text, /tryRunAgentCore|Integracion Agent Core|agent-core-bridge/i);
});

test("extractReplaceSpecs soporta varios oldText/newText", () => {
  const specs = core.extractReplaceSpecs([
    "PROCEDE",
    "replace_in_file en resources/app/agent-core/A.txt",
    "oldText:",
    "uno",
    "newText:",
    "UNO",
    "",
    "oldText:",
    "dos",
    "newText:",
    "DOS",
    "No toques nada mas.",
  ].join("\n"));
  assert.equal(specs.length, 2);
  assert.equal(specs[0].path, "resources/app/agent-core/A.txt");
  assert.equal(specs[0].oldText, "uno");
  assert.equal(specs[1].newText, "DOS");
});

test("PROCEDE multi-replace ejecuta N replace_in_file", async () => {
  const replaces = [];
  let content = "alpha\nbeta\n";
  const result = await core.runAgent({
    prompt: [
      "PROCEDE",
      "Usa replace_in_file en resources/app/agent-core/MULTI.txt",
      "oldText:",
      "alpha",
      "newText:",
      "ALPHA",
      "",
      "oldText:",
      "beta",
      "newText:",
      "BETA",
      "No toques nada mas.",
    ].join("\n"),
    projectRoot: "D:/PROGRAMAS IA/EDITCOREAI",
    allowWrite: true,
    planAuthorized: true,
    tools: {
      async execute(name, input) {
        if (name === "read_file") return { path: input.path, content };
        if (name === "replace_in_file") {
          replaces.push(input);
          if (!content.includes(input.oldText)) throw new Error("oldText missing");
          content = content.replace(input.oldText, input.newText);
          return { path: input.path, bytes: content.length };
        }
        throw new Error(name);
      },
    },
  });
  assert.equal(replaces.length, 2);
  assert.equal(content, "ALPHA\nBETA\n");
  assert.match(result.text, /Evidencia de correccion/i);
  assert.match(result.text, /replace_in_file OK/i);
});

test("PROCEDE borrar archivo ejecuta delete_file", async () => {
  const deletes = [];
  const result = await core.runAgent({
    prompt: [
      "PROCEDE",
      "Borra el archivo resources/app/agent-core/SMOKE_DELETE.txt",
      "No toques nada mas.",
    ].join("\n"),
    projectRoot: "D:/PROGRAMAS IA/EDITCOREAI",
    allowWrite: true,
    planAuthorized: true,
    tools: {
      async execute(name, input) {
        if (name === "delete_file") {
          deletes.push(input);
          return { path: input.path, deleted: true };
        }
        throw new Error(name);
      },
    },
  });
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].path, "resources/app/agent-core/SMOKE_DELETE.txt");
  assert.match(result.text, /borrado|delete_file OK/i);
  assert.equal(result.report?.mutated, true);
});

test("extractVerifyCommand detecta npm test", () => {
  assert.equal(
    core.extractVerifyCommand("PROCEDE\nArregla foo.js y verifica con npm test"),
    "npm test",
  );
  assert.equal(
    core.extractVerifyCommand("corre node --test test/smoke.test.js"),
    "node --test test/smoke.test.js",
  );
  assert.equal(
    core.extractVerifyCommand('verifica con node -e "console.log(1)"'),
    null,
  );
});

test("extractSwapSpec cambia A por B", () => {
  const swap = core.extractSwapSpec([
    "PROCEDE",
    "Arregla resources/app/agent-core/SMOKE_W1.txt:",
    "cambia w1-ok por w1-week2-ok",
  ].join("\n"));
  assert.equal(swap.path, "resources/app/agent-core/SMOKE_W1.txt");
  assert.equal(swap.oldText, "w1-ok");
  assert.equal(swap.newText, "w1-week2-ok");
});

test("swap crea archivo si no existe", async () => {
  const writes = [];
  const files = {};
  const result = await core.runAgent({
    prompt: [
      "PROCEDE",
      "Arregla resources/app/agent-core/SMOKE_MISSING.txt:",
      "cambia missing-old por missing-new",
    ].join("\n"),
    projectRoot: "D:/PROGRAMAS IA/EDITCOREAI",
    allowWrite: true,
    planAuthorized: true,
    tools: {
      async execute(name, input) {
        if (name === "read_file") {
          if (!files[input.path]) throw new Error(`Archivo no encontrado: ${input.path}`);
          return { path: input.path, content: files[input.path] };
        }
        if (name === "replace_in_file") {
          if (!files[input.path]) throw new Error(`Archivo no encontrado: ${input.path}`);
          if (!files[input.path].includes(input.oldText)) throw new Error("oldText no existe");
          files[input.path] = files[input.path].replace(input.oldText, input.newText);
          return { path: input.path };
        }
        if (name === "write_file") {
          writes.push(input);
          files[input.path] = input.content;
          return { path: input.path, bytes: String(input.content || "").length };
        }
        throw new Error(name);
      },
    },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].content, "missing-new");
  assert.match(result.text, /Mutaciones aplicadas|write_file OK/i);
});

test("freeFormFix plan: arregla sin oldText lee archivo y marca verify", () => {
  const plan = core.planTask({
    prompt: "PROCEDE\nArregla el bug en resources/app/agent-core/src/modes.js y verifica con npm test",
    allowWrite: true,
    planAuthorized: true,
  });
  assert.equal(plan.mode, "execute");
  assert.equal(plan.freeFormFix, true);
  assert.equal(plan.verifyCommand, "npm test");
  assert.ok(plan.steps.some((s) => s.tool === "read_file"));
  assert.ok(plan.steps.some((s) => s.type === "mutate"));
  assert.ok(plan.steps.some((s) => s.type === "verify"));
});

test("execute freeForm + verify falla luego repara y pasa", async () => {
  let content = "const BAD = 1;\n";
  let testRound = 0;
  let replaced = false;
  const result = await core.runAgent({
    prompt: "PROCEDE\nArregla resources/app/agent-core/demo.js: cambia BAD por GOOD y verifica con npm test",
    projectRoot: "D:/PROGRAMAS IA/EDITCOREAI",
    allowWrite: true,
    planAuthorized: true,
    tools: {
      async execute(name, input) {
        if (name === "read_file") return { path: input.path, content };
        if (name === "replace_in_file") {
          if (!content.includes(input.oldText)) throw new Error("oldText missing");
          content = content.replace(input.oldText, input.newText);
          replaced = true;
          return { path: input.path, bytes: content.length };
        }
        if (name === "run_command") {
          testRound += 1;
          if (!replaced || !content.includes("GOOD")) {
            return {
              diagnostic: true,
              toolOk: true,
              passed: false,
              exitCode: 1,
              output: "FAIL expected GOOD",
            };
          }
          return {
            diagnostic: true,
            toolOk: true,
            passed: true,
            exitCode: 0,
            output: "PASS",
          };
        }
        throw new Error(name);
      },
    },
    providerApi: {
      async call({ messages }) {
        const last = JSON.stringify(messages).slice(-800);
        if (/REPARACION REQUERIDA|FAIL expected GOOD/i.test(last) || (!replaced && /SOLICITUD/i.test(last))) {
          return {
            text: "Corrigiendo",
            tool_calls: [{
              id: "c1",
              function: {
                name: "replace_in_file",
                arguments: JSON.stringify({
                  path: "resources/app/agent-core/demo.js",
                  oldText: "const BAD = 1;",
                  newText: "const GOOD = 1;",
                }),
              },
            }],
          };
        }
        return { text: "Listo sin tools" };
      },
    },
  });
  assert.equal(replaced, true);
  assert.ok(testRound >= 1);
  assert.match(content, /GOOD/);
  assert.match(result.text, /Verificacion PASO|run_command PASO|PASS/i);
});
