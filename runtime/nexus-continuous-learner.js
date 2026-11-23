"use strict";

const fs = require("fs");
const path = require("path");

const NEXUS_MODEL_DIR = path.join("D:\\", "PROGRAMAS IA", "EDITCORE-MODEL");
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
