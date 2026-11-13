"use strict";

/**
 * [EDITCORE-V510-B5-MAPA] EL MAPA — orientación mantenida.
 *
 * Ampliación pedida por Luis (2026-11-12, textual): «cuando hablas de
 * mapa a eso me refiero cuando te digo que debe tener una red
 * neuronal, y debería ser como tú». Su «red neuronal» es el MAPA DE
 * ORIENTACIÓN: el contexto permanente y consolidado con el que un
 * asistente personal trabaja — quién es el usuario, sus reglas, sus
 * proyectos y su estado, decisiones con procedencia — consultado en
 * cada turno y MANTENIDO entre sesiones. No es el mapa cognitivo de
 * archivos (runtime/project-map, topología del repo): este es el
 * destilado VIGENTE que orienta.
 *
 * Dos capas:
 *  (a) USUARIO (global): ~/.editcore/orientation-map-user.json, junto
 *      a la memoria global del kernel. Quién es, reglas permanentes,
 *      preferencias e índice de sus proyectos (nombre, propósito,
 *      estado, frentes). Se guarda como artefacto versionado propio
 *      porque el almacén del Cerebro (brain-service.remember) solo
 *      ANEXA entradas con id nuevo: la capa vigente del Mapa exige
 *      sobrescritura con procedencia, no acumulación.
 *  (b) PROYECTO: dentro del expediente (thread-memory), clave
 *      `orientationMap`: propósito, estado vigente (reescrito, no
 *      anexado), decisiones VIGENTES con procedencia, frentes
 *      abiertos/cerrados y archivos clave con su rol.
 *
 * Mantenimiento agéntico DETERMINISTA al cierre de cada turno
 * (handle()): las decisiones nuevas que contradicen a una anterior
 * (misma clave de tema) REEMPLAZAN la vieja conservando la
 * procedencia («sustituye a la del <fecha>»); el estado se reescribe
 * desde los hechos del turno; los frentes rotan con el workingOn del
 * expediente. Topes declarados por capa con poda por
 * relevancia/antigüedad (lo más reciente manda; lo sustituido sale).
 *
 * Carga: al abrir cada turno el bloque del Mapa entra como tier
 * ESENCIAL acotado (agente, conserje y director lo reciben; los
 * subagentes, la capa del proyecto vía la memoria compartida), y el
 * bloque del expediente se deduplica contra él. Consultable:
 * search_brain devuelve primero las entradas del Mapa cuando la
 * pregunta es de orientación.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const threadMemory = require("./thread-memory");
const { distillTurnForBrain } = require("./subagent-distill");

// Topes declarados por capa (poda por relevancia/antigüedad).
const PROJECT_MAP_BLOCK_MAX = 1900;
const USER_MAP_BLOCK_MAX = 900;
const MAX_MAP_DECISIONS = 12;
const MAX_MAP_FRONTS = 8;
const MAX_MAP_KEYFILES = 12;
const MAX_USER_RULES = 14;
const MAX_USER_PROJECTS = 12;

function clip(text, max) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function normalizeLoose(text = "") {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9$ ]+/g, " ").replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------
// Sustitución por tema: la clave de una decisión/regla es su TEMA —
// las primeras palabras con contenido tras quitar la fórmula de
// entrada («Opción elegida por el usuario:», «Decidimos», «El
// usuario descartó»…). Dos asientos con la misma clave y distinto
// texto = contradicción: el nuevo SUSTITUYE al viejo.
// ------------------------------------------------------------------
const TOPIC_FILLER = new Set([
  "opcion", "elegida", "por", "el", "la", "los", "las", "un", "una", "usuario",
  "decidimos", "decidido", "se", "decide", "queda", "quedan", "usar", "usaremos",
  "autorizacion", "acepto", "aceptar", "va", "hacer", "que", "de", "del", "en",
]);
function topicKey(text = "") {
  const words = normalizeLoose(text).split(" ").filter(Boolean);
  let i = 0;
  while (i < words.length && TOPIC_FILLER.has(words[i])) i += 1;
  return words.slice(i, i + 4).join(" ");
}

// Inserta un asiento (decisión/regla) con semántica de sustitución:
// texto idéntico ⇒ refresca; mismo tema, otro texto ⇒ reemplaza y el
// nuevo conserva la procedencia del sustituido; si no, anexa al final
// (lo reciente manda) y poda por antigüedad al tope de la capa.
function upsertEntry(list, entry, max) {
  const items = Array.isArray(list) ? [...list] : [];
  const cleanText = clip(entry.text, 400);
  if (!cleanText) return items;
  const sameText = items.findIndex((e) => normalizeLoose(e.text) === normalizeLoose(cleanText));
  if (sameText >= 0) {
    items[sameText] = { ...items[sameText], at: entry.at || new Date().toISOString(), source: entry.source || items[sameText].source || "" };
    return items;
  }
  const key = topicKey(cleanText);
  if (key) {
    const sameTopic = items.findIndex((e) => topicKey(e.text) === key);
    if (sameTopic >= 0) {
      const old = items[sameTopic];
      items[sameTopic] = {
        text: cleanText,
        at: entry.at || new Date().toISOString(),
        source: entry.source || "",
        supersedes: { text: old.text, at: old.at || "", source: old.source || "" },
      };
      return items;
    }
  }
  items.push({ text: cleanText, at: entry.at || new Date().toISOString(), source: entry.source || "" });
  return items.slice(-max);
}

// ------------------------------------------------------------------
// Capa PROYECTO (en el expediente)
// ------------------------------------------------------------------
function emptyProjectMap() {
  return {
    version: 1,
    updatedAt: null,
    purpose: "",
    state: "",
    decisions: [],
    openFronts: [],
    closedFronts: [],
    keyFiles: [],
    _lastWorkingOn: "",
  };
}

function getProjectMap(projectRoot) {
  if (!projectRoot) return emptyProjectMap();
  try {
    const state = threadMemory.loadProjectState(projectRoot);
    const raw = state?.orientationMap;
    if (!raw || typeof raw !== "object") return emptyProjectMap();
    return { ...emptyProjectMap(), ...raw };
  } catch { return emptyProjectMap(); }
}

function saveProjectMap(projectRoot, map) {
  if (!projectRoot) return map;
  const clean = { ...map, updatedAt: new Date().toISOString() };
  try { threadMemory.saveProjectState(projectRoot, { orientationMap: clean }); } catch { /* el Mapa nunca tumba el turno */ }
  return clean;
}

