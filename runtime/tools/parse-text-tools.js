"use strict";

/**
 * Fallback: algunos modelos emiten tools como XML/texto en vez de tool_calls.
 * También limpia ese markup para que NUNCA se vea en el chat.
 */

const ALIAS = {
  list_directory: "list_files",
  list_dir: "list_files",
  listdir: "list_files",
  glob: "search_files",
  grep: "search_files",
  execute_command: "run_command",
  run_shell: "run_command",
  shell: "run_command",
  bash: "run_command",
  terminal: "run_command",
  str_replace: "replace_in_file",
  search_replace: "replace_in_file",
  apply_patch: "replace_in_file",
  edit_file: "replace_in_file",
  create_file: "write_file",
  write: "write_file",
  read: "read_file",
  view: "read_file",
  open_file: "read_file",
};

const NATIVE = [
  "list_files", "read_file", "write_file", "replace_in_file", "search_files",
  "run_command", "audit_env", "supabase_migrate", "scaffold_project",
  "capture_preview_screenshot",
  // [EDITCORE-INTEGRAL-B4] start_preview reconocida también por la vía texto.
  "start_preview", "git_log", "git_diff",
  "web_scrape", "ingest_to_brain", "clone_repo",
  "rollback_last_change", "list_snapshots",
  // [v5.2.7 — corrección] Los documentos también se rescatan por
  // la vía texto: create_pdf/word/excel/csv son nombres reales del
  // despachador (extra-tools) y faltaban en esta lista — una
  // llamada en texto a crear un PDF se descartaba en silencio.
  "create_pdf", "create_word", "create_excel", "create_csv",
  // [FASE2-BORRAR B-3] Salen capture_preview y list_brain: nombres
  // muertos que la vía texto reconocía y el despachador rechazaba
  // (capture_preview es la deriva de capture_preview_screenshot;
  // list_brain no existe en ningún conjunto). La vía texto ya solo
  // promete nombres con case real en tools.execute.
];

const TOOL_TAG_NAMES = [...new Set([...NATIVE, ...Object.keys(ALIAS)])];

/** Marca el inicio de protocolo tool/XML/JSON que no debe verse en el chat. */
const TOOL_MARKUP_START_RE = /<\s*\/?\s*[|｜\uFF5C]\s*DSML\b|<\|tool_call\|>|<(?:dots_function_call|tool_code|tool_call|tool_use|tool_invocation|function_calls?|function\s*=|parameter\s*=|invoke|tools)\b|<\/?(?:dots_function_call|tool_code|tool_call|tool_use|function|parameter|tools)\b|```(?:json|xml)?\s*\n\s*\{\s*"(?:tool|function)"\s*:|```(?:json|xml)?\s*\n\s*\{\s*"name"\s*:[^}]*?"(?:args|arguments|input|parameters)"\s*:|\{\s*"(?:tool|function)"\s*:/i;

function normalizeToolName(name) {
  const raw = String(name || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return ALIAS[raw] || raw;
}

function toolsKnown(name) {
  return NATIVE.includes(name);
}

// DESESCAPE DE BLOBS (contrato de turno): cuando el modelo emite la llamada
// en modo texto con el contenido escapado como una sola línea (los saltos
// como \n literales), guardar el valor tal cual corrompe el archivo en
// disco (Footer.tsx/Navbar.tsx, 2026-11-10). Solo se desescapa el patrón
// inequívoco — sin ningún salto real y con ≥2 secuencias \n — para no
// tocar código legítimo que contenga "\n" dentro de cadenas o regex.
function unescapeTextBlob(val) {
  const v = String(val ?? "");
  if (v.includes("\n") || (v.match(/\\n/g) || []).length < 2) return v;
  return v
    .replace(/\\\\/g, "\u0001")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\//g, "/")
    .replace(/\u0001/g, "\\");
}

function assignArg(args, key, val) {
  let parsedVal = val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "true") parsedVal = true;
    else if (trimmed === "false") parsedVal = false;
    else if (/^-?\d+(?:\.\d+)?$/.test(trimmed) && !/^(path|file|filepath|file_path|query|pattern|search|content|contents|text|old|new)/i.test(key)) {
      parsedVal = Number(trimmed);
    } else if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        parsedVal = JSON.parse(trimmed);
      } catch { /* mantener cadena si no es JSON válido */ }
    }
  }
  if (/^(path|file|filepath|file_path)$/i.test(key)) args.path = typeof parsedVal === "string" ? parsedVal.trim() : parsedVal;
  else if (/^(command|cmd)$/i.test(key)) args.command = parsedVal;
  else if (/^(content|contents|text)$/i.test(key)) args.content = typeof parsedVal === "string" ? unescapeTextBlob(parsedVal) : parsedVal;
  else if (/^(old|old_str|oldText|old_text)$/i.test(key)) args.oldText = typeof parsedVal === "string" ? unescapeTextBlob(parsedVal) : parsedVal;
  else if (/^(new|new_str|newText|new_text)$/i.test(key)) args.newText = typeof parsedVal === "string" ? unescapeTextBlob(parsedVal) : parsedVal;
  else if (/^(query|pattern|search)$/i.test(key)) args.query = typeof parsedVal === "string" ? unescapeTextBlob(parsedVal) : parsedVal;
  else if (/^url$/i.test(key)) args.url = parsedVal;
  else args[key] = parsedVal;
}

