"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Compuertas de reparación (hallazgo en vivo, sesión VIXERAI 2026-11-10).
 *
 * El agente diagnosticó de memoria ("Tailwind v4 no reconoce gap-2"),
 * editó 8 archivos en 3 turnos y declaró "corregido" tres veces apoyado
 * solo en la comprobación ligera por archivo — sin capturar jamás el
 * error real de la consola, que estaba visible desde el primer turno.
 * Este módulo pone la disciplina en MECANISMOS, no en deseos:
 *
 *  1. isRepairTask — clasifica el turno como reparación/diagnóstico.
 *  2. maybeBlockWriteBeforeEvidence — en un turno de reparación, la
 *     primera escritura exige evidencia del fallo capturada EN el turno
 *     (captura del preview o build/dev por comando). Acotado y con
 *     salida: tras 2 bloqueos (fail-open declarado), escribir se libera.
 *     [EDITCORE-INTEGRAL-B1] Una captura FALLIDA ya no cuenta como
 *     evidencia: sin preview no hay evidencia que liberar.
 *  3. turnHasPassingRealVerification — qué cuenta como verificación
 *     REAL aprobada: captura con renderOk y sin errores de consola, o
 *     build/test/typecheck en verde. La comprobación ligera por
 *     archivo NO cuenta.
 *  4. repairProtocolPrompt — el protocolo que viaja en el turno.
 */

const REPAIR_RE = /(no\s+(?:abre|se\s+abre|carga|funciona|se\s+ve|renderiza|responde)|sigue\s+(?:dañad|igual|fall|rot|sin\b)|est[áa]\s+(?:dañad|rot|mal)|dañad|roto\b|pantalla\s+en\s+blanco|página\s+en\s+blanco|pagina\s+en\s+blanco|no\s+se\s+ve|preview|falla|fallo|fallando|\berror\b|corr[ií]gelo|corrige|arr[eé]glalo|arregla|repara|soluciona|depura|debug|crash|se\s+cayó|blank\s+(?:page|screen)|not\s+working|doesn'?t\s+(?:open|load|work)|still\s+broken|fix\s+(?:it|this|the\b))/i;

function isRepairTask(text = "") {
  return REPAIR_RE.test(String(text || ""));
}

const VISUAL_REPAIR_RE = /(preview|pantalla|en\s+blanco|no\s+se\s+ve|se\s+ve|no\s+abre|no\s+carga|render|navegador|browser|p[áa]gina|blank|css|tailwind|estilos?|diseño|visual|interfaz|frontend|front-end|\bui\b)/i;

function isVisualRepairTask(text = "") {
  return VISUAL_REPAIR_RE.test(String(text || ""));
}

/**
 * ¿El proyecto tiene superficie web capturable? La herramienta de
 * captura solo se ofrece en reparaciones cuando hay algo que mirar:
 * una reparación de lógica pura en el servidor ("corrige el cálculo de
 * impuestos") no debe pagarla (regresión guardada por la Fase Calidad);
 * su verificación real es el build o los tests, siempre disponibles.
 */
function projectLooksWeb(projectRoot = "") {
  const root = String(projectRoot || "");
  if (!root) return false;
  try {
    if (fs.existsSync(path.join(root, "index.html"))) return true;
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      return ["vite", "next", "react", "vue", "svelte", "@angular/core", "react-scripts", "astro", "nuxt"].some((k) => k in deps);
    }
  } catch { /* ilegible: sin ojos */ }
  return false;
}

const BUILD_AFFECTING_RE = /\.(css|scss|sass|less|styl)$|(^|\/)(package\.json|package-lock\.json|index\.html|vite\.config\.[a-z]+|webpack\.config\.[a-z]+|tailwind\.config\.[a-z]+|postcss\.config\.[a-z]+|tsconfig[^/]*\.json|next\.config\.[a-z]+)$|(^|\/)src\/(main|index|app)\.(tsx?|jsx?)$/;

