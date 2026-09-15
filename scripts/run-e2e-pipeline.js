"use strict";

/**
 * CLI: node scripts/run-e2e-pipeline.js [projectRoot]
 * Mismo reporte que la tool run_e2e_pipeline del agente.
 */

const path = require("node:path");
const { runEditcoreE2ePipeline } = require("../runtime/e2e-pipeline-report");

async function main() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const result = await runEditcoreE2ePipeline(root, { writeReport: true });
  console.log(result.reportMarkdown);
  console.log(`\n[score=${result.score}/100 ok=${result.ok} report=${result.reportPath}]`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
