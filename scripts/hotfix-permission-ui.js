"use strict";

// Legacy: redirige al hotfix unificado (1 asar instalado + espejo repo).
console.log("[hotfix-permission-ui] DEPRECATED → usa scripts/deploy-ui-asar-hotfix.mjs");
require("node:child_process").spawnSync(
  process.execPath,
  [require("node:path").join(__dirname, "deploy-ui-asar-hotfix.mjs")],
  { stdio: "inherit" },
);
