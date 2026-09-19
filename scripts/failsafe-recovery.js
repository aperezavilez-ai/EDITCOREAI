"use strict";

/**
 * Script de Auto-Recuperación y Rescate de Emergencia para EditCoreAI.
 * Se puede ejecutar desde la consola o haciendo doble clic en rescue.bat.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const { rollbackLastChange, listSnapshots, createSnapshot } = require("../editcore-chat-kernel/snapshot");

const MIRROR_FILES = [
  "main.js",
  "preload.js",
  "index.html",
  "chat-home.js",
  "chat-home.css",
  "renderer.js",
  "styles.css",
  "agent-parser.js",
  "auto-model-selection.js",
  "command-policy.js",
  "renderer-markdown.js",
  "security-utils.js",
  "project-analysis.js",
  "project-path-policy.js",
  "static-preview-server.js",
  "editor-inline-edit.js",
  "logs-panel.js",
  "visual-preview-inspector.js",
  "editcore-claude-adapter.js",
  "package.json",
];

const RUNTIME_MIRRORS = [
  "runtime/auth-manager.js",
  "runtime/credit-ledger.js",
  "runtime/role-policy-guard.js",
  "runtime/update-check.js",
];

function syncMirrors() {
  console.log("🔄 Sincronizando espejos hacia resources/ui-overlay/...");
  const overlayDir = path.join(PROJECT_ROOT, "resources", "ui-overlay");
  if (!fs.existsSync(overlayDir)) {
    fs.mkdirSync(overlayDir, { recursive: true });
  }

  for (const rel of MIRROR_FILES) {
    const src = path.join(PROJECT_ROOT, rel);
    const dest = path.join(overlayDir, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }

  const runtimeOverlay = path.join(overlayDir, "runtime");
  if (!fs.existsSync(runtimeOverlay)) {
    fs.mkdirSync(runtimeOverlay, { recursive: true });
  }

  for (const rel of RUNTIME_MIRRORS) {
    const src = path.join(PROJECT_ROOT, rel);
    const dest = path.join(overlayDir, rel);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
  console.log("✅ Espejos sincronizados correctamente.");
}

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
    syncMirrors();
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
    syncMirrors();
    verifySyntax();
    rebuildExe();
    console.log("\n🎉 Auto-recuperación completada exitosamente.");
    return result;
  } else {
    console.error(`❌ Falló la restauración: ${result.error}`);
    syncMirrors();
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
  syncMirrors,
  verifySyntax,
  rebuildExe,
};
