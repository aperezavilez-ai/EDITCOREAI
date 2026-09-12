"use strict";

/**
 * Playbooks de migracion + ejecucion por lotes con checkpoint/rollback.
 */

const fs = require("node:fs");
const path = require("node:path");

const PLAYBOOKS = {
  "js-to-ts": {
    id: "js-to-ts",
    name: "JavaScript → TypeScript estricto",
    steps: [
      "Anadir tsconfig.json strict",
      "Renombrar entrypoints .js → .ts/.tsx con rename_sync",
      "Tipar exports publicos",
      "Correr typecheck y tests",
    ],
    files: {
      "tsconfig.json": `${JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src", "resources/app"],
      }, null, 2)}\n`,
    },
  },
  "react-hooks": {
    id: "react-hooks",
    name: "Class components → hooks",
    steps: [
      "Localizar class components con symbol_search",
      "Convertir a function + hooks",
      "Actualizar tests",
    ],
    files: {},
  },
  "orm-prisma": {
    id: "orm-prisma",
    name: "ORM legacy → Prisma",
    steps: [
      "Crear prisma/schema.prisma",
      "Mapear modelos",
      "Reemplazar queries y correr migraciones",
    ],
    files: {
      "prisma/schema.prisma": `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`,
    },
  },
};

function listMigrationPlaybooks() {
  return Object.values(PLAYBOOKS).map(({ id, name, steps }) => ({ id, name, steps }));
}

function checkpointDir(projectRoot, runId) {
  return path.join(String(projectRoot || ""), ".editcore", "migration-runs", String(runId || "default"));
}

function applyMigrationPlaybook(projectRoot, playbookId = "") {
  const pb = PLAYBOOKS[String(playbookId || "").trim()];
  if (!pb) {
    return { ok: false, error: `Playbook desconocido: ${playbookId}`, available: listMigrationPlaybooks() };
  }
  const root = path.resolve(String(projectRoot || ""));
  const written = [];
  for (const [rel, content] of Object.entries(pb.files || {})) {
    const abs = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, content, "utf8");
      written.push(rel);
    }
  }
  const dir = path.join(root, ".editcore", "playbooks", "migrations");
  fs.mkdirSync(dir, { recursive: true });
  const checklist = path.join(dir, `${pb.id}.md`);
  fs.writeFileSync(
    checklist,
    [`# ${pb.name}`, "", ...pb.steps.map((s, i) => `${i + 1}. ${s}`), ""].join("\n"),
    "utf8",
  );
  return {
    ok: true,
    playbook: pb.id,
    written,
    checklist: `.editcore/playbooks/migrations/${pb.id}.md`,
    steps: pb.steps,
  };
}

/**
 * Aplica un lote de cambios de archivo con backup para rollback.
 * batch: [{ path, content }] o [{ path, oldText, newText }]
 */
function runMigrationBatch(projectRoot, input = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const runId = String(input.runId || `mig_${Date.now().toString(36)}`);
  const dir = checkpointDir(root, runId);
  fs.mkdirSync(dir, { recursive: true });
  const batch = Array.isArray(input.batch) ? input.batch : [];
  const applied = [];
  const backups = [];

  for (const item of batch.slice(0, Number(input.limit) || 40)) {
    const rel = String(item.path || "").replace(/\\/g, "/");
    if (!rel || rel.includes("..")) continue;
    const abs = path.join(root, ...rel.split("/"));
    let before = "";
    const existed = fs.existsSync(abs);
    if (existed) before = fs.readFileSync(abs, "utf8");
    let after = before;
    if (item.content != null) after = String(item.content);
    else if (item.oldText != null) {
      const oldText = String(item.oldText);
      const newText = String(item.newText ?? "");
      if (!before.includes(oldText)) {
        applied.push({ path: rel, ok: false, error: "oldText no encontrado" });
        continue;
      }
      after = item.replaceAll === true ? before.split(oldText).join(newText) : before.replace(oldText, newText);
    } else {
      applied.push({ path: rel, ok: false, error: "sin content/oldText" });
      continue;
    }
    const backupName = `${rel.replace(/[\\/]/g, "__")}.bak`;
    fs.writeFileSync(path.join(dir, backupName), before, "utf8");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, after, "utf8");
    backups.push({ path: rel, backup: backupName, existed });
    applied.push({ path: rel, ok: true, bytes: Buffer.byteLength(after, "utf8") });
  }

  const meta = {
    runId,
    at: new Date().toISOString(),
    playbook: input.playbook || "",
    backups,
    applied,
  };
  fs.writeFileSync(path.join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { ok: true, runId, checkpoint: `.editcore/migration-runs/${runId}`, applied, count: applied.filter((a) => a.ok).length };
}

function rollbackMigrationBatch(projectRoot, runId = "") {
  const root = path.resolve(String(projectRoot || ""));
  const dir = checkpointDir(root, runId);
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return { ok: false, error: "Checkpoint no encontrado." };
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const restored = [];
  for (const item of meta.backups || []) {
    const abs = path.join(root, ...String(item.path).split("/"));
    const bak = path.join(dir, item.backup);
    const before = fs.existsSync(bak) ? fs.readFileSync(bak, "utf8") : "";
    if (!item.existed) {
      if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });
      restored.push({ path: item.path, action: "deleted" });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, before, "utf8");
      restored.push({ path: item.path, action: "restored" });
    }
  }
  meta.rolledBackAt = new Date().toISOString();
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { ok: true, runId, restored };
}

module.exports = {
  listMigrationPlaybooks,
  applyMigrationPlaybook,
  runMigrationBatch,
  rollbackMigrationBatch,
  PLAYBOOKS,
};
