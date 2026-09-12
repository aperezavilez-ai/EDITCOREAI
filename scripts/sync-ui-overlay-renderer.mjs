import fs from "node:fs";
import path from "node:path";

const repo = path.resolve("D:/PROGRAMAS IA/EDITCOREAI/resources/ui-overlay/renderer.js");
const installed = path.resolve(
  process.env.LOCALAPPDATA || "",
  "Programs/EDITCOREAI/resources/ui-overlay/renderer.js",
);
const text = fs.readFileSync(repo, "utf8");
if (!/\$\("connectGatewayProjectBtn"\)\?\.addEventListener/.test(text)) {
  throw new Error("Missing optional connectGatewayProjectBtn wiring");
}
if (/\$\("connectGatewayProjectBtn"\)\.addEventListener/.test(text)) {
  throw new Error("Hard connectGatewayProjectBtn wiring still present");
}
fs.copyFileSync(repo, installed);
console.log(JSON.stringify({
  repoBytes: fs.statSync(repo).size,
  installedBytes: fs.statSync(installed).size,
  gatewayOptional: true,
}, null, 2));
