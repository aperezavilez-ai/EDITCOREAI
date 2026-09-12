import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const asar = require("@electron/asar");

const paths = [
  path.join(process.env.LOCALAPPDATA || "", "Programs", "EDITCOREAI", "resources", "app.asar"),
  "D:\\PROGRAMAS IA\\EDITCOREAI\\resources\\app.asar",
];

for (const p of paths) {
  if (!fs.existsSync(p)) {
    console.log("MISS", p);
    continue;
  }
  const text = asar.extractFile(p, "main.js").toString("utf8");
  console.log("OK", p);
  console.log("  gemini-2.5-flash", text.includes("gemini-2.5-flash"));
  console.log("  grok-4.5", text.includes("grok-4.5"));
  console.log("  deepseek-v4-pro in APICREDITS block", /APICREDITS_GATEWAY_MODELS[\s\S]{0,400}deepseek-v4-pro/.test(text));
  console.log("  old block all gemini", /\/\^apicredits\\\/gemini\/i/.test(text));
}
