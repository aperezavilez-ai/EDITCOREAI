"use strict";
// ============================================================
// CONSTRUCCIÓN — el agente crea el proyecto con herramientas:
// nada de código pegado en el chat, nada de turnos mudos, nada
// de burbujas que el usuario no escribió.
// Caso real (2026-11-17, «sistemas contino»): el modelo pegaba
// sus llamadas y contenidos como texto, el turno cerraba con
// 0 acciones y el chat quedaba lleno de código crudo; y un «??»
// del usuario se convertía, sin que él lo escribiera, en una
// orden de reanudar la tarea guardada.
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { ejecutarTurno } = require("../editcore-chat-kernel/nuevo/turno");
const { componerCierre, esVolcadoDeCodigo } = require("../editcore-chat-kernel/nuevo/cierre");
const { SISTEMA_NUCLEO } = require("../editcore-chat-kernel/nuevo/textos");
const { stripTextToolMarkup } = require("../editcore-chat-kernel/parse-text-tools");

const VOLCADO = [
  "Aquí está el proyecto:",
  "```json",
  "{",
  '  "name": "rental-equipment-saas",',
  '  "version": "1.0.0",',
  '  "private": true,',
  '  "scripts": {',
  '    "dev": "next dev",',
  '    "build": "next build",',
  '    "start": "next start",',
  '    "lint": "next lint",',
  '    "test": "vitest"',
  "  },",
  '  "dependencies": {',
  '    "next": "14.2.0",',
  '    "react": "18.3.1",',
  '    "react-dom": "18.3.1",',
  '    "prisma": "5.0.0",',
  '    "@prisma/client": "5.0.0",',
  '    "typescript": "5.4.0",',
  '    "tailwindcss": "3.4.0",',
  '    "zod": "3.23.0",',
  '    "bcrypt": "5.1.0"',
  "  }",
  "}",
  "```",
].join("\n");

test("detector: un archivo volcado es volcado; un ejemplo corto no", () => {
  assert.equal(esVolcadoDeCodigo(VOLCADO), true);
  assert.equal(esVolcadoDeCodigo("Corre `npm run dev` y listo."), false);
  assert.equal(esVolcadoDeCodigo("Ejemplo:\n```\nuna linea\n```"), false);
  assert.equal(esVolcadoDeCodigo("sin codigo en absoluto"), false);
});

const VOLCADO_COMPACTO = [
  "Aquí está el package.json:",
  "```json",
  "{",
  '  "name": "rental-equipment-saas",',
  '  "version": "1.0.0",',
  '  "private": true,',
  '  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" },',
  '  "dependencies": { "next": "14.2.0", "react": "18.3.1", "prisma": "5.0.0" }',
  "}",
  "```",
].join("\n");

test("detector: un package.json compacto también es volcado; un JSON de ejemplo, no", () => {
  assert.equal(esVolcadoDeCodigo(VOLCADO_COMPACTO), true);
  assert.equal(esVolcadoDeCodigo("La respuesta sería:\n```json\n{\"ok\": true, \"id\": 1}\n```"), false);
});

test("ORDEN: si el modelo vuelca el archivo en el chat, el turno lo corrige y escribe con la herramienta", async () => {
  let llamada = 0;
  const llamarModelo = async () => {
    llamada += 1;
    if (llamada === 1) return { texto: VOLCADO, toolCalls: [], uso: { total: 500 } };
    if (llamada === 2) {
      return {
        texto: "",
        toolCalls: [{ nombre: "write_file", args: { path: "package.json", content: "{}" } }],
        uso: { total: 500 },
      };
    }
    return { texto: "Proyecto creado: package.json en la raíz.", toolCalls: [], uso: { total: 200 } };
  };
  const ejecutarHerramienta = async (nombre) => ({ ok: true, resumen: `${nombre} ok`, archivoAplicado: "package.json", archivoBytes: 120 });
  const r = await ejecutarTurno({
    texto: "procede con todo",
    llamarModelo,
    ejecutarHerramienta,
    herramientasCompletas: ["write_file"],
    historial: [
      { role: "assistant", content: "¿Te parece bien esta propuesta? Si me das tu aprobación (\"procede\") lo construyo." },
    ],
  });
  assert.equal(r.carril, "ORDEN");
  assert.deepEqual(r.hechos.aplicados, ["package.json"]);
  assert.ok(!r.textoFinal.includes("```"), "el texto final no lleva el volcado");
  const cierre = componerCierre({ resultado: r });
  assert.ok(!cierre.voz.includes("```"));
});

test("ORDEN: si el modelo vuelca dos veces, el cierre no publica el código y declara que nada se aplicó", async () => {
  const llamarModelo = async () => ({ texto: VOLCADO, toolCalls: [], uso: { total: 500 } });
  const r = await ejecutarTurno({
    texto: "crea el proyecto",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: ["write_file"],
  });
  const cierre = componerCierre({ resultado: r });
  assert.equal(cierre.corregida, true);
  assert.ok(!cierre.voz.includes("```"), "el código volcado no llega al chat");
  assert.match(cierre.voz, /no se aplicó nada/i);
});

