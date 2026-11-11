"use strict";

// [EDITCORE-INTEGRAL-B4] HERRAMIENTAS QUE ENTREGAN LA EVIDENCIA
// COMPLETA (Bloque 4 de la corrección integral v4.9.0):
//  - Política de truncamiento POR HERRAMIENTA: cabeza+cola con elipsis
//    declarada y campos críticos primero; nada de corte único de 2.000
//    por la cabeza que eliminaba stderr, las colas con el error final,
//    la cola de read_skill y los diagnostics de la captura.
//  - run_command sobre el runner ÚNICO (process-runner): conserva la
//    cola y lee/actúa el onSevereError que execute() ya pasaba.
//  - search_files: literal Y regex declarados, búsqueda por nombre/ruta
//    (assets), línea+fragmento, total y truncated.
//  - rollback_last_change REAL sobre snapshot.js, por archivo, como
//    escritura ante la compuerta.
//  - start_preview: envuelve helpers.startPreview; sin helper, honesto.
// Patrón de publicacion-verificada: costuras/fakes inyectados, sin red
// ni CLI reales (los comandos que corren son `node -e` locales, como en
// desbloqueos-v481). Nada de aserciones sobre texto fuente.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b4-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

// Fake de visión ANTES de cargar tools/orchestrator (ambos
// desestructuran capture_preview_screenshot al cargarse): registra la
// URL capturada para probar que, tras start_preview, el turno captura
// sobre la URL que el preview devolvió.
const vision = require("../editcore-chat-kernel/vision-inspector");
const capturedUrls = [];
vision.capture_preview_screenshot = async (opts = {}) => {
  capturedUrls.push(String(opts.url || ""));
  return {
    ok: true,
    renderOk: true,
    url: opts.url || "",
    screenshotPath: ".editcore/vision/fake-b4.png",
    diagnostics: { consoleErrors: [], issues: [], renderOk: true },
  };
};

const tools = require("../editcore-chat-kernel/tools");
const { ChatOrchestrator } = require("../editcore-chat-kernel/orchestrator");
const { parseTextToolCalls } = require("../editcore-chat-kernel/parse-text-tools");
const { READ_ONLY_TOOLS, WRITE_TOOLS } = require("../editcore-chat-kernel/classify");
const { deployOneClick } = require("../runtime/deploy-one-click");

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ec-b4-proj-"));
}

