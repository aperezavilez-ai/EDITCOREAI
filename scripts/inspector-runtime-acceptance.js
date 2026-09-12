"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { EditCoreBrainService } = require("../brain-service");
const { InspectorCoreService } = require("../inspector-core-service");

async function main() {
  const appRoot = path.resolve(__dirname, "..");
  const outputRoot = path.resolve(process.argv[2] || path.join(appRoot, "..", "..", "acceptance-output-20260804-final"));
  fs.mkdirSync(outputRoot, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-inspector-e2e-"));
  const temporaryAppRoot = path.join(temporaryRoot, "app-copy");
  const protectedFile = path.join(appRoot, "project-analysis.js");
  const sourceHashBefore = crypto.createHash("sha256").update(fs.readFileSync(protectedFile)).digest("hex");
  fs.cpSync(appRoot, temporaryAppRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(appRoot, source).replace(/\\/g, "/");
      return !relative || !/^(?:node_modules|\.editcore|release)(?:\/|$)/.test(relative);
    },
  });
  const fixturePackagePath = path.join(temporaryAppRoot, "package.json");
  const fixturePackage = JSON.parse(fs.readFileSync(fixturePackagePath, "utf8"));
  fixturePackage.scripts = { check: "node --check project-analysis.js" };
  fs.writeFileSync(fixturePackagePath, `${JSON.stringify(fixturePackage, null, 2)}\n`, "utf8");
  const brain = new EditCoreBrainService({
    catalogPath: path.join(appRoot, "catalog.json"),
    userDataPath: path.join(temporaryRoot, "inspector-user-data"),
    sharedSkillPaths: [path.join(appRoot, "brain-seed", "skills")],
  });
  const inspector = new InspectorCoreService({ brainService: brain, storageRoot: path.join(temporaryRoot, "inspector-state") });
  try {
    const progress = [];
    const installed = await inspector.install(temporaryAppRoot);
    const diagnosis = await inspector.diagnose(temporaryAppRoot, (step) => progress.push(step));
    const checkpoint = await inspector.createCheckpoint(temporaryAppRoot);
    const safeRepair = await inspector.repair(temporaryAppRoot, (step) => progress.push(step));
    const changedFiles = [...new Set((safeRepair.fixes || []).map((item) => item.path).filter(Boolean))];
    const regressionFile = "project-analysis.js";
    fs.appendFileSync(path.join(temporaryAppRoot, regressionFile), "\nfunction inspectorAcceptanceRegression( {\n", "utf8");
    changedFiles.push(regressionFile);
    const regressionValidation = await inspector.validateAfterRepair(temporaryAppRoot, checkpoint.id);
    const rollback = await inspector.restoreCheckpoint(temporaryAppRoot, checkpoint.id, changedFiles);
    const restoredValidation = await inspector.validateAfterRepair(temporaryAppRoot, checkpoint.id);
    const restoredDiagnosis = await inspector.diagnose(temporaryAppRoot, (step) => progress.push(step));
    await inspector.discardCheckpoint(temporaryAppRoot, checkpoint.id);
    const checkpointsAfterDiscard = await inspector.listCheckpoints(temporaryAppRoot);
    const snapshot = await inspector.snapshot(temporaryAppRoot);
    const brainSnapshot = await brain.snapshot(temporaryAppRoot);
    const sourceHashAfter = crypto.createHash("sha256").update(fs.readFileSync(protectedFile)).digest("hex");
    const report = {
      generatedAt: new Date().toISOString(),
      appRoot,
      temporaryAppRoot,
      installed: installed?.status === "active" || snapshot.installed,
      diagnosis,
      checkpoint: { id: checkpoint.id, files: checkpoint.files, commandResults: checkpoint.commandResults },
      safeRepair: { fixes: safeRepair.fixes || [], openAlertCount: safeRepair.openAlertCount || 0 },
      regressionValidation,
      rollback,
      restoredValidation,
      restoredDiagnosis,
      snapshot,
      brain: {
        ready: brainSnapshot.ready,
        memory: brainSnapshot.memory,
        index: brainSnapshot.index,
        skillCount: brainSnapshot.skillCount,
      },
      progress,
    };
    report.criteria = {
      temporaryCopy: temporaryAppRoot.startsWith(path.resolve(os.tmpdir())) && temporaryAppRoot !== appRoot,
      installed: report.installed,
      evaluated: Boolean(diagnosis?.area && diagnosis?.generatedAt),
      hasEvidence: Array.isArray(diagnosis?.evidence) && diagnosis.evidence.length > 0,
      checkpointCreated: Boolean(checkpoint.id && checkpoint.files > 0),
      modificationDetectedAsRegression: regressionValidation.degraded === true && regressionValidation.failures?.some((item) => item.script === "check"),
      rollbackRestoredFile: rollback.restored?.includes(regressionFile) === true,
      rollbackVerified: restoredValidation.degraded === false && restoredDiagnosis.commandResults?.every((item) => item.skipped || item.ok),
      checkpointDiscarded: checkpointsAfterDiscard.length === 0,
      canonicalSourceUntouched: sourceHashBefore === sourceHashAfter,
      persistentMemory: brainSnapshot.memory?.backend === "sqlite-fts5",
      indexedRuntime: Number(brainSnapshot.index?.totalFiles || 0) > 0,
    };
    report.ok = Object.values(report.criteria).every(Boolean);
    fs.writeFileSync(path.join(outputRoot, "inspector-runtime-acceptance.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!report.ok) process.exitCode = 2;
  } finally {
    brain.memoryStore.close();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