test("turno mudo en CONVERSACION: el cierre pone voz desde los hechos", async () => {
  const llamarModelo = async () => ({ texto: "", toolCalls: [], uso: { total: 100 } });
  const r = await ejecutarTurno({
    texto: "hola, ¿qué puedes hacer?",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true }),
    herramientasCompletas: [],
  });
  const cierre = componerCierre({ resultado: r });
  assert.ok(cierre.voz.trim().length > 0, "la voz nunca queda vacía");
});

test("turno mudo tras aplicar: la voz nombra lo aplicado", async () => {
  let llamada = 0;
  const llamarModelo = async () => {
    llamada += 1;
    if (llamada === 1) {
      return { texto: "", toolCalls: [{ nombre: "write_file", args: { path: "index.html" } }], uso: { total: 300 } };
    }
    return { texto: "", toolCalls: [], uso: { total: 100 } };
  };
  const r = await ejecutarTurno({
    texto: "crea la página principal",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true, resumen: "ok", archivoAplicado: "index.html", archivoBytes: 50 }),
    herramientasCompletas: ["write_file"],
  });
  const cierre = componerCierre({ resultado: r });
  assert.match(cierre.voz, /index\.html/);
});

test("ejemplo corto tras trabajo real: no se corrige ni se mutila", async () => {
  let llamada = 0;
  const llamarModelo = async () => {
    llamada += 1;
    if (llamada === 1) {
      return { texto: "", toolCalls: [{ nombre: "write_file", args: { path: "a.txt" } }], uso: { total: 300 } };
    }
    return { texto: "Hecho. Para correrlo:\n```\nnpm run dev\n```", toolCalls: [], uso: { total: 100 } };
  };
  const r = await ejecutarTurno({
    texto: "crea el archivo a",
    llamarModelo,
    ejecutarHerramienta: async () => ({ ok: true, resumen: "ok", archivoAplicado: "a.txt", archivoBytes: 10 }),
    herramientasCompletas: ["write_file"],
  });
  assert.equal(llamada, 2, "sin llamada correctiva de más");
  const cierre = componerCierre({ resultado: r });
  assert.ok(cierre.voz.includes("npm run dev"), "el ejemplo corto se conserva");
});

test("el limpiador de protocolo NO se come un archivo volcado (eso dejaba el turno mudo y ciego)", () => {
  const limpio = stripTextToolMarkup(VOLCADO);
  assert.ok(limpio.includes("rental-equipment-saas"), "el package.json sobrevive al limpiador: el bucle puede verlo y corregirlo");
  const llamadaCercada = "Voy:\n```json\n{\"name\": \"write_file\", \"arguments\": {\"path\": \"a.txt\"}}\n```";
  assert.ok(!stripTextToolMarkup(llamadaCercada).includes("write_file"), "una llamada cercada sí se retira");
  const llamadaTool = "Voy:\n```json\n{\"tool\": \"bash\", \"args\": {\"command\": \"ls\"}}\n```";
  assert.ok(!stripTextToolMarkup(llamadaTool).includes("bash"), "la llamada con clave tool también se retira");
});

test("las reglas del núcleo ordenan crear con herramientas y en la raíz", () => {
  assert.match(SISTEMA_NUCLEO, /nunca pego el contenido de un archivo en el chat/i);
  assert.match(SISTEMA_NUCLEO, /raíz del proyecto abierto/i);
});

test("rutas: en un proyecto nuevo, src/app.js se crea EN src/ (la política no aplana la estructura)", async () => {
  const os = require("node:os");
  const policy = require("../project-path-policy");
  const tools = require("../editcore-chat-kernel/tools");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rutas-"));
  try {
    assert.ok(policy.resolveInside(tmp, "src/app.js").endsWith(path.join("src", "app.js")));
    assert.equal(policy.resolveAccessibleTarget(tmp, "src/app.js", { fullAccess: true }).relative, "src/app.js");
    const r = await tools.execute("write_file", { path: "src/app.js", content: "x\n" }, tmp, true, {});
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(tmp, "src", "app.js")), "el archivo quedó en src/");
    assert.equal(fs.existsSync(path.join(tmp, "app.js")), false, "nada aplanado en la raíz");
    // El rescate legítimo se conserva: proyecto plano con app.js en
    // la raíz — pedir src/app.js sigue resolviendo a ese archivo.
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-rutas-plano-"));
    try {
      fs.writeFileSync(path.join(tmp2, "app.js"), "viejo\n");
      assert.ok(policy.resolveInside(tmp2, "src/app.js").endsWith("app.js"));
      assert.ok(!policy.resolveInside(tmp2, "src/app.js").includes(path.join("src", "app.js")));
    } finally { fs.rmSync(tmp2, { recursive: true, force: true }); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("renderer: un envío de pura puntuación ya no se sustituye por una orden de reanudar", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "renderer.js"), "utf8");
  assert.ok(
    !src.includes('effectivePrompt = "Continua la tarea activa'),
    "la sustitución de la burbuja fue retirada",
  );
});