function parseInnerArgs(body) {
  const args = {};
  const src = String(body || "");
  let matched = false;

  // Primero parámetros cerrados
  const closedRe = /<parameter\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)\s*<\/parameter>/gi;
  let m;
  while ((m = closedRe.exec(src))) {
    matched = true;
    assignArg(args, String(m[1] || "").trim(), String(m[2] || "").trim());
  }

  // Luego un parámetro abierto al final (stream cortado)
  const remainder = src.replace(/<parameter\s*=\s*[a-zA-Z_][\w-]*\s*>\s*[\s\S]*?\s*<\/parameter>/gi, "");
  const open = /<parameter\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*)$/i.exec(remainder);
  if (open) {
    matched = true;
    assignArg(args, String(open[1] || "").trim(), String(open[2] || "").trim());
  }

  const tagRe = /<([a-zA-Z_][\w-]*)>\s*([\s\S]*?)\s*<\/\1>/g;
  while ((m = tagRe.exec(src))) {
    matched = true;
    const key = String(m[1] || "").trim();
    if (!key || /^(parameter|function|tool_call)$/i.test(key)) continue;
    assignArg(args, key, String(m[2] || "").trim());
  }

  if (!matched) {
    const trimmed = src.trim();
    if (trimmed.startsWith("{")) {
      try {
        const json = JSON.parse(trimmed);
        if (json && typeof json === "object") {
          Object.assign(args, json);
          // Doble escape: el JSON era válido pero el contenido quedó como
          // blob de una línea con \n literales tras el parseo.
          // [EDITCORE-INTEGRAL-B4] query también se desescapa aquí.
          for (const k of ["content", "oldText", "newText", "query"]) {
            if (typeof args[k] === "string") args[k] = unescapeTextBlob(args[k]);
          }
        }
      } catch { /* ignore */ }
    }
  }
  return args;
}

function toRelativePath(projectRoot, filePath) {
  const raw = String(filePath || "").trim();
  if (!raw || !projectRoot) return raw.replace(/\\/g, "/");
  // Prefijo literal primero: si la ruta empieza con la raíz tal
  // cual (sin importar la plataforma), el resto ES la ruta
  // relativa; resolver con path.resolve en otra plataforma
  // devuelve la ruta entera y el prefijo jamás se recorta.
  const escaped = String(projectRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefixRe = new RegExp(`^${escaped}[\\\\/]?`, "i");
  if (prefixRe.test(raw)) return raw.replace(prefixRe, "").replace(/\\/g, "/") || ".";
  const path = require("path");
  try {
    const root = path.resolve(String(projectRoot));
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
    const rootLower = root.toLowerCase();
    const absLower = abs.toLowerCase();
    if (absLower === rootLower) return ".";
    const sep = path.sep.toLowerCase();
    if (absLower.startsWith(rootLower + sep) || absLower.startsWith(`${rootLower}/`) || absLower.startsWith(`${rootLower}\\`)) {
      return path.relative(root, abs).replace(/\\/g, "/") || ".";
    }
  } catch { /* ignore */ }
  return raw.replace(/\\/g, "/");
}

function pushCall(calls, name, args, projectRoot) {
  const normalized = normalizeToolName(name);
  if (!toolsKnown(normalized)) return;
  const next = { ...args };
  if (next.path) next.path = toRelativePath(projectRoot, next.path);
  if (normalized === "run_command" && next.command && projectRoot) {
    const esc = String(projectRoot).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next.command = String(next.command)
      .replace(new RegExp(`^cd\\s+"?${esc}"?\\s*(?:&&|;)\\s*`, "i"), "")
      .trim();
  }
  calls.push({
    id: `text_tool_${calls.length + 1}_${Date.now()}`,
    type: "function",
    function: { name: normalized, arguments: JSON.stringify(next) },
    _fromText: true,
  });
}

// Argumentos del formato <tool_code>: el cuerpo de <arguments>
// es JSON. Si el JSON no cierra (stream cortado a mitad del
// objeto), se cae al parser interno general, que tolera texto.
function parseToolCodeArgs(body) {
  let trimmed = String(body || "").trim();
  // Un resto de la etiqueta de cierre dentro del cuerpo (cuando
  // falta </tool_code> el cuerpo capturado lo arrastra) no es
  // parte del JSON: se corta antes de parsear.
  const corte = trimmed.indexOf("</arguments");
  if (corte >= 0) trimmed = trimmed.slice(0, corte).trim();
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      if (json && typeof json === "object" && !Array.isArray(json)) return json;
    } catch { /* JSON incompleto: se intenta la vía general */ }
  }
  return parseInnerArgs(body);
}


