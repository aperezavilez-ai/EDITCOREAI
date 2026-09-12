const { createRequire } = require("module");
const requireFrom = createRequire("d:/PROGRAMAS IA/EDITCOREAI/resources/app/scripts/deploy-ui-asar-hotfix.mjs");
const asar = requireFrom("@electron/asar");
const p = "C:/Users/apere/AppData/Local/Programs/EDITCOREAI/resources/app.asar";
for (const rel of ["agent-core/src/orchestrator.js", "agent-core\\src\\orchestrator.js", "agent-core/src/modes.js", "agent-core\\src\\modes.js"]) {
  try {
    const t = asar.extractFile(p, rel).toString("utf8");
    console.log("OK", rel, "len", t.length);
    const m = t.match(/CORE_VERSION\s*=\s*"([^"]+)"/);
    if (m) console.log(" version", m[1]);
    if (t.includes("SMOKE_AGENT_CORE")) console.log(" has SMOKE");
    if (t.includes("NUNCA tomar un path suelto")) console.log(" has NUNCA");
  } catch (e) {
    console.log("FAIL", rel, e.message);
  }
}
