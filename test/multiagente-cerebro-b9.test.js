"use strict";

// [EDITCORE-INTEGRAL-B9] MULTIAGENTE Y CEREBRO: REALES O FUERA
// (Bloque 9 de la corrección integral v4.9.0). Decisiones:
//  (a) «Fase 8» RETIRADA del camino vivo: handle() ya no crea un
//      ParallelBatch por turno, no sobrescribe LATEST.json y no
//      inyecta el prompt del job 1 (completeJob/failJob/fanIn
//      tenían 0 llamadores: era 1 job fantasma por turno).
//  (d) agent-bus: se DEJA DE ESCRIBIR por turno (tablero de solo
//      escritura: promptBlock/readMessages con 0 llamadores;
//      leerlo costaría ~2.200 caracteres del presupuesto del
//      Bloque 2 duplicando el expediente del Bloque 3).
// Locks con ciclo de vida real: liberación por escritura,
// renovación sin temporizadores, UNA identidad por corrida y
// locks en scaffold/fotos. Cerebro único: .editcore/rag entra en
// el índice que la consulta automática lee, con huellas para no
// re-upsertar todo por búsqueda.
// Patrón publicacion-verificada: comportamiento con fakes/costuras
// inyectadas y directorios temporales reales, sin red.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b9-"));
process.env.EDITCORE_USER_DATA_PATH = path.join(tmpBase, "userdata");
fs.mkdirSync(process.env.EDITCORE_USER_DATA_PATH, { recursive: true });

const root = path.join(__dirname, "..");
const { ChatOrchestrator, buildCerebroServiceBlock } = require(path.join(root, "editcore-chat-kernel", "orchestrator.js"));
const tools = require(path.join(root, "editcore-chat-kernel", "tools.js"));
const { fetchStockPhoto } = require(path.join(root, "editcore-chat-kernel", "stock-photos.js"));
const { getCoordination, AgentCoordination } = require(path.join(root, "runtime", "agent-coordination.js"));
const { saveToBrain } = require(path.join(root, "editcore-chat-kernel", "brain-ingest.js"));
const { EditCoreBrainService } = require(path.join(root, "brain-service.js"));
const { shouldUseParallel } = require(path.join(root, "runtime", "agent-parallel.js"));