// Objetos JSON completos en el texto (con llaves balanceadas,
// respetando cadenas): el dialecto JSON de herramientas llega
// como líneas peladas {"tool":"bash","args":{...}} sin cerco.
function extraerObjetosJson(src) {
  const objetos = [];
  const texto = String(src || "");
  for (let i = 0; i < texto.length; i++) {
    if (texto[i] !== "{") continue;
    let profundidad = 0;
    let enCadena = false;
    let escape = false;
    let fin = -1;
    for (let j = i; j < texto.length; j++) {
      const ch = texto[j];
      if (enCadena) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') enCadena = false;
        continue;
      }
      if (ch === '"') enCadena = true;
      else if (ch === "{") profundidad++;
      else if (ch === "}") {
        profundidad--;
        if (profundidad === 0) { fin = j; break; }
      }
    }
    if (fin < 0) continue;
    try {
      const obj = JSON.parse(texto.slice(i, fin + 1));
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        objetos.push({ obj, inicio: i, fin: fin + 1 });
        i = fin;
      }
    } catch { /* no era JSON: seguir buscando */ }
  }
  return objetos;
}

// ¿Este objeto JSON es una llamada a herramienta en dialecto
// JSON? Llaves vistas en vivo: {"tool": "bash", "args": {...}}
// (el «Auto» de la pasarela), {"name": ..., "arguments": ...},
// {"function": ..., "parameters": ...}, y formato plano de modelos
// locales: {"tool": "write_file", "path": "...", "content": "..."}.
function llamadaDesdeJson(obj) {
  if (!obj || typeof obj !== "object") return null;
  const nombre = obj.tool || obj.name || obj.function;
  if (typeof nombre !== "string" || !nombre.trim()) return null;
  const isDirectFlat = obj.args == null && obj.arguments == null && obj.input == null && obj.parameters == null;
  let crudos = isDirectFlat ? obj
    : (obj.args != null ? obj.args
      : obj.arguments != null ? obj.arguments
      : obj.input != null ? obj.input
      : obj.parameters != null ? obj.parameters
      : {});
  if (typeof crudos === "string") {
    try { crudos = JSON.parse(crudos); } catch { crudos = {}; }
  }
  if (!crudos || typeof crudos !== "object" || Array.isArray(crudos)) crudos = {};
  const args = {};
  for (const [k, v] of Object.entries(crudos)) {
    if (isDirectFlat && (k === "tool" || k === "name" || k === "function")) continue;
    assignArg(args, k, v);
  }
  return { nombre, args };
}

