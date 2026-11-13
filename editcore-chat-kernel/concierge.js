"use strict";

/**
 * [EDITCORE-V510-B1] CONSERJE — carril paralelo de SOLO LECTURA.
 *
 * Diagnóstico de Luis (2026-11-12): si manda una consulta mientras el
 * agente trabaja, ningún agente la atiende: el mensaje cae en la cola
 * del motor único («ejecuta de uno en uno») y puede caducar sin que
 * nadie lo lea. Claude/Cursor/Antigravity atienden en paralelo; aquí
 * el orquestador es uno solo y su serialización NO se toca — lo que
 * nace es un SEGUNDO carril, estrecho y seguro: consultas puras
 * (preguntar, listar, analizar, verificar) se atienden al momento sin
 * entrar en la cadena, sin tocar `this.session`/`this.steering` del
 * orquestador y sin escribir un solo archivo.
 *
 * El conserje responde desde la MEMORIA COMPARTIDA (expediente del
 * proyecto + Cerebro, los mismos bloques que recibe el turno
 * principal) y desde la evidencia fresca de solo lectura que levanta
 * el analyst (el mismo ejecutor determinista de delegate_parallel).
 * Una sola llamada al modelo, sin herramientas: no puede mutar nada
 * ni por accidente. Si la consulta en realidad pide cambios, lo dice
 * y deriva al turno principal: no promete lo que su carril no hace.
 */

const { runAnalyst } = require("./subagents/analyst");
const threadMemory = require("./thread-memory");

const CONCIERGE_SYSTEM = [
  "Eres el CONSERJE de EditCoreAI: el agente de guardia que atiende las consultas del usuario MIENTRAS el agente principal está ocupado con otra tarea.",
  "Tu carril es de SOLO LECTURA: no escribes archivos, no ejecutas cambios y no das órdenes al agente principal. Respondes la consulta de frente, con la memoria compartida del proyecto (expediente + Cerebro) y la evidencia del proyecto que se te adjunta.",
  "Reglas:",
  "1) Responde a lo preguntado, en el idioma del usuario, con concreción: cita archivos y hechos de la evidencia/memoria, no conocimiento genérico.",
  "2) Si algo no consta en la evidencia ni en la memoria, dilo («no consta en lo que puedo ver») en vez de inventarlo.",
  "3) Si la consulta en realidad pide CAMBIOS (crear, corregir, aplicar), dilo con claridad: este carril no escribe; esa instrucción debe ir al turno principal (el usuario puede reenviarla o fundirla como instrucción cuando el motor se libere). No prometas ejecutarla tú.",
  "4) La tarea principal sigue corriendo intacta en paralelo: no la des por terminada ni hables en su nombre sobre su resultado.",
].join("\n");

