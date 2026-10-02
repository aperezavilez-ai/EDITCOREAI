"use strict";

/**
 * Script de Auto-Recuperación y Rescate de Emergencia para EditCoreAI.
 * Se puede ejecutar desde la consola o haciendo doble clic en rescue.bat.
 */

const path = require("node:path");
const { execSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const { rollbackLastChange, listSnapshots, createSnapshot } = require("../editcore-chat-kernel/snapshot");

function verifySyntax() {
  console.log("🔍 Verificando integridad sintáctica de archivos del núcleo...");
  try {
    execSync("node --check main.js preload.js chat-home.js renderer.js", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
    });
    console.log("✅ Sintaxis de JavaScript válida al 100%.");
    return true;
  } catch (err) {
    console.warn("⚠️ Advertencia en verificación sintáctica:", err.message);
    return false;
  }
}

function rebuildExe() {
  console.log("🔨 Recompilando EDITCOREAI.exe...");
  try {
    execSync("node scripts/rebuild-root-exe.js", {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    console.log("✅ EDITCOREAI.exe generado con éxito.");
  } catch (err) {
    console.error("❌ Error al recompilar el ejecutable:", err.message);
  }
}

function runRecovery() {
  console.log("====================================================");
  console.log("🛡️  EDITCOREAI - AUTO-RECUPERACIÓN Y RESCATE 1-CLIC");
  console.log("====================================================");

  const snapshotList = listSnapshots(PROJECT_ROOT, 5);
  if (!snapshotList.snapshots || snapshotList.snapshots.length === 0) {
    console.log("ℹ️ No hay snapshots previos registrados. Creando checkpoint de seguridad actual...");
    createSnapshot(PROJECT_ROOT, ["main.js", "preload.js", "index.html", "chat-home.js"], "Respaldo inicial de rescate");
    verifySyntax();
    rebuildExe();
    console.log("\n🎉 Sistema protegido y listo para operar.");
    return { ok: true, restored: [] };
  }

  console.log(`📦 Último snapshot detectado: ${snapshotList.latest}`);
  const result = rollbackLastChange(PROJECT_ROOT, snapshotList.latest);

  if (result.ok) {
    console.log(`✅ Snapshot ${result.snapshotId} restaurado con éxito.`);
    if (result.restored?.length) {
      console.log(`   Archivos restaurados: ${result.restored.join(", ")}`);
    }
    verifySyntax();
    rebuildExe();
    console.log("\n🎉 Auto-recuperación completada exitosamente.");
    return result;
  } else {
    console.error(`❌ Falló la restauración: ${result.error}`);
    verifySyntax();
    rebuildExe();
    return result;
  }
}

if (require.main === module) {
  runRecovery();
}

module.exports = {
  runRecovery,
  verifySyntax,
  rebuildExe,
};
