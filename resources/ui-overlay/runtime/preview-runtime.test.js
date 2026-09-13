"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { findRunnableProjectRoot, previewRuntimeFingerprint, readProjectPreviewEnv } = require("../preview-runtime");

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-preview-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("detecta un proyecto frontend ejecutable en la raiz", (t) => {
  const root = temporaryRoot(t);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  assert.equal(findRunnableProjectRoot(root), root);
});

test("conserva la raiz ejecutable aunque exista un build anidado", (t) => {
  const root = temporaryRoot(t);
  const app = path.join(root, "web-app");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite", "build:web-app": "npm --prefix web-app run build" } }));
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  assert.equal(findRunnableProjectRoot(root), root);
});

test("usa una aplicacion anidada cuando el script de desarrollo delega en ella", (t) => {
  const root = temporaryRoot(t);
  const app = path.join(root, "web-app");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "npm --prefix web-app run dev" } }));
  fs.writeFileSync(path.join(app, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  assert.equal(findRunnableProjectRoot(root), app);
});

test("hereda variables publicas sin exponer secretos del proyecto", (t) => {
  const root = temporaryRoot(t);
  const app = path.join(root, "frontend");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(root, ".env.local"), [
    "VITE_API_URL=https://api.example.test",
    "NEXT_PUBLIC_SITE_NAME=EditCore",
    "SUPABASE_SERVICE_ROLE_KEY=private-value",
    "DATABASE_URL=postgres://private",
  ].join("\n"));
  fs.writeFileSync(path.join(app, ".env.local"), "VITE_THEME=dark\n");
  assert.deepEqual(readProjectPreviewEnv(root, app), {
    VITE_API_URL: "https://api.example.test",
    NEXT_PUBLIC_SITE_NAME: "EditCore",
    VITE_THEME: "dark",
  });
});

test("reinicia el preview solo cuando cambia configuracion relevante", (t) => {
  const root = temporaryRoot(t);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
  fs.writeFileSync(path.join(root, ".env.local"), "VITE_API_URL=https://one.example\n");
  fs.writeFileSync(path.join(root, "src.ts"), "export const value = 1;\n");
  const initial = previewRuntimeFingerprint(root, root);

  fs.writeFileSync(path.join(root, "src.ts"), "export const value = 2;\n");
  assert.equal(previewRuntimeFingerprint(root, root), initial, "HMR atiende cambios de fuente");

  fs.writeFileSync(path.join(root, ".env.local"), "VITE_API_URL=https://two.example\n");
  assert.notEqual(previewRuntimeFingerprint(root, root), initial, "las variables requieren reinicio");
});

test("lee archivos de entorno del modo desarrollo", (t) => {
  const root = temporaryRoot(t);
  fs.writeFileSync(path.join(root, ".env"), "VITE_THEME=base\n");
  fs.writeFileSync(path.join(root, ".env.development"), "VITE_THEME=development\n");
  fs.writeFileSync(path.join(root, ".env.development.local"), "VITE_API_URL=https://dev.example\n");
  assert.deepEqual(readProjectPreviewEnv(root, root), {
    VITE_THEME: "development",
    VITE_API_URL: "https://dev.example",
  });
});
