"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { GitCheckpointManager } = require("../runtime/git-checkpoint-manager");

test("GitCheckpointManager creates snapshots, performs time travel, and generates semantic commit messages", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-chk-test-"));
  
  const fileA = path.join(tmpDir, "src", "Button.tsx");
  fs.mkdirSync(path.dirname(fileA), { recursive: true });
  fs.writeFileSync(fileA, "export const Button = () => <button>Click</button>;", "utf8");

  const manager = new GitCheckpointManager({ projectRoot: tmpDir });

  // 1. Crear checkpoint antes de mutar
  const checkpoint = manager.createCheckpoint({
    description: "Antes de refactorizar Button.tsx a Tailwind",
    modifiedFiles: ["src/Button.tsx", "src/NewBadge.tsx"],
  });

  assert.ok(checkpoint.id.startsWith("chk_"));
  assert.equal(checkpoint.filesCount, 2);

  // 2. Modificar fileA y crear NewBadge.tsx
  fs.writeFileSync(fileA, "export const Button = () => <button className='btn-blue'>Click</button>;", "utf8");
  fs.writeFileSync(path.join(tmpDir, "src", "NewBadge.tsx"), "export const Badge = () => <span>New</span>;", "utf8");

  // 3. Time Travel de regreso al checkpoint
  const travelResult = manager.timeTravelTo(checkpoint.id);
  assert.equal(travelResult.ok, true);
  assert.equal(travelResult.restoredCount, 2);

  // Verificar que Button.tsx volvió a su estado original
  assert.equal(fs.readFileSync(fileA, "utf8"), "export const Button = () => <button>Click</button>;");
  // Verificar que el archivo nuevo fue eliminado limpiamente
  assert.equal(fs.existsSync(path.join(tmpDir, "src", "NewBadge.tsx")), false);

  // 4. Generación de commit semántico
  const commitMsg = manager.generateSemanticCommitMessage(["src/Button.tsx"]);
  assert.equal(commitMsg, "feat(ui): update Button and related components");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
