"use strict";

const { app, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const userData = path.join(process.env.APPDATA || "", "EDITCOREAI");
const outFile = path.join(__dirname, "..", ".editcore", "probe-publish-lipoblue.json");
app.setPath("userData", userData);

function writeOut(payload) {
  try {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch (error) {
    process.stderr.write(`writeOut failed: ${error?.message || error}\n`);
  }
}

app.whenReady().then(async () => {
  const payload = { startedAt: new Date().toISOString() };
  try {
    const bin = path.join(userData, "editcore-secure-config.bin");
    const raw = safeStorage.decryptString(fs.readFileSync(bin));
    const secure = JSON.parse(raw);
    const conn = secure["editcore-connections"] || {};
    const token = String(conn.vercelToken || "").trim();
    payload.hasGithub = Boolean(String(conn.githubToken || "").trim());
    payload.hasVercel = Boolean(token);
    payload.vercelLen = token.length;
    if (!token) {
      payload.error = "NO_VERCEL_TOKEN";
      writeOut(payload);
      app.exit(2);
      return;
    }
    const { publishProject } = require("../runtime/publish-pipeline");
    const root = "D:\\PROGRAMAS IA\\LIPOBLUE";
    const result = await publishProject(root, {
      mode: "project",
      connections: {
        githubToken: String(conn.githubToken || "").trim(),
        vercelToken: token,
        vercelProjectId: "prj_u4FSZTXt3UJLjvMBgEQ0dglMptGA",
        vercelOrgId: "team_4XVvukp0kYKkyO5MvDPet1Q4",
        vercelTeamId: "team_4XVvukp0kYKkyO5MvDPet1Q4",
      },
      deploy: true,
      supabasePush: true,
      skipPush: true,
      preCheck: false,
      commitMessage: "chore: editcore publish probe",
      rollbackOnDeployFail: false,
    });
    const sb = (result.steps || []).find((s) => s.step === "supabase_db_push");
    const dep = (result.steps || []).find((s) => s.step === "deploy_one_click");
    payload.ok = result.ok === true;
    payload.message = String(result.message || "").slice(0, 400);
    payload.failedStep = result.failedStep || "";
    payload.supabase = sb ? {
      ok: sb.ok,
      skipped: sb.skipped,
      warning: sb.warning,
      message: String(sb.message || "").slice(0, 260),
    } : null;
    payload.deploy = dep ? {
      ok: dep.ok,
      skipped: dep.skipped,
      url: dep.url || "",
      message: String(dep.message || "").slice(0, 400),
      projectId: dep.projectId || "",
      detail: String(dep.detail || "").slice(-400),
    } : null;
    payload.steps = (result.steps || []).map((s) => ({
      step: s.step,
      ok: s.ok !== false,
      skipped: s.skipped === true,
      message: String(s.message || "").slice(0, 160),
    }));
    writeOut(payload);
    app.exit(payload.ok ? 0 : 1);
  } catch (error) {
    payload.error = String(error?.stack || error);
    writeOut(payload);
    app.exit(1);
  }
});
