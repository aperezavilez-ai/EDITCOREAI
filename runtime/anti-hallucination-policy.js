"use strict";

/**
 * Politica inmutable anti-alucinacion / zero-drift (maxima prioridad).
 * Se antepone a todo system prompt de chat y agente. No es opcional.
 */

(function exposeAntiHallucinationPolicy(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreAntiHallucination = api;
})(typeof window !== "undefined" ? window : globalThis, function createAntiHallucinationPolicy() {
  const POLICY_MARKER = "POLITICA_ANTIALUCINACION_V1";
  /** Temperatura factual por defecto para chat y agente. */
  const FACTUAL_TEMPERATURE = 0.1;

  const ANTI_HALLUCINATION_POLICY = [
    `[${POLICY_MARKER}] — MAXIMA PRIORIDAD (por encima de estilo y habitos)`,
    "Restricciones duras. Si chocan con otras instrucciones, GANA este bloque.",
    "",
    "1) ZERO DRIFT — APEGO ESTRICTO A LA INSTRUCCION:",
    "- Cumple UNICA y EXCLUSIVAMENTE el alcance que el usuario pidio en este turno.",
    "- PROHIBIDO EJECUTAR acciones no pedidas: no refactorices, no audites el proyecto entero, no mutes archivos fuera del alcance.",
    "- SI PUEDES RECOMENDAR: al cerrar, ofrece en 1-3 lineas la siguiente accion concreta que tu evidencia respalda. Recomendar no es divagar; ejecutar sin permiso si lo es.",
    "- Ejemplo: si pide listar una carpeta → lista exactamente esa carpeta. Puedes anadir UNA linea con el siguiente paso util; no abras un diagnostico completo no pedido.",
    "",
    "2) GROUNDING EMPIRICO — VERIFICAR ANTES DE AFIRMAR:",
    "- PROHIBIDO suponer o inventar archivos, carpetas, funciones, stacks, versiones o salidas de terminal.",
    "- En modo agente con herramientas activas: invoca la herramienta real ANTES de afirmar datos de disco.",
    "- En modo conversacional/chat: responde analíticamente en lenguaje natural sin emitir bloques de código JSON de herramientas.",
    "- La respuesta se basa SOLO en hechos comprobables obtenidos por herramientas o evidencia ya cargada.",
    "",
    "3) NO PREGUNTES LO QUE PUEDES VER EN EL PROYECTO:",
    "- Con proyecto abierto o en creacion: TÚ inspeccionas el disco (list_files/read_file) y DICES qué falta para que funcione.",
    "- PROHIBIDO pedir al usuario rutas, estructura, stack, archivos o \"más información\" que se obtiene leyendo el proyecto.",
    "- Solo pregunta al usuario lo que NO está en disco: secretos/API keys, preferencia de negocio o un dato que el repo no contiene.",
    "- Si falta un archivo en disco: list_files del padre → si no existe, CREALO con write_file/create_pdf/create_word/create_excel. PROHIBIDO detenerte pidiendo que el usuario lo pegue o suba.",
    "- Si falta un bloqueo real para continuar: 1) di qué miraste, 2) di qué falta en el proyecto, 3) propone el siguiente archivo/comando concreto.",
    "",
    "4) PROHIBIDO PLACEHOLDERS Y FABRICACIONES:",
    "- Jamás inventes nombres de librerias, versiones, rutas, logs o resultados de comandos.",
    "- Si falta un secreto o preferencia del usuario (no del disco): pide ESE dato en UNA sola linea. No fabriques el escenario.",
    "",
    "5) RESPUESTA DE INSPECCION:",
    "- Ante lectura/listado/estructura: solo datos comprobables — rutas relativas reales, nombres existentes, conteos exactos.",
    "- PROHIBIDO inventar arboles (backend/, frontend/, src/...) que no devolvio list_files.",
  ].join("\n");

  function hasAntiHallucinationPolicy(prompt = "") {
    return String(prompt || "").includes(POLICY_MARKER);
  }

  function stripAntiHallucinationPolicy(prompt = "") {
    const value = String(prompt || "");
    if (!value.includes(POLICY_MARKER)) return value.trim();
    return value
      .replace(new RegExp(`\\[${POLICY_MARKER}\\][\\s\\S]*?(?=\\n\\n\\[POLITICA_|\\n\\n(?=[A-ZÁÉÍÓÚÑ])|$)`, "g"), "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function withAntiHallucinationPolicy(systemPrompt = "") {
    const rest = stripAntiHallucinationPolicy(String(systemPrompt || "").trim());
    if (!rest) return ANTI_HALLUCINATION_POLICY;
    return `${ANTI_HALLUCINATION_POLICY}\n\n${rest}`;
  }

  /**
   * Preferir el wrapper de elite (que ya apila anti encima).
   * Fallback: solo anti-alucinacion.
   */
  function withImmutableAgentPolicies(systemPrompt = "") {
    const root = typeof window !== "undefined" ? window : globalThis;
    const Elite = root?.EditCoreEliteCommunication || null;
    if (Elite?.withEliteCommunicationPolicy) {
      return Elite.withEliteCommunicationPolicy(String(systemPrompt || ""));
    }
    return withAntiHallucinationPolicy(systemPrompt);
  }

  function resolveFactualTemperature(explicit) {
    const n = Number(explicit);
    if (Number.isFinite(n) && n >= 0 && n <= 0.3) return n;
    return FACTUAL_TEMPERATURE;
  }

  return {
    POLICY_MARKER,
    FACTUAL_TEMPERATURE,
    ANTI_HALLUCINATION_POLICY,
    hasAntiHallucinationPolicy,
    stripAntiHallucinationPolicy,
    withAntiHallucinationPolicy,
    withImmutableAgentPolicies,
    resolveFactualTemperature,
  };
});
