"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseFullAccessCommand,
  parseLegacyReadCommand,
  isShellReadCommand,
  resolveShellReadPath,
  classifyCommandRisk,
} = require("../command-policy");

test("full permite npm install y comandos de desarrollo", () => {
  assert.deepEqual(parseFullAccessCommand("npm install"), { executable: "npm", args: ["install"], shell: false, risk: { level: "none" } });
  assert.deepEqual(parseFullAccessCommand("npm run dev"), { executable: "npm", args: ["run", "dev"], shell: false, risk: { level: "none" } });
  assert.deepEqual(parseFullAccessCommand("dir"), { executable: "dir", args: [], shell: false, risk: { level: "none" } });
  assert.deepEqual(parseFullAccessCommand("node --check src/app.js"), { executable: "node", args: ["--check", "src/app.js"], shell: false, risk: { level: "none" } });
});

test("full permite shells y comandos compuestos con riesgo confirmable", () => {
  const shell = parseFullAccessCommand("npm test && npm run build");
  assert.equal(shell.shell, true);
  assert.equal(shell.risk.level, "confirm");
  const ps = parseFullAccessCommand("powershell -Command Get-ChildItem .");
  assert.equal(ps.shell, true);
  assert.equal(ps.risk.level, "confirm");
});

test("full normaliza rutas absolutas de npm.cmd en Windows", () => {
  const parsed = parseFullAccessCommand(String.raw`C:\PROGRA~1\nodejs\npm.cmd run build`);
  assert.equal(parsed.executable, "npm");
  assert.deepEqual(parsed.args, ["run", "build"]);
  const spaced = parseFullAccessCommand(String.raw`C:\Program Files\nodejs\npm.cmd run build`);
  assert.equal(spaced.executable, "npm");
  assert.deepEqual(spaced.args, ["run", "build"]);
});

test("buildWindowsCmdInvocation cita rutas con espacios", () => {
  const { buildWindowsCmdInvocation } = require("../command-policy");
  assert.deepEqual(
    buildWindowsCmdInvocation(String.raw`C:\Program Files\nodejs\npm.cmd`, ["run", "build"]),
    ["/d", "/s", "/c", String.raw`"C:\Program Files\nodejs\npm.cmd" run build`],
  );
});

test("isProjectDevServerCommand detecta npm run dev", () => {
  const { isProjectDevServerCommand } = require("../command-policy");
  assert.equal(isProjectDevServerCommand("npm run dev"), true);
  assert.equal(isProjectDevServerCommand(String.raw`C:\Program Files\nodejs\npm.cmd run dev`), true);
  assert.equal(isProjectDevServerCommand("npm run build"), false);
});

test("full bloquea operaciones catastroficas", () => {
  assert.throws(() => parseFullAccessCommand("rm -rf /"), /bloqueada/i);
  const risk = classifyCommandRisk("git push origin main");
  assert.equal(risk.level, "confirm");
  assert.match(risk.kind, /git push/i);
});

test("identifica cat heredado como lectura de archivo sin habilitar shell", () => {
  assert.deepEqual(parseLegacyReadCommand("cat package.json"), { executable: "cat", args: ["package.json"], path: "package.json" });
  assert.equal(parseLegacyReadCommand("cat package.json && whoami"), null);
  assert.equal(parseLegacyReadCommand("cat -- package.json"), null);
});

test("isShellExploreCommand detecta dir recursivo", () => {
  const { isShellExploreCommand } = require("../command-policy");
  assert.equal(isShellExploreCommand('dir /B /S "D:\\proyecto"'), true);
});

test("resolveShellReadPath e isShellReadCommand redirigen lecturas legacy", () => {
  assert.equal(resolveShellReadPath("type src/app.tsx"), "src/app.tsx");
  assert.equal(isShellReadCommand("type src/app.tsx"), true);
  assert.equal(resolveShellReadPath("dir /B /S *.tsx"), null);
  assert.equal(isShellReadCommand("dir /B /S *.tsx"), false);
});

test("detecta exploracion shell incl. Get-ChildItem y powershell", () => {
  const { isShellExploreCommand, extractShellExplorePathHint } = require("../command-policy");
  assert.equal(isShellExploreCommand('Get-ChildItem "D:\\PROGRAMAS IA\\CALILI" -Force'), true);
  assert.equal(isShellExploreCommand("dir /B"), true);
  assert.equal(isShellExploreCommand('powershell -Command "Get-ChildItem ."'), true);
  assert.equal(isShellExploreCommand("npm test"), false);
  assert.equal(extractShellExplorePathHint('Get-ChildItem "D:\\PROGRAMAS IA\\CALILI" -Force'), "D:\\PROGRAMAS IA\\CALILI");
});
