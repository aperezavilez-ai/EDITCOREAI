"use strict";
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "renderer.js");
let s = fs.readFileSync(file, "utf8");
const ids = [
  "connectionsBtn",
  "closeConnectionsBtn",
  "detectConnectionsBtn",
  "providersBtn",
  "closeProvidersBtn",
  "brainInstallRepoBtn",
  "brainSearch",
  "brainRepoUrl",
  "previewBackBtn",
  "webPreviewBtn",
  "mobilePreviewBtn",
];
let n = 0;
for (const id of ids) {
  const bad = `$("${id}").addEventListener`;
  const good = `$("${id}")?.addEventListener`;
  if (s.includes(bad)) {
    s = s.split(bad).join(good);
    n += 1;
  }
}
if (!s.includes("wireComposerControlsSafe")) {
  s = s.replace(
    "wireComposerControls();\n",
    `try { wireComposerControls(); } catch (err) {
  console.error("[EditCoreAI] wireComposerControls failed", err);
  try { $("status").textContent = "Error UI chat: " + (err?.message || err); } catch { /* ignore */ }
}
`,
  );
  n += 1;
}
fs.writeFileSync(file, s);
console.log("patched listeners/guards:", n);
