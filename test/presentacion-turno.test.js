"use strict";

// PRESENTACIÓN DEL TURNO (v4.7.5): la batería en vivo de la v4.7.4 dejó
// cuatro fallos de presentación con raíz en el kernel, no en el modelo:
//  (P-1) el agente no pedía el «¿procedo?»: convivían una compuerta que
//        ordena preguntar y una prohibición vieja de request-scope-policy
//        que lo vetaba («PROHIBIDO… '¿procedemos a…?'») — ganó la vieja.
//  (P-2/P-3) la narrativa era el VOLCADO CRUDO del razonamiento del
//        modelo (onTextDelta → narration_delta): inglés, auto-instruc-
//        ciones filtradas y la evidencia contada dos veces (volcado +
//        respuesta final), 27k tokens para un sí/no.
//  (C-2) el Cerebro y las skills se usaban sin dejar prueba visible: el
//        usuario no podía confirmar que el turno los consultó.
//  (Detener) la señal de la corrida nunca llegaba a las herramientas y
//        runCommand ignoraba options.signal: Detener no cortaba nada
//        hasta que el comando vencía por timeout.
// Estas pruebas cubren el CAMINO COMPLETO de cada arreglo.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const Scope = require("../runtime/request-scope-policy");
const tools = require("../editcore-chat-kernel/tools");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-presentacion-"));
}

const BARE_REPORT = "Revisé los archivos en disco: src/components/layout/Footer.tsx está escrito en una sola línea con secuencias literales y src/components/layout/Navbar.tsx presenta exactamente el mismo problema.";

test("presentación: la política de alcance ya no veta el «¿procedo?» del modo «Pregunta antes»", () => {
  const focused = Scope.buildScopedUserDirective("revisa el roadmap", "evidencia");
  assert.ok(!focused.includes("o '¿procedemos a…?' si no lo pidió"), "la prohibición plana desapareció de la directiva focalizada");
  assert.ok(focused.includes("Pregunta antes"), "la directiva focalizada trae la excepción del modo paso a paso");
  assert.ok(Scope.REQUEST_SCOPE_POLICY.includes("EXCEPCIÓN QUE MANDA SOBRE ESTA REGLA"), "la política general trae la excepción que manda");
  assert.ok(Scope.REQUEST_SCOPE_POLICY.includes("contrato del modo de permisos"), "la excepción nombra el contrato del modo");
});

test("presentación: en «Pregunta antes» el cierre trae el pedido de autorización AUNQUE el modelo se niegue a preguntar", async () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "src", "components", "layout"), { recursive: true });
  const blob = "import * as React from 'react';\\nimport { Wrench } from 'lucide-react';\\n\\nexport default function Footer() { return null; }\\n";
  fs.writeFileSync(path.join(root, "src", "components", "layout", "Footer.tsx"), blob);

  // Modelo terco: cierra siempre con el reporte pelado, incluso después
  // de que la compuerta de la v4.7.4 le devuelve el turno. La garantía
  // ya no puede depender de su obediencia.
  const helpers = {
    callChat: async () => ({ text: BARE_REPORT, toolCalls: [], usage: {} }),
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "corrige los archivos Footer.tsx y Navbar.tsx que quedaron escritos en una sola línea",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "step", allowWrite: true, fullAccess: false,
    helpers, history: [],
  });

  const text = String(out.text || "");
  assert.ok(!text.includes("¿Procedo?"), "el modelo nunca preguntó (premisa del fallo en vivo)");
  assert.ok(text.includes("No apliqué ningún cambio"), "el kernel adjuntó la garantía: sin cambios + modo «Pregunta antes»");
  assert.ok(text.includes("«procede»"), "el cierre deja al usuario la palabra exacta para autorizar");
  assert.equal(fs.readFileSync(path.join(root, "src", "components", "layout", "Footer.tsx"), "utf8"), blob, "sin autorización, el archivo sigue intacto");
});