function toolCall(name, args) {
  return { id: `call_${name}_${Math.random().toString(36).slice(2, 7)}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

// ---------- (1) run_command: la evidencia del FINAL llega al modelo ----------

const LONG_FAIL_CMD = "node -e \"console.log('HEAD-LINE-B4'); console.log('x'.repeat(20000)); console.error('STDERR-CAUSE-B4'); console.log('TAIL-ERROR-FINAL-B4'); process.exit(2)\"";

test("B4-1 run_command por el bucle: el payload al modelo trae la COLA con el error final Y el stderr, con elipsis declarada", async () => {
  const root = tmpProject();
  const seen = [];
  const script = [
    { text: "", toolCalls: [toolCall("run_command", { command: LONG_FAIL_CMD })], usage: {} },
    { text: "Mi propuesta concreta es corregir el error final que muestra el comando en el archivo implicado. ¿Sigo con eso?", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "ejecuta el comando de diagnóstico del proyecto y dime el resultado",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 5, fullAccess: true, permissionMode: "full",
    helpers: {
      callChat: async (args) => {
        seen.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
        return script.shift() || { text: "Mi propuesta concreta es seguir desde ese error. ¿Sigo con eso?", toolCalls: [], usage: {} };
      },
    },
  });

  assert.ok(seen.length >= 2, "hubo una segunda llamada al modelo tras el comando");
  const payload = seen[1];
  assert.ok(payload.includes("TAIL-ERROR-FINAL-B4"), "la COLA del output (el error final) llegó al modelo");
  assert.ok(payload.includes("STDERR-CAUSE-B4"), "el stderr llegó al modelo (antes output se comía el cupo y stderr nunca llegaba)");
  assert.match(payload, /\[… \d+ caracteres omitidos …\]/, "el recorte, cuando ocurre, se declara con elipsis y conteo");
});

test("B4-1b run_command directo: el runner conserva la cola y el error severo se registra y se notifica", async () => {
  const root = tmpProject();
  const severeSeen = [];
  const result = await tools.execute("run_command", {
    command: "node -e \"console.log('y'.repeat(15000)); console.error('Module not found: paquete-fantasma-b4'); process.exit(1)\"",
  }, root, true, { onProcessSevereError: (issue) => severeSeen.push(issue) });

  assert.equal(result.ok, false);
  assert.ok(String(result.output || "").includes("y".repeat(100)), "output presente");
  assert.equal(String(result.output || "").length, 12000, "el runner conserva la COLA acotada (12000), no la cabeza de un buffer mayor");
  assert.ok(String(result.stderr || "").includes("Module not found"), "stderr íntegro en el resultado");
  assert.ok(severeSeen.length >= 1, "onSevereError que execute() pasa SÍ se invoca ahora");
  assert.ok(result.severeError, "el error severo queda REGISTRADO en el resultado");
  assert.match(String(result.severeError.summary || ""), /Module not found/);
});

test("B4-1c el fallo de deploy de publicacion-verificada SOBREVIVE íntegro a la política de truncamiento", async () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, ".vercel"), { recursive: true });
  fs.writeFileSync(path.join(root, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_test", orgId: "team_test", projectName: "demo-app" }));
  fs.writeFileSync(path.join(root, "vercel.json"), "{}\n");
  const result = await deployOneClick(root, { provider: "vercel", production: true }, {
    connections: { vercelToken: "tok-test" },
    deps: {
      runProcessImpl: async () => ({ code: 0, stdout: "Production: https://demo-app.vercel.app\n", stderr: "" }),
      sleepImpl: async () => {},
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.startsWith("https://demo-app.vercel.app")) return { status: 500 };
        if (u.includes("api.vercel.com/v6/deployments")) return { ok: true, status: 200, json: async () => ({ deployments: [{ uid: "dpl_123" }] }) };
        if (u.includes("/v2/deployments/dpl_123/events")) {
          return { ok: true, status: 200, json: async () => ([{ payload: { text: "Traceback (most recent call last):" } }, { payload: { text: "sqlite3.OperationalError: no such table: products" } }]) };
        }
        throw new Error(`fetch inesperado: ${u}`);
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.productionDown, true);

  const payload = tools.truncatePayload(result, undefined, "publish_project");
  assert.ok(payload.length <= tools.TOOL_PAYLOAD_CAPS.publish_project, "el payload respeta el tope propio de publish_project");
  assert.ok(payload.includes("PRODUCCIÓN ESTÁ CAÍDA"), "el veredicto del fallo llega íntegro");
  assert.ok(payload.includes("no such table: products"), "firstLogError y los logs llegan íntegros");
  assert.ok(payload.includes('"status":500') || payload.includes('"status": 500'), "la evidencia del humo llega íntegra");
  // El orden deliberado del objeto NO se reordena: el veredicto va antes que los logs.
  assert.ok(payload.indexOf("publishFailed") < payload.indexOf("no such table"), "el orden de claves deliberado del fallo se conserva");
});

test("B4-1d capture_preview_screenshot: diagnostics y veredicto van PRIMERO en el payload", () => {
  const result = {
    ok: true,
    engine: "electron",
    url: "http://127.0.0.1:4568/",
    viewport: "desktop",
    screenshotPath: ".editcore/vision/preview.png",
    screenshotBytes: 12345,
    relleno: "z".repeat(15000),
    diagnostics: { issues: ["Overflow horizontal detectado"], renderOk: false, consoleErrors: [{ type: "error", text: "DIAGNOSTICS-MARKER-B4" }] },
    renderOk: false,
    multimodalHint: "Posibles problemas de maquetación",
  };
  const payload = tools.truncatePayload(result, undefined, "capture_preview_screenshot");
  assert.ok(payload.indexOf("DIAGNOSTICS-MARKER-B4") >= 0, "los diagnostics llegan al payload");
  assert.ok(payload.indexOf("DIAGNOSTICS-MARKER-B4") < 600, "los diagnostics van al PRINCIPIO del payload, no al final del objeto");
  assert.match(payload, /\[… \d+ caracteres omitidos …\]/, "el relleno se recorta con elipsis declarada");
});

test("B4-1e delegate_parallel: cada informe conserva su contenido sin aplastar el conjunto a 2.000", () => {
  const result = {
    ok: true,
    delegated: 4,
    completed: 4,
    notes: [],
    results: [1, 2, 3, 4].map((i) => ({ role: "explorer", target: `zona${i}`, ok: true, text: `${"informe detallado ".repeat(160)}FIN-INFORME-${i}` })),
    text: "Delegación en paralelo: 4/4 subagentes entregaron informe.\n\n" + "relleno ".repeat(3000),
  };
  const payload = tools.truncatePayload(result, undefined, "delegate_parallel");
  for (const i of [1, 2, 3, 4]) {
    assert.ok(payload.includes(`FIN-INFORME-${i}`), `el informe ${i} llega completo al payload`);
  }
  assert.ok(payload.length > 2000, "el conjunto ya no se aplasta al tope único de 2.000");
});

// ---------- (2) search_files ----------

function searchFixture() {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "public", "assets"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  // Asset binario: su contenido NO es texto buscable; solo su nombre.
  fs.writeFileSync(path.join(root, "public", "assets", "hero-taller.jpg"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]));
  fs.writeFileSync(path.join(root, "index.html"), "<!DOCTYPE html>\n<html>\n<body>\n<img src=\"public/assets/hero-taller.jpg\" alt=\"Hero\">\n</body>\n</html>\n");
  fs.writeFileSync(path.join(root, "src", "app.ts"), "export const heroImage = \"hero-taller.jpg\";\nexport const version = \"v2\";\n");
  // Archivo-blob: una sola línea con \n LITERALES (backslash + n).
  fs.writeFileSync(path.join(root, "src", "blob.js"), String.raw`const a = 1;\nconst b = 2;\nmodule.exports = { a, b };`);
  fs.writeFileSync(path.join(root, ".env.local"), "API_KEY=secreto\n");
  return root;
}

test("B4-2a search_files encuentra un asset por su NOMBRE de archivo (aunque sea binario)", () => {
  const root = searchFixture();
  const out = tools.searchFiles(root, "hero-taller.jpg");
  assert.equal(out.ok, true);
  const byName = (out.results || []).find((r) => r.path === "public/assets/hero-taller.jpg");
  assert.ok(byName, "el asset aparece en los resultados");
  assert.equal(byName.match, "name", "el hit del asset es por nombre/ruta, no por contenido");
});

test("B4-2b search_files encuentra el literal \\n de un archivo-blob por la VÍA TEXTO", async () => {
  const root = searchFixture();
  // La vía texto con la query DOBLE-escapada (\\n en el texto crudo):
  // parse-text-tools le aplica a query el mismo unescapeTextBlob que a
  // los contenidos y la query resultante trae el \n literal buscado.
  const rawText = String.raw`<tool_call><function=search_files><parameter=query>const a = 1;\\nconst b = 2;\\nmodule</parameter></function></tool_call>`;
  const calls = parseTextToolCalls(rawText, { projectRoot: root });
  assert.equal(calls.length, 1, "la llamada por texto se parseó");
  const args = JSON.parse(calls[0].function.arguments);
  assert.ok(String(args.query).includes(String.raw`\n`), "la query parseada contiene la secuencia literal \\n (no un salto real)");
  assert.ok(!String(args.query).includes("\n"), "la query parseada NO contiene saltos reales");

  const out = await tools.execute("search_files", args, root, false, {});
  assert.equal(out.ok, true);
  assert.ok((out.hits || []).includes("src/blob.js"), "el archivo-blob se encuentra por su \\n literal");
});

test("B4-2c search_files modo regex declarado encuentra por patrón; literal no lo interpreta", () => {
  const root = searchFixture();
  const literal = tools.searchFiles(root, "hero-[a-z]+", 30, { mode: "literal" });
  assert.equal(literal.mode, "literal");
  assert.ok(!(literal.hits || []).includes("public/assets/hero-taller.jpg"), "en literal, el patrón NO casa el nombre del asset");

  const regex = tools.searchFiles(root, "hero-[a-z]+", 30, { mode: "regex" });
  assert.equal(regex.mode, "regex");
  const byName = (regex.results || []).find((r) => r.path === "public/assets/hero-taller.jpg");
  assert.ok(byName, "en regex, el patrón SÍ encuentra el asset por nombre");

  const bad = tools.searchFiles(root, "hero-([a-z]+", 30, { mode: "regex" });
  assert.equal(bad.ok, false, "un regex inválido devuelve ok:false declarado, no 0 hits mudos");
});

test("B4-2d search_files: resultados con línea y fragmento, total y truncated:true al superar maxHits", () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    fs.writeFileSync(path.join(root, "src", `mod${i}.js`), `// módulo ${i}\nconst marcaB4 = ${i};\n`);
  }
  const out = tools.searchFiles(root, "marcaB4", 2);
  assert.equal(out.ok, true);
  assert.equal(out.total, 5, "el total cuenta TODOS los archivos que casan");
  assert.equal(out.truncated, true, "superado maxHits, truncated:true lo declara");
  assert.equal(out.results.length, 2, "los resultados devueltos respetan maxHits");
  assert.equal(out.results[0].line, 2, "cada resultado trae su línea");
  assert.ok(String(out.results[0].snippet).includes("marcaB4"), "cada resultado trae el fragmento de la línea");
  // Extensiones ampliadas: html y env encuentran por contenido/nombre.
  const fix = searchFixture();
  const htmlHit = tools.searchFiles(fix, "Hero");
  assert.ok((htmlHit.results || []).some((r) => r.path === "index.html" && r.match === "content"), "el .html se busca por contenido");
  const envHit = tools.searchFiles(fix, ".env.local");
  assert.ok((envHit.hits || []).includes(".env.local"), "el .env.local se encuentra por nombre");
});

