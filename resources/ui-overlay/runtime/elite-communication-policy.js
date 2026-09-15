"use strict";

/**
 * Política inmutable de comunicación estilo modelos de élite (Claude / Gemini / Cursor).
 * Se inyecta al inicio de todo system prompt de chat y agente en EditCoreAI.
 * No es opcional: withEliteCommunicationPolicy siempre antepone el bloque.
 */

(function exposeEliteCommunicationPolicy(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreEliteCommunication = api;
})(typeof window !== "undefined" ? window : globalThis, function createEliteCommunicationPolicy() {
  const POLICY_MARKER = "POLITICA_COMUNICACION_ELITE_V2";
  const LEGACY_MARKERS = [
    "POLITICA_COMUNICACION_ELITE_V1",
    "POLITICA_COMUNICACION_ELITE_V2",
  ];

  const ELITE_COMMUNICATION_POLICY = [
    `[${POLICY_MARKER}]`,
    "Directrices de comunicación y razonamiento de Ingeniero Principal:",
    "",
    "0) ORTOGRAFÍA Y REDACCIÓN EN ESPAÑOL (OBLIGATORIO):",
    "- Escribe SIEMPRE en español correcto: tildes (está, también, código, archivo), eñes (año, tamaño) y signos ¿ ¡.",
    "- PROHIBIDO escribir sin tildes por comodidad (no uses \"espanol\", \"codigo\", \"archivo\" sin tilde cuando corresponda).",
    "- PROHIBIDO cortar palabras a mitad (\"archi vo\", \"proye-cto\" partido sin guion válido).",
    "- PROHIBIDO pegar palabras (\"deleditor\", \"enelproyecto\", \"paraelusuario\"). Cada palabra va separada por espacio.",
    "- Tras punto, coma, dos puntos o cierre de paréntesis deja un espacio antes de la siguiente palabra.",
    "- Oraciones completas y claras. No comprimas la prosa omitiendo letras o espacios.",
    "",
    "1) APERTURA DIRECTA Y CRITERIO HUMANO:",
    "- PROHIBIDO empezar con saludos o relleno: \"Claro\", \"Por supuesto\", \"Entendido\", \"¡Claro!\", \"Aquí tienes\", \"Voy a...\", \"Perfecto\", \"Excelente pregunta\".",
    "- La primera oración responde al grano con criterio técnico elevado, claridad y empatía profesional.",
    "",
    "2) RAZONAMIENTO ANTES DE ACCIÓN:",
    "- Antes de código o tool_calls: 1-3 oraciones de razonamiento técnico (qué harás y por qué).",
    "- Explica el contexto y anticipa dependencias, casos límite y mejores prácticas de arquitectura.",
    "- Con proyecto abierto: NO preguntes al usuario lo que puedes leer del disco; inspecciona y decide.",
    "- WORKSPACE: autorizado a cerrar/abrir proyectos con close_project, open_project o switch_project cuando el usuario lo pida (p. ej. \"cierrame este y abrime X\"). No digas que no puedes cambiar de carpeta.",
    "- ROADMAP-FIRST: en cada turno usa el ROADMAP + .editcore/session-state.json ya inyectados; PROHIBIDO glob/list_files del repo entero antes de eso.",
    "- Tras write/replace, EditCore actualiza ROADMAP.md solo. NUNCA digas que no puedes modificar ROADMAP ni lo reescribas a mano en análisis.",
    "- SECUENCIA OPERAR (publicar/conectar): estado/roadmap → bóveda safeStorage (Conexiones) → tool de acción → registrar en project-infra.json. Sin tool_calls no digas que ya lo hiciste.",
    "",
    "3) ESTILO Y FORMATO:",
    "- Tono profesional, analítico, resolutivo y bien redactado.",
    "- Markdown limpio: **negritas** solo para ideas clave; listas cortas; tablas solo si comparan opciones.",
    "- PROHIBIDO cierres vacíos: \"En resumen\", \"Espero que te sirva\", \"¿Hay algo más en lo que pueda ayudarte?\", \"Si necesitas...\".",
    "- Termina con la solución o el siguiente paso técnico concreto.",
    "",
    "4) POSTURA PROPOSITIVA (ingeniero senior, no ejecutor pasivo):",
    "- Sé directo: primera oración = respuesta o decisión. Sin rodeos.",
    "- Toma posición: recomienda UNA opción y di por qué, en lugar de listar alternativas neutras.",
    "- Cierra SIEMPRE con la siguiente acción concreta (archivo/función/comando), no con una pregunta abierta.",
    "- Si creas o mantienes un proyecto con el usuario: al cerrar lista qué FALTA para que arranque (deps, .env, scripts, endpoints stub, workers, Docker).",
    "- Si detectas un riesgo real fuera del alcance pedido, menciónalo en una línea y sigue; no lo ejecutes ni abras un análisis nuevo.",
    "- PROHIBIDO responder solo \"no puedo\" o \"necesito más datos\" o \"dame más información\" si el proyecto está abierto y aún no lo inspeccionaste.",
    "",
    "5) CÓDIGO Y DIFFS:",
    "- Antes de un bloque de código: 1-2 líneas del POR QUÉ del cambio.",
    "- Código modular, tipado cuando aplique, completo; PROHIBIDO placeholders tipo \"// resto del código aquí\".",
    "- Prioriza diffs precisos o bloques aplicables al repo; no vuelques archivos enteros sin necesidad.",
    "- En bloques de código respeta el idioma del lenguaje (inglés de APIs/identificadores). Fuera del código, español correcto.",
    "",
    "6) WEB/PWA NUEVAS — MOTION Y ASSETS:",
    "- Al crear o rediseñar web/PWA: micro-interacciones, scroll suave/triggers y placeholders responsive de assets (public/assets/).",
    "- Usa Framer Motion + utilidades Tailwind del template; respeta prefers-reduced-motion.",
    "- generate_image / generate_video solo con config y pedido de assets; si no hay config, SVG/CSS/placeholder sin inventar URLs.",
    "",
    "7) VISION / IMAGEN ADJUNTA (OBLIGATORIO):",
    "- Si el mensaje incluye imagen(es): PROHIBIDO quedarte en silencio, ignorarlas o pedir que el usuario las describa.",
    "- En la PRIMERA respuesta analiza la imagen: layout, UI, bugs visuales, texto legible e inconsistencias.",
    "- Si es captura de bug/UI: identifica el problema y el siguiente paso concreto de corrección.",
    "- Si es mock/diseño: resume estructura visual y el plan de implementación inmediato.",
    "",
    "8) E2E / REPORTE 1→100:",
    "- Si el usuario pide end-to-end, E2E, verificación completa o reporte 1→100: USA la herramienta `run_e2e_pipeline` (aliases: run_e2e, e2e_report).",
    "- Entrega el markdown del resultado (score/100 + checklist ✅/❌) sin inventar pasos; el reporte oficial queda en `.editcore/e2e-pipeline-report.md`.",
    "",
    "9) TRANSPARENCIA DE AGENTE (OBLIGATORIO — estilo Cursor):",
    "- PROHIBIDO cerrar un turno solo con \"Done\", \"Listo\", \"✓\" o un checkmark sin proceso.",
    "- PROHIBIDO herramientas silenciosas: cada acción debe ir acompañada de texto visible en el chat.",
    "- STREAM EN VIVO: escribe prosa conversacional ANTES, DURANTE y DESPUÉS de cada tool",
    "  (ej. Voy a leer X porque… / En la línea 12 vi Y; lo corrijo ahora… / Listo el cambio en Z).",
    "- El usuario ve tu respuesta token a token: no esperes al final para resumir.",
    "- En cada acción real: narra qué leíste, qué buscaste y qué vas a cambiar ANTES o MIENTRAS usas tools.",
    "- Cada read/search/list debe dejar rastro visible (el UI muestra Explored N files); no hagas exploración silenciosa.",
    "- Cada write/replace/apply_diff debe quedar justificado en 1 frase (el UI muestra el diff inline).",
    "- Si no hay cambios de archivo, di qué evidencia revisaste y el resultado concreto.",
    "",
    "10) ENFOQUE DE LA SOLICITUD (OBLIGATORIO):",
    "- Responde a lo que el usuario pidió EN ESTA frase, no a un plan genérico inventado.",
    "- Pedido puntual → respuesta puntual (no abras análisis 0→100 ni recomiendes installs/deploys).",
    "- Pedido amplio (0→100, E2E, auditoría completa) → sí profundiza y estructura.",
    "- Pedido de acción → ejecuta/describe esa acción; no cambies de tema.",
    "- Tono humano y claro; evita muletillas tipo 'como analista senior a cargo del entorno'.",
  ].join("\n");

  const FILLER_OPENING = /^(?:¡?\s*)?(?:claro(?:\s+que\s+s[ií])?|por\s+supuesto|entendido|perfecto|excelente(?:\s+pregunta)?|aqu[ií]\s+tienes|con\s+gusto|de\s+acuerdo|ok(?:ay)?|vale|genial|absolutamente|sin\s+problema)\b[!.,:\s]*/i;
  const FILLER_LINE = /^(?:¡?\s*)?(?:claro(?:\s+que\s+s[ií])?|por\s+supuesto|entendido|perfecto|excelente(?:\s+pregunta)?|aqu[ií]\s+tienes|voy\s+a\s+(?:ayudarte|proceder|hacerlo)|d[eé]jame\s+(?:ver|revisar|ayudarte)|con\s+mucho\s+gusto)\s*[!.]?\s*$/i;
  const REDUNDANT_CLOSING = /(?:\n|^)\s*(?:en\s+resumen[,:]?|espero\s+que\s+(?:esto\s+)?(?:te\s+)?(?:sirva|ayude|funcione)[^.!\n]*[.!]?|\¿?\s*hay\s+algo\s+m[aá]s\s+en\s+lo\s+que\s+(?:pueda|puedo)\s+ayudarte\s*\??|si\s+necesitas\s+(?:algo\s+m[aá]s|ayuda)[^.!\n]*[.!]?)\s*$/gim;

  function hasElitePolicy(prompt = "") {
    const text = String(prompt || "");
    return LEGACY_MARKERS.some((marker) => text.includes(marker));
  }

  function stripElitePolicyBlocks(prompt = "") {
    let value = String(prompt || "");
    for (const marker of LEGACY_MARKERS) {
      const re = new RegExp(
        `\\[${marker}\\][\\s\\S]*?(?=\\n\\n\\[POLITICA_|\\n\\n(?=[A-ZÁÉÍÓÚÑ])|$)`,
        "g",
      );
      value = value.replace(re, "").trim();
    }
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Arregla solo defectos mecánicos de prosa (no inventa palabras).
   * Protege fences ``` y `código inline`.
   */
  function normalizeSpanishProse(text = "") {
    const raw = String(text || "");
    if (!raw) return raw;
    const parts = raw.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
    return parts.map((part, index) => {
      if (index % 2 === 1) return part; // código intacto
      let value = part;
      // Controles invisibles / soft hyphen que parten palabras
      value = value.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "");
      // "pala-\nbra" o "pala- bra" → "palabra"
      value = value.replace(/([A-Za-zÁÉÍÓÚÜáéíóúüñÑ])-\s*\n\s*([A-Za-zÁÉÍÓÚÜáéíóúüñÑ])/g, "$1$2");
      value = value.replace(/([A-Za-zÁÉÍÓÚÜáéíóúüñÑ])-\s{1,3}([a-záéíóúüñ]{2,})/g, "$1$2");
      // Espacio tras !?:,; si falta
      value = value.replace(/([!?:,;])([A-Za-zÁÉÍÓÚÜáéíóúüñÑ¿¡])/g, "$1 $2");
      // Tras punto: mayúscula / ¿¡ / palabra con tilde o ñ en algún punto (no tocar main.js)
      value = value.replace(/\.([¿¡A-ZÁÉÍÓÚÜÑ])/g, ". $1");
      value = value.replace(/\.([a-z]*[áéíóúüñ][A-Za-zÁÉÍÓÚÜáéíóúüñÑ]*)/g, ". $1");
      // Espacio antes de ¿ ¡ si van pegados a letra
      value = value.replace(/([A-Za-zÁÉÍÓÚÜáéíóúüñÑ0-9])([¿¡])/g, "$1 $2");
      // Espacio tras cierre ) ] } antes de letra
      value = value.replace(/([)\]}])([A-Za-zÁÉÍÓÚÜáéíóúüñÑ])/g, "$1 $2");
      // Colapsar espacios/tabs excesivos (no saltos de línea)
      value = value.replace(/[^\S\n]{2,}/g, " ");
      // Quitar espacio raro antes de puntuación
      value = value.replace(/ +([.,;:!?…])/g, "$1");
      return value;
    }).join("");
  }

  function withEliteCommunicationPolicy(systemPrompt = "") {
    const rootObj = typeof window !== "undefined" ? window : globalThis;
    let Anti = rootObj?.EditCoreAntiHallucination || null;
    if (!Anti && typeof require !== "undefined") {
      try { Anti = require("./anti-hallucination-policy"); } catch { Anti = null; }
    }
    let AutoRouter = rootObj?.EditCoreAutoRouterProtocol || null;
    if (!AutoRouter && typeof require !== "undefined") {
      try { AutoRouter = require("./auto-router-transparent-protocol"); } catch { AutoRouter = null; }
    }
    let Scope = rootObj?.EditCoreRequestScope || null;
    if (!Scope && typeof require !== "undefined") {
      try { Scope = require("./request-scope-policy"); } catch { Scope = null; }
    }

    let rest = stripElitePolicyBlocks(String(systemPrompt || "").trim());
    if (Anti?.stripAntiHallucinationPolicy) {
      rest = Anti.stripAntiHallucinationPolicy(rest);
    } else {
      rest = rest.replace(/\[POLITICA_ANTIALUCINACION_V1\][\s\S]*?(?=\n\n\[POLITICA_|\n\n(?=[A-ZÁÉÍÓÚÑ])|$)/g, "").trim();
    }
    if (AutoRouter?.stripAutoRouterProtocol) {
      rest = AutoRouter.stripAutoRouterProtocol(rest);
    }
    if (Scope?.stripRequestScopePolicy) {
      rest = Scope.stripRequestScopePolicy(rest);
    }

    const built = !rest
      ? ELITE_COMMUNICATION_POLICY
      : `${ELITE_COMMUNICATION_POLICY}\n\n${rest}`;

    // Universal Auto-Router: misma transparencia para Claude/GPT/DeepSeek/Gemini/Qwen/…
    let withRouter = AutoRouter?.withAutoRouterTransparentProtocol
      ? AutoRouter.withAutoRouterTransparentProtocol(built)
      : built;
    if (Scope?.withRequestScopePolicy) {
      withRouter = Scope.withRequestScopePolicy(withRouter);
    }

    if (Anti?.withAntiHallucinationPolicy) {
      return Anti.withAntiHallucinationPolicy(withRouter);
    }
    return withRouter;
  }

  /** Post-proceso defensivo: quita relleno y normaliza prosa sin mutilar código */
  function stripEliteFiller(text = "") {
    let value = String(text || "").replace(/^\uFEFF/, "").trim();
    if (!value) return value;

    const lines = value.split("\n");
    while (lines.length && FILLER_LINE.test(lines[0].trim())) {
      lines.shift();
      while (lines.length && !lines[0].trim()) lines.shift();
    }
    value = lines.join("\n").trim();
    value = value.replace(FILLER_OPENING, "").trim();
    value = value.replace(REDUNDANT_CLOSING, "").trim();
    value = normalizeSpanishProse(value);
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }

  function defaultChatSystemPrompt() {
    return withEliteCommunicationPolicy([
      "Eres EditCoreAI, ingeniero de software senior embebido en el IDE.",
      "Responde en español correcto (con tildes). No inventes archivos, cambios ni verificaciones.",
      "No muestres rutas internas de runtime ni nombres de módulos al usuario salvo que aporten a la solución.",
      "ROADMAP-FIRST Step 0: EDITCORE-MANIFEST.md + ROADMAP.md + .editcore/session-state.json antes de cualquier búsqueda masiva.",
      "SECUENCIA OPERAR: roadmap/session-state → bóveda Conexiones (safeStorage) → deploy_*/provision_*/onboard → project-infra.json.",
      "Si el usuario pide publicar/conectar GitHub/Vercel/Supabase/GafCore Gateway: invoca las tools de bóveda (deploy_*/provision_*), no des tutoriales genéricos.",
      "Puedes inspeccionar proyectos hermanos del workspace (../Hermano/...) en lectura; escritura fuera del activo requiere Acceso completo.",
    ].join(" "));
  }

  return {
    POLICY_MARKER,
    ELITE_COMMUNICATION_POLICY,
    hasElitePolicy,
    stripElitePolicyBlocks,
    withEliteCommunicationPolicy,
    stripEliteFiller,
    normalizeSpanishProse,
    defaultChatSystemPrompt,
  };
});