test("presentación: la narrativa ya NO vuelca el razonamiento crudo del modelo (sin narration_delta)", async () => {
  const root = tmpProject();
  const events = [];
  let calls = 0;
  const helpers = {
    callChat: async (args) => {
      calls += 1;
      if (calls === 1) {
        // El modelo «piensa en voz alta» en inglés mientras actúa: eso
        // antes llegaba tal cual al chat del usuario.
        if (typeof args.onTextDelta === "function") {
          args.onTextDelta("Alright, the task is to create the file. ");
          args.onTextDelta("I will start by writing it now, let me think about the content at length...");
        }
        return {
          text: "",
          toolCalls: [{ id: "c1", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "saludo.txt", content: "hola" }) } }],
          usage: {},
        };
      }
      return { text: "Listo: creé saludo.txt con el saludo.", toolCalls: [], usage: {} };
    },
  };

  const orch = new ChatOrchestrator();
  const out = await orch.handle({
    message: "crea el archivo saludo.txt con un saludo para el cliente",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [], onProgress: (ev) => events.push(ev),
  });

  assert.ok(!events.some((e) => e.phase === "narration_delta"), "ningún evento vuelca deltas del modelo a la narrativa");
  assert.ok(!events.some((e) => /Alright, the task is/i.test(String(e.text || ""))), "el razonamiento en inglés no llegó a la superficie visible");
  assert.ok(events.some((e) => e.phase === "narration" && /saludo\.txt/.test(String(e.text || ""))), "la línea de acción compuesta por el kernel sí narra el paso");
  assert.ok(String(out.text || "").includes("creé saludo.txt"), "la respuesta final del modelo llega una sola vez, por el camino final");
});

test("presentación: el uso del Cerebro deja prueba visible en la narrativa del turno", async () => {
  const root = tmpProject();
  const events = [];
  const helpers = {
    brainSearch: async () => ({
      memory: [{ title: "preferencia del taller", content: "El cliente prefiere saludos breves y formales." }],
      knowledge: [],
      catalog: [],
    }),
    callChat: async () => ({ text: "Entendido.", toolCalls: [], usage: {} }),
  };

  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "crea el archivo nota.txt con un saludo para el cliente",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [], onProgress: (ev) => events.push(ev),
  });

  assert.ok(
    events.some((e) => e.phase === "narration" && /Cerebro: consulté lo instalado/.test(String(e.text || ""))),
    "la narrativa muestra que el Cerebro se consultó y cuántos aportes entraron",
  );
});

test("presentación: las skills aplicadas dejan prueba visible en la narrativa del turno", async () => {
  const root = tmpProject();
  const events = [];
  const helpers = {
    callChat: async () => ({ text: "Listo.", toolCalls: [], usage: {} }),
  };

  const orch = new ChatOrchestrator();
  await orch.handle({
    message: "créame una landing para mi taller mecánico",
    projectRoot: root, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers, history: [], onProgress: (ev) => events.push(ev),
  });

  const line = events.find((e) => e.phase === "narration" && /Skills aplicadas este turno:/.test(String(e.text || "")));
  assert.ok(line, "la narrativa nombra las skills del turno");
  assert.ok(/antislop-ui|frontend-design/.test(String(line.text || "")), "las skills de diseño del catálogo quedaron nombradas");
});

test("presentación: Detener corta un comando en curso al instante (la señal ya no se ignora)", async () => {
  const root = tmpProject();
  const ac = new AbortController();
  const started = Date.now();
  const pending = tools.runCommand(root, "node -e \"setTimeout(()=>{},30000)\"", { signal: ac.signal, timeoutMs: 60000 });
  setTimeout(() => ac.abort(), 150);
  const res = await pending;
  const elapsed = Date.now() - started;
  assert.equal(res.aborted, true, "el comando resolvió como detenido por el usuario");
  assert.ok(elapsed < 5000, `el comando se cortó al instante (${elapsed} ms), no a los 30 s ni al timeout`);
});

test("presentación: un comando con la señal ya abortada ni siquiera arranca", async () => {
  const root = tmpProject();
  const ac = new AbortController();
  ac.abort();
  const started = Date.now();
  const res = await tools.runCommand(root, "node -e \"setTimeout(()=>{},30000)\"", { signal: ac.signal, timeoutMs: 60000 });
  assert.equal(res.aborted, true);
  assert.ok(Date.now() - started < 2000, "resolvió de inmediato, sin ejecutar el proceso");
});