// ---------- (3) rollback_last_change real ----------

test("B4-3 rollback_last_change restaura el contenido previo de ESE archivo y no toca otro modificado después", async () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, "a.txt"), "version-1\n");
  fs.writeFileSync(path.join(root, "b.txt"), "b-original\n");

  await tools.execute("write_file", { path: "a.txt", content: "version-2\n" }, root, true, {});
  await tools.execute("write_file", { path: "b.txt", content: "b-modificado\n" }, root, true, {});
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "version-2\n");
  assert.equal(fs.readFileSync(path.join(root, "b.txt"), "utf8"), "b-modificado\n");

  const rb = await tools.execute("rollback_last_change", { path: "a.txt" }, root, true, {});
  assert.equal(rb.ok, true, "rollback_last_change ya no es «Herramienta desconocida»");
  assert.ok(rb.snapshotId, "el resultado trae el snapshot restaurado");
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "version-1\n", "a.txt volvió a su contenido previo");
  assert.equal(fs.readFileSync(path.join(root, "b.txt"), "utf8"), "b-modificado\n", "b.txt (modificado DESPUÉS) no se tocó");
});

test("B4-3b rollback_last_change es ESCRITURA: la compuerta lo bloquea en solo lectura y está ofrecido en modo agente", async () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, "a.txt"), "version-1\n");
  await tools.execute("write_file", { path: "a.txt", content: "version-2\n" }, root, true, {});

  assert.ok(WRITE_TOOLS.includes("rollback_last_change"), "clasificado como escritura en classify.js");
  const denied = await tools.execute("rollback_last_change", { path: "a.txt" }, root, false, {});
  assert.equal(denied.ok, false, "en solo lectura, la segunda capa de tools.execute lo bloquea como escritura");
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "version-2\n", "bloqueado: el archivo no cambió");

  // Ofrecido en modo agente: el modelo lo VE en las definiciones…
  const defs = tools.getToolDefinitions({ allowWrite: true, isFullAccess: true }).map((t) => t.function?.name);
  assert.ok(defs.includes("rollback_last_change"), "rollback_last_change tiene definición real");

  // …y un turno completo lo ejecuta y la reversión queda en los hechos.
  const script = [
    { text: "", toolCalls: [toolCall("rollback_last_change", { path: "a.txt" })], usage: {} },
    { text: "Listo: revertí la última escritura de a.txt desde su snapshot, como pediste en este turno.", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "deshaz el último cambio de a.txt",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 5, fullAccess: true, permissionMode: "full",
    helpers: { callChat: async () => script.shift() || { text: "Listo.", toolCalls: [], usage: {} } },
  });
  const step = (out.steps || []).find((s) => s.name === "rollback_last_change");
  assert.ok(step, "el paso de rollback quedó registrado (no fue filtrado por el orquestador)");
  assert.equal(step.ok, true, "el rollback se ejecutó en el turno");
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "version-1\n", "el turno revirtió el archivo de verdad");
});

