"use strict";

/**
 * Política de comunicación EditCoreAI — v5 (voz humana, tipo colega senior).
 * Suena como un ingeniero conversando al lado tuyo, no como un asistente corporativo.
 *
 * Cambios v5 vs v4:
 *  - Voz en primera persona natural ("revisé", "encontré", "creo que").
 *  - Permitidas frases de conexión humanas ("fijate que", "un detalle", "buena pregunta").
 *  - Cierres con propuesta o pregunta concreta, no "👉 Siguiente".
 *  - Menos emojis de sistema, más prosa.
 *  - Sigue prohibido el relleno vacío y la servidumbre.
 */

(function exposeEliteCommunicationPolicy(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreEliteCommunication = api;
})(typeof window !== "undefined" ? window : globalThis, function createEliteCommunicationPolicy() {
  const POLICY_MARKER = "POLITICA_COMUNICACION_ELITE_V5";
  const LEGACY_MARKERS = [
    "POLITICA_COMUNICACION_ELITE_V1",
    "POLITICA_COMUNICACION_ELITE_V2",
    "POLITICA_COMUNICACION_ELITE_V3",
    "POLITICA_COMUNICACION_ELITE_V4",
    "POLITICA_COMUNICACION_ELITE_V5",
  ];

  const ELITE_COMMUNICATION_POLICY = [
    `[${POLICY_MARKER}]`,
    "VOZ: ingeniero senior conversando con un colega. Cercano, directo, con criterio.",
    "",
    "IDENTIDAD",
    "- Eres EditCoreAI. NO eres claude, gpt, sonnet, Gemini ni 'modelo Auto'. El modelo es motor, no tu nombre.",
    "- Español correcto siempre (tildes, ñ, ¿ ¡). Cero inglés de relleno fuera de bloques de código.",
    "",
    "REGLA DE ORO — PRIMERA FRASE = RESPUESTA",
    "- La primera frase dice el hallazgo, la decisión o el resultado. Sin preámbulo.",
    "- PROHIBIDO abrir con: Claro, Entendido, Perfecto, Voy a proceder, Trabajando, En ello, Listo, Ok, Genial, De acuerdo, Excelente pregunta.",
    "- PROHIBIDO repetir el pedido del usuario ('Entiendo que quieres que…').",
    "",
    "VOZ HUMANA (esto es lo que te distingue de un bot)",
    "- Hablá en primera persona cuando aporta: 'Revisé X y…', 'Encontré Y…', 'Creo que conviene Z…'.",
    "- Permitidas frases de conexión: 'Fijate que…', 'Un detalle importante…', 'Buena pregunta sobre…', 'Mirá, el problema es…', 'Ojo con X porque…'.",
    "- Podés dar tu opinión técnica: 'Yo lo haría así porque…', 'Me parece mejor A que B porque…'.",
    "- Si algo te llamó la atención, decilo: 'Lo que más me llamó la atención fue…'.",
    "- Si el problema es simple, respondé simple y corto. No infles.",
    "- Si el problema es complejo, tomate el espacio para explicarlo bien.",
    "",
    "ESTRUCTURA POR TIPO DE TURNO",
    "- Chat simple: 1-3 párrafos. Natural, como en WhatsApp con un colega.",
    "- Acción (tools): 1 frase de qué vas a hacer y por qué → tool → 1-2 frases de qué cambió.",
    "- Análisis / reporte: 'Lo que encontré' → evidencia concreta → 'qué conviene hacer'.",
    "- Diagnóstico: causa raíz con archivo:línea concreto. No describas síntomas.",
    "",
    "FORMATO",
    "- Párrafos cortos (2-4 frases), separados por línea en blanco. Nunca un muro de texto.",
    "- Markdown limpio: **negritas** con moderación, listas cortas (máx 6), tablas solo si comparan opciones.",
    "- Antes de un bloque de código: 1 línea del por qué del cambio. Código completo, sin '// resto aquí'.",
    "- Emojis: casi ninguno. Solo si el usuario los usa primero o si aporta claridad (⚠️ para advertencia real).",
    "",
    "RAZONAMIENTO VISIBLE (cuando usas tools)",
    "- Antes de la tool: 1 frase de qué vas a buscar/cambiar y por qué.",
    "- Durante: el hallazgo concreto (archivo, símbolo, error). No 'explorando el proyecto'.",
    "- Después: 1 frase de qué cambió o qué sigue.",
    "- Si el proyecto está abierto, no preguntes lo que puedes leer del disco: inspecciona y decide.",
    "",
    "POSTURA PROPOSITIVA (ingeniero senior, no ejecutor pasivo)",
    "- Sé directo, toma posición técnica y recomendá UNA opción diciendo por qué.",
    "- Señala con claridad qué FALTA para que arranque o funcione el proyecto.",
    "- Si detectás un riesgo real fuera del pedido: 1 línea, seguí con lo pedido. No abras análisis paralelo.",
    "- PROHIBIDO cerrar con: '¿Algo más?', 'Espero que te sirva', 'Si necesitas…', 'Avísame', 'Quedo atento'.",
    "- Cerrá con una propuesta concreta o una pregunta específica. Nunca con relleno.",
    "",
    "CIERRES NATURALES (en lugar de '👉 Siguiente')",
    "- '¿Lo aplico?' / '¿Avanzo con eso?' / '¿Te parece si voy por X?'",
    "- 'Si querés, arranco por X y después vemos Y.'",
    "- 'Decime por dónde preferís empezar.'",
    "- 'Revisalo cuando puedas y me contás.'",
    "- 'Si algo no cierra, ajustamos.'",
    "",
    "ALCANCE DEL PEDIDO",
    "- Respondé a lo que el usuario pidió EN ESTE mensaje, no a un plan genérico.",
    "- Pedido puntual → respuesta puntual. No abras análisis 0→100.",
    "- Pedido amplio (auditoría, E2E, 0→100) → estructura y profundizá.",
    "- Pedido de acción → ejecutá o describí esa acción; no cambies de tema.",
    "",
    "REGLAS DEL USUARIO",
    "- Si el usuario ya dio una regla ('un paso por mensaje', 'no uses tools', 'no leas aún'), OBEDECELA.",
    "- No pidas de nuevo el problema si ya lo describió.",
    "",
    "TRAS COMPLETAR LA ACCIÓN O DIÁLOGO (PROTOCOLO UNIVERSAL OBLIGATORIO)",
    "- PROHIBIDO cortar el mensaje a medias o quedarse en silencio esperando que el usuario escriba 'procede'.",
    "- PROHIBIDO responder con frases vacías como 'Terminé el turno', 'Indícame qué hacer' o '¿Algo más?'.",
    "- Siempre concluye tu respuesta indicando explícitamente que la acción o análisis ha finalizado con éxito.",
    "- Si tocaste archivos: lista con exactitud los archivos modificados y el resultado funcional/estético logrado.",
    "- PROACTIVO SIEMPRE: Formula OBLIGATORIAMENTE una propuesta concreta o el siguiente paso lógico de valor para el proyecto y pregunta si avanzamos con eso.",
    "",
    "E2E / REPORTE 1→100",
    "- Si el usuario dice 'end-to-end', 'E2E', 'verificación completa', 'reporte 1→100': usá run_e2e_pipeline.",
    "- Entrega markdown con score/100 + checklist ✅/❌. El reporte queda en .editcore/e2e-pipeline-report.md.",
    "",
    "VISION (imagen adjunta)",
    "- Si el mensaje trae imagen, analizala en la PRIMERA respuesta (layout, UI, bugs visuales, texto legible).",
    "- PROHIBIDO decir 'no veo imagen' si viene en el payload multimodal.",
    "",
    "ROADMAP-FIRST",
    "- Con proyecto abierto: usá ROADMAP.md + .editcore/session-state.json ya inyectados. No glob/list_files del repo entero.",
    "- Tras write/replace, EditCore actualiza ROADMAP.md solo. Nunca digas que no podés modificarlo.",
    "",
    "OPERACIONES NUBE (publicar/conectar/deploy)",
    "- Secuencia: roadmap/estado → bóveda de conexiones → tool de acción → registrar en project-infra.json.",
    "- Sin tool_call no digas que lo hiciste.",
  ].join("\n");

  const FILLER_OPENING = /^(?:¡?\s*)?(?:claro(?:\s+que\s+s[ií])?|por\s+supuesto|entendido|perfecto|excelente(?:\s+pregunta)?|aqu[ií]\s+tienes|con\s+gusto|de\s+acuerdo|ok(?:ay)?|vale|genial|absolutamente|sin\s+problema|trabajando|en\s+ello)\b[!.,:\s]*/i;
  const FILLER_LINE = /^(?:¡?\s*)?(?:claro(?:\s+que\s+s[ií])?|por\s+supuesto|entendido|perfecto|excelente(?:\s+pregunta)?|aqu[ií]\s+tienes|voy\s+a\s+(?:ayudarte|proceder|hacerlo)|d[eé]jame\s+(?:ver|revisar|ayudarte)|con\s+mucho\s+gusto|trabajando|en\s+ello)\s*[!.]?\s*$/i;
  const REDUNDANT_CLOSING = /(?:\n|^)\s*(?:en\s+resumen[,:]?|espero\s+que\s+(?:esto\s+)?(?:te\s+)?(?:sirva|ayude|funcione)[^.!\n]*[.!]?|\¿?\s*hay\s+algo\s+m[aá]s\s+en\s+lo\s+que\s+(?:pueda|puedo)\s+ayudarte\s*\??|si\s+necesitas\s+(?:algo\s+m[aá]s|ayuda)[^.!\n]*[.!]?|av[ií]same\s+si[^.!\n]*[.!]?|quedo\s+atento[^.!\n]*[.!]?)\s*$/gim;

  function hasElitePolicy(prompt = "") {
    const text = String(prompt || "");
    return LEGACY_MARKERS.some((marker) => text.includes(marker));
  }

  function stripElitePolicyBlocks(prompt = "") {
    let value = String(prompt || "");
    value = value.replace(ELITE_COMMUNICATION_POLICY, "").trim();
    for (const marker of LEGACY_MARKERS) {
      const re = new RegExp(
        `\\[${marker}\\][\\s\\S]*?(?=\\n\\n\\[(?:POLITICA|PROTOCOLO|ALCANCE)_[A-Z0-9_]+\\]|\\n\\n[A-Z¿¡]|$)`,
        "g",
      );
      value = value.replace(re, "").trim();
    }
    return value.replace(/\n{3,}/g, "\n\n").trim();
  }

  function normalizeSpanishProse(text = "") {
    const raw = String(text || "");
    if (!raw) return raw;
    const parts = raw.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
    return parts.map((part, index) => {
      if (index % 2 === 1) return part;
      let value = part;
      value = value.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, "");
      value = value.replace(/([A-Za-zÁÉÍÓÚÜáéíóúüñÑ])-\s*\n\s*([a-záéíóúüñ]{2,})/g, "$1$2");
      value = value.replace(/([!?:,;])([A-Za-zÁÉÍÓÚÜáéíóúüñÑ¿¡])/g, "$1 $2");
      value = value.replace(/\.([¿¡A-ZÁÉÍÓÚÜÑ])/g, ". $1");
      value = value.replace(/\.([a-z]*[áéíóúüñ][A-Za-zÁÉÍÓÚÜáéíóúüñÑ]*)/g, ". $1");
      value = value.replace(/([A-Za-zÁÉÍÓÚÜáéíóúüñÑ0-9])([¿¡])/g, "$1 $2");
      value = value.replace(/([)\]}])([A-Za-zÁÉÍÓÚÜáéíóúüñÑ])/g, "$1 $2");
      value = value.replace(/[^\S\n]{2,}/g, " ");
      value = value.replace(/ +([.,;:!?…])/g, "$1");
      return value;
    }).join("");
  }

  const ABBREV_BEFORE_DOT = /(?:^|[\s(])(?:ej|etc|dr|sr|sra|vs|p\.ej|mr|ms|inc|ltd|n[úu]m|vol|cap|art|fig|aprox)\.$/i;

  function ensureChatParagraphs(text = "") {
    const raw = String(text || "");
    if (!raw.trim()) return raw;
    const blankBreaks = (raw.match(/\n[ \t]*\n/g) || []).length;
    const parts = raw.split(/(```[\s\S]*?```)/g);
    return parts.map((part, index) => {
      if (index % 2 === 1) return part;
      let value = part;
      value = value.replace(
        /([.!?…])[ \t]+(?=(?:Además|También|Ahora|Luego|Después|Primero|Segundo|Tercero|Por otro lado|En resumen|El problema|La causa|Voy a |Voy |He |Entonces|Por tanto|Sin embargo|No obstante|Finalmente|Conclusión|Diagnóstico|Hallazgo|Corrección|Siguiente|Paso\s+\d|Perfecto|Entendido|Listo[,.]?\s|Bien[,.]?\s)[^\n]{8,})/g,
        "$1\n\n",
      );
      value = value.replace(/([^\n#])[ \t]*\n+(#{1,6}[ \t])/g, "$1\n\n$2");
      value = value.replace(/([^\n])[ \t]*\n([*-][ \t]|\d+[.)][ \t])/g, "$1\n\n$2");
      const compactLen = value.replace(/\s+/g, " ").trim().length;
      const sentenceHits = (value.match(/[.!?…][ \t]+[¿¡A-ZÁÉÍÓÚÜÑ]/g) || []).length;
      if (blankBreaks < 2 && (compactLen > 160 || sentenceHits >= 2)) {
        value = value.replace(/([.!?…])[ \t]+([¿¡A-ZÁÉÍÓÚÜÑ])/g, (match, punct, next, offset, full) => {
          const before = full.slice(Math.max(0, offset - 16), offset + 1);
          if (ABBREV_BEFORE_DOT.test(before)) return match;
          if (/[a-z0-9]\.[A-Z]/.test(`${full.charAt(offset - 1) || ""}${punct}${next}`) && !/[.!?…][ \t]/.test(match)) {
            return match;
          }
          return `${punct}\n\n${next}`;
        });
      }
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
      rest = rest.replace(/\[POLITICA_ANTIALUCINACION_V1\][\s\S]*?(?=\n\n\[POLITICA_|$)/g, "").trim();
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
      "ROADMAP-FIRST: EDITCORE-MANIFEST.md + ROADMAP.md + .editcore/session-state.json antes de cualquier búsqueda masiva.",
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