function noteMapDecision(projectRoot, text, source = "turno del agente") {
  const map = getProjectMap(projectRoot);
  map.decisions = upsertEntry(map.decisions, { text, source }, MAX_MAP_DECISIONS);
  return saveProjectMap(projectRoot, map);
}

function openMapFront(projectRoot, text, source = "turno del agente") {
  const map = getProjectMap(projectRoot);
  const clean = clip(text, 160);
  if (clean && !map.openFronts.some((f) => normalizeLoose(f.text) === normalizeLoose(clean))) {
    map.openFronts = [{ text: clean, at: new Date().toISOString(), source }, ...map.openFronts].slice(0, MAX_MAP_FRONTS);
  }
  return saveProjectMap(projectRoot, map);
}

function closeMapFront(projectRoot, text, source = "turno del agente") {
  const map = getProjectMap(projectRoot);
  const key = normalizeLoose(text);
  const idx = map.openFronts.findIndex((f) => normalizeLoose(f.text) === key || topicKey(f.text) === topicKey(text));
  if (idx >= 0) {
    const [closed] = map.openFronts.splice(idx, 1);
    map.closedFronts = [{ ...closed, closedAt: new Date().toISOString(), closedBy: source }, ...map.closedFronts].slice(0, MAX_MAP_FRONTS);
  }
  return saveProjectMap(projectRoot, map);
}

function setMapPurpose(projectRoot, text) {
  const map = getProjectMap(projectRoot);
  map.purpose = clip(text, 220);
  return saveProjectMap(projectRoot, map);
}

function noteMapKeyFile(projectRoot, file, role) {
  const map = getProjectMap(projectRoot);
  const cleanFile = String(file || "").replace(/\\/g, "/").slice(0, 200);
  if (!cleanFile) return map;
  map.keyFiles = [{ file: cleanFile, role: clip(role, 120) }, ...map.keyFiles.filter((k) => k.file !== cleanFile)].slice(0, MAX_MAP_KEYFILES);
  return saveProjectMap(projectRoot, map);
}

