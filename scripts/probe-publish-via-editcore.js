"use strict";

/**
 * Prueba el pipeline del botón Publicar (executeFullStackDeploy) con bóveda EditCoreAI.
 * Escribe progreso parcial para no quedar a ciegas si se cuelga.
 */

const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_ROOT = "D:\\PROGRAMAS IA\\LIPOBLUE";
const OUT = path.join(__dirname, "..", ".editcore", "probe-publish-via-editcore.json");
const userData = path.join(process.env.APPDATA || "", "EDITCOREAI");

app.setPath("userData", userData);
app.commandLine.appendSwitch("disable-gpu");

function writeOut(payload) {
  try {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`writeOut: ${error?.message || error}\n`);
  }
}

app.whenReady().then(async () => {
  const payload = {
    startedAt: new Date().toISOString(),
    via: "editcore-executeFullStackDeploy",
    projectRoot: PROJECT_ROOT,
    progress: [],
  };
  writeOut(payload);
  try {
    payload.encryption = safeStorage.isEncryptionAvailable();
    const bin = path.join(userData, "editcore-secure-config.bin");
    payload.vaultExists = fs.existsSync(bin);
    writeOut(payload);

    const raw = safeStorage.decryptString(fs.readFileSync(bin));
    const secure = JSON.parse(raw);
    const conn = secure["editcore-connections"] || {};
    const connections = {
      githubToken: String(conn.githubToken || "").trim(),
      vercelToken: String(conn.vercelToken || "").trim(),
      vercelOrgId: String(conn.vercelOrgId || conn.vercelTeamId || "").trim(),
      vercelTeamId: String(conn.vercelTeamId || conn.vercelOrgId || "").trim(),
      vercelProjectId: String(conn.vercelProjectId || "").trim(),
      selfSupabaseUrl: String(conn.selfSupabaseUrl || "").trim(),
      selfSupabaseKey: String(conn.selfSupabaseKey || "").trim(),
    };
    payload.hasGithub = Boolean(connections.githubToken);
    payload.hasVercel = Boolean(connections.vercelToken);
    writeOut(payload);
    if (!connections.githubToken || !connections.vercelToken) {
      payload.error = "Faltan tokens GitHub/Vercel en bóveda EditCoreAI";
      writeOut(payload);
      app.exit(2);
      return;
    }

    // Preferir update si ya hay infra: aísla Push+Deploy (donde truncaba).
    const hasInfra = fs.existsSync(path.join(PROJECT_ROOT, ".vercel", "project.json"));
    const mode = hasInfra ? "update" : "full";
    payload.mode = mode;
    payload.progress.push({ at: new Date().toISOString(), event: "start_deploy", mode });
    writeOut(payload);

    const { executeFullStackDeploy } = require("../runtime/fullstack-deploy");
    const result = await executeFullStackDeploy(PROJECT_ROOT, connections, {
      repoName: "lipoblue",
      mode,
      skipDeploy: false,
      skipPreCheck: true,
      rollbackOnFail: false,
      commitMessage: `chore: editcoreai publish ${new Date().toISOString().slice(0, 19)}`,
      onProgress: (p) => {
        payload.progress.push({
          at: new Date().toISOString(),
          stageId: p.stageId,
          status: p.status,
          message: String(p.message || "").slice(0, 240),
        });
        writeOut(payload);
      },
    });

    payload.ok = result.ok === true;
    payload.message = String(result.message || "").slice(0, 600);
    payload.liveUrl = result.liveUrl || "";
    payload.branch = result.branch || "";
    payload.sha = String(result.sha || "").slice(0, 40);
    payload.stages = (result.stages || []).map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      message: String(s.message || "").slice(0, 320),
      url: s.url || "",
    }));
    payload.steps = (result.steps || []).map((s) => ({
      step: s.step,
      ok: s.ok !== false,
      skipped: s.skipped === true,
      warning: s.warning === true,
      message: String(s.message || "").slice(0, 280),
      url: s.url || "",
    }));
    payload.finishedAt = new Date().toISOString();
    writeOut(payload);
    app.exit(payload.ok ? 0 : 1);
  } catch (error) {
    payload.error = String(error?.stack || error);
    payload.finishedAt = new Date().toISOString();
    writeOut(payload);
    app.exit(1);
  }
});
