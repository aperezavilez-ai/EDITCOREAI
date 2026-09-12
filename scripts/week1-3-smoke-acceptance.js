"use strict";

/**
 * Suite Semanas 1–3 (sin UI): Agent Core create/replace/swap/delete + undo checkpoint.
 * Ejecutar: node resources/app/scripts/week1-3-smoke-acceptance.js
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO = path.resolve(__dirname, "..", "..", "..");
const CORE = path.join(REPO, "resources", "editcore-agent-core");
const APP = path.join(REPO, "resources", "app");
const SMOKE = path.join(APP, "agent-core", "SMOKE_W1.txt");

const report = {
  generatedAt: new Date().toISOString(),
  repo: REPO,
  phases: [],
  ok: true,
};

function step(name, fn) {
  const started = Date.now();
  try {
    const detail = fn() || {};
    report.phases.push({ name, ok: true, ms: Date.now() - started, ...detail });
    console.log(`OK  ${name}`);
  } catch (error) {
    report.ok = false;
    report.phases.push({
      name,
      ok: false,
      ms: Date.now() - started,
      error: String(error?.message || error),
    });
    console.error(`FAIL ${name}: ${error?.message || error}`);
  }
}

function runNodeTest(cwd, pattern) {
  const r = spawnSync(process.execPath, ["--test", pattern], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "test failed").slice(-1500));
  }
  const pass = Number((r.stdout.match(/ℹ pass (\d+)/) || [])[1] || 0);
  const fail = Number((r.stdout.match(/ℹ fail (\d+)/) || [])[1] || 0);
  if (fail > 0) throw new Error(`fail=${fail}\n${r.stdout.slice(-800)}`);
  return { pass, fail };
}

function memoryFs() {
  const files = new Map();
  return {
    files,
    async execute(name, input = {}) {
      const p = String(input.path || "").replace(/\\/g, "/");
      if (name === "read_file") {
        if (!files.has(p)) throw new Error(`Archivo no encontrado: ${p}`);
        return { path: p, content: files.get(p) };
      }
      if (name === "write_file") {
        files.set(p, String(input.content || ""));
        return { path: p, bytes: files.get(p).length, created: true, backupPath: "" };
      }
      if (name === "replace_in_file") {
        if (!files.has(p)) throw new Error(`Archivo no encontrado: ${p}`);
        const cur = files.get(p);
        if (!cur.includes(input.oldText)) throw new Error("oldText no existe");
        files.set(p, cur.replace(input.oldText, input.newText));
        return { path: p, bytes: files.get(p).length, created: false };
      }
      if (name === "delete_file") {
        if (!files.has(p)) throw new Error(`Archivo no encontrado: ${p}`);
        files.delete(p);
        return { path: p, deleted: true };
      }
      if (name === "run_command") {
        return { diagnostic: true, passed: true, exitCode: 0, output: "PASS" };
      }
      throw new Error(name);
    },
  };
}

async function main() {
  step("unit: agent-core (semanas 1-2)", () => runNodeTest(CORE, "test/*.test.js"));
  step("unit: undo checkpoint (semana 3)", () => runNodeTest(APP, "test/agent-run-checkpoint.test.js"));

  const core = require(path.join(CORE, "index.js"));
  report.coreVersion = core.version;

  step("disk: reset SMOKE_W1.txt = w1-ok", () => {
    fs.mkdirSync(path.dirname(SMOKE), { recursive: true });
    fs.writeFileSync(SMOKE, "w1-ok", "utf8");
    return { content: fs.readFileSync(SMOKE, "utf8") };
  });

  // create
  {
    const name = "core: create archivo smoke";
    const started = Date.now();
    try {
      const mem = memoryFs();
      const result = await core.runAgent({
        prompt: [
          "PROCEDE",
          "Crea SOLO el archivo resources/app/agent-core/SMOKE_ACCEPT.txt",
          "con exactamente este contenido de una línea:",
          "accept-ok",
        ].join("\n"),
        projectRoot: REPO,
        allowWrite: true,
        planAuthorized: true,
        tools: mem,
      });
      if (!mem.files.get("resources/app/agent-core/SMOKE_ACCEPT.txt")?.includes("accept-ok")) {
        throw new Error("create no escribio contenido");
      }
      if (!/SMOKE_ACCEPT|accept-ok/i.test(result.text)) throw new Error("respuesta sin evidencia");
      report.phases.push({ name, ok: true, ms: Date.now() - started });
      console.log(`OK  ${name}`);
    } catch (error) {
      report.ok = false;
      report.phases.push({ name, ok: false, ms: Date.now() - started, error: String(error.message || error) });
      console.error(`FAIL ${name}: ${error.message || error}`);
    }
  }

  // swap + disk
  {
    const name = "core+disk: swap w1-ok → w1-week2-ok";
    const started = Date.now();
    try {
      const before = fs.readFileSync(SMOKE, "utf8");
      if (!before.includes("w1-ok")) fs.writeFileSync(SMOKE, "w1-ok", "utf8");
      const result = await core.runAgent({
        prompt: [
          "PROCEDE",
          "Arregla resources/app/agent-core/SMOKE_W1.txt:",
          "cambia w1-ok por w1-week2-ok",
        ].join("\n"),
        projectRoot: REPO,
        allowWrite: true,
        planAuthorized: true,
        tools: {
          async execute(toolName, input) {
            const rel = String(input.path || "").replace(/\\/g, "/");
            const abs = path.join(REPO, ...rel.split("/"));
            if (toolName === "read_file") {
              if (!fs.existsSync(abs)) throw new Error(`Archivo no encontrado: ${rel}`);
              return { path: rel, content: fs.readFileSync(abs, "utf8") };
            }
            if (toolName === "replace_in_file") {
              let content = fs.readFileSync(abs, "utf8");
              if (!content.includes(input.oldText)) throw new Error("oldText no existe");
              content = content.replace(input.oldText, input.newText);
              fs.writeFileSync(abs, content, "utf8");
              return { path: rel, bytes: content.length, created: false, backupPath: "" };
            }
            if (toolName === "write_file") {
              fs.mkdirSync(path.dirname(abs), { recursive: true });
              fs.writeFileSync(abs, String(input.content || ""), "utf8");
              return { path: rel, bytes: Buffer.byteLength(String(input.content || "")), created: true };
            }
            throw new Error(toolName);
          },
        },
      });
      const after = fs.readFileSync(SMOKE, "utf8");
      if (!after.includes("w1-week2-ok")) throw new Error(`disco=${JSON.stringify(after)}`);
      if (!/Mutaciones aplicadas|replace_in_file OK/i.test(result.text)) {
        throw new Error("sin evidencia de mutacion");
      }
      report.phases.push({ name, ok: true, ms: Date.now() - started, disk: after });
      console.log(`OK  ${name}`);
    } catch (error) {
      report.ok = false;
      report.phases.push({ name, ok: false, ms: Date.now() - started, error: String(error.message || error) });
      console.error(`FAIL ${name}: ${error.message || error}`);
    }
  }

  // delete
  {
    const name = "core: delete_file determinista";
    const started = Date.now();
    try {
      const mem = memoryFs();
      mem.files.set("resources/app/agent-core/SMOKE_DEL.txt", "x");
      const result = await core.runAgent({
        prompt: "PROCEDE\nBorra el archivo resources/app/agent-core/SMOKE_DEL.txt",
        projectRoot: REPO,
        allowWrite: true,
        planAuthorized: true,
        tools: mem,
      });
      if (mem.files.has("resources/app/agent-core/SMOKE_DEL.txt")) throw new Error("no borro");
      if (!/delete_file OK|borrado/i.test(result.text)) throw new Error("sin evidencia delete");
      report.phases.push({ name, ok: true, ms: Date.now() - started });
      console.log(`OK  ${name}`);
    } catch (error) {
      report.ok = false;
      report.phases.push({ name, ok: false, ms: Date.now() - started, error: String(error.message || error) });
      console.error(`FAIL ${name}: ${error.message || error}`);
    }
  }

  // undo checkpoint module on real temp project
  {
    const name = "semana3: undo restore en disco";
    const started = Date.now();
    try {
      const {
        saveLastAgentRun,
        restoreLastAgentRun,
        buildLastRunReview,
        reviewFileDecision,
        acceptAllPending,
      } = require(path.join(APP, "runtime", "agent-run-checkpoint"));
      const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ec-w13-ud-"));
      const project = fs.mkdtempSync(path.join(os.tmpdir(), "ec-w13-proj-"));
      const rel = "agent-core/SMOKE_W1.txt";
      const abs = path.join(project, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "w1-week2-ok", "utf8");
      const backup = path.join(userData, "bak.txt");
      fs.writeFileSync(backup, "w1-ok", "utf8");
      saveLastAgentRun(userData, project, {
        runId: "smoke",
        files: [{ path: rel, action: "replace_in_file", backupPath: backup, created: false }],
      });
      const resolveInside = (root, r) => path.join(root, ...String(r).split("/"));
      const review = buildLastRunReview(userData, project, { resolveInside });
      if (!review.files?.length || !review.files[0].diff) throw new Error("review sin diff");
      // semana4: accept keeps content
      acceptAllPending(userData, project);
      if (fs.readFileSync(abs, "utf8") !== "w1-week2-ok") throw new Error("accept altero disco");

      // new run then reject
      fs.writeFileSync(abs, "w1-week2-ok", "utf8");
      saveLastAgentRun(userData, project, {
        runId: "smoke2",
        files: [{ path: rel, action: "replace_in_file", backupPath: backup, created: false }],
      });
      reviewFileDecision(userData, project, rel, "reject", { resolveInside });
      if (fs.readFileSync(abs, "utf8") !== "w1-ok") throw new Error("reject no restauro");

      report.phases.push({ name: "semana4: review accept/reject", ok: true, ms: Date.now() - started });
      console.log("OK  semana4: review accept/reject");

      // restore path for semana3 naming still
      saveLastAgentRun(userData, project, {
        runId: "smoke3",
        files: [{ path: rel, action: "replace_in_file", backupPath: backup, created: false }],
      });
      fs.writeFileSync(abs, "tmp", "utf8");
      const out = restoreLastAgentRun(userData, project, { resolveInside });
      if (fs.readFileSync(abs, "utf8") !== "w1-ok") throw new Error("restore no revirtio");
      if (out.restored !== 1) throw new Error("restored count");
      report.phases.push({ name, ok: true, ms: Date.now() - started });
      console.log(`OK  ${name}`);
    } catch (error) {
      report.ok = false;
      report.phases.push({ name, ok: false, ms: Date.now() - started, error: String(error.message || error) });
      console.error(`FAIL ${name}: ${error.message || error}`);
    }
  }

  step("unit: platform backlog (index/@/mcp/privacy/yolo/checkpoint)", () =>
    runNodeTest(APP, "test/platform-backlog.test.js"));
  step("unit: vision backlog (browser/rename/images/docs/docker)", () =>
    runNodeTest(APP, "test/vision-backlog.test.js"));

  // restore smoke file for user
  step("cleanup: SMOKE_W1.txt = w1-week2-ok (estado post-semana2)", () => {
    fs.writeFileSync(SMOKE, "w1-week2-ok", "utf8");
    return { content: fs.readFileSync(SMOKE, "utf8") };
  });

  const outPath = path.join(REPO, ".editcore", "week1-3-smoke-report.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nREPORT ${outPath}`);
  console.log(report.ok ? "\nALL PASS" : "\nSOME FAILED");
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