// Mantenimiento al cierre de un turno: sincroniza la capa del
// proyecto desde el expediente YA destilado por el propio turno
// (decisiones con su procedencia, hechos, workingOn) y reescribe el
// estado desde los hechos de ESTE turno. Nunca lanza.
function maintainProjectMap(projectRoot, { steps = [], finalText = "", userText = "" } = {}) {
  if (!projectRoot) return null;
  try {
    const state = threadMemory.loadProjectState(projectRoot);
    const map = getProjectMap(projectRoot);
    if (state.objective) map.purpose = clip(state.objective, 220);
    // Decisiones: se reproducen en orden desde el expediente; la
    // sustitución por tema deja solo las VIGENTES, con procedencia.
    let decisions = [];
    for (const d of Array.isArray(state.decisions) ? state.decisions : []) {
      const text = typeof d === "string" ? d : String(d?.text || "");
      if (!text) continue;
      decisions = upsertEntry(decisions, {
        text,
        at: d?.t ? new Date(d.t).toISOString() : new Date().toISOString(),
        source: "expediente del proyecto",
      }, MAX_MAP_DECISIONS);
    }
    map.decisions = decisions;
    // Archivos clave: desde los hechos estructurales del expediente
    // (qué contiene/usa cada archivo), lo más reciente manda.
    const byFile = new Map();
    for (const f of Array.isArray(state.facts) ? state.facts : []) {
      if (!f?.file) continue;
      let role = "";
      if (f.kind === "section") role = f.name ? `contiene ${f.name}` : "sección mapeada";
      else if (f.kind === "asset") role = f.asset ? `usa ${f.asset}` : "asset";
      else if (f.kind === "read") role = f.why ? clip(f.why, 100) : "leído";
      else if (f.kind === "subagent") role = "mapeado por subagente";
      if (role) byFile.set(String(f.file).replace(/\\/g, "/"), role);
    }
    if (byFile.size) {
      map.keyFiles = [...byFile.entries()].map(([file, role]) => ({ file, role })).slice(-MAX_MAP_KEYFILES).reverse();
    }
    // Frentes: rotan con el workingOn del expediente — al cambiar el
    // frente en curso, el anterior se CIERRA con procedencia.
    const front = clip(state.workingOn, 160);
    if (front && map._lastWorkingOn && normalizeLoose(map._lastWorkingOn) !== normalizeLoose(front)) {
      const prev = map._lastWorkingOn;
      map.openFronts = map.openFronts.filter((f) => normalizeLoose(f.text) !== normalizeLoose(prev));
      map.closedFronts = [{ text: prev, at: new Date().toISOString(), source: "expediente", closedAt: new Date().toISOString(), closedBy: "rotación del frente en curso" }, ...map.closedFronts].slice(0, MAX_MAP_FRONTS);
    }
    if (front) {
      map._lastWorkingOn = front;
      if (!map.openFronts.some((f) => normalizeLoose(f.text) === normalizeLoose(front))) {
        map.openFronts = [{ text: front, at: new Date().toISOString(), source: "expediente · frente en curso" }, ...map.openFronts].slice(0, MAX_MAP_FRONTS);
      }
    }
    // Estado VIGENTE: se reescribe desde los hechos de este turno
    // (el destilado B5), no se anexa relato.
    if (Array.isArray(steps) && steps.length) {
      const distilled = distillTurnForBrain({ userText, steps, finalText });
      const appliedLine = distilled.split("\n").find((l) => l.startsWith("Aplicado")) || "";
      const verifiedLine = distilled.split("\n").find((l) => l.startsWith("Verificación")) || "";
      const today = new Date().toISOString().slice(0, 10);
      map.state = clip(`[${today}] ${appliedLine}${verifiedLine ? ` · ${verifiedLine}` : ""}${front ? ` · Frente en curso: ${front}` : ""}`, 420);
    } else if (front && !map.state) {
      map.state = clip(`Frente en curso: ${front}`, 420);
    }
    return saveProjectMap(projectRoot, map);
  } catch { return null; }
}

// ------------------------------------------------------------------
// Capa USUARIO (global, ~/.editcore)
// ------------------------------------------------------------------
function userMapPath() {
  return path.join(os.homedir(), ".editcore", "orientation-map-user.json");
}

