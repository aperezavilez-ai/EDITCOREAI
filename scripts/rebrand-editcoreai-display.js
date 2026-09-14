"use strict";

/**
 * Renombra marca visible EDITCOREAI → EditCoreAI en UI.
 * No toca: rutas, appId, userData, ids HTML, data-*, carpetas, repo URLs.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function brandVisible(text) {
  let t = String(text);
  // Frases / marca completa (word-ish)
  t = t.replace(/\bEDITCOREAI\b/g, "EditCoreAI");
  return t;
}

function patchHtml(filePath) {
  let t = fs.readFileSync(filePath, "utf8");
  const before = t;
  t = brandVisible(t);
  // Restaurar atributos técnicos si se colaron
  t = t.replace(/data-inspector-target="EditCoreAI"/g, 'data-inspector-target="editcore"');
  t = t.replace(/id="EditCoreAI"/gi, (m) => m); // none expected
  if (t !== before) {
    fs.writeFileSync(filePath, t);
    return true;
  }
  return false;
}

function patchJsUi(filePath, { alsoWindowTitle = false } = {}) {
  let t = fs.readFileSync(filePath, "utf8");
  const before = t;
  // Solo literales de UI comunes
  const patterns = [
    [/Bienvenido a EDITCOREAI/g, "Bienvenido a EditCoreAI"],
    [/Eres EDITCOREAI,/g, "Eres EditCoreAI,"],
    [/Eres EDITCOREAI /g, "Eres EditCoreAI "],
    [/\*\*EDITCOREAI\*\*/g, "**EditCoreAI**"],
    [/header\.textContent = role === "user" \? "Tú" : `EDITCOREAI/g, 'header.textContent = role === "user" ? "Tú" : `EditCoreAI'],
    [/head\.textContent = runLabel \? `EDITCOREAI · \$\{runLabel\}` : "EDITCOREAI"/g, 'head.textContent = runLabel ? `EditCoreAI · ${runLabel}` : "EditCoreAI"'],
    [/head\.textContent = "EDITCOREAI"/g, 'head.textContent = "EditCoreAI"'],
    [/Reinicia EDITCOREAI/g, "Reinicia EditCoreAI"],
    [/de EDITCOREAI/g, "de EditCoreAI"],
    [/EDITCOREAI no pudo/g, "EditCoreAI no pudo"],
    [/EDITCOREAI elige/g, "EditCoreAI elige"],
    [/EDITCOREAI \(app/g, "EditCoreAI (app"],
    [/a EDITCOREAI desktop/g, "a EditCoreAI desktop"],
    [/versiones nuevas de EDITCOREAI/g, "versiones nuevas de EditCoreAI"],
    [/hallazgos EDITCOREAI/g, "hallazgos EditCoreAI"],
    [/Escaneo.*?EDITCOREAI/g, (m) => m.replace(/EDITCOREAI/g, "EditCoreAI")],
    [/Publicando EDITCOREAI/g, "Publicando EditCoreAI"],
    [/EDITCOREAI publicado/g, "EditCoreAI publicado"],
    [/EDITCOREAI guardado/g, "EditCoreAI guardado"],
    [/Guardando cambios de EDITCOREAI/g, "Guardando cambios de EditCoreAI"],
    [/Guardado EDITCOREAI/g, "Guardado EditCoreAI"],
    [/bóveda EDITCOREAI/g, "bóveda EditCoreAI"],
    [/Conexiones de EDITCOREAI/g, "Conexiones de EditCoreAI"],
    [/nombre: "EDITCOREAI"/g, 'nombre: "EditCoreAI"'],
    [/name: "EDITCOREAI"/g, 'name: "EditCoreAI"'],
    [/\? "EDITCOREAI" : ""/g, '? "EditCoreAI" : ""'],
    [/title: `EDITCOREAI v\$\{/g, "title: `EditCoreAI v${"],
    [/title: "Publicar EDITCOREAI"/g, 'title: "Publicar EditCoreAI"'],
    [/Commit \+ push de EDITCOREAI/g, "Commit + push de EditCoreAI"],
    [/message: "EDITCOREAI es una app/g, 'message: "EditCoreAI es una app'],
    [/ocupado\. EDITCOREAI intentara/g, "ocupado. EditCoreAI intentara"],
    [/reparando EDITCOREAI mismo/g, "reparando EditCoreAI mismo"],
  ];
  for (const [re, rep] of patterns) {
    t = t.replace(re, rep);
  }
  // Catch remaining UI quotes with EDITCOREAI as whole word inside string literals carefully:
  // welcome / assistant headers already covered.
  if (alsoWindowTitle) {
    t = t.replace(/title: `EDITCOREAI v\$\{RUNTIME_VERSION\}`/g, "title: `EditCoreAI v${RUNTIME_VERSION}`");
  }
  // Broader safe pass for Spanish UI sentences still containing EDITCOREAI
  t = t.replace(/(["'`])([^"'`]*?)\bEDITCOREAI\b([^"'`]*?)\1/g, (full, q, a, b) => {
    // Skip technical paths / userdata / package refs
    if (/AppData|userData|resources[\\/]|com\.editcore|EDITCOREAI\.git|setPath|setName\(/.test(full)) return full;
    if (/^[A-Za-z0-9_./\\-]+$/.test(a + "EDITCOREAI" + b) && !/\s/.test(a + b)) return full;
    return `${q}${a}EditCoreAI${b}${q}`;
  });
  if (t !== before) {
    fs.writeFileSync(filePath, t);
    return true;
  }
  return false;
}

const results = [];
results.push(["index.html", patchHtml(path.join(root, "index.html"))]);
results.push(["renderer.js", patchJsUi(path.join(root, "renderer.js"))]);
results.push(["main.js", patchJsUi(path.join(root, "main.js"), { alsoWindowTitle: true })]);

// productName visible; no cambiar executableName/appId/userData
const pkgPath = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
let pkgChanged = false;
if (pkg.productName === "EDITCOREAI") { pkg.productName = "EditCoreAI"; pkgChanged = true; }
if (pkg.build?.productName === "EDITCOREAI") { pkg.build.productName = "EditCoreAI"; pkgChanged = true; }
if (pkg.description && pkg.description.includes("EDITCOREAI")) {
  pkg.description = pkg.description.replace(/\bEDITCOREAI\b/g, "EditCoreAI");
  pkgChanged = true;
}
if (pkg.author === "EDITCOREAI") { pkg.author = "EditCoreAI"; pkgChanged = true; }
if (pkg.build?.nsis?.shortcutName === "EDITCOREAI") {
  pkg.build.nsis.shortcutName = "EditCoreAI";
  pkgChanged = true;
}
if (pkgChanged) {
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  results.push(["package.json", true]);
} else results.push(["package.json", false]);

// elite policy / default chat prompt if present
const elite = path.join(root, "runtime", "elite-communication-policy.js");
if (fs.existsSync(elite)) {
  results.push(["elite-communication-policy.js", patchJsUi(elite)]);
}

console.log(JSON.stringify(Object.fromEntries(results), null, 2));
