"use strict";

const fs = require("fs");
const path = require("path");

const mainPath = path.join(__dirname, "..", "main.js");
let s = fs.readFileSync(mainPath, "utf8");

const marker = "// Montar preview si el proyecto es ejecutable";
const idx = s.indexOf(marker);
if (idx < 0) {
  if (s.includes("Preview en background: NUNCA bloquear")) {
    console.log("already patched");
    process.exit(0);
  }
  throw new Error("preview marker not found");
}

const tryIdx = s.indexOf("try {", idx);
const catchIdx = s.indexOf("} catch { /* ignore */ }", tryIdx);
if (tryIdx < 0 || catchIdx < 0) throw new Error("try/catch block not found");

const end = catchIdx + "} catch { /* ignore */ }".length;
const replacement = `// Preview en background: NUNCA bloquear el return del agente (evita UI colgada en Verifier).
      Promise.resolve()
        .then(() => startProjectPreview(rootPath, event.sender.id))
        .then((preview) => {
          if (preview?.available && preview?.url && !event.sender.isDestroyed()) {
            event.sender.send("project:preview-updated", { projectRoot: rootPath, url: preview.url });
          }
        })
        .catch(() => {});`;

s = s.slice(0, idx) + replacement + s.slice(end);
fs.writeFileSync(mainPath, s);
console.log("patched preview fire-and-forget");