function emptyUserMap() {
  return { version: 1, updatedAt: null, who: { name: "", notes: "" }, rules: [], preferences: [], projects: [] };
}

function getUserMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(userMapPath(), "utf8"));
    if (!raw || typeof raw !== "object") return emptyUserMap();
    return { ...emptyUserMap(), ...raw, who: { ...emptyUserMap().who, ...(raw.who || {}) } };
  } catch { return emptyUserMap(); }
}

function saveUserMap(map) {
  const clean = { ...map, updatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(userMapPath()), { recursive: true });
    fs.writeFileSync(userMapPath(), JSON.stringify(clean, null, 2), "utf8");
  } catch { /* el Mapa nunca tumba el turno */ }
  return clean;
}

function updateUserMap(mutator) {
  const map = getUserMap();
  try { mutator(map); } catch { return map; }
  return saveUserMap(map);
}

function upsertUserRule(text, source = "usuario") {
  return updateUserMap((map) => { map.rules = upsertEntry(map.rules, { text, source }, MAX_USER_RULES); });
}

// El índice de proyectos del usuario se sincroniza solo con cada
// mantenimiento de proyecto: nombre, propósito y estado vigentes.
function syncUserProjectIndex(projectRoot, projectMap) {
  if (!projectRoot || !projectMap) return null;
  const name = path.basename(String(projectRoot).replace(/\\/g, "/")) || String(projectRoot);
  return updateUserMap((map) => {
    const entry = {
      name,
      root: String(projectRoot),
      purpose: clip(projectMap.purpose, 160),
      state: clip(projectMap.state, 200),
      updatedAt: new Date().toISOString(),
    };
    map.projects = [entry, ...map.projects.filter((p) => p.root !== entry.root)].slice(0, MAX_USER_PROJECTS);
  });
}

// ------------------------------------------------------------------
// Bloque de contexto (tier esencial) y deduplicación del expediente
// ------------------------------------------------------------------
function entryLine(e) {
  const when = e.at ? ` · ${String(e.at).slice(0, 10)}` : "";
  const sup = e.supersedes?.text ? ` (sustituye a: «${clip(e.supersedes.text, 80)}»${e.supersedes.at ? `, del ${String(e.supersedes.at).slice(0, 10)}` : ""})` : "";
  return `- ${clip(e.text, 220)}${e.source ? ` [${e.source}${when}]` : ""}${sup}`;
}

function buildUserMapBlock() {
  const user = getUserMap();
  const lines = [];
  if (user.who?.name || user.who?.notes) lines.push(`- Usuario: ${clip([user.who.name, user.who.notes].filter(Boolean).join(" — "), 200)}`);
  for (const r of (user.rules || []).slice(-6)) lines.push(`- Regla permanente: ${clip(r.text, 200)}`);
  for (const p of (user.preferences || []).slice(-4)) lines.push(`- Preferencia: ${clip(p.text, 160)}`);
  const others = (user.projects || []).slice(0, 6);
  if (others.length) lines.push(`- Sus proyectos: ${others.map((p) => `${p.name}${p.state ? ` (${clip(p.state, 60)})` : ""}`).join(" · ")}`);
  if (!lines.length) return "";
  return `### Capa usuario (global)\n${lines.join("\n")}`.slice(0, USER_MAP_BLOCK_MAX);
}

function buildProjectMapBlock(projectRoot) {
  const map = getProjectMap(projectRoot);
  const lines = [];
  if (map.purpose) lines.push(`- Propósito: ${clip(map.purpose, 220)}`);
  if (map.state) lines.push(`- Estado vigente: ${clip(map.state, 420)}`);
  if (map.decisions?.length) {
    lines.push("- Decisiones vigentes (con procedencia):");
    for (const d of map.decisions.slice(-6)) lines.push(`  ${entryLine(d)}`);
  }
  if (map.openFronts?.length) lines.push(`- Frentes abiertos: ${map.openFronts.slice(0, 5).map((f) => clip(f.text, 100)).join(" · ")}`);
  if (map.keyFiles?.length) lines.push(`- Archivos clave: ${map.keyFiles.slice(0, 8).map((k) => `\`${k.file}\`${k.role ? ` (${clip(k.role, 60)})` : ""}`).join(" · ")}`);
  if (!lines.length) return "";
  const name = projectRoot ? path.basename(String(projectRoot).replace(/\\/g, "/")) : "";
  return `### Capa proyecto${name ? ` — ${name}` : ""}\n${lines.join("\n")}`.slice(0, PROJECT_MAP_BLOCK_MAX);
}