function tmpProject(prefix = "ec-b9-proj-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------
// (1) Fase 8 retirada + bus sin escribir: turno completo por handle()
// ------------------------------------------------------------------
test("B9-1 turno completo: NO se crea batch de Fase 8, NO se inyecta job y NO se escribe el bus", async () => {
  const project = tmpProject();
  const message = "crea una app completa desde cero, con landing, dashboard y api, y además verifica todo el resultado";
  assert.equal(shouldUseParallel(message), true, "la premisa: este mensaje SÍ habría disparado Fase 8 antes de B9");

  const captured = [];
  const orch = new ChatOrchestrator();
  await orch.handle({
    message,
    projectRoot: project, apiKey: "sk-test", apiBaseUrl: "https://example.invalid", model: "test-model",
    permissionMode: "full", allowWrite: true, fullAccess: true,
    helpers: {
      callChat: async (args) => {
        captured.push((args.messages || []).map((m) => String(m.content || "")).join("\n"));
        return { text: "Listo: propongo sentar la base y verificarla en el preview. ¿Sigo con eso?", toolCalls: [], usage: {} };
      },
    },
    history: [],
  });

  assert.ok(captured.length >= 1, "el modelo fue llamado (turno real por handle)");
  const context = captured.join("\n");
  assert.ok(!context.includes("PARALLEL FAN-OUT"), "ningún prompt de fan-out de Fase 8 entra al contexto");
  assert.ok(!context.includes("JOB ACTIVO"), "ningún prompt de job fantasma entra al contexto");
  const parallelDir = path.join(project, ".editcore", "parallel");
  assert.ok(!fs.existsSync(path.join(parallelDir, "LATEST.json")), "LATEST.json no se crea ni se sobrescribe por turno");
  const busFiles = fs.existsSync(path.join(project, ".editcore", "chat-memory"))
    ? fs.readdirSync(path.join(project, ".editcore", "chat-memory")).filter((f) => f.startsWith("bus-"))
    : [];
  assert.deepEqual(busFiles, [], "el turno no deja ningún bus-*.json nuevo (agent-bus apagado en el camino vivo)");
});

// ------------------------------------------------------------------
// (2) Locks: liberación por escritura, renovación, identidad única
// ------------------------------------------------------------------
test("B9-2a tras una write_file, OTRO thread adquiere el lock del mismo archivo de inmediato", () => {
  const project = tmpProject();
  const w = tools.writeFile(project, "nota.txt", "contenido\n", { threadId: "chat-1", agentRole: "supervisor" });
  assert.equal(w.ok, true);
  // Sin esperar al cierre del turno: el lock ya no está retenido.
  const coord = getCoordination(project);
  const other = coord.acquireLock("chat-2", "supervisor", "nota.txt", "write_file");
  assert.equal(other.ok, true, "el lock se liberó al terminar la escritura, no al cerrar el turno");
  coord.releaseLock("chat-2", "supervisor", "nota.txt");
  // Y una replace de otro chat también pasa ya.
  const r = tools.replaceInFile(project, "nota.txt", "contenido", "de otro chat", { threadId: "chat-2", agentRole: "supervisor" });
  assert.equal(r.ok, true);
});

test("B9-2b con TTL corto, la renovación por la costura mantiene el lock del dueño pasado el TTL nominal", async () => {
  const project = tmpProject();
  // Instancia propia con TTL inyectado de 300 ms (sin singleton).
  // [EDITCORE-INTEGRAL-B9] Escala ×5 respecto a la versión original
  // (60/40/40/80): con márgenes de 20 ms, un sleep(40) bajo la contención
  // de la suite completa en Windows resolvía tarde y el lock expiraba
  // ANTES de renovar (falso fallo con la suite en carga; aislada pasaba).
  // Márgenes actuales: 100 ms en cada borde.
  const coord = new AgentCoordination(project, { lockTtlMs: 300 });
  const first = coord.acquireLock("run-1", "supervisor", "vivo.txt", "write_file");
  assert.equal(first.ok, true);
  await sleep(200);
  // La costura de renovación elegida (sin setInterval): latido
  // explícito de la corrida, el mismo que tools.execute invoca en
  // cada despacho y que acquireLock aplica a los locks propios.
  const renewed = coord.renewThreadLocks("run-1");
  assert.equal(renewed.renewed, 1);
  await sleep(200); // 400 ms desde la adquisición: el TTL nominal (300) ya pasó
  const intruder = coord.acquireLock("run-2", "supervisor", "vivo.txt", "write_file");
  assert.equal(intruder.ok, false, "pasado el TTL nominal, el lock SIGUE siendo del dueño que trabaja");
  const own = coord.acquireLock("run-1", "implementer", "vivo.txt", "replace_in_file");
  assert.equal(own.ok, true, "el dueño lo refresca con cualquier rol de su corrida");
  coord.releaseAllForThread("run-1");
  // Sin renovación, el lock SÍ expira (la purga sigue viva).
  const again = coord.acquireLock("run-1", "supervisor", "vivo.txt", "write_file");
  assert.equal(again.ok, true);
  await sleep(400);
  const afterExpiry = coord.acquireLock("run-2", "supervisor", "vivo.txt", "write_file");
  assert.equal(afterExpiry.ok, true, "una corrida que dejó de trabajar pierde el lock al vencer");
});

test("B9-2c escritura por ruta implementer y luego por ruta supervisor en la MISMA corrida no se autobloquea", () => {
  const project = tmpProject();
  fs.writeFileSync(path.join(project, "hero.txt"), "antes\n");
  const coord = getCoordination(project);
  // La ruta implementer retiene el lock a mitad de su operación…
  const held = coord.acquireLock("run-7", "implementer", "hero.txt", "replace_in_file");
  assert.equal(held.ok, true);
  // …y la ruta supervisor de la MISMA corrida escribe sin autobloqueo.
  const w = tools.replaceInFile(project, "hero.txt", "antes", "después", { threadId: "run-7", agentRole: "supervisor" });
  assert.equal(w.ok, true, "misma corrida, distinto rol: no hay autobloqueo");
  assert.equal(fs.readFileSync(path.join(project, "hero.txt"), "utf8"), "después\n");
  // Pero OTRA corrida sí queda fuera mientras tanto (invariante).
  const held2 = coord.acquireLock("run-7", "supervisor", "hero.txt", "write_file");
  assert.equal(held2.ok, true);
  const blocked = tools.writeFile(project, "hero.txt", "pisado\n", { threadId: "run-8", agentRole: "supervisor" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.locked, true);
  coord.releaseAllForThread("run-7");
});

// ------------------------------------------------------------------
// (3) Scaffold / foto con el destino bloqueado por otro thread
// ------------------------------------------------------------------
test("B9-3a scaffold_project con package.json bloqueado por otro thread ⇒ falla explicando el lock y no escribe", async () => {
  const project = tmpProject();
  const coord = getCoordination(project);
  const held = coord.acquireLock("otro-chat", "supervisor", "package.json", "write_file");
  assert.equal(held.ok, true);
  const res = await tools.execute("scaffold_project", { prompt: "landing de prueba", name: "Demo" }, project, true, { threadId: "chat-1", agentRole: "supervisor" });
  assert.equal(res.ok, false, "scaffold no escribe sobre un destino bloqueado");
  assert.equal(res.locked, true);
  assert.match(String(res.error || ""), /bloqueado/i, "el error explica el lock");
  assert.ok(!fs.existsSync(path.join(project, "package.json")), "no se escribió package.json");
  assert.ok(!fs.existsSync(path.join(project, "src", "App.tsx")), "no se escribió nada a medias");
  coord.releaseLock("otro-chat", "supervisor", "package.json");
  const ok = await tools.execute("scaffold_project", { prompt: "landing de prueba", name: "Demo" }, project, true, { threadId: "chat-1", agentRole: "supervisor" });
  assert.equal(ok.ok, true, "liberado el lock, scaffold sienta la base");
  assert.ok(fs.existsSync(path.join(project, "src", "App.tsx")));
  // Y scaffold liberó sus locks al terminar.
  const after = coord.acquireLock("otro-chat", "supervisor", "package.json", "write_file");
  assert.equal(after.ok, true, "los locks del scaffold se liberan al terminar");
  coord.releaseLock("otro-chat", "supervisor", "package.json");
});

test("B9-3b fetch_stock_photo con el archivo destino bloqueado por otro thread ⇒ no escribe y explica el lock", async () => {
  const project = tmpProject();
  const coord = new AgentCoordination(project);
  const held = coord.acquireLock("otro-chat", "supervisor", "assets/hero.jpg", "write_file");
  assert.equal(held.ok, true);
  // Costura idéntica a la que tools.execute inyecta en producción.
  const acquireLock = (relPath) => {
    const r = coord.acquireLock("chat-1", "supervisor", relPath, "fetch_stock_photo");
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, release: () => coord.releaseLock("chat-1", "supervisor", relPath) };
  };
  const fetcher = async (url) => {
    if (String(url).includes("openverse")) {
      return { ok: true, status: 200, json: async () => ({ results: [{ url: "https://img.test/hero.jpg", title: "Hero", creator: "Test", license: "CC0", foreign_landing_url: "" }] }) };
    }
    return {
      ok: true, status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array(20_000).buffer,
    };
  };
  const blocked = await fetchStockPhoto({ query: "hero", name: "hero", projectRoot: project, fetcher, acquireLock });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.locked, true);
  assert.match(String(blocked.error || ""), /bloquead/i);
  assert.ok(!fs.existsSync(path.join(project, "assets", "hero.jpg")), "la foto no aterrizó en un archivo bloqueado");
  coord.releaseLock("otro-chat", "supervisor", "assets/hero.jpg");
  const ok = await fetchStockPhoto({ query: "hero", name: "hero", projectRoot: project, fetcher, acquireLock });
  assert.equal(ok.ok, true, "liberado el lock, la foto se descarga y escribe");
  assert.ok(fs.existsSync(path.join(project, "assets", "hero.jpg")));
});