function isBuildAffectingPath(p = "") {
  const rel = String(p || "").replace(/\\/g, "/").toLowerCase().trim();
  return rel ? BUILD_AFFECTING_RE.test(rel) : false;
}

const EVIDENCE_COMMAND_RE = /\b(?:npm|pnpm|yarn|bun)\b[^|;&]*\b(?:build|dev|preview|start|test|typecheck|serve)\b|\btsc\b|\bvite\s+build\b/i;

function stepIsEvidenceAttempt(s) {
  if (!s || s.blocked) return false;
  if (s.name === "capture_preview_screenshot") {
    // [EDITCORE-INTEGRAL-B1] Una captura FALLIDA no es evidencia: sin
    // preview no se capturó el fallo, solo se intentó. Antes un intento
    // fallido liberaba la compuerta y se editaba de memoria (el patrón
    // VIXERAI que esta compuerta nació para matar). La compuerta solo se
    // libera con evidencia real o, fail-open DECLARADO, tras
    // EVIDENCE_BLOCK_LIMIT bloqueos (maybeBlockWriteBeforeEvidence).
    return s.ok !== false && s.result?.ok !== false;
  }
  if (s.name === "run_command" && EVIDENCE_COMMAND_RE.test(String(s.input?.command || ""))) return true;
  return false;
}

function turnHasEvidence(steps = []) {
  return (Array.isArray(steps) ? steps : []).some(stepIsEvidenceAttempt);
}

// [EDITCORE-INTEGRAL-B1] ¿El comando de evidencia GUARDA RELACIÓN con el
// cambio? Un comando verde ajeno (p. ej. los tests de OTRO archivo) no
// re-prueba el punto del fallo y no puede desbloquear un «corregido».
// Relación = el comando nombra un archivo tocado (ruta o basename), o es
// el build/test/typecheck GENÉRICO del proyecto (sin rutas ajenas como
// argumentos: cubre por construcción los archivos tocados). Sin lista de
// tocados (llamadas legadas) se conserva el criterio anterior.
function commandRelatesToChange(command = "", touchedPaths = []) {
  const touched = (Array.isArray(touchedPaths) ? touchedPaths : []).map((p) => String(p || "").replace(/\\/g, "/").trim().toLowerCase()).filter(Boolean);
  if (!touched.length) return true;
  const cmd = String(command || "").replace(/\\/g, "/").toLowerCase();
  if (!cmd.trim()) return false;
  for (const rel of touched) {
    const base = rel.split("/").pop();
    if (cmd.includes(rel) || (base && cmd.includes(base))) return true;
  }
  const mentionsPathArg = /(?:^|\s)(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)+\.[a-z]{1,5}\b|\b[\w.-]+\.(?:tsx?|jsx?|css|scss|json|html)\b/i.test(cmd);
  if (mentionsPathArg) return false;
  return /\b(?:npm|pnpm|yarn|bun)\b[^|;&]*\b(?:build|test|typecheck|check)\b|\btsc\b|\bvite\s+build\b/i.test(cmd);
}

function turnHasPassingRealVerification(steps = [], touchedPaths = []) {
  const list = Array.isArray(steps) ? steps : [];
  // [EDITCORE-INTEGRAL-B1] La verificación debe ser POSTERIOR a la última
  // escritura del turno: verificar antes de editar no prueba el cambio.
  let lastWriteIdx = -1;
  list.forEach((s, i) => {
    if (s && (s.name === "write_file" || s.name === "replace_in_file" || s.name === "scaffold_project") && s.ok !== false && s.result?.ok !== false) lastWriteIdx = i;
  });
  return list.some((s, i) => {
    if (!s || s.blocked) return false;
    if (lastWriteIdx >= 0 && i <= lastWriteIdx) return false;
    if (s.name === "capture_preview_screenshot") {
      const errs = Array.isArray(s.result?.diagnostics?.consoleErrors)
        ? s.result.diagnostics.consoleErrors.filter((e) => e && e.type !== "warning")
        : [];
      return s.result?.renderOk === true && errs.length === 0;
    }
    if (s.name === "run_command" && EVIDENCE_COMMAND_RE.test(String(s.input?.command || ""))) {
      return s.ok !== false && s.result?.ok === true && commandRelatesToChange(s.input?.command || "", touchedPaths);
    }
    return false;
  });
}