function parseTextToolCalls(text, { projectRoot } = {}) {
  const src = String(text || "");
  if (!src.trim()) return [];
  const calls = [];

  // Dialecto JSON (líneas peladas o en cerco): {"tool": "...",
  // "args": {...}}. Sin esta rama la llamada no se ejecutaba y
  // el JSON quedaba pintado como si fuera la respuesta (visto
  // en vivo: el agente «inspeccionaba» con JSON en el chat y no
  // construía nada). pushCall descarta los nombres sin destino
  // real tras aplicar los alias (bash -> run_command).
  for (const { obj } of extraerObjetosJson(src)) {
    const llamada = llamadaDesdeJson(obj);
    if (llamada) pushCall(calls, llamada.nombre, llamada.args, projectRoot);
  }

  // Formato Gemma: <|tool_call|>call: <espacio>: <nombre>{json}<|tool_call|>
  // El modelo «Auto» lo emite con un espacio de nombres inventado
  // («googleapis: write_file»); el nombre válido es el ÚLTIMO
  // segmento. Los argumentos son el objeto JSON entre la primera
  // { y la última } antes del marcador de cierre (el contenido
  // puede traer llaves dentro de cadenas). Sin este rescate, la
  // llamada no se ejecutaba y el marcado quedaba pintado en el
  // chat (juicio v5.2.7: notas.txt «creado» que nunca existió).
  const gemmaRe = /<\|tool_call\|>\s*call:\s*([a-zA-Z0-9_.\-: ]+?)\s*(\{[\s\S]*\})\s*(?:<\|tool_call\|>|$)/gi;
  let gm;
  while ((gm = gemmaRe.exec(src))) {
    const nombre = String(gm[1] || "").split(":").pop().trim();
    if (nombre) pushCall(calls, nombre, parseToolCodeArgs(gm[2] || ""), projectRoot);
  }

  // Formato tool_code: <tool_code><name>list_files</name>
  // <arguments>{"path": "..."}</arguments></tool_code>
  const toolCodeRe = /<tool_code>\s*<name>\s*([a-zA-Z_][\w-]*)\s*<\/name>\s*<arguments>\s*([\s\S]*?)\s*<\/arguments>\s*<\/tool_code>/gi;
  let tm;
  while ((tm = toolCodeRe.exec(src))) {
    pushCall(calls, tm[1], parseToolCodeArgs(tm[2] || ""), projectRoot);
  }

  // tool_code sin cierre (stream cortado): se rescata si los
  // argumentos llegaron legibles.
  if (!calls.length) {
    const openTc = /<tool_code>\s*<name>\s*([a-zA-Z_][\w-]*)\s*<\/name>\s*<arguments>\s*([\s\S]*)$/i.exec(src);
    if (openTc) {
      const args = parseToolCodeArgs(openTc[2] || "");
      if (Object.keys(args).length) pushCall(calls, openTc[1], args, projectRoot);
    }
  }

  // Formato cerrado: <tool_call><function=name>...</function></tool_call>
  const fnBlockRe = /<tool_call>\s*<function\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)\s*<\/function>\s*<\/tool_call>/gi;
  let m;
  while ((m = fnBlockRe.exec(src))) {
    pushCall(calls, m[1], parseInnerArgs(m[2] || ""), projectRoot);
  }

  // Formato incompleto / sin cierre (stream cortado)
  if (!calls.length) {
    const open = /<tool_call>\s*<function\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*)$/i.exec(src);
    if (open) {
      const args = parseInnerArgs(open[2] || "");
      if (args.path || args.content || args.command || args.query || args.oldText) {
        pushCall(calls, open[1], args, projectRoot);
      }
    }
  }

  // <function=write_file> sin wrapper tool_call
  if (!calls.length) {
    const bareFn = /<function\s*=\s*([a-zA-Z_][\w-]*)\s*>\s*([\s\S]*?)(?:<\/function>|$)/gi;
    while ((m = bareFn.exec(src))) {
      const args = parseInnerArgs(m[2] || "");
      if (args.path || args.content || args.command || args.query || args.oldText) {
        pushCall(calls, m[1], args, projectRoot);
      }
    }
  }

  // Formato DSML (Kimi/DSML): < | DSML | calls>< | DSML | invoke name="tool">< | DSML | parameter name="param">value</ | DSML | parameter></ | DSML | invoke></ | DSML | calls>
  // Soporta barra vertical ASCII | y Unicode ｜ (\uFF5C), barras de cierre opcionales, y atributos de tipo de dato
  const dsmlRe = /<\s*\/?\s*[|｜\uFF5C]\s*DSML\s*[|｜\uFF5C]\s*invoke\s+name\s*=\s*["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\s*\/?\s*[|｜\uFF5C][^>]*invoke\s*>/gi;
  while ((m = dsmlRe.exec(src))) {
    const rawName = m[1];
    const body = m[2];
    const args = {};
    const paramRe = /<\s*\/?\s*(?:[|｜\uFF5C]\s*DSML\s*[|｜\uFF5C]\s*)?parameter\s+name\s*=\s*["']?([^"'>\s]+)["']?[^>]*>([\s\S]*?)<\s*\/?\s*(?:[|｜\uFF5C][^>]*|(?:\/\s*)?)parameter\s*>/gi;
    let pm;
    while ((pm = paramRe.exec(body))) {
      assignArg(args, pm[1], pm[2].trim());
    }
    pushCall(calls, rawName, args, projectRoot);
  }

  // Formato dots_function_call: <dots_function_call><invoke name="grep"><parameter name="pattern">...</parameter></invoke></dots_function_call>
  const dotsRe = /<dots_function_call>\s*<invoke\s+name\s*=\s*["']?([^"'>\s]+)["']?\s*>\s*([\s\S]*?)\s*<\/invoke>\s*<\/dots_function_call>/gi;
  while ((m = dotsRe.exec(src))) {
    const rawName = m[1];
    const body = m[2];
    const args = {};
    const paramRe = /<parameter\s+name\s*=\s*["']?([^"'>\s]+)["']?[^>]*>\s*([\s\S]*?)\s*<\/parameter>/gi;
    let pm;
    while ((pm = paramRe.exec(body))) {
      assignArg(args, pm[1], pm[2].trim());
    }
    pushCall(calls, rawName, args, projectRoot);
  }

  // <invoke name="tool"> sin wrapper dots_function_call
  if (!calls.length) {
    const bareInvoke = /<\s*\/?\s*invoke\s+name\s*=\s*["']?([^"'>\s]+)["']?[^>]*>\s*([\s\S]*?)(?:<\s*\/?\s*invoke[^>]*>|$)/gi;
    while ((m = bareInvoke.exec(src))) {
      const rawName = m[1];
      const body = m[2];
      const args = {};
      const paramRe = /<\s*\/?\s*parameter\s+name\s*=\s*["']?([^"'>\s]+)["']?[^>]*>\s*([\s\S]*?)(?:<\s*\/?\s*parameter[^>]*>|$)/gi;
      let pm;
      while ((pm = paramRe.exec(body))) {
        assignArg(args, pm[1], pm[2].trim());
      }
      pushCall(calls, rawName, args, projectRoot);
    }
  }

  // Formato clásico y con atributos: <read_file path="...">...</read_file> o <write_file path="...">
  const names = TOOL_TAG_NAMES.join("|");
  const blockRe = new RegExp(`<(${names})(?:\\s+(?:path|file|filepath)=["']([^"']+)["'])?[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
  while ((m = blockRe.exec(src))) {
    const rawTag = m[1];
    const attrPath = m[2] ? m[2].trim() : "";
    const body = m[3] || "";
    const args = parseInnerArgs(body);
    if (attrPath && !args.path) args.path = attrPath;
    const norm = normalizeToolName(rawTag);
    if (norm === "write_file" && !args.content && body && !body.includes("<parameter")) {
      args.content = unescapeTextBlob(body);
    } else if (norm === "run_command" && !args.command && body && !body.includes("<parameter")) {
      args.command = body.trim();
    }
    pushCall(calls, norm, args, projectRoot);
  }

  // Detección dirigida para modelos locales (Nexus / Qwen):
  // Si no hubo llamadas estructuradas previas, pero el modelo generó un bloque de código
  // cercado (```js ... ```) y el texto indica una ruta destino ("crea src/App.js", "archivo: index.html"),
  // se rescata como write_file para que el archivo se escriba en disco y encienda los indicadores.
  if (!calls.length) {
    const pathMatch = src.match(/(?:(?:en|gu[aá]rdalo en|archivo|crea|modifica|path[:=]|escribe en|en el archivo|ruta|creando|guardando)\s*[`'"]?([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,6})[`'"]?)|(?:```[a-zA-Z0-9_-]*\s*[:\/\/\s]*([a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,6}))/i);
    if (pathMatch) {
      const targetPath = (pathMatch[1] || pathMatch[2] || "").trim();
      const codeBlocks = [];
      const codeRe = /```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```/g;
      let cb;
      while ((cb = codeRe.exec(src))) {
        if (cb[1] && cb[1].trim().length > 10) codeBlocks.push(cb[1].trim());
      }
      if (targetPath && codeBlocks.length > 0) {
        const largestCode = codeBlocks.reduce((a, b) => (a.length >= b.length ? a : b));
        pushCall(calls, "write_file", { path: targetPath, content: largestCode }, projectRoot);
      }
    }
  }

  return calls;
}