// El bloque completo del Mapa para el contexto del turno. Vacío solo
// cuando ninguna capa tiene contenido todavía.
function buildMapBlock(projectRoot) {
  const userBlock = buildUserMapBlock();
  const projectBlock = projectRoot ? buildProjectMapBlock(projectRoot) : "";
  if (!userBlock && !projectBlock) return "";
  return [
    "## 🗺️ MAPA DE ORIENTACIÓN (contexto permanente: el destilado VIGENTE del usuario y del proyecto — manda sobre relatos viejos; si algo de aquí contradice el historial, vale esto)",
    userBlock,
    projectBlock,
  ].filter(Boolean).join("\n\n");
}

// El bloque del expediente (projectPromptBlock) y el Mapa duplican
// decisiones: las líneas del expediente cuyo texto ya está en el
// Mapa salen del expediente (el Mapa es la forma vigente y acotada).
function dedupeDossierAgainstMap(dossierText, mapBlock) {
  const dossier = String(dossierText || "");
  if (!dossier || !mapBlock) return dossier;
  const mapNorm = normalizeLoose(mapBlock);
  const kept = dossier.split(/\r?\n/).filter((line) => {
    const norm = normalizeLoose(line.replace(/^[-*\s]+/, ""));
    if (norm.length < 30) return true;
    return !mapNorm.includes(norm.slice(0, 60));
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ------------------------------------------------------------------
// Consultable: preguntas de orientación se responden del Mapa
// ------------------------------------------------------------------
const ORIENTATION_QUERY_RE = /\b(qu[eé] decidimos|decidimos|decisi[oó]n|en qu[eé] (?:est[aá]|qued[oó]|va)|estado (?:de|del)|c[oó]mo va|qu[eé] es (?:el|este) proyecto|qui[eé]n es|reglas? (?:de|del|permanentes?)|frentes? (?:abiertos?|en curso)|mapa|orientaci[oó]n|qu[eé] (?:sigue|falta|queda))\b/i;
function isOrientationQuery(query = "") {
  return ORIENTATION_QUERY_RE.test(String(query || ""));
}

function searchMap(projectRoot, query = "", limit = 5) {
  const words = [...new Set(normalizeLoose(query).split(" ").filter((w) => w.length >= 3))];
  const hits = [];
  const consider = (layer, kind, text, extra = "") => {
    const hay = normalizeLoose(`${text} ${extra}`);
    const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1 : 0), 0);
    if (score > 0) hits.push({ layer, kind, text: clip(text, 300), score });
  };
  const user = getUserMap();
  for (const r of user.rules || []) consider("usuario", "regla", r.text);
  for (const p of user.projects || []) consider("usuario", "proyecto", `${p.name}: ${p.state || p.purpose || ""}`, p.purpose || "");
  if (projectRoot) {
    const map = getProjectMap(projectRoot);
    if (map.purpose) consider("proyecto", "propósito", map.purpose);
    if (map.state) consider("proyecto", "estado", map.state);
    for (const d of map.decisions || []) consider("proyecto", "decisión", d.text);
    for (const f of map.openFronts || []) consider("proyecto", "frente abierto", f.text);
    for (const k of map.keyFiles || []) consider("proyecto", "archivo clave", `${k.file} — ${k.role || ""}`, k.file);
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = {
  // capas y mantenimiento
  emptyProjectMap, getProjectMap, saveProjectMap, maintainProjectMap,
  noteMapDecision, openMapFront, closeMapFront, setMapPurpose, noteMapKeyFile,
  emptyUserMap, getUserMap, saveUserMap, updateUserMap, upsertUserRule, syncUserProjectIndex,
  // contexto y consulta
  buildMapBlock, buildUserMapBlock, buildProjectMapBlock, dedupeDossierAgainstMap,
  isOrientationQuery, searchMap,
  // utilidades (pruebas)
  topicKey, upsertEntry, userMapPath,
  PROJECT_MAP_BLOCK_MAX, USER_MAP_BLOCK_MAX,
};