const WRITE_TOOL_NAMES = new Set(["write_file", "replace_in_file", "scaffold_project"]);
const EVIDENCE_BLOCK_LIMIT = 2;

function maybeBlockWriteBeforeEvidence(name, steps, blocksSoFar) {
  if (!WRITE_TOOL_NAMES.has(String(name || ""))) return null;
  if (Number(blocksSoFar || 0) >= EVIDENCE_BLOCK_LIMIT) return null;
  if (turnHasEvidence(steps)) return null;
  return {
    ok: false,
    blocked: true,
    evidenceGate: true,
    error: "Compuerta de evidencia (turno de reparación): todavía no capturaste el fallo real en este turno. Antes de editar, ejecuta capture_preview_screenshot (con la URL del PREVIEW ACTIVO de tu contexto; su resultado trae los errores de consola y el error visible en pantalla) o run_command con el build/dev del proyecto, y lee el error exacto. Editar desde una hipótesis sin esa evidencia ya produjo diagnósticos falsos y daños en este producto: no repitas ese patrón.",
  };
}

function repairProtocolPrompt() {
  return [
    "PROTOCOLO DE REPARACIÓN (obligatorio en este turno):",
    "1. EVIDENCIA ANTES DE EDITAR: captura primero el fallo real (capture_preview_screenshot al preview activo — su resultado incluye errores de consola y el texto del error en pantalla — o el build con run_command) y trabaja sobre ESE error exacto. Prohibido diagnosticar de memoria o desde el síntoma narrado.",
    "2. HIPÓTESIS FALSABLE: antes de cada edición di qué causa crees y qué comprobación la confirmaría o la mataría. Una edición por hipótesis; si la comprobación no cambia, la hipótesis murió: no insistas ni repitas la misma edición con otras palabras.",
    "3. SI EL USUARIO DICE QUE SIGUE FALLANDO, tu corrección anterior NO funcionó: vuelve al paso 1 y recaptura el estado actual. No des por buena ninguna de tus conclusiones previas sin re-verificarlas.",
    "4. ANTES DE CREAR un archivo de configuración, verifica con list_files/search_files qué archivos existen YA, incluidas variantes .cjs/.mjs/.ts: duplicar una configuración existente es una causa clásica de daño.",
    "5. ÉXITO SOLO CON VERIFICACIÓN REAL: «corregido» exige, DESPUÉS de tu última edición y en este mismo turno, una captura con renderOk y sin errores de consola o un build en verde. La comprobación ligera por archivo no prueba que la app funciona.",
    "6. Si la verificación real falla y no encuentras la causa, dilo mostrando el error exacto que tienes en la mano; nunca cierres con un «debería funcionar».",
  ].join("\n");
}

module.exports = {
  isRepairTask,
  isVisualRepairTask,
  projectLooksWeb,
  isBuildAffectingPath,
  turnHasEvidence,
  turnHasPassingRealVerification,
  commandRelatesToChange,
  maybeBlockWriteBeforeEvidence,
  repairProtocolPrompt,
  EVIDENCE_BLOCK_LIMIT,
  // [EDITCORE-V516-S5/S6] La clase de comandos de evidencia y su
  // detector por paso se exportan para que el orquestador asiente los
  // resultados de esos comandos en los hechos del kernel (S5) y
  // detecte la premisa refutada por la evidencia previa (S6). Sin
  // cambio de comportamiento: son las mismas constantes/función que
  // este módulo ya usa por dentro.
  EVIDENCE_COMMAND_RE,
  stepIsEvidenceAttempt,
};
