"use strict";

(function exposeProjectAnalysis(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.EditCoreProjectAnalysis = api;
})(typeof window !== "undefined" ? window : globalThis, function createProjectAnalysis() {
  const AUTHORIZATION_PATTERN = /^\s*(?:(?:s[i\u00ed][\s,.!]+)?(?:adelante|procede|contin[u\u00fa]a|hazlo|ejecuta)(?:\s+(?:con\s+)?(?:(?:todos?|todas?)\s+)?(?:(?:el|la|los|las|tu|tus|este|esta|estos|estas)\s+)?(?:cambios?|plan|propuesta|tarea|correcciones?))?|autorizado|autorizo(?:\s+(?:(?:todos?|todas?)\s+)?(?:(?:el|la|los|las|tu|tus|este|esta|estos|estas)\s+)?(?:cambios?|plan|propuesta|tarea|correcciones?))?|acepto(?:\s+(?:(?:todos?|todas?)\s+)?(?:(?:el|la|los|las|tu|tus|este|esta|estos|estas)\s+)?(?:cambios?|plan|propuesta|tarea|correcciones?))?|s[i\u00ed])\s*[.!]*\s*$/i;
  const FOLLOW_UP_PATTERN = /^(?:en\s+)?(?:qu[e\u00e9]|cu[a\u00e1]l|c[o\u00f3]mo|dime|explica)?\s*(?:porcentaje|avance|estado|reporte|resultado|hallazgos|an[a\u00e1]lisis|qu[e\u00e9]\s+falta)|^(?:la|el|esa|ese|esta|este)\s+(?:app|aplicaci[o\u00f3]n|proyecto|que\s+acabas|que\s+analizaste)|^(?:sobre|respecto\s+a)\s+(?:lo|la)\s+anterior/i;
  const RECOVERY_PATTERN = /\b(?:contin[u\u00fa]a|reanuda|retoma|prosigue|corrige|corrije|repara|soluciona|arregla)\b[\s\S]{0,100}\b(?:tarea|proceso|ejecuci[o\u00f3]n|correcciones?|fallos?|errores?|problemas?|pendiente|anterior|descrit[oa]s?|indicad[oa]s?)\b|\b(?:correcciones?|fallos?|errores?|problemas?)\b[\s\S]{0,100}\b(?:anterior|pendiente|descrit[oa]s?|indicad[oa]s?|corrige|corrije|repara|soluciona|arregla)\b/i;
  const CREDENTIAL_LABEL_PATTERN = /(\b(?:api[\s_-]*key|clave|clve|token|secret|password|contrase(?:n|ñ)a|authorization)\b\s*[:=]?\s*(?:bearer\s+)?)[A-Za-z0-9_.\/+\-=]{12,}/gi;
  const URL_CREDENTIAL_PATTERN = /([?&](?:key|api_key|apikey|token|access_token)=)[^&\s]+/gi;

  function text(value) {
    return String(value || "").trim();
  }

  // Rutas absolutas reales: D:\foo, D:/foo, \\unc
  // NO confundir prosa española ("breve: qué contiene…") con letra de unidad.
  const PROJECT_PATH_WITH_SEP = /[A-Za-z]:[\\/]+[^<>"|?*\r\n]+/g;
  const PROJECT_PATH_UNC = /\\\\[^<>"|?*\r\n]+/g;
  // Atajo del producto: D:PROGRAMAS IA (sin barra, sin espacio justo tras ':')
  const PROJECT_PATH_SHORTHAND = /[A-Za-z]:[A-Za-z0-9._-]+(?:\s+[A-Za-z0-9._-]+)*(?:[\\/][^<>"|?*\r\n]*)?/g;

  function normalizeProjectPath(value) {
    const raw = text(value);
    const unc = /^(?:\\\\|\/\/)/.test(raw);
    const candidate = raw.replace(/[\\/]+/g, "\\");
    if (unc) return `\\${candidate}`;
    if (/^[A-Za-z]:[^\\]/.test(candidate)) return `${candidate.slice(0, 2)}\\${candidate.slice(2)}`;
    return candidate;
  }

  function cleanProjectPath(value) {
    return text(value)
      .replace(/^[`'"\(\[\{]+/, "")
      .replace(/[\s`'"\)\]\}\.,;!?]+$/, "")
      .trim();
  }

  function looksLikeAbsoluteProjectPath(candidate) {
    const normalized = normalizeProjectPath(cleanProjectPath(candidate));
    if (!normalized) return false;
    if (/^\\\\/.test(normalized)) return normalized.length > 3;
    if (!/^[A-Za-z]:\\/.test(normalized)) return false;
    const rest = normalized.slice(3).trim();
    if (!rest) return false;
    // Prosa tras "palabra:" (qué / si / el / y / 1 corrección…)
    if (/^(qué|que|si|el|la|los|las|un|una|y|o|de|del|en|con|por|para|mi|tu|su|al|a|no|se|es|hay|algo)\b/i.test(rest)) {
      return false;
    }
    if ((rest.match(/,/g) || []).length >= 2) return false;
    if (/\b(si hay|algo raro|correcci[oó]n concreta|espera mi autorizaci|no explores)\b/i.test(rest)) {
      return false;
    }
    return true;
  }

  function extractProjectPaths(value) {
    const raw = String(value || "");
    const matches = [
      ...(raw.match(PROJECT_PATH_WITH_SEP) || []),
      ...(raw.match(PROJECT_PATH_UNC) || []),
      ...(raw.match(PROJECT_PATH_SHORTHAND) || []),
    ];
    const paths = [];
    const seen = new Set();
    for (const match of matches) {
      const candidate = normalizeProjectPath(cleanProjectPath(match));
      if (!looksLikeAbsoluteProjectPath(candidate)) continue;
      const key = candidate.toLowerCase();
      if (!candidate || seen.has(key)) continue;
      seen.add(key);
      paths.push(candidate);
    }
    return paths;
  }

  function isPathOnlyPrompt(value) {
    const prompt = normalizeProjectPath(cleanProjectPath(value));
    const paths = extractProjectPaths(value);
    return paths.length === 1 && prompt.toLowerCase() === paths[0].toLowerCase();
  }

  function normalizeProjectPrompt(value) {
    return isPathOnlyPrompt(value)
      ? "Analiza el proyecto abierto en EditCore y prepara un diagnostico verificable."
      : text(value);
  }

  function isAuthorization(value) {
    const prompt = text(value);
    if (AUTHORIZATION_PATTERN.test(prompt)) return true;
    if (/^\s*(?:contin[u\u00fa]a|continuamos|procede|procedamos|adelante|retoma|reanuda|reanudamos|ejecuta|hazlo|autorizo|autoriza|dale|seguimos|sigamos)\b/i.test(prompt)) return true;
    // "vamos" solo es autorización si está solo o seguido de continuación, no de "a crear/hacer/..."
    if (/^\s*vamos\s*[?!.\s]*$/i.test(prompt)) return true;
    // Pedido explícito de CORREGIR/ARREGLAR (no es análisis nuevo): autoriza escritura
    if (/^\s*(?:corrije|corrige|arregla|arregla[rn]?|implementa|aplica|repara|soluciona)\b/i.test(prompt)
      && !/\b(?:analiza|audita|diagnostica|revisa|explora|reporte|solo\s+lectura|NO\s+MODIFICAR)\b/i.test(prompt)) {
      return true;
    }
    return false;
  }

  function isAnalysisReport(value) {
    const report = text(value);
    if (report.length < 120) return false;
    if (/Verificacion completada con evidencia real/i.test(report)) return false;
    if (/##\s*(?:An[aá]lisis|Errores|Riesgos|Recomendaciones|Resumen|Problemas|Qu[eé]\s+s[ií]\s+funcion[oó]|Qu[eé]\s+fall[oó]|Evidencia|C[oó]mo\s+lo\s+corregir[eé])/i.test(report)) return true;
    return isPendingAnalysisPlan(report);
  }

  function isPendingAnalysisPlan(value) {
    const report = text(value);
    if (report.length < 180) return false;
    if (/Verificacion completada con evidencia real/i.test(report)) return false;
    if (/REPORTE\s+DE\s+AN[aá]LISIS/i.test(report)) return true;
    const hasFindings = /(?:ERRORES|PROBLEMAS|RIESGOS|HALLAZGOS|CR[ií]TICOS|identificados|encontrados|Qu[eé]\s+fall[oó])/i.test(report);
    const hasActions = /(?:CORRECCIONES|RECOMENDACIONES|REQUERIDAS|ARCHIVOS\s+CR[ií]TICOS|propongo|aplicar|C[oó]mo\s+lo\s+corregir)/i.test(report);
    const asksAuth = /(?:\?\s*)?(?:deseas que proceda|cuando autorices|escribe procede|procede|autorizo|continua)/i.test(report);
    return hasFindings && (hasActions || asksAuth);
  }

  function normalizeAnalysisReport(value) {
    const report = text(value);
    if (!report) return "";
    if (/##\s*(?:An[aá]lisis|Errores|Riesgos|Recomendaciones|Resumen|Problemas|Qu[eé]\s+s[ií]\s+funcion[oó]|Qu[eé]\s+fall[oó]|Evidencia|C[oó]mo\s+lo\s+corregir[eé])/i.test(report)) return report;
    const errorsBlock = report.match(/(?:ERRORES[\s\S]*?)(?=CORRECCIONES|RECOMENDACIONES|ARCHIVOS|$)/i)?.[0]?.trim() || "";
    const fixesBlock = report.match(/(?:CORRECCIONES|RECOMENDACIONES|ARCHIVOS)[\s\S]*/i)?.[0]?.trim() || "";
    const intro = report.split(/\n(?=(?:REPORTE|ERRORES|\d+\.\s))/i)[0]?.trim() || report.slice(0, 1800);
    return [
      "## Qué sí funcionó",
      "",
      "Inspección del proyecto con evidencia real en disco.",
      "",
      "## Qué falló / hallazgos",
      "",
      errorsBlock || intro,
      "",
      "## Evidencia",
      "",
      intro.slice(0, 1200),
      "",
      "## Cómo lo corregiré",
      "",
      fixesBlock || "Aplicar las correcciones identificadas tras tu autorización (PROCEDE).",
      "",
      "Cuando autorices procedo con las correcciones.",
    ].join("\n");
  }

  function isFreshAnalysisRequest(value) {
    const prompt = text(value);
    if (isAuthorization(prompt)) return false;
    if (isPromptOnlySteering(prompt) || isPromptAnalysisRequest(prompt) || isGreenfieldSpecPrompt(prompt)) return false;
    if (isScopedDiskFileRequest(prompt)) return true;
    // Lectura/listado de carpeta concreta: turno nuevo (no reanudar FOCO archivo previo).
    if (/\b(?:lee|lista|listar|enlista|muestra|explora|revisa)\b[\s\S]{0,60}\b(?:carpeta|folder|directorio)\b/i.test(prompt)) {
      return true;
    }
    if (/\b(?:solo|unicamente|solamente)\b[\s\S]{0,40}\b(?:carpeta|folder|directorio)\b/i.test(prompt)) {
      return true;
    }
    return /^(?:analizame|analiza|reanaliza|reh[aá]z|arranca|audita|diagnostica|investiga|haz(?:me)?\s+(?:un\s+)?(?:an[aá]lisis|reporte)|an[aá]lisis)\b/i.test(prompt)
      || /\breh[aá]z\b[\s\S]{0,40}\ban[aá]lisis\b/i.test(prompt)
      || /\ban[aá]lisis\s+(?:profundo|exhaustiv[oa]|quir[uú]rgic[oa]|forense|completo)\b/i.test(prompt)
      || /\b(?:reporte|diagn[oó]stico|an[aá]lisis|hallazgos)\b.*\b(?:completo|final|proyecto|profundo|exhaustiv[oa])\b/i.test(prompt)
      || /\b(?:completo|final|profundo|exhaustiv[oa])\b.*\b(?:reporte|diagn[oó]stico|an[aá]lisis|hallazgos)\b/i.test(prompt)
      || /\b(?:hazme|dame)\s+(?:un\s+)?reporte\b/i.test(prompt)
        && /\b(?:proyecto|hallazgos|analiza|analizame)\b/i.test(prompt);
  }

  /** "Analiza" + texto pegado / rol de arquitecto / spec: entender el mensaje, no auditar disco vacio. */
  function isPromptAnalysisRequest(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (isPromptOnlySteering(prompt)) return true;
    // Rol de arquitecto / consultor / diseñador: SIEMPRE entender el prompt y razonar
    if (/\b(?:act[uú]a\s+como|eres\s+un|como\s+arquitecto|como\s+experto|dise[nñ]a\s+la\s+arquitectura|arquitecto\s+de\s+software)\b/i.test(prompt)) {
      return true;
    }
    // Analisis de requerimiento / especificacion / texto pegado / propuesta
    if (/\b(?:analiza|revisa|interpreta|eval[uú]a|mira|observa|dime|entiende|lee)\b[\s\S]{0,120}\b(?:esta\s+respuesta|los\s+datos\s+de\s+la\s+consulta|lo\s+que\s+sali[oó]|este\s+texto|el\s+resultado\s+del\s+chat|lo\s+siguiente|esta\s+idea|mi\s+idea|a\s+continuaci[oó]n|el\s+siguiente\s+texto|(?:el|este|los|las|la|mi|nuestro|el\s+siguiente)\s+(?:requerimiento|requerimientos|especificaci[oó]n|especificaciones|propuesta|documento|caso\s+de\s+uso|historias?\s+de\s+usuario|prompt|pedido|brief|idea|concepto))\b/i.test(prompt)) {
      return true;
    }
    if (/\b(?:analiza|entiende|lee|revisa)\s+(?:el\s+siguiente|este|mi|el)\s+(?:prompt|requerimiento|texto|documento|pedido|caso)\b/i.test(prompt)) {
      return true;
    }
    // Auditoria explicita de proyecto / codigo / repo en disco
    if (/\b(?:audita|diagnostica|analiza\s+el\s+c[oó]digo\s+existente|analiza\s+la\s+carpeta|auditor[ií]a\s+del\s+proyecto)\b/i.test(prompt)) {
      return false;
    }
    if (/\banaliza\b.*\b(?:el\s+)?(?:proyecto|c[oó]digo|repo|repositorio|directorio|carpeta)\s+(?:existente|local|en\s+disco)\b/i.test(prompt)) {
      return false;
    }
    return false;
  }

  /**
   * FOCO RETIRADO: siempre false.
   * Antes activaba scopedDiskFocus (solo read_file + mensajes FOCO en chat).
   * El agente ahora investiga libremente como Cursor/Claude.
   */
  function isScopedDiskFileRequest(_value) {
    return false;
  }

  /** El usuario pide corregir rumbo: entiende el prompt, no explores carpetas. */
  function isPromptOnlySteering(value) {
    const prompt = text(value);
    if (!prompt) return false;
    // Reanalisis / lectura de archivo concreto en disco: NO es steering de prompt.
    if (/\b(?:reh[aá]z|reanaliza|re-?haz|vuelve\s+a\s+(?:analizar|leer|revisar)|analiza|analizando|lee|leyendo|revisa|audita)\b[\s\S]{0,120}\b(?:solo|unicamente|solamente)\b[\s\S]{0,80}\b(?:archivo|package\.json|[\w./\\-]+\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|py))\b/i.test(prompt)) {
      return false;
    }
    if (/\b(?:reporte|an[aá]lisis)\b[\s\S]{0,40}\b(?:del?|de\s+el)\s+package\.json\b/i.test(prompt)) {
      return false;
    }
    return /\bno\s+(analizaste|entendiste|leiste|busques?|explores?|listes?|entres?|metas?)\b/i.test(prompt)
      || /\b(entiende|analiza|lee|revisa|interpreta)\b.*\b(mi |el |tu )?(prompt|instruccion|mensaje|requerimiento|especificacion|lo que te)/i.test(prompt)
      || /\b(solo|unicamente|solamente|primero)\b.*\b(prompt|instruccion|mensaje|requerimiento)/i.test(prompt)
      || /\bproyecto\b.*\b(vamos a crear|apenas vamos|por crear|aun no existe|no existe)\b/i.test(prompt)
      || /\b(sin|no)\b.*\b(explorar|buscar en carpetas|meterte en|list_files)\b/i.test(prompt)
      || /\bno\s+aplica\b.*\b(explor|archivos|carpetas)\b/i.test(prompt);
  }

  /** Comentario conversacional de intencion futura SIN especificar que construir. */
  function hasConcreteProductHint(value) {
    const prompt = text(value);
    if (!prompt) return false;
    return /\b(ticket|tickets|evento|eventos|reserva|venta|qr|asiento|seat|panel|organizador|esc[aá]ner|check-?in|multi-?tenant|saas|e-?commerce|inventario|usuarios|registro|admin|api|backend|frontend)\b/i.test(prompt)
      || /\bproyecto\s+de\s+\w+/i.test(prompt)
      || /\b(?:app|sistema|plataforma)\s+(?:de|para)\s+/i.test(prompt);
  }

  function isProjectIntentComment(value) {
    const prompt = text(value);
    if (!prompt || isAuthorization(prompt)) return false;
    if (hasConcreteProductHint(prompt)) return false;
    if (prompt.length > 140) return false;
    if (/\b(ahora|ya|inmediatamente|empieza a crear|crea el|implementa en disco|escribe el archivo|procede)\b/i.test(prompt)) return false;
    const futureIntent = /\b(vamos a|iremos a|voy a|queremos|vamos a hacer|pensemos en|hagamos|trabajemos en)\b/i.test(prompt);
    const createVerb = /\b(crear|hacer|montar|armar|desarrollar|construir)\b/i.test(prompt);
    const projectNoun = /\b(proyecto|app|aplicaci[oó]n|sistema)\b/i.test(prompt);
    if (futureIntent && createVerb && projectNoun) return true;
    if (/^\s*quiero\s+crear\s+(?:un\s+)?(?:proyecto|app|aplicaci[oó]n)\s*(?:nuevo)?\s*[.!?]*$/i.test(prompt)) return true;
    if (/^\s*vamos\s+a\s+crear\s+(?:un\s+)?(?:proyecto|app)\s*(?:nuevo)?\s*[.!?]*$/i.test(prompt)) return true;
    return false;
  }

  /** Quiere pensar / brainstorm / guiarse: conversacion real con el modelo, no plantilla ni escritura. */
  function isProjectBrainstormRequest(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (/\b(crea(?:r)?\s+(?:ya|ahora)|implementa(?:r)?\s+(?:ya|ahora)|solo\s+crea|escribe(?:\s+los)?\s+archivos|procede|adelante|hazlo)\b/i.test(prompt)) {
      return false;
    }
    return /\b(ayud(?:a|ame|ame)|ayúdame|guiame|gu[ií]ame|pensar|pensemos|brainstorm|idear|definir|aclarar|orientar|convers(?:a|emos)|diseñar\s+juntos|empezar\s+a\s+pensar|desde\s+cero)\b/i.test(prompt)
      && /\b(proyecto|app|aplicaci[oó]n|idea|producto|negocio)\b/i.test(prompt);
  }

  /** Pedido de crear sin especificar producto, stack ni funcionalidad (solo estructura o app generica). */
  function isVagueGreenfieldRequest(value) {
    const prompt = text(value);
    if (!prompt || isAuthorization(prompt) || isProjectIntentComment(prompt)) return false;
    if (isProjectBrainstormRequest(prompt)) return false;
    if (/\b(solo\s+analiza|no\s+implementes|sin\s+implementar|analiza\s+y\s+documenta)\b/i.test(prompt)) return false;
    if (/\b(ahora|ya|inmediatamente|solo\s+crea|crea\s+el\s+proyecto|genera\s+el\s+proyecto|procede|adelante|hazlo)\b/i.test(prompt)) return false;
    if (/\b(vac[ií]o|en\s+blanco|minimal|m[ií]nimo|esqueleto|solo\s+estructura|placeholder|sin\s+contenido)\b/i.test(prompt)) return false;
    if (hasConcreteProductHint(prompt)) return false;
    const createIntent = /^\s*(?:crea|crear|genera|implementa|construye|desarrolla|monta)\b/i.test(prompt)
      || /\b(crea|crear|quiero|necesito)\b[\s\S]{0,80}\b(app|aplicaci[oó]n|proyecto|web)\b/i.test(prompt);
    if (!createIntent) return false;
    const scaffoldOnly = /\b(readme|package\.json|estructura\s+b[aá]sica|archivos?\s+b[aá]sicos?)\b/i.test(prompt);
    const shortGeneric = prompt.length <= 140
      && /\b(app|aplicaci[oó]n|proyecto|web)\b/i.test(prompt)
      && !/\b(con|que\s+tenga|incluya|para\s+\w+|usuarios?|login|dashboard|react|vue|node|stack|api)\b/i.test(prompt);
    return scaffoldOnly || shortGeneric;
  }

  /** Orden explicita de crear/implementar AHORA en disco (no un comentario conversacional). */
  function isGreenfieldCreateRequest(value) {
    const prompt = text(value);
    if (!prompt || isAuthorization(prompt) || isProjectIntentComment(prompt)) return false;
    if (isVagueGreenfieldRequest(prompt)) return false;
    if (/\b(solo\s+analiza|analiza\s+y\s+documenta|no\s+implementes|sin\s+implementar|dise[nñ]a\s+y\s+documenta|do\s+not\s+implement|empieza\s+entendiendo|primero\s+entiende|plan\s+de\s+an[aá]lisis)\b/i.test(prompt)) return false;
    if (/\b(solo\s+crea|no\s+quiero\s+conectar|sin\s+conectar)\b/i.test(prompt) && /\b(proyecto|archivos|ticket|estructura|c[oó]digo)\b/i.test(prompt)) return true;
    if (/\b(crea(?:r)?\s+el\s+proyecto|genera(?:r)?\s+el\s+proyecto|escribe(?:\s+los)?\s+archivos)\b/i.test(prompt)) return true;
    if (/^\s*(?:crea|genera|implementa|construye|desarrolla|monta)\b/i.test(prompt) && prompt.length <= 180) return true;
    const wantsNow = /\b(crea(?:r)?\s+(?:ya|ahora)|implementa(?:r)?\s+(?:ya|ahora)|empieza(?:\s+a)?\s+(?:a\s+)?(?:crear|implementar|escribir)|escribe(?:\s+los)?\s+archivos|genera(?:\s+la)?\s+estructura)\b/i.test(prompt)
      || /\b(crea(?:r)?|implementa(?:r)?|empieza(?:\s+a)?\s+(?:a\s+)?(?:crear|implementar|escribir))\b[\s\S]{0,48}?\b(ya|ahora)\b/i.test(prompt);
    return wantsNow && /\b(proyecto|archivos|estructura|ticket|readme|package\.json)\b/i.test(prompt);
  }

  function isProjectOnboardingRequest(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (/\b(sin\s+conectar|no\s+conectes|solo\s+crea|no\s+quiero\s+conectar)\b/i.test(prompt)) return false;
    const wantsConnect = /\b(conecta(?:r)?|enlaza(?:r)?|vincula(?:r)?|configura(?:r)?|aplicar\s+conexiones|onboard(?:ing)?|aprovisiona(?:r)?)\b/i.test(prompt)
      && /\b(github|vercel|supabase|gafcore|gateway|servidor|servicios?)\b/i.test(prompt);
    const wantsDeps = /\b(aplica(?:r)?|instala(?:r)?)\b/i.test(prompt)
      && /\b(dependencias?|npm\s+install|paquetes?|node_modules)\b/i.test(prompt);
    const wantsFullSetup = /\b(proyecto\s+nuevo|nuevo\s+proyecto|reci[eé]n\s+creado|al\s+crear)\b/i.test(prompt)
      && (wantsConnect || wantsDeps);
    return wantsConnect || wantsDeps || wantsFullSetup
      || /\b(conecta(?:r)?\s+todo|configura(?:r)?\s+todo|deja(?:r)?\s+listo\s+para\s+publicar)\b/i.test(prompt);
  }

  function isGreenfieldContinuationRequest(value, { scaffoldIncomplete = false } = {}) {
    const prompt = text(value);
    if (!prompt || !scaffoldIncomplete) return false;
    if (/\b(solo\s+analiza|no\s+implementes|sin\s+implementar)\b/i.test(prompt)) return false;
    return /\b(continua|continuar|procede|sigue|hay que continuar|sigue con|crea el proyecto|solo crea)\b/i.test(prompt)
      && /\b(proyecto|ticketia|ticket|archivos|estructura|scaffold|c[oó]digo)\b/i.test(prompt);
  }

  /** Especificacion larga de proyecto nuevo: primero entender el pedido, no auditar disco vacio. */
  function isGreenfieldSpecPrompt(value) {
    const prompt = text(value);
    if (!prompt || prompt.length < 60) return false;
    if (/\b(crea(?:r)?\s+(?:ya|ahora)|implementa(?:r)?\s+(?:ya|ahora)|solo\s+crea|crea\s+el\s+proyecto|genera(?:r)?\s+el\s+proyecto)\b/i.test(prompt)) return false;
    if (/\b(analiza|audita|diagnostica|revisa|explora)\b.*\b(proyecto|carpeta|archivos|c[oó]digo)\b/i.test(prompt)) return false;
    if (/\b(lista|revisa|lee|abre)\b.*\b(archivos|carpeta|proyecto existente)\b/i.test(prompt)) return false;
    return /\b(crea|crear|construye|desarrolla|implementa|arma|monta|quiero|necesito)\b/i.test(prompt)
      && (/\b(app|aplicaci[oó]n|sistema|plataforma|saas|proyecto|ticket|tickets|evento|eventos|web)\b/i.test(prompt) || prompt.length >= 180);
  }

  function shouldAnalyzePromptFirst(value) {
    if (isGreenfieldCreateRequest(value)) return false;
    if (isProjectBrainstormRequest(value)) return true;
    if (isVagueGreenfieldRequest(value)) return true;
    const prompt = text(value);
    if (hasConcreteProductHint(prompt)
      && /\b(crear|quiero|vamos|necesito|hacer|construir|desarrollar|montar|armar)\b/i.test(prompt)) {
      return true;
    }
    return isPromptOnlySteering(value) || isGreenfieldSpecPrompt(value) || isPromptAnalysisRequest(value);
  }

  function findOriginalUserRequest(project, options = {}) {
    const stored = text(options.storedPrompt || "");
    // Prioridad: tarea activa / memoria actual — NUNCA el mensaje mas largo del historial
    // (eso reactivaba auditorias viejas y FOCO sticky en CONTINUA/PROCEDE).
    const active = text(project?.agentWorkflow?.task)
      || text(project?.analysisMemory?.request)
      || text(project?.durableWorkflow?.goal)
      || stored;
    if (active && !isAuthorization(active)) return active;

    const messages = Array.isArray(project?.messages) ? project.messages : [];
    // Recencia: ultimo user no-autorizacion (recorrido inverso).
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message || message.role !== "user") continue;
      const content = text(message.content || "");
      if (!content || isAuthorization(content)) continue;
      if (content.length >= 12) return content;
    }
    return stored && !isAuthorization(stored) ? stored : "";
  }

  function isConversationalFollowUp(value) {
    const prompt = text(value);
    if (!prompt) return false;
    return /^(?:qu[eé]|cu[aá]l)\s+(?:haremos|hacemos|sigue|siguiente|plan|paso)\b/i.test(prompt)
      || /^que\s+haremos\b/i.test(prompt)
      || /^(?:y\s+)?ahora\s+qu[eé]\b/i.test(prompt)
      || /^en\s+qu[eé]\s+consiste\b/i.test(prompt)
      || /^(?:explica(?:me)?|expl[ií]came)\b/i.test(prompt)
      || /^(?:dime|cu[eé]ntame)\s+(?:qu[eé]|por\s*qu[eé]|porque)\b/i.test(prompt)
      || /\bqu[eé]\s+(?:hiciste|haces|est[aá]s\s+haciendo|pasa(?:ste)?|falt[ao]|necesitas|hace\s+falta)\b/i.test(prompt)
      || /\b(?:por\s*qu[eé]|porque)\s+(?:no\s+)?(?:puedes|pudo|completar|terminar|responder|avanzas|haces\s+caso)\b/i.test(prompt);
  }

  /** Usuario corrige al agente ("haz lo que te pido") sin pedir un analisis nuevo. */
  function isUserDirectiveOrComplaint(value) {
    const prompt = text(value);
    if (!prompt || prompt.length > 400) return false;
    if (isFreshAnalysisRequest(prompt) || isAuthorization(prompt)) return false;
    if (isChangeRequest(prompt) && /\b(?:corrige|arregla|implementa|crea)\b.*\b(?:archivo|c[oó]digo|bug|error)\b/i.test(prompt)) {
      return false;
    }
    return /\bno\s+te\s+estoy\s+pidiendo\s+(?:eso|esto)\b/i.test(prompt)
      || /\bhaz\s+lo\s+que\s+te\s+pido\b/i.test(prompt)
      || /\bhaz(?:me)?\s+caso\b/i.test(prompt)
      || /\bno\s+hagas\s+lo\s+que\s+(?:t[uú]|el)\s+quier(?:es|a)\b/i.test(prompt)
      || /\bresponde\s+(?:mis?\s+)?preguntas?\b/i.test(prompt)
      || /\bno\s+quiero\s+(?:eso|otro\s+an[aá]lisis|m[aá]s\s+exploraci[oó]n)\b/i.test(prompt);
  }

  function isAgentWorkflowQuestion(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (isAuthorization(prompt)) return false;
    if (isChangeRequest(prompt)) return false;
    if (isRecoveryInstruction(prompt)) return false;
    // Pedido fresco de analisis profundo/completo NUNCA es pregunta de workflow.
    if (isFreshAnalysisRequest(prompt)) return false;
    if (/\b(?:haz(?:me)?|quiero|necesito|entregame|dame)\b.*\b(?:an[aá]lisis|reporte)\b/i.test(prompt)
      && /\b(?:completo|profundo|proyecto|errores|hallazgos)\b/i.test(prompt)
      && !/^(?:mu[eé]strame|dame|ensename)\s+(?:el\s+)?(?:reporte|resultado|hallazgos|avance)\s*(?:anterior|ya|guardado)?[?¿!.\s]*$/i.test(prompt)
      && !isConversationalFollowUp(prompt)
      && !isUserDirectiveOrComplaint(prompt)) {
      return false;
    }
    // Pregunta sobre lo que el agente hizo / por qué falló / qué falta.
    if (isConversationalFollowUp(prompt)) return true;
    return /\b(?:estado|avance|resultado|reporte|hallazgos)\b.*\b(?:tarea|an[aá]lisis|agente|plan)\b/i.test(prompt)
      || /\b(?:tarea|agente|plan)\b.*\b(?:estado|avance|resultado|reporte|hallazgos)\b/i.test(prompt)
      || /^(?:qu[eé]\s+(?:encontraste|detectaste|hallaste|corregiste|falta|sigue|pas[oó]|hiciste))[?¿!.\s]*$/i.test(prompt)
      || /^(?:mu[eé]strame|dame|ensename)\s+(?:el\s+)?(?:reporte|resultado|hallazgos|avance)(?:\s+(?:anterior|ya|guardado))?[?¿!.\s]*$/i.test(prompt)
      || /\bqu[eé]\s+hace\s+falta\b/i.test(prompt)
      || /\bpor\s*qu[eé]\s+no\s+(?:puedes|pudo|completar|terminar)\b/i.test(prompt);
  }

  function workflowQuestionContext(workflow = {}, analysisMemory = null) {
    const parts = [
      workflow.task ? `Tarea original:\n${workflow.task}` : "",
      workflow.plan ? `Analisis y plan de correccion:\n${workflow.plan}` : "",
      analysisMemory?.resultSummary ? `Memoria de analisis:\n${analysisMemory.resultSummary}` : "",
    ].filter(Boolean);
    return parts.join("\n\n");
  }

  function stripDiagnosticReadonlyClauses(value = "") {
    return text(value)
      .replace(/\bMODO:\s*DIAGN[ÓO]STICO[^\n]*/gi, "")
      .replace(/\bNO\s+MODIFIQUES?\b[^\n.]*/gi, "")
      .replace(/\bNO\s+MODIFICAR\b[^\n.]*/gi, "")
      .replace(/\bNO\s+CREES?\s+ARCHIVOS\b[^\n.]*/gi, "")
      .replace(/\bPROHIBIDO\s+write_file[^\n]*/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isJunkRepairTarget(filePath = "") {
    const p = text(filePath).replace(/\\/g, "/");
    if (!p) return true;
    if (/\.claude\//i.test(p) && /\.md$/i.test(p)) return true;
    if (/ANALISIS_ERRORES/i.test(p)) return true;
    if (/^ROADMAP(\/|$)/i.test(p) && /\.md$/i.test(p)) return true;
    return false;
  }

  function authorizedPlanExecutionPrompt(workflow = {}) {
    const original = stripDiagnosticReadonlyClauses(workflow.task || workflow.originalRequest || "Tarea pendiente");
    const plan = stripDiagnosticReadonlyClauses(workflow.plan || "");
    const cleanedPlan = plan
      .split(/\n/)
      .filter((line) => !isJunkRepairTarget(line) && !/ANALISIS_ERRORES|\.claude\/.*\.md/i.test(line))
      .join("\n")
      .trim();
    let fixQueueBlock = "";
    try {
      const { buildFixQueueFromReport, buildFixQueueExecutionPrompt, syncFixQueueWithSteps } = require("./runtime/fix-queue");
      const queue = Array.isArray(workflow.fixQueue) && workflow.fixQueue.length
        ? workflow.fixQueue
        : buildFixQueueFromReport(cleanedPlan, { findings: workflow.findings || [] });
      const synced = syncFixQueueWithSteps(queue, workflow.steps || [], "");
      fixQueueBlock = buildFixQueueExecutionPrompt(synced.queue, cleanedPlan, { steps: workflow.steps || [] });
    } catch {
      fixQueueBlock = "";
    }
    return [
      "AUTORIZACION DE EJECUCION (PROCEDE): las reglas de DIAGNOSTICO / NO MODIFICAR del analisis previo quedan ANULADAS para esta corrida.",
      "Puedes usar write_file y replace_in_file sobre codigo real del proyecto abierto.",
      "No uses .claude/*.md ni ROADMAP.md ni TODOs documentales como objetivo de correccion.",
      `SOLICITUD ORIGINAL (sanitizada):\n${original || "Tarea pendiente"}`,
      fixQueueBlock || (cleanedPlan ? `PLAN YA AUTORIZADO POR EL USUARIO:\n${cleanedPlan}` : ""),
      "INSTRUCCION DE EJECUCION:",
      "El usuario ya autorizo con procede/continua/adelante. Ejecuta cambios reales con herramientas ahora.",
      "NO generes otro plan. NO repitas ## Entendimiento ni ## Plan paso a paso. NO cierres pidiendo autorizacion otra vez.",
      "PROHIBIDO narrar 'ACCION 1/2/3' sin invocar write_file o replace_in_file. Sin mutacion real no hay progreso.",
      "Prioriza codigo fuente del producto (src/, app/, lib/). IGNORA ROADMAP.md como objetivo.",
      "Narra en el chat cada avance en ESPAÑOL (que revisas, que cambias, que verificas) sin pegar codigo fuente ni bloques ```.",
      "PROHIBIDO usar run_command con cmd, powershell, type, cat o Get-Content para leer archivos. Usa SOLO read_file / search_files / list_files.",
      "Para archivos EXISTENTES: read_file primero, luego replace_in_file con oldText exacto. write_file completo solo para archivos NUEVOS.",
      "Al terminar incluye ## Evidencia de correccion.",
      "Usa herramientas hasta completar y verificar los cambios.",
    ].filter(Boolean).join("\n\n");
  }

  /**
   * PROCEDE + cuerpo concreto (path/cambio) → true (no es solo autorizacion vacia).
   */
  function hasConcreteAuthorizedTask(userPrompt = "") {
    const raw = text(userPrompt);
    if (!/^\s*(?:procede|adelante|autorizo|contin[uú]a)\b/i.test(raw)) return false;
    const body = raw
      .replace(/^\s*(?:procede|adelante|autorizo|contin[uú]a)\b(?:\s*[:.\-–—]\s*|\s+)/i, "")
      .trim();
    if (body.length < 12 || isAuthorization(body)) return false;
    return isChangeRequest(body)
      || /\b(?:replace_in_file|write_file|read_file|cambia(?:r)?|reemplaza(?:r)?|crea(?:r)?|borra(?:r)?|elimina(?:r)?)\b/i.test(body)
      || /\b(?:src|resources|runtime|app)\/[\w./-]+\.\w+\b/i.test(body);
  }

  /**
   * PROCEDE + cuerpo concreto (path/cambio) → ejecutar ese pedido, no el plan forense antiguo.
   * PROCEDE solo → authorizedPlanExecutionPrompt(workflow).
   */
  function resolveAuthorizedExecutionPrompt(userPrompt, workflow = {}, storedTask = "") {
    const raw = text(userPrompt);
    const body = raw
      .replace(/^\s*(?:procede|adelante|autorizo|contin[uú]a)\b(?:\s*[:.\-–—]\s*|\s+)/i, "")
      .trim();
    if (hasConcreteAuthorizedTask(raw)) {
      return [
        "AUTORIZACION DE EJECUCION (PROCEDE): pedido concreto del usuario.",
        "Las reglas de DIAGNOSTICO / NO MODIFICAR del analisis previo quedan ANULADAS para esta corrida.",
        `TAREA CONCRETA:\n${body}`,
        "Ejecuta ESTA tarea con herramientas reales (read_file, replace_in_file, write_file).",
        "NO sustituyas por un plan forense antiguo ni por ANALISIS_ERRORES. NO pidas autorizacion otra vez.",
        "Para archivos existentes: read_file, luego replace_in_file con oldText exacto.",
        "Al terminar incluye ## Evidencia de correccion.",
      ].join("\n\n");
    }
    return authorizedPlanExecutionPrompt({
      ...workflow,
      task: storedTask || workflow.task || workflow.originalRequest || "",
    });
  }

  function isRecoveryInstruction(value) {
    return RECOVERY_PATTERN.test(text(value));
  }

  function isUserStopInstruction(value) {
    const prompt = text(value).trim().toLowerCase().replace(/[.!?,;]+$/g, "");
    if (!prompt) return false;
    if (/^(?:por\s+favor\s+)?(?:alto|detente|det[eé]n(?:lo)?|detener|parar?|p[aá]ralo|stop|cancela(?:r|lo)?|aborta(?:r|lo)?|interrump(?:e|ir|alo)?|basta|escala|pausa(?:r)?|no\s+sigas)$/i.test(prompt)) {
      return true;
    }
    if (/^(?:por\s+favor\s+)?(?:cancela|cancelar|det[eé]n|detener|parar?|p[aá]ralo|aborta|abortar|pausa|pausar|interrumpir)\s+(?:el\s+an[aá]lisis|la\s+tarea|la\s+ejecuci[oó]n|esto|todo|el\s+proceso|la\s+b[uú]squeda)$/i.test(prompt)) {
      return true;
    }
    if (/^(?:ya\s+)?(?:no\s+sigas|deja\s+de\s+(?:analizar|buscar|ejecutar|trabajar|hacer\s+nada))$/i.test(prompt)) {
      return true;
    }
    return false;
  }

  function isKeepGoingInstruction(value) {
    const prompt = text(value);
    if (!prompt || /[?¿]/.test(prompt)) return false;
    return /\bno\s+te\s+detengas\b|\bno\s+pares\b|\bsigue(?:\s+(?:adelante|con(?:\s+(?:eso|la\s+tarea)?))?)?\b/i.test(prompt)
      && prompt.length < 120;
  }

  // Reorienta la corrida viva. Nudges / "porque no avanzas" NO deben abrir un 2º agente ciego.
  function shouldSteerLiveAgent(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (isUserStopInstruction(prompt)) return true;
    if (isAuthorization(prompt)) return true;
    if (isKeepGoingInstruction(prompt) && !isChangeRequest(prompt)) return true;
    if (isRecoveryInstruction(prompt) && prompt.length < 160) return true;
    if (prompt.length < 320 && !isChangeRequest(prompt)
      && /\b(?:por\s*qu[eé]|porque|avanza(?:s|r)?|tardas|atasca|trabad[oa]|stuck|sigue|contin[uú]a|procede|qu[eé]\s+pasa|estado|no\s+avanza)\b/i.test(prompt)) {
      return true;
    }
    return false;
  }

  function isAgentTaskFeedback(value) {
    const prompt = text(value);
    return /\b(?:dejas|dejaste|a medias|sin terminar|no la terminas|no terminaste|no acabaste|incompleta|a la mitad|por qu[eé] no terminas|porque no terminas)\b/i.test(prompt)
      && /\b(?:tarea|trabajo|agente|esto|lo)\b/i.test(prompt);
  }

  function redactCredentials(value) {
    return text(value)
      .replace(CREDENTIAL_LABEL_PATTERN, "$1[REDACTED]")
      .replace(/\bBearer\s+[A-Za-z0-9_.\-+/=]{12,}/gi, "Bearer [REDACTED]")
      .replace(URL_CREDENTIAL_PATTERN, "$1[REDACTED]");
  }

  function recoveryPrompt(workflow = {}, instruction = "") {
    const original = text(workflow.task || workflow.originalRequest || "Tarea pendiente");
    const plan = text(workflow.plan || "");
    const failure = text(workflow.error || "");
    const direction = text(instruction || "Continua hasta completar y verificar la tarea.");
    return [
      `SOLICITUD ORIGINAL:\n${original}`,
      plan ? `PLAN AUTORIZADO:\n${plan}` : "",
      failure ? `ESTADO DE REANUDACION:\n${failure}` : "",
      `INSTRUCCION ACTUAL:\n${direction}`,
      "La autorizacion original sigue vigente. Retoma los checkpoints disponibles, corrige los fallos y completa la solicitud sin pedir otra autorizacion.",
    ].filter(Boolean).join("\n\n");
  }

  function isPercentageQuestion(value) {
    const prompt = text(value);
    return /\b(?:porcentaje|por\s+ciento|avance)\b/i.test(prompt);
  }

  function isTaskStatusQuestion(value) {
    const prompt = text(value);
    if (/^[?¿!\s]$/.test(prompt)) return false;
    return /^(?:qu[eé]\s+(?:sigue|prosigue|falta|pasa|pas[oó])|cu[aá]l\s+es\s+el\s+estado|estado(?:\s+de\s+la\s+tarea)?|avance|sigues\s+(?:trabajando|ah[ií]))[?¿!.\s]*$/i.test(prompt)
      || /^[?¿!]{2,}$/.test(prompt);
  }

  function isAnalysisFollowUp(value, hasAnalysis = true) {
    if (!hasAnalysis) return false;
    const prompt = text(value);
    // Pedido fresco de analisis profundo NUNCA es follow-up de memoria.
    if (isFreshAnalysisRequest(prompt)) return false;
    if (/\b(?:profundo|completo|todo\s+el\s+proyecto|reanaliza|desde\s+cero|nuevo\s+an[aá]lisis)\b/i.test(prompt)
      && /\b(?:an[aá]lisis|audita|diagnostica|reporte|hallazgos)\b/i.test(prompt)) {
      return false;
    }
    return isPercentageQuestion(prompt)
      || isProposalFollowUp(prompt)
      || FOLLOW_UP_PATTERN.test(prompt)
      || /\b(?:acabas\s+de\s+analizar|an[a\u00e1]lisis\s+anterior|proyecto\s+analizado|esa\s+misma)\b/i.test(prompt);
  }

  /** Publicar / deploy / conectar nube: fuerza agente + EXECUTE (no chat narrativo). */
  function isCloudOperateRequest(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (/\b(solo\s+explica|sin\s+publicar|no\s+public(?:ues|ar)|no\s+despliegues)\b/i.test(prompt)) return false;
    return /\b(publica(?:r|ci[oó]n)?|deploy|despleg[aeo]|redeploy|actualizar?\s+publicaci[oó]n)\b/i.test(prompt)
      || (/\b(conecta(?:r)?|enlaza(?:r)?|vincula(?:r)?|aprovision(?:ar)?|onboard(?:ing)?)\b/i.test(prompt)
        && /\b(github|vercel|supabase|gafcore|gateway|servicios?)\b/i.test(prompt));
  }

  function isChangeRequest(value) {
    const prompt = text(value);
    if (isProjectIntentComment(prompt)) return false;
    if (shouldAnalyzePromptFirst(prompt) || isGreenfieldSpecPrompt(prompt)) return false;
    // Pedir propuesta/plan de correccion NO es autorizar ejecucion.
    if (isProposalFollowUp(prompt)) return false;
    // "ANALIZA ... hallazgos a corregir" = reporte, no mutar ahora.
    if (isFreshAnalysisRequest(prompt)
      && /\b(?:reporte|hallazgos|diagn[oó]stico|an[aá]lisis)\b/i.test(prompt)
      && !isAuthorization(prompt)) {
      return false;
    }
    if (/\b(?:hallazgos?\s+a\s+corregir|(?:a|para)\s+corregir)\b/i.test(prompt)
      && /\b(?:analiza|reporte|hallazgos|diagn[oó]stico|an[aá]lisis)\b/i.test(prompt)
      && !isAuthorization(prompt)) {
      return false;
    }
    if (isCloudOperateRequest(prompt)) return true;
    return /\b(crea|crear|corrige|corrije|corregir|modifica|modificar|agrega|agregar|elimina|eliminar|instala|instalar|implementa|implementar|repara|reparar|actualiza|actualizar|cambia|cambiar|construye|construir|desarrolla|desarrollar|configura|configurar|haz|hacer|arregla|arreglar|soluciona|solucionar|resuelve|resolver|integra|integrar|conecta|conectar|restaura|restaurar|recupera|recuperar|termina|terminar|aplica|aplicar|quiero que hagas|necesito que hagas|publica|publicar|deploy|despliega|desplegar)\b/i.test(prompt)
      || /\b(no puede|no puedo|no funciona|no responde|no modifica|no corrige|bloquead[oa]|error(?:es)?|fall[ao]|roto|rompe|permisos?|acceso)\b/i.test(prompt)
        && /\b(corrige|corregir|arregla|arreglar|repara|reparar|soluciona|solucionar|haz|hacer|funcione|modifica|modificar)\b/i.test(prompt);
  }

  function isProposalFollowUp(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (isAuthorization(prompt)) return false;
    if (/\b(?:crear|construir|nueva|nuevo|arquitect[oó]nica)\b/i.test(prompt)) return false;
    return /\b(?:propuesta|propon(?:e|es|er)|c[oó]mo\s+(?:lo\s+)?(?:correg|arreglar)|orden\s+de\s+reparaci|qu[eé]\s+har[ií]as|cu[aá]l\s+ser[ií]a\s+tu\s+propuesta|plan\s+de\s+correcci)\b/i.test(prompt)
      && !/\b(?:procede|autorizo|adelante|hazlo|ejecuta|apl[ií]calo)\b/i.test(prompt);
  }

  function isUsefulAnalysisMemory(memory = null) {
    if (!memory || typeof memory !== "object") return false;
    const summary = text(memory.resultSummary);
    const files = Array.isArray(memory.filesInspected) ? memory.filesInspected.filter(Boolean) : [];
    const plan = text(memory.plan || memory.workflowPlan);
    if (files.length > 0) return true;
    if (plan.length > 80) return true;
    if (summary.length < 40) return false;
    if (/Falta informaci[oó]n|NO-GO|NO EXISTE EVIDENCIA SUFICIENTE|No hay memoria de analisis/i.test(summary)) {
      return false;
    }
    return true;
  }

  function hydrateAnalysisMemoryFromSources(memory = null, { history = [], workflow = null, projectName = "", projectRoot = "" } = {}) {
    const base = memory && typeof memory === "object" ? { ...memory } : {};
    if (isUsefulAnalysisMemory(base)) {
      return {
        ...base,
        projectName: text(base.projectName) || text(projectName) || "Proyecto",
        projectRoot: text(base.projectRoot) || text(projectRoot),
      };
    }

    const workflowPlan = text(workflow?.plan);
    const workflowTask = text(workflow?.task);
    if (workflowPlan.length > 80) {
      return buildAnalysisMemory({
        projectName: text(base.projectName) || text(projectName) || "Proyecto",
        projectRoot: text(base.projectRoot) || text(projectRoot),
        request: text(base.request) || workflowTask,
        resultText: workflowPlan,
        model: text(base.model),
        steps: [
          ...(Array.isArray(base.filesInspected)
            ? base.filesInspected.map((p) => ({ name: "read_file", path: p, ok: true }))
            : []),
          ...(Array.isArray(base.commands)
            ? base.commands.map((c) => ({ name: "run_command", command: c.command || c, ok: c.ok !== false }))
            : []),
        ],
        report: { completed: true, toolCount: Number(base.toolCount || 0) },
        generatedAt: base.generatedAt || workflow?.updatedAt || Date.now(),
      });
    }

    const messages = Array.isArray(history) ? history : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (String(msg?.role || "") !== "assistant") continue;
      const content = text(msg?.content);
      if (content.length < 80) continue;
      if (!isAnalysisReport(content) && !isPendingAnalysisPlan(content)
        && !/\b(?:hallazgos|an[aá]lisis|diagn[oó]stico|propuesta|archivos?\s+inspeccion|recomend)/i.test(content)) {
        continue;
      }
      if (/No hay memoria de analisis util/i.test(content)) continue;
      return buildAnalysisMemory({
        projectName: text(base.projectName) || text(projectName) || "Proyecto",
        projectRoot: text(base.projectRoot) || text(projectRoot),
        request: text(base.request) || workflowTask || "Analisis previo del chat",
        resultText: content.slice(0, 4000),
        model: text(base.model),
        steps: [],
        report: { completed: true, toolCount: Number(base.toolCount || 0) },
        generatedAt: msg?.at || msg?.updatedAt || Date.now(),
      });
    }

    return Object.keys(base).length ? base : null;
  }

  function proposalFromAnalysisMemory(memory = {}) {
    const files = Array.isArray(memory.filesInspected) ? memory.filesInspected.filter(Boolean) : [];
    const summary = text(memory.resultSummary);
    const hollow = /Falta informaci[oó]n|NO-GO|NO EXISTE EVIDENCIA SUFICIENTE/i.test(summary);
    const lines = [
      "## Propuesta de correccion (desde el analisis ya hecho — sin reexplorar)",
      "",
    ];
    if (!isUsefulAnalysisMemory(memory) && !summary && !files.length) {
      lines.push("No hay memoria de analisis util. Ejecuta de nuevo un analisis/auditoria y luego pide la propuesta.");
      return lines.join("\n");
    }
    if (hollow) {
      lines.push("El informe anterior quedo hueco (dijo que faltaba contexto pese a lecturas). No sirve como base forense.");
      lines.push("");
      lines.push("### Que hacer ahora");
      lines.push("1. Releer solo los puntos de early-exit/completion en el runtime (no todo el repo).");
      lines.push("2. Anclar el primer punto de falla a funcion + archivo + condicion.");
      lines.push("3. Recien despues, autorizar correcciones con **procede**.");
      lines.push("");
    } else if (summary) {
      lines.push("### Base del analisis previo");
      lines.push(summary.slice(0, 2800));
      lines.push("");
    }
    if (files.length) {
      lines.push("### Archivos ya inspeccionados (reutilizar, no releer en bucle)");
      for (const file of files.slice(0, 40)) lines.push(`- ${file}`);
      lines.push("");
    }
    lines.push("### Orden de reparacion propuesto");
    lines.push("1. Priorizar hallazgos de mayor impacto (errores/bloqueos) sobre mejoras cosméticas.");
    lines.push("2. Conservar extractos forenses tras compactar contexto (no solo metadatos).");
    lines.push("3. Aplicar cambios acotados por archivo; verificar preview/tests tras cada lote.");
    lines.push("4. Preguntas de propuesta → respuesta desde memoria, sin nueva exploracion.");
    lines.push("5. Autoriza **procede** solo cuando quieras aplicar los cambios.");
    return lines.join("\n");
  }

  function classifyPromptIntent(value, hasAnalysis = false) {
    const prompt = text(value);
    if (isAuthorization(prompt)) return "authorization";
    // Consultas informativas sobre la app/agente: NUNCA análisis ni tools
    if (/\b(?:para\s+qu[eé]\s+(?:sirve|funciona|es)|qu[eé]\s+(?:hace|es|es\s+esta)|qui[eé]n\s+eres|c[oó]mo\s+te\s+llamas|ayuda)\b/i.test(prompt)
      && !/\b(?:corrije|corrige|arregla|implementa|analiza|audita|crea\s+un|modifica)\b/i.test(prompt)) {
      return "conversation";
    }
    if (isChangeRequest(prompt)) return "task";
    if (isAnalysisFollowUp(prompt, hasAnalysis)) return "followup";
    if (/^(analiza|revisa|verifica|investiga|busca|encuentra|diagnostica|audita|haz(?:me)?\s+(?:un\s+)?an[aá]lisis)\b/i.test(prompt)) return "analysis";
    if (isFreshAnalysisRequest(prompt)) return "analysis";
    if (/\b(?:an[aá]lisis|audita|diagnostica|reporte\s+completo)\b/i.test(prompt)
      && /\b(?:proyecto|repo|carpeta|c[oó]digo|hallazgos)\b/i.test(prompt)) {
      return "analysis";
    }

    // Saludos puros → conversación local (no necesitan modelo)
    if (/^(hola|hi|hello|hey|buenas|buenos dias|buenas tardes|buenas noches|gracias|c[o\u00f3]mo est[a\u00e1]s|qui[e\u00e9]n eres)[.!? ]*$/i.test(prompt)) return "conversation";

    // Si hay historial de análisis, preguntas cortas y quejas deben ir al modelo para que responda con contexto.
    // Mantenemos la lógica de "conversation" solo para saludos o frases muy breves sin intención clara.
    if (hasAnalysis) {
      if (/[?¿]/.test(prompt)) return "followup"; // preguntas sobre el análisis van a follow‑up
      if (isConversationalFollowUp(prompt)) return "followup";
    }
    // Sin historial: solo saludos y frases triviales se consideran conversaciones locales.
    // Eliminamos la regla genérica que convertía cualquier '?' en "conversation".
    // El resto se delega a "task" para que el modelo procese la petición.
    if (isProjectIntentComment(prompt)) return "conversation";
    if (/^(qu[e\u00e9] pas[o\u00f3]|por qu[e\u00e9] no contestas|ya est[a\u00e1]s (?:operativo|operativamente funcional)|est[a\u00e1]s (?:operativo|funcionando))[.!? ]*$/i.test(prompt)) return "conversation";
    return "task";
  }

  function compactStep(step) {
    const input = step?.input || {};
    const result = step?.result || {};
    return {
      name: text(step?.name),
      ok: step?.ok !== false && !result?.error,
      path: text(input.path),
      query: text(input.query),
      command: text(input.command),
      error: text(result?.error).slice(0, 400),
      output: text(result?.output).replace(/\s+/g, " ").slice(0, 600),
    };
  }

  function buildAnalysisMemory(input = {}) {
    const steps = (input.steps || []).map(compactStep);
    const files = [...new Set(steps
      .filter((step) => step.name === "read_file" && step.path && step.ok === true)
      .map((step) => {
        let rel = text(step.path).replace(/\\/g, "/").replace(/^\.\//, "");
        const marker = "/src/";
        const idx = rel.toLowerCase().indexOf(marker);
        if (idx >= 0) rel = rel.slice(idx + 1);
        return rel;
      }))];
    const commands = steps.filter((step) => step.name === "run_command" && step.command);
    return {
      version: 1,
      projectName: text(input.projectName) || "Proyecto",
      projectRoot: text(input.projectRoot),
      request: text(input.request).slice(0, 1200),
      resultSummary: text(input.resultText).slice(0, 4000),
      model: text(input.model),
      generatedAt: new Date(Number(input.generatedAt) || Date.now()).toISOString(),
      completed: input.report?.completed === true,
      toolCount: Number(input.report?.toolCount || steps.length),
      filesInspected: files.slice(0, 80),
      searches: steps.filter((step) => step.name === "search_files" && step.query).map((step) => step.query).slice(0, 30),
      commands: commands.slice(0, 30),
      requirements: Array.isArray(input.requirements) ? input.requirements.slice(0, 100) : [],
    };
  }

  function commandEvidence(memory, pattern) {
    return (memory?.commands || []).filter((item) => pattern.test(item.command));
  }

  function evidenceCategory(id, label, weight, rows) {
    if (!rows.length) return { id, label, weight, status: "unknown", evidence: "No verificado" };
    const ok = rows.every((item) => item.ok === true);
    return {
      id,
      label,
      weight,
      status: ok ? "pass" : "fail",
      evidence: rows.map((item) => `${item.command}: ${item.ok ? "OK" : item.error || "fallo"}`).join(" | ").slice(0, 800),
    };
  }

  function assessCompletion(memory = {}) {
    const categories = [
      evidenceCategory("functional", "Flujos funcionales/E2E", 30, commandEvidence(memory, /(?:playwright|cypress|e2e|integration)/i)),
      evidenceCategory("backend", "Backend y datos", 20, commandEvidence(memory, /(?:migration|migrate|database|supabase|prisma)/i)),
      evidenceCategory("tests", "Pruebas automatizadas", 15, commandEvidence(memory, /(?:^|\s)(?:npm|pnpm|yarn|bun)?\s*(?:run\s+)?test\b|node\s+--test/i)),
      evidenceCategory("security", "Seguridad", 10, commandEvidence(memory, /(?:audit|security|sast|semgrep)/i)),
      evidenceCategory("quality", "TypeScript, lint y calidad", 10, commandEvidence(memory, /(?:typecheck|tsc|lint|check)/i)),
      evidenceCategory("production", "Build y produccion", 10, commandEvidence(memory, /(?:^|\s)(?:npm|pnpm|yarn|bun)?\s*(?:run\s+)?build\b/i)),
      {
        id: "documentation",
        label: "Documentacion",
        weight: 5,
        status: (memory.filesInspected || []).some((file) => /(?:^|\/)readme\.md$/i.test(file)) ? "pass" : "unknown",
        evidence: (memory.filesInspected || []).find((file) => /(?:^|\/)readme\.md$/i.test(file)) || "No verificado",
      },
    ];
    const evaluatedWeight = categories.filter((item) => item.status !== "unknown").reduce((sum, item) => sum + item.weight, 0);
    const passedWeight = categories.filter((item) => item.status === "pass").reduce((sum, item) => sum + item.weight, 0);
    const requirements = Array.isArray(memory.requirements) ? memory.requirements : [];
    const verifiedRequirements = requirements.filter((item) => item?.verified === true && item?.complete === true).length;
    const determinable = requirements.length > 0 && requirements.every((item) => item?.verified === true) && evaluatedWeight >= 70;
    const completionPercent = determinable ? Math.round((verifiedRequirements / requirements.length) * 100) : null;
    return {
      determinable,
      completionPercent,
      verificationCoveragePercent: categories.reduce((sum, item) => sum + (item.status === "unknown" ? 0 : item.weight), 0),
      verifiedReadinessPercent: evaluatedWeight ? Math.round((passedWeight / evaluatedWeight) * 100) : null,
      evaluatedWeight,
      passedWeight,
      categories,
      requirementsTotal: requirements.length,
      requirementsVerified: requirements.filter((item) => item?.verified === true).length,
    };
  }

  function analysisContext(memory = {}) {
    const assessment = assessCompletion(memory);
    return [
      "MEMORIA VERIFICADA DEL ULTIMO ANALISIS (usa este contexto para referencias como 'esa app'):",
      `Proyecto: ${memory.projectName || "Proyecto"}`,
      `Ruta: ${memory.projectRoot || "no disponible"}`,
      `Solicitud: ${memory.request || "no disponible"}`,
      `Fecha: ${memory.generatedAt || "no disponible"}`,
      `Modelo: ${memory.model || "no disponible"}`,
      `Herramientas ejecutadas: ${memory.toolCount || 0}`,
      `Archivos leidos: ${(memory.filesInspected || []).join(", ") || "ninguno registrado"}`,
      `Comandos: ${(memory.commands || []).map((item) => `${item.command}=${item.ok ? "OK" : "FALLO"}`).join("; ") || "ninguno"}`,
      `Porcentaje de terminacion: ${assessment.determinable ? `${assessment.completionPercent}%` : "NO DETERMINABLE con la evidencia actual"}`,
      `Cobertura de verificacion: ${assessment.verificationCoveragePercent}%`,
      `Resumen anterior: ${text(memory.resultSummary).slice(0, 2600)}`,
      "No inventes evidencia ausente y no pidas autorizacion para responder preguntas informativas.",
    ].join("\n");
  }

  function percentageResponse(memory = {}) {
    const assessment = assessCompletion(memory);
    const heading = assessment.determinable
      ? `Porcentaje de terminacion verificado: ${assessment.completionPercent}%`
      : "Porcentaje de terminacion: no determinable todavia";
    const rows = assessment.categories.map((item) => `- ${item.label} (${item.weight}%): ${item.status === "pass" ? "aprobado" : item.status === "fail" ? "fallo" : "no verificado"}. Evidencia: ${item.evidence}`);
    return [
      `## ${memory.projectName || "Proyecto"}`,
      "",
      heading,
      "",
      assessment.determinable
        ? `Requisitos verificados: ${assessment.requirementsVerified}/${assessment.requirementsTotal}.`
        : "El analisis anterior no comparo todos los requisitos funcionales contra resultados ejecutados; asignar un porcentaje de terminacion seria inventarlo.",
      `Cobertura real de comprobaciones ejecutadas: ${assessment.verificationCoveragePercent}% (no equivale al avance del producto).`,
      "",
      "### Evidencia disponible",
      ...rows,
      "",
      "Para calcular el porcentaje de terminacion faltan una linea base completa de requisitos y verificar cada requisito, ademas de los puntos marcados como no verificados.",
    ].join("\n");
  }

  function extractAbsolutePathHints(value) {
    // Misma normalizacion que extractProjectPaths: acepta `D:PROGRAMAS IA` y lo convierte a `D:\PROGRAMAS IA`.
    return extractProjectPaths(value);
  }

  function hasUsableAbsolutePath(value) {
    return extractAbsolutePathHints(value).length > 0;
  }

  /** "abre el proyecto TAXIDRIV" / "abrir TAXIDRIV" / "entra a Documentos" → nombre. */
  function extractOpenProjectName(value) {
    const prompt = text(value);
    if (!prompt) return "";
    const patterns = [
      /^\s*(?:abre|abrir|abreme|open|entra(?:r)?|ingresa(?:r)?|ve\s+a)\s+(?:a\s+|en\s+|al\s+)?(?:el\s+|la\s+)?(?:proyecto|carpeta|folder|directorio)\s+["'`]?([^"'`\n]+?)["'`]?\s*[.!]?\s*$/i,
      /^\s*(?:abre|abrir|abreme|open|entra(?:r)?|ingresa(?:r)?)\s+(?:a\s+|en\s+|al\s+)?["'`]?([A-Za-z0-9][^"'`\n]{0,80}?)["'`]?\s*[.!]?\s*$/i,
    ];
    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (!match) continue;
      let name = cleanProjectPath(match[1] || "");
      name = name.replace(/^(?:el|la|los|las|un|una|mis|mi)\s+/i, "").trim();
      if (!name) continue;
      if (/^(?:proyecto|carpeta|folder|archivo|ruta|directorio)$/i.test(name)) continue;
      if (/^[a-zA-Z]:[\\/]/.test(name) || name.startsWith("\\\\") || name.startsWith("/")) continue;
      if (/\b(analiza|listar?|enlista|corrige|crea|implementa)\b/i.test(name)) continue;
      return name;
    }
    return "";
  }

  /**
   * "ANALIZA CALILI …" / "revisa TAXIDRIV y dame un reporte" → nombre de carpeta del catalogo.
   * No exige verbo abrir: el usuario quiere entrar al proyecto y trabajar.
   */
  function extractReferencedProjectName(value) {
    const prompt = text(value);
    if (!prompt) return "";
    // Pedido acotado a un archivo del proyecto YA abierto: NUNCA cambiar de carpeta.
    if (isScopedDiskFileRequest(prompt)) return "";
    const openName = extractOpenProjectName(value);
    if (openName) return openName;
    const adverbSkip = "(?:completamente|completo|profundo|a\\s+fondo|en\\s+detalle|quir[uú]rgicamente|solo|unicamente|[uú]nicamente|solamente)";
    const patterns = [
      /^\s*(?:analiza|audita|diagnostica|revisa|explora|inspecciona|lee|aborda)\s+(?:el\s+|la\s+)?(?:proyecto|carpeta|folder|app|aplicaci[oó]n|codigo|c[oó]digo)\s+["'`]?([A-Za-z0-9][\w.-]{0,80})["'`]?/i,
      // "analiza completamente TAXIDRIV" / "analiza unicamente package.json" (adverbio, no nombre)
      new RegExp(`^\\s*(?:analiza|audita|diagnostica|revisa|explora)\\s+${adverbSkip}?\\s*["'\`]?([A-Za-z0-9][\\w.-]{1,80})["'\`]?`, "i"),
      /^\s*(?:analiza|audita|diagnostica|revisa|explora|inspecciona)\s+["'`]?([A-Za-z0-9][\w.-]{1,80})["'`]?/i,
      // "HAZME UN ANALISIS ... DEL PROYECTO TAXIDRIV" / "analisis profundo de todo el proyecto X"
      /\bhaz(?:me)?\s+(?:un\s+)?an[aá]lisis\b[\s\S]{0,160}?\b(?:del?\s+|de\s+(?:todo\s+el\s+)?)?proyecto\s+["'`]?([A-Za-z0-9][\w.-]{1,80})/i,
      /\b(?:an[aá]lisis|audita|diagnostica|reporte)\b[\s\S]{0,160}?\b(?:del?\s+|de\s+(?:todo\s+el\s+)?)?proyecto\s+["'`]?([A-Za-z0-9][\w.-]{1,80})/i,
    ];
    const nameStop = /^(?:el|la|los|las|un|una|mis|mi|del|de|al|en|por|para|con|sin|sobre|desde|hasta|cuando|como|porque|porqu[eé]|why|how|what|when|where|which|that|the|a|an|solo|solamente|unicamente|[uú]nicamente|archivo|archivos|fichero|ruta|path|file|files|proyecto|carpeta|folder|directorio|codigo|c[oó]digo|app|aplicaci[oó]n|este|esta|aqui|aqu[ií]|all[ií]|alli|quirurgicamente|quir[uú]rgicamente|todo|completo|completamente|profundo|detalle|fondo|raiz|ra[ií]z|nada|mas|m[aá]s|no|si|s[ií]|ia|ai|la|servicio|service|servise)$/i;
    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (!match) continue;
      let name = cleanProjectPath(match[1] || "");
      name = name.replace(/^(?:el|la|los|las|un|una|mis|mi)\s+/i, "").trim();
      // Cortar cola: "TAXIDRIV Y DAME..." / "TAXIDRIV." → TAXIDRIV
      name = name.split(/\s+/)[0] || "";
      name = name.replace(/[.,;:!?]+$/g, "").trim();
      if (!name) continue;
      // Artículos / genéricos / adverbios / conjunciones: "analiza porque" NO es un nombre.
      if (nameStop.test(name)) continue;
      // Frases interrogativas / causa: "analiza porque X" nunca debe abrir carpeta "porque".
      if (/^(?:porque|porqu[eé]|por)$/i.test(name)) continue;
      // Nunca tratar un archivo (package.json) como nombre de proyecto.
      if (/\.(?:js|ts|tsx|jsx|mjs|cjs|json|md|py|css|html|vue|svelte)$/i.test(name)) continue;
      if (name.length < 2) continue;
      if (/^[a-zA-Z]:[\\/]/.test(name) || name.startsWith("\\\\") || name.startsWith("/")) continue;
      return name;
    }
    return "";
  }

  function isOpenNamedProjectRequest(value) {
    if (extractOpenProjectName(value)) return true;
    const prompt = text(value);
    // "abre" / "abre el proyecto" / "abrir carpeta" sin nombre → dialogo Abrir
    if (/^\s*(?:abre|abrir|abreme|open)(?:\s+(?:el\s+|la\s+)?(?:proyecto|carpeta|folder))?\s*[.!]?\s*$/i.test(prompt)) {
      return true;
    }
    // "abre D:\Users\...\Documents" u otra ruta absoluta
    if (!/^\s*(?:abre|abrir|abreme|open|entra(?:r)?|ingresa(?:r)?)\b/i.test(prompt)) return false;
    return hasUsableAbsolutePath(prompt);
  }

  /** Solo "abre X" sin pedido de analisis/trabajo: UI local. Si hay analiza/revisa/etc., el chat debe continuar con el agente. */
  function isPureOpenProjectRequest(value) {
    if (isSwitchProjectRequest(value)) return false;
    if (!isOpenNamedProjectRequest(value)) return false;
    const prompt = text(value);
    if (/\b(analiza|audita|diagnostica|revisa|explora|inspecciona|corrige|crea|implementa|arregla|fix|reporte|hallazgos|mejora)\b/i.test(prompt)) {
      return false;
    }
    if (extractReferencedProjectName(prompt) && !/^\s*(?:abre|abrir|abreme|open|entra(?:r)?|ingresa(?:r)?)\b/i.test(prompt)) {
      return false;
    }
    return true;
  }

  /** "cierra el proyecto" / "cerrar proyecto" — accion de UI, no del agente. */
  function isCloseProjectRequest(value) {
    const prompt = text(value);
    if (!prompt) return false;
    if (isSwitchProjectRequest(prompt)) return false;
    if (/^\s*(?:cierra|cerrar|cierrame|close)\s+(?:el\s+|la\s+)?(?:proyecto|carpeta|folder|sesi[oó]n|session)\s*[.!]?\s*$/i.test(prompt)) {
      return true;
    }
    return /^\s*(?:cierra|cerrar|close)\s+(?:el\s+)?proyecto\b/i.test(prompt)
      && !/\b(abre|abrir|abreme|abrime|abras|crea|analiza|listar?|enlista)\b/i.test(prompt);
  }

  /**
   * "cierrame este y abrime EDITCOREAI" / "cierra FUXION y abre el proyecto X".
   * Accion de UI atomica (switch_project), no narracion del modelo.
   * NO debe dispararse en auditorias/analisis que solo mencionan "cerrar" y "abrir" en prosa.
   */
  function isSwitchProjectRequest(value) {
    const prompt = text(value);
    if (!prompt) return false;
    // Auditorias / specs largas: nunca tratar como cambio de workspace.
    if (prompt.length > 360) return false;
    if (/\b(auditor[ií]a|an[aá]lisis integral|objetivos obligatorios|mapeo y validaci[oó]n|inventario de rupturas|plan de reparaci[oó]n|resumen ejecutivo|canales ipc|sin concesiones)\b/i.test(prompt)) {
      return false;
    }
    if (/\b(analiza|audita|diagnostica|revisa|explora|inspecciona|reporte|hallazgos|mapea|rastrea)\b/i.test(prompt)
      && !/\b(?:ci[eé]rrame|cierrame\s+este|cierra\s+este|abre(?:me|me)?\s+(?:el\s+)?proyecto\s+\w)/i.test(prompt)) {
      return false;
    }
    const switchIntent = /\b(?:ci[eé]rrame|cierrame|cierra|cerrar|cierres|close)\b[\s\S]{0,120}\b(?:abre|abrir|abreme|abrime|abras|open)\b/i.test(prompt)
      || /\b(?:abre|abrir|abreme|abrime|abras|open)\b[\s\S]{0,80}\b(?:cierra|cerrar|cierrame|cierres|close)\b/i.test(prompt)
      || /\b(?:cambia(?:r)?|switch)\s+(?:(?:a|al|de|el)\s+)?(?:proyecto|carpeta|folder|workspace)\b/i.test(prompt);
    if (!switchIntent) return false;
    if (extractSwitchProjectName(prompt)) return true;
    return /\b(?:ci[eé]rrame|cierrame|cierra\s+este)\b[\s\S]{0,100}\b(?:abre|abreme|abrime|abras)\b/i.test(prompt);
  }

  /** Nombre/ruta del destino tras un pedido de cambio de proyecto. */
  function extractSwitchProjectName(value) {
    const prompt = text(value);
    if (!prompt) return "";
    const patterns = [
      /\b(?:abre|abrir|abreme|abrime|abras|open)\s+(?:el\s+|la\s+)?(?:proyecto|carpeta|folder)\s*[,:]?\s*["'`]?([A-Za-z0-9][\w .\-]{0,80}?)["'`]?\s*[.!]?\s*$/i,
      /\b(?:abre|abrir|abreme|abrime|abras|open)\s+(?:el\s+|la\s+)?(?:proyecto|carpeta|folder)\s*[,:]?\s*["'`]?([A-Za-z0-9][\w .\-]{1,80})["'`]?/i,
      /\b(?:abre|abrir|abreme|abrime|abras|open)\s+["'`]?([A-Za-z0-9][\w .\-]{1,80})["'`]?(?:\s|$)/i,
      /\b(?:cambia(?:r)?|switch)\s+(?:(?:a|al|de|el)\s+)?(?:proyecto|carpeta|folder|workspace)?\s*[,:]?\s*["'`]?([A-Za-z0-9][\w .\-]{1,80})["'`]?/i,
    ];
    const nameStop = /^(?:el|la|los|las|un|una|este|esta|proyecto|carpeta|folder|directorio|y|o|al|de|a)$/i;
    for (const pattern of patterns) {
      const match = prompt.match(pattern);
      if (!match) continue;
      let name = cleanProjectPath(match[1] || "");
      name = name.replace(/^(?:el|la|los|las|un|una|mis|mi)\s+/i, "").trim();
      name = name.replace(/[.,;:!?]+$/g, "").trim();
      if (!name || nameStop.test(name)) continue;
      if (/^[a-zA-Z]:[\\/]/.test(name) || name.startsWith("\\\\") || name.startsWith("/")) continue;
      // Evitar capturar el proyecto que se cierra: "cierra este fuxion service y abras..."
      if (/\b(?:cierra|cerrar|cierrame|cierres|close)\b[\s\S]{0,40}\b(?:este|esta)?\s*/i.test(prompt)) {
        const closeChunk = prompt.match(/\b(?:cierra|cerrar|cierrame|cierres|close)\b[\s\S]{0,60}?\b(?:abre|abrir|abreme|abrime|abras|open)\b/i);
        if (closeChunk && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(closeChunk[0])
          && !new RegExp(`\\b(?:abre|abrir|abreme|abrime|abras|open)[\\s\\S]{0,40}\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(prompt)) {
          continue;
        }
      }
      return name;
    }
    // Ultimo recurso: nombre tras la ultima coma ("..., editcoreai")
    const afterComma = prompt.match(/,\s*["'`]?([A-Za-z0-9][\w .\-]{1,80})["'`]?\s*[.!]?\s*$/i);
    if (afterComma) {
      let name = cleanProjectPath(afterComma[1] || "").replace(/[.,;:!?]+$/g, "").trim();
      if (name && !nameStop.test(name) && !/^(?:fuxion|service)$/i.test(name)) return name;
    }
    return "";
  }

  /** Alias locales → clave de app.getPath (documents/downloads/desktop/home). */
  function knownFolderAliasKey(name = "") {
    const raw = text(name).toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (/^(documentos|mis documentos|documents|my documents)$/i.test(raw)) return "documents";
    if (/^(descargas|downloads|my downloads)$/i.test(raw)) return "downloads";
    if (/^(escritorio|desktop)$/i.test(raw)) return "desktop";
    if (/^(inicio|home|usuario|user profile)$/i.test(raw)) return "home";
    return "";
  }

  function resolveNamedProjectPath(name, parentRoot = "") {
    const folder = text(name);
    const parent = text(parentRoot).replace(/[\\/]+$/, "");
    if (!folder || !parent) return "";
    const sep = parent.includes("/") && !parent.includes("\\") ? "/" : "\\";
    return `${parent}${sep}${folder}`;
  }

  function resolveExecutionMode(prompt, options = {}) {
    const requestedAgent = options.requestedAgent === true;
    const projectOpen = options.projectOpen === true;
    const resumableTask = options.resumableTask === true;
    const workflowPhase = text(options.workflowPhase);
    const resumableExecutable = resumableTask && ["interrupted", "executing", "awaiting_authorization"].includes(workflowPhase);
    const explicitChangeRequest = isChangeRequest(prompt);
    const explicitCloudOperate = isCloudOperateRequest(prompt);
    // Analisis profundo / reporte completo en modo Chat tambien debe usar herramientas.
    const explicitAnalysisRequest = isFreshAnalysisRequest(prompt)
      || (/\b(?:analiza|audita|diagnostica|an[aá]lisis|reporte|hallazgos)\b/i.test(text(prompt))
        && /\b(?:proyecto|repo|carpeta|c[oó]digo|completo|profundo)\b/i.test(text(prompt)));
    const autoEscalatedAgent = !requestedAgent && projectOpen
      && (explicitChangeRequest || explicitAnalysisRequest || explicitCloudOperate);
    const taskContinuation = projectOpen && resumableTask && (
      isAuthorization(prompt)
      || (resumableExecutable && (isRecoveryInstruction(prompt) || isAgentTaskFeedback(prompt)))
    );
    const isAgent = requestedAgent || autoEscalatedAgent || taskContinuation;
    const pathGiven = hasUsableAbsolutePath(prompt);
    const openNamedProject = isOpenNamedProjectRequest(prompt);
    const referencedProjectName = extractReferencedProjectName(prompt);
    const closeProject = isCloseProjectRequest(prompt);
    const switchProject = isSwitchProjectRequest(prompt);
    // Sin proyecto abierto el chat/agente SI puede trabajar si el usuario dio una ruta absoluta,
    // o si el mensaje es conversacional/arquitectura/brainstorming/spec (no exige disco inmediato).
    // "abre TAXIDRIV" / "cierra el proyecto" / switch lo resuelve la UI; no es missingProject.
    // "ANALIZA CALILI" trae nombre resoluble del catalogo: tampoco es missingProject.
    const isConceptualOrArchitect = shouldAnalyzePromptFirst(prompt)
      || isPromptAnalysisRequest(prompt)
      || isPromptOnlySteering(prompt)
      || isProjectBrainstormRequest(prompt)
      || isVagueGreenfieldRequest(prompt)
      || isGreenfieldSpecPrompt(prompt);
    const needsBoundProject = !isConceptualOrArchitect && !openNamedProject && !closeProject && !switchProject && !referencedProjectName && (
      explicitChangeRequest
      || (/\b(analiza|audita|diagnostica|revisa|explora|corrige|crea|implementa|listar?|enlista|modifica)\b/i.test(text(prompt))
        && /\b(carpeta|directorio|archivo|repo|workspace|c[oó]digo\s+existente|proyecto)\b/i.test(text(prompt)))
    );
    return {
      requestedAgent,
      projectOpen,
      explicitChangeRequest,
      autoEscalatedAgent,
      taskContinuation,
      isAgent,
      pathGiven,
      openNamedProject,
      referencedProjectName,
      closeProject,
      switchProject,
      // Analisis/listado en disco exige carpeta; arquitectura/brainstorm/conversacion NO.
      missingProject: !projectOpen && !pathGiven && !openNamedProject && !closeProject && !switchProject && !referencedProjectName
        && (explicitChangeRequest || needsBoundProject || (isAgent && needsBoundProject)),
    };
  }

  return {
    analysisContext,
    assessCompletion,
    buildAnalysisMemory,
    classifyPromptIntent,
    cleanProjectPath,
    extractProjectPaths,
    isChangeRequest,
    isCloudOperateRequest,
    isPathOnlyPrompt,
    extractAbsolutePathHints,
    hasUsableAbsolutePath,
    extractOpenProjectName,
    extractReferencedProjectName,
    isOpenNamedProjectRequest,
    isPureOpenProjectRequest,
    isCloseProjectRequest,
    isSwitchProjectRequest,
    extractSwitchProjectName,
    knownFolderAliasKey,
    resolveNamedProjectPath,
    isAnalysisFollowUp,
    isProposalFollowUp,
    proposalFromAnalysisMemory,
    isUsefulAnalysisMemory,
    hydrateAnalysisMemoryFromSources,
    isAuthorization,
    isAnalysisReport,
    isPendingAnalysisPlan,
    normalizeAnalysisReport,
    isFreshAnalysisRequest,
    isPromptOnlySteering,
    isScopedDiskFileRequest,
    isPromptAnalysisRequest,
    isGreenfieldSpecPrompt,
    isGreenfieldCreateRequest,
    isVagueGreenfieldRequest,
    isProjectBrainstormRequest,
    isGreenfieldContinuationRequest,
    isProjectOnboardingRequest,
    isProjectIntentComment,
    hasConcreteProductHint,
    isConversationalFollowUp,
    isUserDirectiveOrComplaint,
    shouldAnalyzePromptFirst,
    findOriginalUserRequest,
    authorizedPlanExecutionPrompt,
    hasConcreteAuthorizedTask,
    resolveAuthorizedExecutionPrompt,
    isRecoveryInstruction,
    isUserStopInstruction,
    shouldSteerLiveAgent,
    isAgentTaskFeedback,
    isAgentWorkflowQuestion,
    workflowQuestionContext,
    isTaskStatusQuestion,
    isPercentageQuestion,
    normalizeProjectPrompt,
    normalizeProjectPath,
    percentageResponse,
    recoveryPrompt,
    redactCredentials,
    resolveExecutionMode,
  };
});