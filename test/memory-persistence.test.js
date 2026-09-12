"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { compactChatHistory } = require("../agent-runtime");
const {
  loadProjectMemory,
  saveProjectMemory,
  rememberProjectEvent,
  formatMemoryForPrompt,
} = require("../runtime/project-memory");
const { runParallelExplore, runSubagent } = require("../runtime/subagent-runner");
const { AgentMemory } = require("../runtime/agent-memory");

function temporaryProject(t, prefix = "editcore-mem-test-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  });
  return root;
}

test("compactChatHistory mantiene intacto un historial corto dentro de los limites", () => {
  const history = [
    { role: "user", content: "Crea una barra de navegación con Tailwind." },
    { role: "assistant", content: "He creado el componente Navbar.tsx." },
  ];
  const compacted = compactChatHistory(history, { maxMessages: 10 });
  assert.equal(compacted.length, 2);
  assert.equal(compacted[0].content, "Crea una barra de navegación con Tailwind.");
  assert.equal(compacted[1].content, "He creado el componente Navbar.tsx.");
});

test("compactChatHistory genera un resumen progresivo de turnos anteriores cuando el chat es largo", () => {
  const history = [];
  for (let i = 1; i <= 30; i++) {
    history.push({ role: "user", content: `Instrucción del turno ${i}: Requisito número ${i} del proyecto.` });
    history.push({ role: "assistant", content: `Respuesta del turno ${i}: Implementado paso ${i}.` });
  }

  const compacted = compactChatHistory(history, { maxMessages: 8 });
  assert.equal(compacted.length, 9);
  assert.equal(compacted[0].role, "user");
  assert.match(compacted[0].content, /HISTORIAL PREVIO CONVERSACIONAL/i);
  assert.match(compacted[0].content, /Instrucción del turno 1/i);

  const lastUser = compacted[compacted.length - 2];
  const lastAssistant = compacted[compacted.length - 1];
  assert.equal(lastUser.content, "Instrucción del turno 30: Requisito número 30 del proyecto.");
  assert.equal(lastAssistant.content, "Respuesta del turno 30: Implementado paso 30.");
});

test("compactChatHistory preserva contenido multimodal sin corromperlo", () => {
  const history = [
    {
      role: "user",
      content: [
        { type: "text", text: "Analiza esta imagen adjunta" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
      ],
    },
    { role: "assistant", content: "He analizado el diseño." },
  ];
  const compacted = compactChatHistory(history, { maxMessages: 10 });
  assert.equal(compacted.length, 2);
  assert.ok(Array.isArray(compacted[0].content));
  assert.equal(compacted[0].content[0].text, "Analiza esta imagen adjunta");
});

test("project-memory recuerda eventos, archivos y tareas de forma acumulativa", (t) => {
  const root = temporaryProject(t);

  rememberProjectEvent(root, {
    task: "Crear arquitectura base",
    summary: "Se configuró React + Vite + Tailwind",
    files: ["src/App.tsx", "src/main.tsx"],
    stack: ["react", "vite", "tailwindcss"],
    decision: "Usar TypeScript estricto",
  });

  rememberProjectEvent(root, {
    task: "Agregar autenticacion",
    summary: "Se integraron rutas protegidas",
    files: ["src/components/AuthModal.tsx"],
    decision: "Persistir token seguro",
  });

  const memory = loadProjectMemory(root);
  assert.equal(memory.recentTasks.length, 2);
  assert.equal(memory.recentTasks[0].task, "Agregar autenticacion");
  assert.ok(memory.recentFiles.includes("src/components/AuthModal.tsx"));
  assert.ok(memory.recentFiles.includes("src/App.tsx"));
  assert.ok(memory.decisions.some((d) => d.text.includes("TypeScript estricto")));

  const formatted = formatMemoryForPrompt(memory);
  assert.match(formatted, /MEMORIA LOCAL DEL PROYECTO/i);
  assert.match(formatted, /AuthModal\.tsx/i);
  assert.match(formatted, /TypeScript estricto/i);
});

test("runParallelExplore sincroniza archivos descubiertos con la memoria del proyecto", async (t) => {
  const root = temporaryProject(t);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "test-app" }));
  fs.writeFileSync(path.join(root, "index.html"), "<html><body>App</body></html>");

  const result = await runParallelExplore(root, { query: "package" });
  assert.equal(result.mode, "parallel-explore");

  const memory = loadProjectMemory(root);
  assert.ok(memory.recentTasks.some((t) => t.task.includes("[Subagente Exploración]")));
});

test("runSubagent con implementer sincroniza parches aplicados con la memoria del proyecto", async (t) => {
  const root = temporaryProject(t);
  const written = [];
  const ctx = {
    applyWrite: async (relPath, content) => {
      written.push({ relPath, content });
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return true;
    },
  };

  const res = await runSubagent(root, {
    role: "implementer",
    task: "Crear componente de Header",
    patches: [
      { path: "src/Header.tsx", content: "export const Header = () => <header>App</header>;" },
    ],
  }, ctx);

  assert.ok(res.ok);
  assert.equal(written.length, 1);

  const memory = loadProjectMemory(root);
  assert.ok(memory.recentTasks.some((t) => t.task.includes("[Subagente Implementer]")));
  assert.ok(memory.recentFiles.includes("src/Header.tsx"));
});
