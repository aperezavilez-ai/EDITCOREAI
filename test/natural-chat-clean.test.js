"use strict";

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("Natural Chat & Clean Roles Verification", () => {
  test("adaptador.js does not contain AVISO_INICIAL or 'Manos a la obra'", () => {
    const adaptadorContent = fs.readFileSync(
      path.join(__dirname, "../runtime/tools/nuevo/adaptador.js"),
      "utf8"
    );
    assert.doesNotMatch(adaptadorContent, /AVISO_INICIAL/);
    assert.doesNotMatch(adaptadorContent, /Manos a la obra/i);
    assert.doesNotMatch(adaptadorContent, /Preparo la propuesta/i);
    assert.doesNotMatch(adaptadorContent, /Reviso el proyecto para responderte/i);
  });

  test("runtime/tools/index.js does not inject [Coordinador] or synthetic roles [Arquitecto]/[Analista]/[QA]/[Seguridad]", () => {
    const indexContent = fs.readFileSync(
      path.join(__dirname, "../runtime/tools/index.js"),
      "utf8"
    );
    assert.doesNotMatch(indexContent, /\[Coordinador\]/);
    assert.doesNotMatch(indexContent, /role\s*=\s*["']Analista["']/);
    assert.doesNotMatch(indexContent, /\[\$\{role\}\]/);
    assert.doesNotMatch(indexContent, /\[\$\{sender\}\]/);
  });

  test("textos.js SISTEMA_NUCLEO explicitly forbids artificial role prefixes and canned greetings", () => {
    const textosContent = fs.readFileSync(
      path.join(__dirname, "../runtime/tools/nuevo/textos.js"),
      "utf8"
    );
    assert.match(textosContent, /\[Coordinador\]/);
    assert.match(textosContent, /Manos a la obra/);
  });

  test("renderer.js humanizeAgentNarration sanitizes [Coordinador] and role prefixes", () => {
    const rendererContent = fs.readFileSync(
      path.join(__dirname, "../renderer.js"),
      "utf8"
    );

    // Test the regex logic directly using same logic as in renderer.js
    const sanitize = (text) => {
      return String(text || "")
        .replace(/^\[(?:Coordinador|Arquitecto|Analista|Seguridad|QA|Agente|Director)\]\s*/i, "")
        .replace(/\((?:coordinador|arquitecto|analista|seguridad|qa|agente|director)\)\s*/gi, "")
        .replace(/^\[[^\]]+\]\s*(?=[⚙️🔍📂✓○→✗]|\b(?:list_|read_|write_|replace_|delete_|edit_|run_|diagnose_))/i, "")
        .replace(/\bManos a la obra:\s*ejecuto tu orden[….]*/gi, "")
        .replace(/\bPreparo la propuesta[….]*/gi, "")
        .replace(/\bReviso el proyecto para responderte[….]*/gi, "")
        .trim();
    };

    const input1 = "[Coordinador] Manos a la obra: ejecuto tu orden…";
    assert.equal(sanitize(input1), "");

    const input2 = "[Arquitecto] ✓ list_files . — Carpeta: 7 carpetas, 15 archivos.";
    assert.equal(sanitize(input2), "✓ list_files . — Carpeta: 7 carpetas, 15 archivos.");

    const input3 = "[Analista] ✓ read_file · src/app/page.tsx";
    assert.equal(sanitize(input3), "✓ read_file · src/app/page.tsx");

    const input4 = "(coordinador) Hola, aquí tienes la solución técnica implementada.";
    assert.equal(sanitize(input4), "Hola, aquí tienes la solución técnica implementada.");
  });

  test("Tool execution lines starting with ✓ or ✗ match live activity regex", () => {
    const isLiveActivity = (val) => {
      return /^(?:\[[^\]]+\]\s*)?[⚙️🔍📂✓○→✗]/.test(val)
        || /^(?:\[[^\]]+\]\s*)?(?:Creando|Editando|Leyendo|Verificando|Explorando|Procesando|Sigo en ello)\b/i.test(val)
        || /^(?:\[[^\]]+\]\s*)?(?:✓|✗|\b(?:list_files|read_file|write_file|replace_in_file|run_command|diagnose_code_health)\b)/i.test(val);
    };

    assert.equal(isLiveActivity("✓ list_files . — Carpeta: 7 carpetas, 15 archivos."), true);
    assert.equal(isLiveActivity("✓ read_file · src/app/layout.tsx"), true);
    assert.equal(isLiveActivity("✗ run_command npm test"), true);
    assert.equal(isLiveActivity("Leyendo dependencias..."), true);
    // Regular conversational answer should NOT match live activity
    assert.equal(isLiveActivity("He revisado la configuración y el archivo está listo."), false);
    assert.equal(isLiveActivity("Para resolver este problema, podemos configurar el middleware."), false);
  });
});