// Los bloques de memoria compartida: el expediente del proyecto y el
// Cerebro — los MISMOS constructores que alimentan al turno principal
// (projectPromptBlock y buildCerebroServiceBlock), para que el
// conserje responda con el mismo conocimiento y no con una copia.
async function buildSharedMemoryBlock(projectRoot, threadId, query, helpers) {
  const parts = [];
  // [EDITCORE-V510-B5-MAPA] El Mapa ABRE el bloque de memoria
  // compartida (es el contexto permanente, tier esencial): conserje,
  // turno principal y subagentes leen primero la orientación vigente.
  let mapBlock = "";
  try {
    mapBlock = require("./orientation-map").buildMapBlock(projectRoot);
    if (mapBlock) parts.push(mapBlock);
  } catch { /* sin Mapa no hay bloque, no un error */ }
  try {
    let dossier = threadMemory.projectPromptBlock(projectRoot, threadId || "default", query);
    if (dossier && mapBlock) {
      try { dossier = require("./orientation-map").dedupeDossierAgainstMap(dossier, mapBlock); } catch { /* sin deduplicar */ }
    }
    if (dossier) parts.push(dossier);
  } catch { /* sin expediente no hay bloque, no un error */ }
  try {
    const { buildCerebroServiceBlock } = require("./orchestrator");
    const cerebro = await buildCerebroServiceBlock(projectRoot, query, helpers);
    if (cerebro) parts.push(cerebro);
  } catch { /* fail-open, como al abrir el turno principal */ }
  // [EDITCORE-V513-W4] Declaración de vacío de frentes: si el Mapa no
  // trae frentes abiertos, el bloque lo DICE («ninguno registrado»)
  // en vez de omitir la sección. Sin esa línea, «memoria vacía» y
  // «memoria no consultada» se veían iguales, y el modelo sustituía
  // la memoria por lecturas sueltas de archivos para concluir el
  // estado del proyecto (el fallo en vivo de la v5.1.2). Va justo
  // tras la pieza del Mapa, dentro del mismo tope de 5.200.
  try {
    const om = require("./orientation-map");
    const fronts = om.getProjectMap(projectRoot)?.openFronts || [];
    if (!fronts.length) {
      parts.splice(mapBlock ? 1 : 0, 0, "Frentes abiertos: ninguno registrado en la memoria del proyecto.");
    }
  } catch { /* sin declaración no hay bloque roto */ }
  return parts.join("\n\n").slice(0, 5200);
}

/**
 * Atiende una consulta pura por el carril del conserje.
 * Devuelve el resultado del turno (kind CONCIERGE) o null si el
 * carril no puede atender (sin clave, sin proyecto o fallo del
 * proveedor): el llamador conserva entonces la ruta de siempre (la
 * cadena), nunca una respuesta fabricada.
 */
async function runConcierge({ message, projectRoot, threadId, apiBaseUrl, apiKey, model, helpers, signal, onProgress } = {}) {
  const query = String(message || "").trim();
  if (!query || !projectRoot || !apiKey) return null;
  if (signal?.aborted) return null;

  const memoryBlock = await buildSharedMemoryBlock(projectRoot, threadId, query, helpers);

  // Evidencia fresca de solo lectura (determinista, con tope de
  // lecturas y la señal de aborto PROPIA de esta corrida).
  let evidence = "";
  let steps = [];
  try {
    // Sin memoryContext aquí: el bloque de memoria ya viaja UNA vez
    // en el mensaje al modelo (abajo), no duplicado en la evidencia.
    const analyst = await runAnalyst({ projectRoot, userMessage: query, signal, maxReads: 8 });
    evidence = String(analyst?.report || "");
    steps = Array.isArray(analyst?.steps) ? analyst.steps : [];
  } catch { /* sin evidencia también se responde desde la memoria */ }
  if (signal?.aborted) return null;

  const chatCaller = (helpers && typeof helpers.callChat === "function")
    ? helpers.callChat
    : require("./provider").callChat;

  const userParts = [
    memoryBlock ? `## Memoria compartida del proyecto (expediente + Cerebro)\n${memoryBlock}` : "",
    evidence ? `## Evidencia del proyecto (levantada ahora, solo lectura)\n${evidence.slice(0, 9000)}` : "",
    `## Consulta del usuario\n${query}`,
  ].filter(Boolean).join("\n\n");

  let turn = null;
  try {
    turn = await chatCaller({
      apiBaseUrl,
      apiKey,
      model,
      messages: [
        { role: "system", content: CONCIERGE_SYSTEM },
        { role: "user", content: userParts },
      ],
      tools: [],
      signal: signal || null,
      stream: false,
      timeoutMs: 120_000,
      fallbackProfiles: [],
    });
  } catch { return null; }
  const text = String(turn?.text || "").trim();
  if (!text) return null;
  try { onProgress?.({ phase: "done", text: "" }); } catch { /* ignore */ }
  return {
    kind: "CONCIERGE",
    concierge: true,
    text,
    steps,
    usage: turn?.usage || {},
    threadId: threadId || "default",
  };
}

module.exports = { runConcierge, buildSharedMemoryBlock, CONCIERGE_SYSTEM };
