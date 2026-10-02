"use strict";
/**
 * Recompila EDITCOREAI.exe en la raíz del proyecto (launcher → Electron + esta carpeta).
 * Lee version desde package.json.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appRoot = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const ver = String(pkg.version || "0.0.0").trim();
const parts = ver.split(".").map((n) => parseInt(n, 10) || 0);
while (parts.length < 4) parts.push(0);
const winVer = parts.slice(0, 4).join(".");

const srcPath = path.join(__dirname, "EditCoreAiRootLauncher.cs");
let src = fs.readFileSync(srcPath, "utf8");
src = src
  .replace(/AssemblyVersion\("[^"]*"\)/, `AssemblyVersion("${winVer}")`)
  .replace(/AssemblyFileVersion\("[^"]*"\)/, `AssemblyFileVersion("${winVer}")`)
  .replace(/AssemblyInformationalVersion\("[^"]*"\)/, `AssemblyInformationalVersion("${ver}")`);
fs.writeFileSync(srcPath, src, "utf8");

const cscCandidates = [
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
  path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
];
const csc = cscCandidates.find((p) => fs.existsSync(p));
if (!csc) {
  console.error("csc.exe no encontrado");
  process.exit(1);
}

const outExe = path.join(appRoot, "EDITCOREAI.exe");
if (fs.existsSync(outExe)) {
  try { fs.unlinkSync(outExe); } catch {}
}

const iconPath = path.join(appRoot, "assets", "logo.ico");
if (!fs.existsSync(iconPath) || fs.statSync(iconPath).size < 1000) {
  console.error("Falta assets/logo.ico (logo oficial). No se compila el launcher sin icono.");
  process.exit(1);
}
const args = ["/nologo", "/target:winexe", "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", `/out:${outExe}`, `/win32icon:${iconPath}`, srcPath];

const result = spawnSync(csc, args, { cwd: appRoot, stdio: "inherit", shell: false });
if (result.status !== 0) process.exit(result.status || 1);

try {
  const now = new Date();
  fs.utimesSync(outExe, now, now);
} catch {}

console.log("EDITCOREAI.exe", outExe);
console.log("icon", iconPath);
console.log("version", ver, "fileVersion", winVer);
