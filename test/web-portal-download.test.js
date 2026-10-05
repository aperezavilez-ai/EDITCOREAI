"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("Página oficial: /download entrega siempre el instalador más nuevo", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const route = config.routes.find((r) => r.src === "/(download|descargar)");
  assert.ok(route, "falta la ruta /download");
  assert.equal(route.dest, "https://github.com/aperezavilez-ai/EDITCOREAI/releases/latest/download/EDITCOREAI-Setup.exe");
  assert.equal(route.status, 302);
  assert.ok(config.routes.indexOf(route) < config.routes.findIndex((r) => r.handle === "filesystem"));
});

test("Página oficial: Vercel publica solo web-portal, sin instalar la app de escritorio", () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.equal(config.outputDirectory, "web-portal");
  assert.equal(config.installCommand, "");
  assert.equal(config.buildCommand, "node scripts/write-web-config.js");
  const ignore = fs.readFileSync(path.join(ROOT, ".vercelignore"), "utf8").split(/\r?\n/).filter(Boolean);
  assert.deepEqual(ignore, [
    "/*", "!/web-portal", "!/vercel.json",
    "!/scripts", "/scripts/*", "!/scripts/write-web-config.js",
    "!/runtime", "/runtime/*", "!/runtime/elite-communication-policy.js",
    "!/runtime/credit-ledger.js",
    "!/index.html", "!/styles.css", "!/chat-home.css", "!/chat-home.js", "!/renderer-markdown.js",
  ]);
});

test("Página oficial: los botones de descarga usan el dominio propio, no versiones fijas", () => {
  for (const file of ["index.html", "download.html"]) {
    const html = fs.readFileSync(path.join(ROOT, "web-portal", file), "utf8");
    assert.match(html, /"\/download"|'\/download'|url=\/download/);
    assert.doesNotMatch(html, /releases\/download\/v\d/);
    assert.doesNotMatch(html, /github\.com\/[^"']*Setup\.exe/);
  }
});
