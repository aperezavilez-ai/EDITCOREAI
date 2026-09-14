"use strict";

/**
 * Prueba real de publish (commit+push+deploy) para FUXION SERVICE.
 * Usa tokens de gh CLI + vercel CLI auth.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { executeFullStackDeploy } = require("../runtime/fullstack-deploy");

function loadVercelToken() {
  const authPath = path.join(process.env.APPDATA || "", "com.vercel.cli", "Data", "auth.json");
  const auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  return String(auth.token || "").trim();
}

function loadGithubToken() {
  const gh = fs.existsSync("C:\\Program Files\\GitHub CLI\\gh.exe")
    ? "C:\\Program Files\\GitHub CLI\\gh.exe"
    : "gh";
  return String(execFileSync(gh, ["auth", "token"], { encoding: "utf8", windowsHide: true })).trim();
}

async function main() {
  const root = path.resolve("d:/PROGRAMAS IA/FUXION SERVICE");
  const connections = {
    githubToken: loadGithubToken(),
    vercelToken: loadVercelToken(),
  };
  if (!connections.githubToken) throw new Error("Sin GitHub token");
  if (!connections.vercelToken) throw new Error("Sin Vercel token");

  const stages = [];
  const result = await executeFullStackDeploy(root, connections, {
    mode: "full",
    skipPreCheck: false,
    commitMessage: "chore: fullstack publish FUXION SERVICE 2026-09-13",
    onProgress: (p) => {
      if (p?.type === "stage") {
        stages.push({ id: p.stageId, status: p.status, message: p.message });
        console.log(`[stage] ${p.stageId} → ${p.status} ${p.message || ""}`);
      }
    },
  });

  console.log(JSON.stringify({
    ok: result.ok,
    completed: result.completed,
    message: result.message,
    liveUrl: result.liveUrl || result.vercelUrl || "",
    sha: result.sha || "",
    stages: (result.stages || []).map((s) => ({ id: s.id, status: s.status, message: s.message })),
    failSteps: (result.steps || []).filter((s) => s.ok === false).map((s) => ({ step: s.step, message: s.message })),
  }, null, 2));

  if (!result.ok) process.exit(2);
  if (/pathspec/i.test(JSON.stringify(result))) {
    console.error("REGRESSION: pathspec still present");
    process.exit(3);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