// ------------------------------------------------------------------
// (4) Cerebro único e incremental
// ------------------------------------------------------------------
test("B9-4a documento ingerido en .editcore/rag aparece en la consulta AUTOMÁTICA del turno sin que el modelo llame a search_brain", async () => {
  const project = tmpProject();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b9-ud-"));
  const saved = saveToBrain(project, "Politica de precios del taller", "La política de precios del taller es clara: la revisión general cuesta 450 pesos (marcador B9PRECIOS450) y el diagnóstico es gratuito.", { source: "prueba-b9", tags: ["precios"] });
  assert.equal(saved.ok, true);
  const service = new EditCoreBrainService({ userDataPath: userData });
  try {
    const block = await buildCerebroServiceBlock(project, "¿cuál es la política de precios del taller?", {
      brainSearch: (r, q, o) => service.searchForAgent(r, q, o),
    });
    assert.ok(block.includes("B9PRECIOS450"), "la consulta automática del turno trae el dato ingerido en .editcore/rag");
    assert.ok(block.length <= 3200, "el bloque del Cerebro conserva su tope duro de 3.200 caracteres");
  } finally {
    try { service.memoryStore.close(); } catch { /* ignore */ }
  }
});

test("B9-4b dos búsquedas seguidas sin cambios ⇒ la segunda no re-upserta registros ni reindexa (huellas)", async () => {
  const project = tmpProject();
  fs.mkdirSync(path.join(project, ".editcore"), { recursive: true });
  fs.writeFileSync(path.join(project, ".editcore", "memory.md"), "# Memoria\nEl dato de memoria B9 es MEMORIA-B9-UNICA y no cambia entre búsquedas.\n");
  fs.writeFileSync(path.join(project, "index.js"), "const datoB9 = 'codigo-b9';\n");
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-b9-ud2-"));
  const service = new EditCoreBrainService({ userDataPath: userData });
  try {
    let upserts = 0;
    const original = service.memoryStore.upsertMemory.bind(service.memoryStore);
    service.memoryStore.upsertMemory = (...args) => { upserts += 1; return original(...args); };

    await service.searchMemory(project, "dato de memoria B9", 5);
    const firstUpserts = upserts;
    assert.ok(firstUpserts > 0, "la primera búsqueda sí upserta los registros (hay trabajo real que medir)");
    upserts = 0;
    await service.searchMemory(project, "dato de memoria B9", 5);
    assert.equal(upserts, 0, "sin cambios en disco, la segunda búsqueda no re-upserta NINGÚN registro");

    const idx1 = await service.indexProject(project, {});
    assert.ok(idx1.totalFiles >= 1);
    const idx2 = await service.indexProject(project, {});
    assert.equal(idx2.mode, "cached", "sin cambios, la segunda indexación sale de la caché por huellas");
    assert.equal(idx2.changedFiles, 0);
  } finally {
    try { service.memoryStore.close(); } catch { /* ignore */ }
  }
});
