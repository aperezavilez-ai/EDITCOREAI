"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveDesktopPreviewTarget, staticPreviewLaunch } = require("../preview-runtime");

function tmpProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ec-desktop-preview-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

const PAGE = "<!doctype html><html><head><title>App</title></head><body><h1>Hola</h1></body></html>";

test("Tauri con frontendDist estático: muestra la carpeta web en vez de correr tauri dev", () => {
  const root = tmpProject({
    "package.json": { scripts: { dev: "tauri dev" } },
    "src-tauri/tauri.conf.json": "\uFEFF" + JSON.stringify({ build: { frontendDist: "../web", beforeDevCommand: "" } }),
    "web/index.html": PAGE,
  });
  const target = resolveDesktopPreviewTarget(root, JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")));
  assert.equal(target.kind, "tauri");
  assert.equal(target.mode, "static");
  assert.equal(target.staticRoot, path.join(root, "web"));
  assert.equal(target.entry, "index.html");
});

test("Tauri con devUrl y beforeDevCommand: arranca solo el frontend", () => {
  const root = tmpProject({
    "package.json": { scripts: { dev: "tauri dev", "dev:web": "vite" } },
    "src-tauri/tauri.conf.json": { build: { devUrl: "http://localhost:1420", beforeDevCommand: "npm run dev:web", frontendDist: "../dist" } },
  });
  const target = resolveDesktopPreviewTarget(root, { scripts: { dev: "tauri dev" } });
  assert.deepEqual(target, { kind: "tauri", mode: "dev-server", url: "http://localhost:1420", command: "npm run dev:web", cwd: root });
});

test("Tauri cuyo script dev ya es vite usa el flujo normal", () => {
  const root = tmpProject({ "src-tauri/tauri.conf.json": { build: { devUrl: "http://localhost:1420" } } });
  assert.equal(resolveDesktopPreviewTarget(root, { scripts: { dev: "vite", tauri: "tauri" } }), null);
});

test("Electron: detecta el HTML de loadFile aunque esté en una subcarpeta", () => {
  const root = tmpProject({
    "package.json": { main: "src/main.js", scripts: { start: "electron ." }, devDependencies: { electron: "^30.0.0" } },
    "src/main.js": "const win = new BrowserWindow();\nwin.loadFile(path.join(__dirname, 'renderer', 'index.html'));\n",
    "src/renderer/index.html": PAGE,
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const target = resolveDesktopPreviewTarget(root, pkg);
  assert.equal(target.kind, "electron");
  assert.equal(target.staticRoot, root);
  assert.equal(target.entry, "src/renderer/index.html");
});

test("Electron con vite en el script dev usa el flujo normal (servidor de desarrollo)", () => {
  const root = tmpProject({ "index.html": PAGE });
  const pkg = { scripts: { dev: "concurrently \"vite\" \"wait-on tcp:5173 && electron .\"" }, devDependencies: { electron: "^30.0.0", vite: "^5.0.0" } };
  assert.equal(resolveDesktopPreviewTarget(root, pkg), null);
});

test("proyecto HTML sin scripts se sirve estático; index.html de bundler no", () => {
  const plain = tmpProject({ "public/index.html": PAGE });
  const target = resolveDesktopPreviewTarget(plain, null);
  assert.equal(target.kind, "static");
  assert.equal(target.staticRoot, path.join(plain, "public"));
  const bundler = tmpProject({ "index.html": '<html><body><script type="module" src="/src/main.tsx"></script></body></html>' });
  assert.equal(resolveDesktopPreviewTarget(bundler, null), null);
});

test("servidor estático: entrada en subcarpeta con <base>, .mjs con MIME de JS y sin exponer .env ni node_modules", async () => {
  const root = tmpProject({
    "src/renderer/index.html": PAGE,
    "src/renderer/app.mjs": "export default 1;",
    ".env.local": "SECRET=1",
    "node_modules/x/index.js": "x",
  });
  const port = 47000 + Math.floor(Math.random() * 2000);
  const launch = staticPreviewLaunch(root, port, process.execPath, path.join(__dirname, "..", "static-preview-server.js"), "src/renderer/index.html");
  assert.ok(launch);
  const child = spawn(launch.executable, launch.args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...launch.env } });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("exit", (code) => reject(new Error(`servidor salió con ${code}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<head><base href="\/src\/renderer\/">/);
    const mod = await fetch(`${base}/src/renderer/app.mjs`);
    assert.match(mod.headers.get("content-type"), /javascript/);
    assert.equal((await fetch(`${base}/.env.local`)).status, 404);
    assert.equal((await fetch(`${base}/node_modules/x/index.js`)).status, 404);
  } finally {
    child.kill();
  }
});