// ---------- (4) start_preview ----------

test("B4-4a start_preview con helper falso devuelve la URL y el turno puede capturar sobre ella", async () => {
  const root = tmpProject();
  fs.writeFileSync(path.join(root, "index.html"), "<!DOCTYPE html><html><body><h1>Landing</h1></body></html>\n");
  capturedUrls.length = 0;
  const PREVIEW_URL = "http://127.0.0.1:5199/";
  const seenTools = [];
  const script = [
    { text: "", toolCalls: [toolCall("start_preview", {})], usage: {} },
    { text: "", toolCalls: [toolCall("capture_preview_screenshot", { url: PREVIEW_URL })], usage: {} },
    { text: "Ya miré la captura del preview de la landing: el hero se ve correcto y corresponde a lo construido en este turno.", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  const out = await orch.runModelTask({
    decision: { kind: "EXECUTE", allowTools: true, allowWrite: true },
    message: "verifica en el preview cómo quedó la landing",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: true, maxSteps: 6, fullAccess: true, permissionMode: "full",
    helpers: {
      startPreview: async () => ({ available: true, started: true, url: PREVIEW_URL }),
      callChat: async (args) => {
        seenTools.push((args.tools || []).map((t) => t.function?.name || t.name).filter(Boolean));
        return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
      },
    },
  });

  assert.ok(seenTools[0].includes("start_preview"), "start_preview se OFRECE en modo agente");
  const startStep = (out.steps || []).find((s) => s.name === "start_preview");
  assert.ok(startStep, "el paso start_preview quedó registrado");
  assert.equal(startStep.result?.ok, true);
  assert.equal(startStep.result?.url, PREVIEW_URL, "start_preview devolvió la URL real del helper");
  assert.deepEqual(capturedUrls, [PREVIEW_URL], "después de arrancar, el turno capturó sobre ESA URL");
});

test("B4-4b start_preview sin helper: respuesta honesta de no disponible (nada de éxito falso) y clasificación de lectura", async () => {
  const root = tmpProject();
  const out = await tools.execute("start_preview", {}, root, true, {});
  assert.equal(out.ok, false, "sin helper no hay éxito falso");
  assert.equal(out.previewUnavailable, true);
  assert.match(String(out.error || ""), /no está disponible en esta ruta/);
  assert.ok(READ_ONLY_TOOLS.includes("start_preview"), "start_preview clasificada como LECTURA (arrancar el preview del propio proyecto no muta archivos)");
  assert.ok(!WRITE_TOOLS.includes("start_preview"), "start_preview NO está en WRITE_TOOLS");

  // Con una URL ya activa en el contexto, la respuesta honesta es esa URL real.
  const active = await tools.execute("start_preview", {}, root, true, { previewUrl: "http://127.0.0.1:4568/" });
  assert.equal(active.ok, true);
  assert.equal(active.alreadyRunning, true);
  assert.equal(active.url, "http://127.0.0.1:4568/");
});

// ---------- (5) read_skill por el bucle conserva su cola ----------

test("B4-5 read_skill por el bucle: el payload al modelo conserva la COLA de la skill (no se aplasta a 2.000 por la cabeza)", async () => {
  const root = tmpProject();
  const skillContent = `INICIO-SKILL-B4\n${"cuerpo de la skill. ".repeat(1200)}\nCOLA-SKILL-B4-FINAL`;
  const seen = [];
  const script = [
    { text: "", toolCalls: [toolCall("read_skill", { name: "skill-b4" })], usage: {} },
    { text: "Consulté la skill completa, incluida su parte final, y mi propuesta concreta es aplicar su cierre tal como indica. ¿Sigo con eso?", toolCalls: [], usage: {} },
  ];
  const orch = new ChatOrchestrator();
  await orch.runModelTask({
    decision: { kind: "ASK", allowTools: true, allowWrite: false },
    message: "consulta la skill skill-b4 y dime cómo cierra",
    projectRoot: root, apiBaseUrl: "http://127.0.0.1:9/v1", apiKey: "k", model: "m",
    allowWrite: false, maxSteps: 5, fullAccess: false, permissionMode: "step",
    helpers: {
      brainReadSkill: async () => ({ name: "skill-b4", source: "test-b4", content: skillContent }),
      callChat: async (args) => {
        seen.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
        return script.shift() || { text: "Listo.", toolCalls: [], usage: {} };
      },
    },
  });

  assert.ok(seen.length >= 2, "hubo segunda llamada tras read_skill");
  const payload = seen[1];
  assert.ok(payload.includes("INICIO-SKILL-B4"), "el inicio de la skill llega");
  assert.ok(payload.includes("COLA-SKILL-B4-FINAL"), "la COLA de la skill llega: su presupuesto propio (~30.000) se respeta en el bucle");
});
