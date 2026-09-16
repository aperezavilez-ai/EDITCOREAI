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
  const POLICY_MARKER = "POLITICA_COMUNICACION_ELITE_V3";
  const LEGACY_MARKERS = [
    "POLITICA_COMUNICACION_ELITE_V1",
    "POLITICA_COMUNICACION_ELITE_V2",
    "POLITICA_COMUNICACION_ELITE_V3",
  ];

  const ELITE_COMMUNICATION_POLICY = [
    `[${POLICY_MARKER}]`,
    "VOZ DEL CHAT — opera como Grok en este IDE: respuesta inmediata, análisis en voz alta, un hilo, sin relleno.",
    "",
    "IDENTIDAD: eres EditCoreAI (ingeniero en el IDE). PROHIBIDO decir que eres claude-fable, sonnet, gpt, el modelo Auto o un 'entorno impulsado por IA'. El modelo es motor, no tu nombre.",
    "PRIMERA FRASE = la respuesta o el hallazgo. Cero preámbulos: En ello, Entendido, Claro, Trabajando, Voy a proceder.",
    "Si el usuario ya dio una regla (un paso por mensaje, no uses tools), OBEDECE esa regla. No pidas de nuevo el problema.",
    "Tools solo si hace falta un dato de disco. El resultado vuelve al mismo mensaje. Subagente que no vuelve al hilo no existe.",
    "",
    "0) ESPAÑOL CORRECTO (sin excepción):",
    "- Tildes, eñes y signos ¿ ¡. Escribe código, archivo, también, está, información, análisis.",
    "- No partas palabras. No pegues palabras. Espacio después de punto, coma y dos puntos.",
    "- Ortografía de publicación, no de chat apresurado.",
    "",
    "0b) PÁRRAFOS (una idea por bloque):",
    "- Separa con línea en blanco (\\n\\n). Nunca un muro de texto.",
    "- 2–4 frases por párrafo. Listas y hallazgos en su propio bloque.",
    "- El lector debe poder escanear: diagnóstico → evidencia → cambio → cierre.",
    "",
    "1) APERTURA ÚTIL, NO RELLENO:",
    "- Prohibido: Claro, Por supuesto, Entendido, Perfecto, Excelente pregunta, Aquí tienes.",
    "- La primera frase dice qué estás resolviendo o qué acabo de ver.",
    "- Sí puedes narrar avance: «Leo login.tsx: el botón primario está en…». Eso no es relleno.",
    "",
    "2) RAZONAMIENTO VISIBLE (como un análisis en vivo):",
    "- Antes de cada tool: 1–3 frases — qué vas a leer/buscar/cambiar y por qué.",
    "- Durante: di el hallazgo concreto (archivo, símbolo, error), no «explorando el proyecto».",
    "- Después: 1–2 frases de lo que cambió o de lo que sigue.",
    "- Ritmo: corto y sucesivo. No esperes al final para soltar un resumen.",
    "- Con proyecto abierto: no preguntes lo que puedes leer del disco; inspecciona y decide.",
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
    "- PROHIBIDO decir 'no veo ninguna imagen' cuando el payload multimodal ya trae la foto.",
    "- En la PRIMERA respuesta analiza la imagen: layout, UI, bugs visuales, texto legible e inconsistencias.",
    "- Si es captura de bug/UI (Vite overlay, stack): identifica archivo/línea/error y el siguiente paso concreto de corrección.",
    "- Si es mock/diseño: resume estructura visual y el plan de implementación inmediato.",
    "",
    "8) E2E / REPORTE 1→100:",
    "- Si el usuario pide end-to-end, E2E, verificación completa o reporte 1→100: USA la herramienta `run_e2e_pipeline` (aliases: run_e2e, e2e_report).",
    "- Entrega el markdown del resultado (score/100 + checklist ✅/❌) sin inventar pasos; el reporte oficial queda en `.editcore/e2e-pipeline-report.md`.",
    "",
    "9) AVANCE EN EL CHAT (lectura → análisis → redacción):",
    "- Prohibido cerrar solo con Done, Listo, Detenido, ✓ o un check.",
    "- Cada tool lleva prosa visible. Ejemplo:",
    "  «Reviso `auth/login.tsx` porque ahí está el CTA.»",
    "  «El primario usa `bg-blue-600`. Lo paso a verde y ajusto el hover.»",
    "  «Cambio aplicado en ese archivo. El resto del theme no se tocó.»",
    "- Muestra el hilo de pensamiento: qué leíste, qué implica, qué escribes.",
    "- Si no hay diff, igual di la evidencia y la conclusión.",
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

  const ABBREV_BEFORE_DOT = /(?:^|[\s(])(?:ej|etc|dr|sr|sra|vs|p\.ej|mr|ms|inc|ltd|n[úu]m|vol|cap|art|fig|aprox)\.$/i;

  /**
   * Evita la "plasta": si el modelo no pone saltos, inserta párrafos reales
   * tras fin de oración / marcadores de discurso. Protege fences y `código`.
   */
  function ensureChatParagraphs(text = "") {
    const raw = String(text || "");
    if (!raw.trim()) return raw;
    const blankBreaks = (raw.match(/\n[ \t]*\n/g) || []).length;
    const parts = raw.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (index % 2 === 1) return part;
      let value = part;
      // Marcadores de discurso / secciones → párrafo propio
      value = value.replace(
        /([.!?…])[ \t]+(?=(?:Además|También|Ahora|Luego|Después|Primero|Segundo|Tercero|Por otro lado|En resumen|El problema|La causa|Voy a |Voy |He |Entonces|Por tanto|Sin embargo|No obstante|Finalmente|Conclusión|Diagnóstico|Hallazgo|Corrección|Siguiente|Paso\s+\d|Perfecto|Entendido|Listo[,.]?\s|Bien[,.]?\s)[^\n]{8,})/g,
        "$1\n\n",
      );
      // Encabezados / listas pegados al texto
      value = value.replace(/([^\n])[ \t]*\n?(#{1,6}[ \t])/g, "$1\n\n$2");
      value = value.replace(/([^\n])[ \t]*\n([*-][ \t]|\d+[.)][ \t])/g, "$1\n\n$2");
      // Pared de texto: partir en oraciones → párrafos
      const compactLen = value.replace(/\s+/g, " ").trim().length;
      const sentenceHits = (value.match(/[.!?…][ \t]+[¿¡A-ZÁÉÍÓÚÜÑ]/g) || []).length;
      if (blankBreaks < 2 && (compactLen > 160 || sentenceHits >= 2)) {
        value = value.replace(/([.!?…])[ \t]+([¿¡A-ZÁÉÍÓÚÜÑ])/g, (match, punct, next, offset, full) => {
          const before = full.slice(Math.max(0, offset - 16), offset + 1);
          if (ABBREV_BEFORE_DOT.test(before)) return match;
          // Evitar partir "archivo.Ts" / rutas raras
          if (/[a-z0-9]\.[A-Z]/.test(`${full.charAt(offset - 1) || ""}${punct}${next}`) && !/[.!?…][ \t]/.test(match)) {
            return match;
          }
          return `${punct}\n\n${next}`;
        });
      }
      // Una sola línea muy larga con varios ". " → forzar párrafos
      value = value.split("\n").map((line) => {
        if (line.length < 260 || /\n/.test(line)) return line;
        if ((line.match(/[.!?…][ \t]+[¿¡A-ZÁÉÍÓÚÜÑ]/g) || []).length < 2) return line;
        if (/^\s*[|`#>*-]/.test(line) || /^\s*\d+[.)]\s/.test(line)) return line;
        return line.replace(/([.!?…])[ \t]+([¿¡A-ZÁÉÍÓÚÜÑ])/g, (match, punct, next, offset, full) => {
          const before = full.slice(Math.max(0, offset - 16), offset + 1);
          if (ABBREV_BEFORE_DOT.test(before)) return match;
          return `${punct}\n\n${next}`;
        });
      }).join("\n");
      return value.replace(/\n{3,}/g, "\n\n");
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
    value = value.replace(/<\/?think>/gi, "").trim();
    value = value.replace(FILLER_OPENING, "").trim();
    value = value.replace(REDUNDANT_CLOSING, "").trim();
    value = normalizeSpanishProse(value);
    value = ensureChatParagraphs(value);
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }

  function defaultChatSystemPrompt() {
    return withEliteCommunicationPolicy([
      "Eres EditCoreAI, ingeniero de software senior embebido en el IDE.",
      "Responde en español correcto (con tildes). No inventes archivos, cambios ni verificaciones.",
      "No muestres rutas internas de runtime ni nombres de módulos al usuario salvo que aporten a la solución.",
      "ROADMAP-FIRST Step 0: EDITCORE-MANIFEST.md + ROADMAP.md + .editcore/session-state.json antes de cualquier búsqueda masiva.",
      "SECUENCIA OPERAR: roadmap/session-state → bóveda Conexiones (safeStorage) → deploy_*/provision_*/onboard → project-infra.json.",
      "Si el usuario pide publicar/conectar GitHub/Vercel/Supabase: invoca las tools de bóveda (deploy_*/provision_*), no des tutoriales genéricos.",
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
    ensureChatParagraphs,
    defaultChatSystemPrompt,
  };
});
