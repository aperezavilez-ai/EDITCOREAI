"use strict";

/**
 * Loop LLM + tools (OpenAI-compatible tool_calls).
 * EDITCOREAI inyecta providerApi.call({ messages, tools, signal, onTextDelta }).
 * 
 * v0.4.1 - Incluye:
 *  - Acceso a internet, git, skills, shell y archivos externos.
 *  - Formato de respuesta markdown rico (encabezados, listas, código, tablas).
 *  - packEvidenceForModel con soporte de tools extendidas.
 */

function toolDefsForMode(mode = "explain", allowWrite = false) {
  const readTools = [
    // ============ TOOLS NATIVAS DEL PROYECTO ============
    {
      type: "function",
      function: {
        name: "list_files",
        description: "Lista archivos/carpetas del proyecto (path relativo).",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Lee un archivo de texto del proyecto.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            startLine: { type: "integer" },
            endLine: { type: "integer" },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_files",
        description: "Busca texto en el proyecto.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            path: { type: "string" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },

    // ============ INTERNET ============
    {
      type: "function",
      function: {
        name: "web_search",
        description: "Busca informacion actualizada en internet (documentacion, errores, librerias, APIs). Usa esto cuando necesites datos fuera del proyecto.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Consulta de busqueda" },
            maxResults: { type: "integer", description: "Maximo de resultados (1-10)" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "web_fetch",
        description: "Descarga y lee el contenido completo de una URL (documentacion, README, articulos).",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL completa a leer" },
            maxChars: { type: "integer", description: "Maximo de caracteres a devolver" },
          },
          required: ["url"],
          additionalProperties: false,
        },
      },
    },

    // ============ GIT ============
    {
      type: "function",
      function: {
        name: "git_clone",
        description: "Clona un repositorio Git de GitHub/GitLab en una ruta local.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            targetDir: { type: "string" },
            depth: { type: "integer" },
          },
          required: ["url", "targetDir"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_log",
        description: "Muestra el historial de commits de un repositorio local.",
        parameters: {
          type: "object",
          properties: {
            repoPath: { type: "string" },
            maxCount: { type: "integer" },
          },
          required: ["repoPath"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_status",
        description: "Muestra el estado actual de un repositorio Git (archivos modificados, staged, untracked).",
        parameters: {
          type: "object",
          properties: { repoPath: { type: "string" } },
          required: ["repoPath"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_diff",
        description: "Muestra las diferencias de un repositorio Git.",
        parameters: {
          type: "object",
          properties: {
            repoPath: { type: "string" },
            staged: { type: "boolean" },
          },
          required: ["repoPath"],
          additionalProperties: false,
        },
      },
    },

    // ============ ACCESO EXTERNO ============
    {
      type: "function",
      function: {
        name: "read_external_file",
        description: "Lee un archivo de CUALQUIER ubicacion autorizada de tu equipo (fuera del proyecto).",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Ruta absoluta del archivo" },
          },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_external_file",
        description: "Escribe o modifica un archivo en CUALQUIER ubicacion autorizada de tu equipo.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_external_directory",
        description: "Lista archivos de una carpeta externa al proyecto (en rutas autorizadas).",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },

    // ============ SKILLS ============
    {
      type: "function",
      function: {
        name: "install_skill",
        description: "Instala una nueva skill (habilidad) desde un repositorio de GitHub en la carpeta skills/.",
        parameters: {
          type: "object",
          properties: {
            repoUrl: { type: "string" },
            skillName: { type: "string" },
          },
          required: ["repoUrl", "skillName"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_skills",
        description: "Lista todas las skills instaladas actualmente en el sistema.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },

    // ============ SHELL ============
    {
      type: "function",
      function: {
        name: "run_shell",
        description: "Ejecuta un comando de shell en PowerShell. Util para: npm install, git, python, node, compiladores, etc.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string" },
            cwd: { type: "string" },
          },
          required: ["command"],
          additionalProperties: false,
        },
      },
    },
  ];

  if ((mode === "execute" || allowWrite) && mode !== "diagnose" && mode !== "list") {
    readTools.push(
      {
        type: "function",
        function: {
          name: "replace_in_file",
          description: "Reemplaza oldText por newText en un archivo (mutacion real).",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["path", "oldText", "newText"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "write_file",
          description: "Crea archivo nuevo (no usar para *-fixed.js ni placeholders).",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "delete_file",
          description: "Borra un archivo del proyecto (no carpetas). Usa solo si el usuario lo pide.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
            },
            required: ["path"],
            additionalProperties: false,
          },
        },
      },
      {
        type: "function",
        function: {
          name: "run_command",
          description: "Ejecuta un comando de verificacion en el proyecto (npm test, node --test, lint, etc.).",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
            additionalProperties: false,
          },
        },
      },
    );
  }
  return readTools;
}

/**
 * v0.4.1 — System prompt con reglas estrictas de FORMATO MARKDOWN.
 * El agente debe responder como un chat moderno (títulos, listas, código, tablas).
 */
function systemPromptForMode(mode, allowWrite, opts = {}) {
  let elite = null;
  try {
    elite = require("../runtime/elite-communication-policy");
  } catch {
    try {
      elite = require("../../runtime/elite-communication-policy");
    } catch {
      elite = null;
    }
  }
  const wrap = elite?.withEliteCommunicationPolicy
    || ((s) => s);
  const fullAccess = opts.fullAccess === true || (allowWrite && opts.permissionMode === "full");

  const base = [
    "Eres EDITCOREAI Agent Core v0.4 — operador con tools avanzadas. Responde SIEMPRE en espanol.",
    "",
    "=== REGLAS DE FORMATO OBLIGATORIO (MARKDOWN RICO) ===",
    "TODAS tus respuestas al usuario DEBEN estar formateadas en Markdown enriquecido, igual que un chat moderno (ChatGPT, Claude, Cursor).",
    "",
    "ESTRUCTURA OBLIGATORIA de cada respuesta:",
    "1. **Título** en `##` para secciones principales (nunca uses # salvo para el título global).",
    "2. **Negritas** (`**texto**`) para palabras clave, nombres de archivos, herramientas y conceptos importantes.",
    "3. **Listas con viñetas** (`- item`) para enumerar cosas, pasos o hallazgos.",
    "4. **Listas numeradas** (`1. paso`) para secuencias de acciones.",
    "5. **Bloques de código** con triple backtick y lenguaje (```javascript, ```bash, ```json) para TODO código, comando o resultado técnico.",
    "6. **Código inline** con backticks simples (`archivo.js`, `npm install`) para nombres de archivos, funciones, variables y comandos cortos.",
    "7. **Tablas** (`| Col | Col |`) cuando compares opciones, listes archivos con metadatos o muestres datos estructurados.",
    "8. **Citas** (`> texto`) para advertencias, notas importantes o resúmenes destacados.",
    "9. **Separadores** (`---`) para dividir secciones largas.",
    "10. **Emojis moderados** (✅ ❌ ⚠️ 🎯 📁 🚀 🔍) SOLO para marcar estado o categoría, nunca en exceso.",
    "",
    "REGLAS DE ESTILO:",
    "- NUNCA respondas con un párrafo monolítico. Divide en secciones.",
    "- NUNCA uses texto plano sin estructura cuando hay más de 2 ideas.",
    "- SIEMPRE deja una línea en blanco entre secciones para respiración visual.",
    "- Los paths de archivos van en `backticks` y con formato consistente.",
    "- Los resultados de tools (búsquedas, listados, comandos) van dentro de bloques de código o tablas.",
    "",
    "EJEMPLO DE RESPUESTA CORRECTA:",
    "```markdown",
    "## 🔍 Búsqueda completada",
    "",
    "Encontré **3 resultados** relevantes para tu consulta:",
    "",
    "| # | Fuente | Título |",
    "|---|--------|--------|",
    "| 1 | Wikipedia | Node.js |",
    "| 2 | GitHub | electron/electron |",
    "| 3 | npm | latest versions |",
    "",
    "### 📁 Archivos encontrados",
    "",
    "En `D:\\PROGRAMAS IA` hay **4 carpetas**:",
    "",
    "- `EDITCOREAI/` — tu proyecto principal",
    "- `old-backup/` — respaldo antiguo",
    "",
    "> 💡 **Siguiente paso sugerido:** ¿Quieres que analice la carpeta `EDITCOREAI/`?",
    "```",
    "",
    "=== FIN DE REGLAS DE FORMATO ===",
    "",
    "=== REGLAS DE COMPORTAMIENTO ===",
    "Hechos del proyecto SOLO salen de TOOL_RESULT. Si no hay result, el hecho no existe.",
    "Protocolo de orden: ANALIZA (breve) → ANUNCIA → EJECUTA tools ahora → REPORTE final con hechos de TOOL_RESULT.",
    "Maximo 3 tool_calls por turno. Observa el result antes de la siguiente oleada.",
    "PROHIBIDO narrar 'ya lei / ya escribi / ya verifique' sin tool_calls en ESTE mensaje.",
    "PROHIBIDO inventar lecturas/escrituras. Usa tool_calls reales.",
    "PROHIBIDO cerrar con 'Verificacion completada con evidencia real'.",
    "PROHIBIDO crear *-fixed.js o placeholders.",
    "MAPA COGNITIVO: usa list_files('.') / rutas reales. PROHIBIDO asumir src/ o app/ si no existen.",
    "OODA: si replace_in_file falla por oldText, relee el archivo y reintenta.",
    "",
    "=== CAPACIDADES AVANZADAS (v0.4) ===",
    "ACCESO A INTERNET: `web_search(query)` para buscar, `web_fetch(url)` para leer URLs completas.",
    "GIT AVANZADO: `git_clone`, `git_log`, `git_status`, `git_diff`.",
    "ACCESO EXTERNO: `read_external_file`, `write_external_file`, `list_external_directory` (respetando config.json).",
    "SKILLS: `install_skill(repoUrl, skillName)`, `list_skills()`.",
    "SHELL: `run_shell(command, cwd)` para npm install, pip, git, python, etc.",
    "",
    "REGLAS DE USO DE TOOLS:",
    "1. Info actualizada o externa → `web_search` PRIMERO.",
    "2. Repositorio externo → `git_clone` + `list_files`/`read_file`.",
    "3. Instalar libreria → `run_shell` con npm/pip install.",
    "4. Funcionalidad nueva → `install_skill` o `web_search`.",
  ];

  if (fullAccess || (allowWrite && mode === "execute")) {
    base.push(
      "MODO ACCESO COMPLETO / EJECUCION AUTORIZADA:",
      "PROHIBIDO detenerte o devolver solo texto diciendo 'Voy a buscar...'. DEBES invocar la tool EN ESTE MISMO MENSAJE.",
      "PROHIBIDO preguntar: '¿Deseas que proceda?', 'Confirma para aplicar los cambios.', '¿Procedo?'.",
      "NO esperes confirmacion del usuario. Ejecuta YA write_file / replace_in_file / run_command / run_shell / install_skill.",
    );
  }
  if (mode === "diagnose") {
    base.push(
      "MODO DIAGNOSTICO (solo lectura): list_files/read_file/search_files/web_search/web_fetch/git_log/git_status.",
      "Formato obligatorio de informe:",
      "## Qué sí funcionó",
      "## Qué falló / hallazgos",
      "## Evidencia",
      "## Cómo lo corregiré",
      "Si no hay defectos reales, dilo. No inventes TODOs.",
    );
  } else if (mode === "execute") {
    base.push(
      "MODO EJECUCION: el usuario autorizo cambios.",
      "EJECUCION DIRECTA: no te detengas tras narrar. Invoca la herramienta correspondiente en este turno.",
      "No esperes oldText del usuario: lee el archivo con read_file y construye replace_in_file con oldText EXACTO.",
      "AL FINALIZAR, usa este formato:",
      "## ✅ Resultado",
      "## 📝 Cambios aplicados",
      "## 🎯 Siguiente paso sugerido",
    );
  } else if (mode === "list" || mode === "explain") {
    base.push(
      "Lista carpetas con list_files (solo rutas reales) y explica archivos con read_file.",
      "Formato obligatorio:",
      "## 📁 Contenido",
      "## 🔍 Explicación",
      "## 💡 Recomendación",
    );
  }
  if (!allowWrite || mode === "diagnose") {
    base.push("PROHIBIDO write_file/replace_in_file/delete_file/write_external_file en esta corrida.");
  }
  const unavailable = Array.isArray(opts.unavailableTools) ? opts.unavailableTools.filter(Boolean) : [];
  if (unavailable.length) {
    base.push(
      `HERRAMIENTAS NO DISPONIBLES EN ESTA CORRIDA: ${unavailable.join(", ")} (no se cargó el módulo de herramientas extendidas).`,
      "No las llames ni prometas usarlas: trabaja con las tools del proyecto y dile al usuario qué capacidad falta y por qué.",
    );
  }
  return wrap(base.join("\n"));
}

function parseToolCalls(response = {}) {
  const calls = [];
  const raw = response.tool_calls || response.toolCalls || response.rawToolCalls || [];
  if (Array.isArray(raw)) {
    for (const call of raw) {
      const name = call?.function?.name || call?.name || "";
      let args = call?.function?.arguments || call?.arguments || {};
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      if (name) {
        calls.push({
          id: call.id || `call_${calls.length}`,
          name,
          input: args && typeof args === "object" ? args : {},
        });
      }
    }
  }
  return calls;
}

function extractAssistantText(response = {}) {
  if (typeof response.text === "string" && response.text.trim()) return response.text.trim();
  if (typeof response.content === "string" && response.content.trim()) return response.content.trim();
  if (Array.isArray(response.content)) {
    return response.content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("").trim();
  }
  if (typeof response.message?.content === "string") return response.message.content.trim();
  return "";
}

function extractEvidenceKeywords(prompt = "", filePath = "") {
  const keys = new Set();
  const text = `${prompt}\n${filePath}`;
  for (const m of text.matchAll(/\b([A-Za-z_][\w]{3,})\b/g)) {
    const w = m[1];
    if (/^(resources|runtime|src|app|file|path|modo|diagn|audita|solo|estos|archivos)$/i.test(w)) continue;
    keys.add(w);
  }
  for (const k of [
    "tryRunAgentCore", "isAgentCoreEnabled", "loadAgentCore", "resolveCoreRoot",
    "runAgent", "planTask", "CORE_VERSION", "agent-core-bridge",
  ]) keys.add(k);
  return [...keys].slice(0, 40);
}

function sliceRelevantContent(content = "", keywords = [], headChars = 4500, windowChars = 2200) {
  const raw = String(content || "");
  if (raw.length <= headChars + 500) {
    return { text: raw, truncated: false, totalChars: raw.length };
  }
  const lower = raw.toLowerCase();
  const seen = new Set();
  const takeMatches = (keys, maxHitsPerKey = 2) => {
    const parts = [];
    for (const key of keys) {
      const needle = String(key || "").toLowerCase();
      if (!needle || needle.length < 4) continue;
      let from = 0;
      let hits = 0;
      while (hits < maxHitsPerKey && from < raw.length) {
        const idx = lower.indexOf(needle, from);
        if (idx < 0) break;
        const start = Math.max(0, idx - 220);
        const end = Math.min(raw.length, idx + needle.length + windowChars);
        const stamp = `${start}:${end}`;
        if (!seen.has(stamp)) {
          seen.add(stamp);
          parts.push({ label: `MATCH ${key} @${idx}`, text: raw.slice(start, end) });
          hits += 1;
        }
        from = idx + needle.length;
      }
    }
    return parts;
  };
  const priorityKeys = [
    "tryRunAgentCore(", "tryRunAgentCore", "isAgentCoreEnabled(",
    "isAgentCoreEnabled", "useCore", "Agent Core (motor",
  ];
  const priorityParts = takeMatches(priorityKeys, 2);
  const headPart = { label: "HEAD", text: raw.slice(0, headChars) };
  const otherKeys = keywords.filter((k) => !priorityKeys.some((p) => p.toLowerCase().includes(String(k).toLowerCase())));
  const otherParts = takeMatches(otherKeys, 1);
  const tailPart = { label: "TAIL", text: raw.slice(-1200) };
  const parts = [...priorityParts, headPart, ...otherParts, tailPart];
  const text = parts.map((p) => `<<<${p.label}>>>\n${p.text}`).join("\n\n");
  return { text, truncated: true, totalChars: raw.length };
}

/**
 * v0.4.1 — Empaqueta evidencia para el modelo, INCLUYENDO tools extendidas.
 */
function packEvidenceForModel(steps = [], options = {}) {
  const maxChars = Number(options.maxChars) || 24000;
  const prompt = String(options.prompt || "");
  const chunks = [];
  const truncatedPaths = [];
  const fileMeta = [];
  let used = 0;

  let { mergeReadStepsByPath } = (() => {
    try {
      return require("./verifier");
    } catch {
      return {};
    }
  })();

  const listSteps = steps.filter((s) => s?.ok && s.name === "list_files");
  const readSteps = typeof mergeReadStepsByPath === "function"
    ? mergeReadStepsByPath(steps)
    : steps.filter((s) => s?.ok && s.name === "read_file");

  const EXT_NAMES = [
    "web_search", "web_fetch", "git_clone", "git_log", "git_status", "git_diff",
    "read_external_file", "list_external_directory",
    "install_skill", "list_skills", "run_shell",
  ];
  const extSteps = steps.filter((s) => s?.ok && EXT_NAMES.includes(s.name));

  // 1) LIST steps
  for (const step of listSteps) {
    const entries = Array.isArray(step.result)
      ? step.result
      : (step.result?.entries || []);
    const names = entries.slice(0, 120).map((e) => e?.name || e?.path || "").filter(Boolean);
    const block = `LIST ${step.input?.path || "."}\n${names.join("\n")}`;
    if (used + block.length > maxChars) break;
    chunks.push(block);
    used += block.length;
  }

  // 2) READ steps
  readSteps.sort((a, b) => {
    const ap = String(a.result?.path || "").toLowerCase();
    const bp = String(b.result?.path || "").toLowerCase();
    const aMain = /main\.js$/.test(ap) ? 1 : 0;
    const bMain = /main\.js$/.test(bp) ? 1 : 0;
    if (aMain !== bMain) return aMain - bMain;
    return String(a.result?.content || "").length - String(b.result?.content || "").length;
  });

  for (const step of readSteps) {
    const p = String(step.result?.path || step.input?.path || "").replace(/\\/g, "/");
    const full = String(step.result?.content || "");
    const toolTruncated = step.result?.truncated === true
      || step.result?.partial === true
      || (Array.isArray(step.result?.windows) && step.result.windows.length > 1);

    const keywords = extractEvidenceKeywords(prompt, p);
    const packed = sliceRelevantContent(full, keywords);
    const budgetLeft = Math.max(2500, maxChars - used - 400);
    let body = packed.text;
    let packTruncated = packed.truncated;
    if (body.length > budgetLeft) {
      body = `${body.slice(0, budgetLeft)}\n<<<CORTE_PRESUPUESTO>>>`;
      packTruncated = true;
    }

    const flags = [];
    if (toolTruncated) flags.push("TOOL_PARTIAL_READ");
    if (packTruncated) flags.push("PACK_TRUNCATED_FOR_MODEL");
    if (flags.length) truncatedPaths.push(p);

    const header = [
      `FILE ${p}`,
      `BYTES_IN_TOOL_RESULT=${full.length}`,
      flags.length
        ? `AVISO: ${flags.join(", ")} — NO significa que el archivo en disco esté incompleto.`
        : "AVISO: evidencia completa.",
    ].filter(Boolean).join("\n");

    const block = `${header}\n\n${body}`;
    if (used + Math.min(block.length, 400) > maxChars && chunks.length) break;
    const clipped = block.slice(0, Math.max(0, maxChars - used));
    chunks.push(clipped);
    used += clipped.length;
    fileMeta.push({ path: p, bytes: full.length, truncatedForModel: packTruncated || toolTruncated });
  }

  // 3) EXTENDED TOOLS (v0.4.1)
  for (const step of extSteps) {
    const name = step.name;
    let block = "";

    if (name === "web_search") {
      const q = step.input?.query || "";
      const src = step.result?.source || "n/a";
      const results = Array.isArray(step.result?.results) ? step.result.results : [];
      block = `WEB_SEARCH "${q}" (fuente: ${src}, ${results.length} resultados)\n\n`;
      block += results.map((r, i) =>
        `[${i + 1}] ${r.title}\n    ${r.snippet}\n    ${r.url}`
      ).join("\n\n");
    } else if (name === "web_fetch") {
      const u = step.input?.url || "";
      block = `WEB_FETCH ${u}\n\n${String(step.result?.content || "").slice(0, 6000)}`;
    } else if (name === "read_external_file") {
      const p = String(step.result?.path || step.input?.path || "").replace(/\\/g, "/");
      const content = String(step.result?.content || "");
      block = `EXTERNAL_FILE ${p}\n\n${content.slice(0, 6000)}`;
    } else if (name === "list_external_directory") {
      const p = String(step.result?.path || step.input?.path || "").replace(/\\/g, "/");
      const entries = Array.isArray(step.result?.entries) ? step.result.entries : [];
      block = `EXTERNAL_DIR ${p} (${entries.length} entradas)\n\n${entries.slice(0, 80).map((e) => e.name).join("\n")}`;
    } else if (name === "git_log") {
      const commits = Array.isArray(step.result?.commits) ? step.result.commits : [];
      block = `GIT_LOG ${step.input?.repoPath}\n\n${commits.map((c) => `${c.hash} ${c.author} ${c.message}`).join("\n")}`;
    } else if (name === "git_status") {
      block = `GIT_STATUS ${step.input?.repoPath}\nBranch: ${step.result?.branch}\nModified: ${(step.result?.modified || []).join(", ")}\nUntracked: ${(step.result?.not_added || []).join(", ")}`;
    } else if (name === "git_diff") {
      block = `GIT_DIFF ${step.input?.repoPath}\n\n${String(step.result?.diff || "").slice(0, 4000)}`;
    } else if (name === "git_clone") {
      block = `GIT_CLONE ${step.input?.url} → ${step.input?.targetDir}`;
    } else if (name === "run_shell") {
      block = `RUN_SHELL: ${step.input?.command}\n\n${String(step.result?.stdout || "").slice(0, 4000)}`;
    } else if (name === "install_skill") {
      block = `INSTALL_SKILL "${step.input?.skillName}" desde ${step.input?.repoUrl}`;
    } else if (name === "list_skills") {
      block = `LIST_SKILLS (${step.result?.count || 0} instaladas)`;
    }

    if (!block.trim()) continue;
    if (used + block.length > maxChars) {
      block = block.slice(0, maxChars - used) + "\n<<<CORTE_PRESUPUESTO>>>";
    }
    chunks.push(block);
    used += block.length;
    if (used >= maxChars) break;
  }

  return {
    text: chunks.join("\n\n---\n\n"),
    truncatedPaths: [...new Set(truncatedPaths)],
    fileMeta,
  };
}

async function synthesizeFromEvidence(input = {}, options = {}) {
  const mode = options.mode || "diagnose";
  const seedSteps = options.seedSteps || [];
  if (!input.providerApi?.call) {
    return { finalText: "", providerCalls: 0, skipped: true };
  }

  const packed = packEvidenceForModel(seedSteps, {
    prompt: input.prompt || "",
    maxChars: mode === "diagnose" ? 32000 : 18000,
  });
  const evidence = packed.text;
  if (!evidence.trim()) {
    return { finalText: "", providerCalls: 0, skipped: true };
  }

  input.onProgress?.({ phase: "model", text: "Agent Core · sintetizando con el modelo (evidencia real)..." });

  const system = [
    "Eres EDITCOREAI Agent Core. Responde SIEMPRE en espanol.",
    "",
    "=== FORMATO OBLIGATORIO ===",
    "Tu respuesta DEBE estar formateada en MARKDOWN RICO, igual que un chat moderno.",
    "Usa:",
    "- **Negritas** para conceptos clave y nombres de archivos.",
    "- `codigo inline` para paths, comandos y variables.",
    "- Bloques ```lenguaje para codigo o resultados tecnicos.",
    "- Tablas `| Col | Col |` para comparaciones o listados estructurados.",
    "- Listas con `-` o `1.` segun corresponda.",
    "- Titulos `##` por seccion, `###` para subsecciones.",
    "- Citas `> ` para advertencias o notas destacadas.",
    "- Emojis moderados (✅ ❌ ⚠️ 🎯 📁 🔍 🚀) para marcar categorias.",
    "NUNCA respondas con parrafos monoliticos sin estructura.",
    "",
    "=== REGLAS DE CONTENIDO ===",
    "Te doy EVIDENCIA REAL ya leida con tools. NO pidas ni inventes mas tools.",
    "PROHIBIDO mencionar view_file, edit_file, file_reader, codebase_search.",
    "PROHIBIDO inventar rutas o fallos que no esten en la evidencia.",
    "PROHIBIDO 'Verificacion completada con evidencia real'.",
    "Si un FILE tiene AVISO PACK_TRUNCATED_FOR_MODEL: el archivo en disco NO esta roto.",
    "Solo reporta defectos si ves una sentencia completa claramente incorrecta.",
    "Si falta contexto por truncado, dilo como limitacion de evidencia.",
    "",
    mode === "diagnose"
      ? "Formato del informe: ## Que si funciono | ## Resumen por archivo | ## Que fallo / hallazgos | ## Evidencia | ## Como lo corregire"
      : "Explica con claridad basandote solo en la evidencia.",
  ].join("\n");

  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        `PROYECTO: ${input.projectRoot || ""}`,
        `MODO: ${mode}`,
        packed.truncatedPaths.length
          ? `ARCHIVOS CON EVIDENCIA ACORTADA PARA EL MODELO (no implica archivo roto): ${packed.truncatedPaths.join(", ")}`
          : "Ningun archivo fue acortado por empaquetado.",
        "",
        "SOLICITUD DEL USUARIO:",
        String(input.prompt || ""),
        "",
        "EVIDENCIA REAL (unica fuente permitida):",
        evidence,
        "",
        "Escribe el informe ahora con formato Markdown rico. Solo sobre esta evidencia.",
      ].join("\n"),
    },
  ];

  try {
    const response = await input.providerApi.call({
      messages,
      tools: [],
      enableTools: false,
      signal: input.signal,
      onTextDelta: (delta) => {
        if (!delta) return;
        input.onProgress?.({ phase: "narration_delta", text: String(delta) });
      },
    });
    const finalText = extractAssistantText(response);
    const toolCalls = parseToolCalls(response);
    return {
      finalText: finalText || "",
      providerCalls: 1,
      skipped: false,
      truncatedPaths: packed.truncatedPaths,
      fileMeta: packed.fileMeta,
      synthRejectedToolCalls: !finalText && toolCalls.length > 0,
    };
  } catch (error) {
    return {
      finalText: "",
      providerCalls: 1,
      skipped: false,
      error: String(error?.message || error),
      truncatedPaths: packed.truncatedPaths,
      fileMeta: packed.fileMeta,
    };
  }
}

