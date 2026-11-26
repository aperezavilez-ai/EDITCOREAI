"use strict";

const fs = require("fs");
const path = require("path");

// La casa del modelo propio: EDITCORE NEXUS V5 (antes EDITCORE-MODEL).
// Se aceptan ambos nombres: el que exista en disco manda, para que el
// renombrado de la carpeta sea seguro en cualquier orden.
const RAICES_NEXUS = [
  path.join("D:\\", "PROGRAMAS IA", "EDITCORE NEXUS V5"),
  path.join("D:\\", "PROGRAMAS IA", "EDITCORE-MODEL"),
];
const NEXUS_MODEL_DIR = RAICES_NEXUS.find((r) => { try { return fs.existsSync(r); } catch { return false; } }) || RAICES_NEXUS[0];
const EXPERIENCE_FILE = path.join(NEXUS_MODEL_DIR, "data", "autonomous_experience.jsonl");

/**
 * Registra un intercambio exitoso verificado en la memoria de experiencia autónoma de Nexus v5.
 * Se ejecuta de forma asíncrona y segura (fire-and-forget) para no retrasar el turno del usuario.
 */
function registrarExperienciaNexus({ prompt, respuesta, kind, steps = [], archivos = [], mutations = 0, verifiedSuccess = true }) {
  try {
    if (!fs.existsSync(path.dirname(EXPERIENCE_FILE))) {
      return;
    }

    const textoPrompt = String(prompt || "").trim();
    const textoRespuesta = String(respuesta || "").trim();

    // No registrar saludos vacíos o preguntas triviales de menos de 10 caracteres
    if (textoPrompt.length < 10 || textoRespuesta.length < 20) {
      return;
    }

    const herramientas = (Array.isArray(steps) ? steps : [])
      .map((s) => s?.nombre || s?.function?.name)
      .filter(Boolean);

    const entrada = {
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      kind: kind || "CONVERSACION",
      user_prompt: textoPrompt,
      assistant_response: textoRespuesta,
      tools_executed: herramientas,
      files_mutated: Array.isArray(archivos) ? archivos : [],
      mutations: Number(mutations) || 0,
      verified_success: Boolean(verifiedSuccess),
    };

    const linea = JSON.stringify(entrada) + "\n";
    fs.appendFile(EXPERIENCE_FILE, linea, "utf8", () => {});
  } catch (err) {
    // Silencioso para no interferir con el flujo de trabajo
  }
}

module.exports = {
  registrarExperienciaNexus,
  EXPERIENCE_FILE,
};