/**
 * Texto visible para el chat: corta en el primer markup de tool/protocolo.
 */
// La cerca JSON solo cuenta como protocolo si el objeto es una
// LLAMADA (clave tool/function, o name acompañado de args/
// arguments/input/parameters). Un package.json también abre con
// "name" — pero es un ARCHIVO volcado, no una llamada: comerlo
// aquí dejaba el turno mudo («Aquí está el proyecto:» y nada
// más) y ciego ante la corrección de volcado del bucle.
function visibleNarrationText(text) {
  const raw = String(text || "");
  if (!raw) return "";
  const idx = raw.search(TOOL_MARKUP_START_RE);
  if (idx >= 0) return raw.slice(0, idx).replace(/\s+$/g, "");
  return raw;
}

function stripTextToolMarkup(text) {
  let out = String(text || "");
  // Dialecto JSON: fuera los objetos que sean llamadas (con
  // nombre conocido o no: un {"tool": ...} jamás es prosa).
  const spansJson = extraerObjetosJson(out)
    .filter(({ obj }) => obj && typeof obj === "object"
      && (typeof obj.tool === "string" || typeof obj.function === "string" || (typeof obj.name === "string" && obj.arguments)))
    .map(({ inicio, fin }) => [inicio, fin])
    .sort((a, b) => b[0] - a[0]);
  for (const [inicio, fin] of spansJson) {
    out = out.slice(0, inicio) + " " + out.slice(fin);
  }
  out = out.replace(/<\|tool_call\|>[\s\S]*?<\|tool_call\|>/gi, "");
  // Gemma sin cierre (stream cortado): se corta la cola entera.
  out = out.replace(/<\|tool_call\|>[\s\S]*$/i, "");
  // DSML / Pipes (soporta ASCII | y Unicode ｜ \uFF5C)
  out = out.replace(/<\s*\/?\s*[|｜\uFF5C]\s*DSML[\s\S]*?<\s*\/?\s*[|｜\uFF5C][^>]*calls\s*>/gi, "");
  out = out.replace(/<\s*\/?\s*[|｜\uFF5C][^>]*calls\s*>[\s\S]*$/gi, "");
  out = out.replace(/<\s*\/?\s*[|｜\uFF5C][^>]*invoke[\s\S]*?<\s*\/?\s*[|｜\uFF5C][^>]*invoke\s*>/gi, "");
  out = out.replace(/<\s*\/?\s*[|｜\uFF5C][^>]*invoke[\s\S]*$/gi, "");
  out = out.replace(/<\s*\/?\s*[|｜\uFF5C]\s*DSML\b[^>]*>/gi, "");
  out = out.replace(/<\s*\/?\s*[|｜\uFF5C][^>]*>/gi, "");
  out = out.replace(/<\s*\/?\s*DSML\b[^>]*>/gi, "");
  out = out.replace(/<dots_function_call>[\s\S]*?<\/dots_function_call>/gi, "");
  out = out.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "");
  out = out.replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, "");
  out = out.replace(/<tool_code>[\s\S]*?<\/tool_code>/gi, "");
  // tool_code sin cierre (stream cortado): se corta la cola entera.
  out = out.replace(/<tool_code>[\s\S]*$/i, "");
  out = out.replace(/<tools>[\s\S]*?<\/tools>/gi, "");
  out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "");
  out = out.replace(/<tool_use>[\s\S]*?<\/tool_use>/gi, "");
  out = out.replace(/<function\s*=\s*[a-zA-Z_][\w-]*\s*>[\s\S]*?<\/function>/gi, "");
  out = out.replace(/<parameter\s*=\s*[a-zA-Z_][\w-]*\s*>[\s\S]*?<\/parameter>/gi, "");
  const names = TOOL_TAG_NAMES.join("|");
  const re = new RegExp(`<(${names})[^>]*>[\\s\\S]*?<\\/\\1>`, "gi");
  out = out.replace(re, "");
  out = out.replace(/<\/?(?:dots_function_call|invoke|parameter|tool_call|tool_use|tool_code|tools)\b[^>]*>/gi, "");
  // Incompletos / stream cortado
  out = visibleNarrationText(out);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function isToolProtocolText(text) {
  const t = String(text || "").trimStart();
  if (!t) return false;
  if (TOOL_MARKUP_START_RE.test(t)) return true;
  if (/^(?:\{|\[)/.test(t) && /"(?:type|name|tool|function)"\s*:/.test(t)) return true;
  return false;
}

module.exports = {
  parseTextToolCalls,
  stripTextToolMarkup,
  visibleNarrationText,
  isToolProtocolText,
  normalizeToolName,
  toRelativePath,
  extraerObjetosJson,
  llamadaDesdeJson,
  ALIAS,
  TOOL_MARKUP_START_RE,
};