async function runLlmToolLoop(input = {}, options = {}) {
  const {
    mode = "explain",
    allowWrite = false,
    seedSteps = [],
    maxIterations = 16,
    repairHint = "",
  } = options;

  if (!input.providerApi?.call) {
    return { steps: [...seedSteps], finalText: "", providerCalls: 0, skipped: true };
  }

  const tools = input.tools;
  const steps = [...seedSteps];
  let providerCalls = 0;
  const messages = [
    {
      role: "system",
      content: systemPromptForMode(mode, allowWrite, {
        fullAccess: input.fullAccess === true || input.permissionMode === "full" || input.permissionFull === true,
        permissionMode: input.permissionMode,
        unavailableTools: input.unavailableTools,
      }),
    },
    {
      role: "user",
      content: [
        `PROYECTO: ${input.projectRoot || ""}`,
        `MODO: ${mode}`,
        `PERMISO ESCRITURA: ${allowWrite && mode !== "diagnose" ? "si" : "no"}`,
        (input.fullAccess || input.permissionMode === "full") ? "ACCESO COMPLETO: si (ejecuta sin pedir procede)" : "",
        "",
        "SOLICITUD:",
        String(input.prompt || ""),
        repairHint ? `\nREPARACION REQUERIDA:\n${repairHint}` : "",
        "",
        seedSteps.length
          ? `EVIDENCIA YA OBTENIDA (${seedSteps.filter((s) => s.ok).length} tools OK). Continua desde ahi.`
          : "Empieza con tools si hace falta.",
        "",
        "RECUERDA: tu respuesta final debe estar en Markdown rico (titulos ##, listas, bloques de codigo, tablas, negritas).",
      ].filter(Boolean).join("\n"),
    },
  ];

  const toolSchemas = toolDefsForMode(mode, allowWrite && mode !== "diagnose");
  let finalText = "";
  let promiseRetries = 0;

  const claimsUnverifiedAction = (text = "") => {
    const raw = String(text || "");
    return /(?:voy\s+a|ahora\s+(?:leo|reviso|escribo|creo)|he\s+(?:le[ií]do|escrito|creado|verificado)|dejame\s+(?:leer|revisar))/i.test(raw);
  };

  for (let i = 0; i < maxIterations; i += 1) {
    if (input.signal?.aborted) break;
    input.onProgress?.({ phase: "model", text: `Agent Core · modelo (${i + 1}/${maxIterations})...` });

    let response;
    try {
      providerCalls += 1;
      response = await input.providerApi.call({
        messages,
        tools: toolSchemas,
        signal: input.signal,
        onTextDelta: (delta) => {
          if (!delta) return;
          input.onProgress?.({ phase: "narration_delta", text: String(delta) });
        },
      });
    } catch (error) {
      steps.push({
        name: "provider_call",
        ok: false,
        error: String(error?.message || error),
        index: steps.length,
      });
      break;
    }

    let toolCalls = parseToolCalls(response);
    const text = extractAssistantText(response);
    if (text) finalText = text;

    if (!toolCalls.length) {
      if (claimsUnverifiedAction(text) && promiseRetries < 3 && i < maxIterations - 1) {
        promiseRetries += 1;
        messages.push({ role: "assistant", content: text || "(sin texto)" });
        messages.push({
          role: "user",
          content: "No cierres. Acabas de afirmar una accion sin tool_calls. Llama ahora UNA tool real. Sin TOOL_RESULT esa accion no ocurrio.",
        });
        input.onProgress?.({ phase: "model", text: `Reintento: accion narrada sin tool (${promiseRetries}/3)` });
        continue;
      }
      messages.push({ role: "assistant", content: text || "(sin texto)" });
      break;
    }

    if (toolCalls.length > 3) toolCalls = toolCalls.slice(0, 3);

    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.input || {}) },
      })),
    });

    for (const call of toolCalls) {
      if (input.signal?.aborted) break;
      if ((call.name === "write_file" || call.name === "replace_in_file" || call.name === "delete_file" || call.name === "write_external_file")
        && (mode === "diagnose" || !allowWrite)) {
        const err = "Escritura bloqueada en este modo.";
        steps.push({ name: call.name, input: call.input, ok: false, error: err, index: steps.length });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: err }) });
        continue;
      }
      if (call.name === "write_file" && /(?:^|\/)[\w.-]*-fixed\.js$/i.test(String(call.input?.path || ""))) {
        const err = "Bloqueado: no se permiten *-fixed.js.";
        steps.push({ name: call.name, input: call.input, ok: false, error: err, index: steps.length });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: err }) });
        continue;
      }

      input.onProgress?.({
        phase: "tool",
        stage: "running",
        name: call.name,
        input: call.input,
        index: steps.length,
      });
      try {
        const result = await tools.execute(call.name, call.input || {});
        const softFail = result && result.ok === false
          && (/oldText|No existe|ENOENT|not a git repository/i.test(String(result.error || result.stderr || ""))
            || result.soft === true);
        let enriched = result;
        if (softFail && call.name === "replace_in_file" && call.input?.path) {
          try {
            const readBack = await tools.execute("read_file", { path: call.input.path });
            enriched = {
              ...result,
              soft: true,
              ooda: "continue",
              guidance: "Fallo leve oldText. Usa autoRead y reintenta replace_in_file.",
              autoRead: readBack,
            };
          } catch {
            enriched = { ...result, soft: true, ooda: "continue" };
          }
        }
        const step = {
          name: call.name,
          input: call.input || {},
          result: enriched,
          ok: result?.ok !== false,
          soft: softFail || undefined,
          index: steps.length,
        };
        steps.push(step);
        input.onProgress?.({
          phase: "tool",
          stage: softFail ? "soft-fail" : "done",
          name: call.name,
          input: call.input,
          result: enriched,
          ok: step.ok,
          index: steps.length - 1,
        });
        const compact = typeof enriched === "string"
          ? enriched.slice(0, 6000)
          : JSON.stringify(enriched).slice(0, 6000);
        messages.push({ role: "tool", tool_call_id: call.id, content: compact });
      } catch (error) {
        const msg = String(error?.message || error);
        const soft = /oldText|ENOENT|No existe|not a git repository|git:\s*command/i.test(msg);
        steps.push({
          name: call.name,
          input: call.input || {},
          ok: false,
          soft: soft || undefined,
          error: msg,
          index: steps.length,
        });
        input.onProgress?.({
          phase: "tool",
          stage: soft ? "soft-fail" : "failed",
          name: call.name,
          input: call.input,
          ok: false,
          index: steps.length - 1,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: msg,
            soft: soft || undefined,
            ooda: soft ? "continue" : undefined,
          }),
        });
      }
    }

    messages.push({
      role: "user",
      content: "TOOL_RESULT ya esta en el hilo. Proximo turno: usa SOLO esos facts. Entrega la respuesta final con formato Markdown rico (titulos ##, listas, bloques de codigo, negritas).",
    });
  }

  return { steps, finalText, providerCalls, skipped: false };
}

module.exports = {
  runLlmToolLoop,
  synthesizeFromEvidence,
  packEvidenceForModel,
  sliceRelevantContent,
  extractEvidenceKeywords,
  toolDefsForMode,
  systemPromptForMode,
  parseToolCalls,
  extractAssistantText,
};