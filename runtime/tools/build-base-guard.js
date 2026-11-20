"use strict";

/**
 * Base profesional obligatoria para construir webs.
 *
 * La landing de Taller Luis (2026-11-10) salió como UN index.html suelto
 * con cajas y texto porque el proyecto estaba vacío (blank) y el agente
 * improvisó: la base profesional del IDE —React + Vite + TypeScript +
 * Tailwind + Framer Motion + componentes tipo shadcn, la misma que usa
 * "Nuevo proyecto → Web App profesional" (runtime/greenfield-builder)—
 * solo se sienta al CREAR el proyecto. Dentro de un proyecto vacío ya
 * abierto, nadie la invocaba: la herramienta scaffold_project estaba
 * clasificada como escritura en classify.js pero NO existía en tools.js.
 *
 * Este módulo trae la lógica pura de la compuerta:
 * - projectLooksEmpty: el proyecto no tiene package.json ni estructura
 *   (solo README/.editcore/.git): es lienzo, no una app existente.
 * - maybeBlockLooseHtmlWrite: en un turno de construcción sobre un
 *   lienzo, el primer write_file de un HTML suelto en la raíz se
 *   bloquea UNA vez con la instrucción de sentar la base primero
 *   (después, fail-open: si el modelo insiste, era su decisión).
 */

const fs = require("fs");
const path = require("path");

const IGNORED_ENTRIES = new Set([".git", ".editcore", "node_modules"]);

function projectLooksEmpty(projectRoot) {
  try {
    const root = path.resolve(String(projectRoot || ""));
    if (!root || !fs.existsSync(root)) return false;
    if (fs.existsSync(path.join(root, "package.json"))) return false;
    const entries = fs.readdirSync(root).filter((entry) => !IGNORED_ENTRIES.has(entry));
    if (entries.length === 0) return true;
    // Un README (y poco más) sigue siendo lienzo: es el estado exacto de
    // un proyecto blank recién creado a mano, como taller luis.
    return entries.length <= 2 && !entries.includes("src");
  } catch {
    return false;
  }
}

function isLooseHtmlWrite(name, args) {
  if (name !== "write_file") return false;
  const rel = String(args?.path || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  return /^[^/]+\.html?$/i.test(rel);
}

function maybeBlockLooseHtmlWrite({ name, args, buildTask, projectEmpty, scaffolded, blocksSoFar } = {}) {
  if (buildTask !== true || projectEmpty !== true || scaffolded === true) return null;
  if (!isLooseHtmlWrite(name, args)) return null;
  if (Number(blocksSoFar || 0) >= 1) return null;
  return {
    ok: false,
    blocked: true,
    error: "Bloqueado: este proyecto está vacío y estás por escribir una página suelta sin base. EditCoreAI tiene una base web profesional (React + Vite + Tailwind + Framer Motion, con componentes y animaciones) y una página de negocio construida a mano en un HTML único sale plana y genérica.",
    guidance: "Llama primero a scaffold_project para sentar la base profesional en este proyecto, ejecuta npm install con run_command, y DESPUÉS personaliza src/App.tsx y las secciones (Hero, Showcase) con el contenido del negocio: textos, fotos reales (fetch_stock_photo a public/assets) y movimiento. Si el usuario pidió explícitamente un archivo HTML único y simple, repite la escritura y se permitirá.",
  };
}

function buildBaseProtocolPrompt() {
  return [
    "## BASE PROFESIONAL (este proyecto está vacío)",
    "No construyas la web como un HTML suelto: saldría plana y genérica.",
    "1. Llama a scaffold_project AHORA para sentar la base (React + Vite + TypeScript + Tailwind + Framer Motion + componentes UI y de layout ya animados).",
    "2. Ejecuta `npm install` con run_command para dejar el proyecto servible.",
    "3. Personaliza sobre la base: src/App.tsx, src/components/sections/Hero.tsx y Showcase.tsx, Navbar/Footer. Sustituye TODO el contenido de ejemplo por el del negocio (nombre, servicios, precios, testimonios, contacto).",
    "4. Da vida a la página: animaciones de entrada y de scroll (los componentes FadeIn/motion de la base), hover con intención, contadores o marquesinas donde aporten, y fotos reales con fetch_stock_photo guardadas en public/assets.",
    "5. Verifica con capture_preview_screenshot en desktop (una sola vista por defecto; la móvil solo si el cambio es de layout/responsive), y corrige lo que veas antes de cerrar.",
  ].join("\n");
}

module.exports = { projectLooksEmpty, isLooseHtmlWrite, maybeBlockLooseHtmlWrite, buildBaseProtocolPrompt };
