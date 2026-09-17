"use strict";

/**
 * Pipeline unificado estilo Lovable:
 * - mode=full: GitHub → Vercel → Supabase → Push/Deploy → infra
 * - mode=update: solo commit/push/redeploy (Actualizar publicación)
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  connectProject,
  writeProjectLinkManifest,
  writeLocalEnv,
} = require("./project-connect");
const { syncEnvToVercel } = require("./vercel-env-sync");
const { manageSupabaseProject } = require("./supabase-manager");
const { publishProject, rollbackLastCommit } = require("./publish-pipeline");
const { appendAuditEvent } = require("./project-audit");
const {
  projectOwnedSupabaseUrl,
  gafcoreProjectSlug,
  connectionsForProject,
} = require("./operator-connections-context");
const { findGitRoot } = require("./git-utils");

const STAGES = [
  { id: "github", label: "GitHub Repo" },
  { id: "vercel", label: "Vercel Link" },
  { id: "supabase", label: "Supabase DB" },
  { id: "publish", label: "Push + Deploy" },
  { id: "live", label: "Live URL" },
];

const UPDATE_STAGES = [
  { id: "publish", label: "Push + Deploy" },
  { id: "live", label: "Live URL" },
];

function emitProgress(onProgress, payload) {
  if (typeof onProgress === "function") {
    try {
      onProgress(payload);
    } catch {
      /* ignore UI callback errors */
    }
  }
}

function stagePercentOf(status, explicit) {
  const n = Number(explicit);
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  if (status === "done") return 100;
  if (status === "running") return 15;
  if (status === "error") return 0;
  return 0;
}

function computeOverallPercent(stages) {
  if (!stages.length) return 0;
  const sum = stages.reduce((acc, s) => acc + stagePercentOf(s.status, s.percent), 0);
  return Math.round(sum / stages.length);
}

function writeProjectInfra(projectRoot, infra = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    projectName: path.basename(root),
    githubRemoteUrl: infra.githubRemoteUrl || "",
    githubFullName: infra.githubFullName || "",
    vercelProjectId: infra.vercelProjectId || "",
    vercelProjectName: infra.vercelProjectName || "",
    vercelUrl: infra.vercelUrl || "",
    supabaseUrl: infra.supabaseUrl || "",
    supabaseProjectId: infra.supabaseProjectId || "",
    gafcoreGateway: infra.gafcoreGateway || "",
    liveUrl: infra.liveUrl || infra.vercelUrl || "",
    notes: Array.isArray(infra.notes) ? infra.notes : [],
  };
  const rootFile = path.join(root, "project-infra.json");
  const editcoreDir = path.join(root, ".editcore");
  fs.mkdirSync(editcoreDir, { recursive: true });
  const editcoreFile = path.join(editcoreDir, "project-infra.json");
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(rootFile, body, "utf8");
  fs.writeFileSync(editcoreFile, body, "utf8");
  return { ok: true, paths: ["project-infra.json", ".editcore/project-infra.json"], data: payload };
}

function readPrevInfra(root) {
  try {
    const file = path.join(root, "project-infra.json");
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    return {};
  }
}

async function executeFullStackDeploy(projectRoot, connections = {}, {
  repoName = "",
  commitMessage = "",
  skipDeploy = false,
  skipPreCheck = false,
  rollbackOnFail = true,
  mode = "full",
  onProgress = null,
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const isUpdate = String(mode || "full").toLowerCase() === "update";
  const stages = (isUpdate ? UPDATE_STAGES : STAGES).map((s) => ({ ...s, status: "pending", message: "" }));
  const steps = [];
  const startedAt = Date.now();

  const setStage = (id, status, message = "", extra = {}) => {
    const row = stages.find((s) => s.id === id);
    if (row) {
      row.status = status;
      row.message = message;
      if (extra.percent != null) row.percent = stagePercentOf(status, extra.percent);
      else if (status === "done") row.percent = 100;
      else if (status === "running" && row.percent == null) row.percent = 8;
      else if (status === "pending") row.percent = 0;
      else if (status === "error" && row.percent == null) row.percent = 0;
      Object.assign(row, extra);
      if (extra.percent != null) row.percent = stagePercentOf(status, extra.percent);
    }
    const overall = computeOverallPercent(stages);
    emitProgress(onProgress, {
      type: "stage",
      stageId: id,
      status,
      message,
      percent: overall,
      mode: isUpdate ? "update" : "full",
      stages: stages.map((s) => ({
        id: s.id,
        label: s.label,
        status: s.status,
        message: s.message,
        percent: stagePercentOf(s.status, s.percent),
        url: s.url || "",
      })),
      ...extra,
      percent: overall,
    });
  };

  const fail = (stageId, message, extra = {}) => {
    setStage(stageId, "error", message, extra);
    appendAuditEvent(root, {
      action: isUpdate ? "update_publication" : "fullstack_deploy",
      ok: false,
      message,
      steps: steps.map((item) => ({ step: item.step, ok: item.ok !== false })),
    });
    return {
      ok: false,
      completed: false,
      projectRoot: root,
      mode: isUpdate ? "update" : "full",
      stages,
      steps: [...steps, { step: stageId, ok: false, message, ...extra }],
      message,
      durationMs: Date.now() - startedAt,
      ...extra,
    };
  };

  if (!root || !fs.existsSync(root)) {
    return fail(isUpdate ? "publish" : "github", "projectRoot invalido.");
  }
  if (!String(connections.githubToken || "").trim()) {
    return fail(isUpdate ? "publish" : "github", "Falta GitHub token en Conexiones (bóveda safeStorage).");
  }

  let remoteUrl = "";
  let githubStep = {};
  let vercelEnv = { ok: true, skipped: true };
  let vercelStep = {};
  let supabaseUrl = "";
  const prevInfra = readPrevInfra(root);

  if (!isUpdate) {
    setStage("github", "running", "Inicializando repo y remote…");
    const connected = await connectProject(root, connections, {
      createGithub: true,
      createVercel: true,
      linkSupabase: true,
      repoName: repoName || path.basename(root),
    });
    steps.push({ step: "connect", ok: connected.ok, message: connected.message, detail: connected.steps });
    if (!connected.ok) {
      return fail("github", connected.message || "No se pudo conectar GitHub/servicios.", { partial: connected });
    }
    githubStep = (connected.steps || []).find((s) => s.step === "github_remote") || {};
    remoteUrl = githubStep.remoteUrl || connected.assessment?.remoteUrl || "";
    setStage("github", "done", remoteUrl || "Repo listo", { url: remoteUrl });

    setStage("vercel", "running", "Enlazando Vercel y sincronizando envs…");
    vercelStep = (connected.steps || []).find((s) => s.step === "vercel_project") || {};
    if (String(connections.vercelToken || "").trim()) {
      vercelEnv = await syncEnvToVercel(root, connections, {
        projectId: vercelStep.projectId || prevInfra.vercelProjectId || "",
        projectName: repoName || vercelStep.projectName || path.basename(root),
      });
    }
    steps.push({ step: "vercel_env_sync", ...vercelEnv });
    if (vercelEnv.ok === false && vercelEnv.skipped !== true) {
      return fail("vercel", vercelEnv.message || "syncEnvToVercel fallo.");
    }
    setStage("vercel", "done", vercelEnv.message || vercelStep.message || "Vercel listo", {
      projectId: vercelEnv.projectId || vercelStep.projectId || "",
    });

    setStage("supabase", "running", "Provisionando Supabase y .env…");
    const scoped = connectionsForProject(connections, root);
    supabaseUrl = projectOwnedSupabaseUrl(root, scoped.selfSupabaseUrl || connections.selfSupabaseUrl);
    const supabaseKey = String(scoped.selfSupabaseKey || connections.selfSupabaseKey || "").trim();
    let supabaseManage = { ok: true, skipped: true, message: "Supabase no configurado en Conexiones." };
    if (supabaseKey && supabaseUrl) {
      writeLocalEnv(root, {
        SUPABASE_URL: supabaseUrl,
        NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_URL: supabaseUrl,
        SUPABASE_ANON_KEY: supabaseKey,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseKey,
        VITE_SUPABASE_ANON_KEY: supabaseKey,
      });
      try {
        supabaseManage = await manageSupabaseProject(root, connections, { ensureBucket: true });
      } catch (error) {
        supabaseManage = { ok: false, message: error?.message || String(error) };
      }
    }
    steps.push({
      step: "supabase",
      ok: supabaseManage.ok !== false,
      skipped: supabaseManage.skipped === true,
      message: supabaseManage.message || supabaseUrl || "",
      url: supabaseUrl || "",
    });
    setStage("supabase", "done", supabaseUrl || supabaseManage.message || "Supabase listo", { url: supabaseUrl || "" });
  } else {
    remoteUrl = prevInfra.githubRemoteUrl || "";
    supabaseUrl = prevInfra.supabaseUrl || "";
  }

  setStage("publish", "running", isUpdate ? "Actualizando publicación…" : "Commit, push y deploy…", { percent: 5 });
  const publishConnections = {
    ...connections,
    vercelProjectId: String(
      vercelEnv.projectId
      || vercelStep.projectId
      || prevInfra.vercelProjectId
      || connections.vercelProjectId
      || "",
    ).trim(),
    vercelOrgId: String(connections.vercelOrgId || connections.vercelTeamId || "").trim(),
    vercelTeamId: String(connections.vercelTeamId || connections.vercelOrgId || "").trim(),
  };
  const publish = await publishProject(root, {
    mode: "project",
    connections: publishConnections,
    deploy: skipDeploy !== true,
    // Supabase CLI link no es requisito de Publicar (self-hosted / sin link).
    supabasePush: true,
    commitMessage: commitMessage || (isUpdate
      ? `chore: update publication ${path.basename(root)} ${new Date().toISOString().slice(0, 10)}`
      : `chore: fullstack publish ${path.basename(root)} ${new Date().toISOString().slice(0, 10)}`),
    // Pre-check no bloqueante: lint/tests no deben truncar el deploy.
    preCheck: false,
    rollbackOnDeployFail: false,
    onProgress: (p) => {
      const pct = Number(p?.percent);
      const msg = String(p?.message || p?.step || "").trim();
      setStage(
        "publish",
        "running",
        msg || (isUpdate ? "Actualizando publicación…" : "Commit, push y deploy…"),
        { percent: Number.isFinite(pct) ? pct : undefined, substep: p?.step || "" },
      );
    },
  });
  steps.push(...(publish.steps || []).map((s) => ({ ...s, step: `publish:${s.step}` })));
  if (!publish.ok) {
    let rollback = { ok: false, skipped: true };
    const gitRoot = findGitRoot(root);
    const commitStep = (publish.steps || []).find((s) => s.step === "git_commit" && s.committed);
    const pushStep = (publish.steps || []).find((s) => s.step === "git_push" && s.ok);
    if (rollbackOnFail && gitRoot && commitStep) {
      rollback = await rollbackLastCommit(gitRoot, { pushed: Boolean(pushStep) });
      steps.push({ step: "rollback", ...rollback });
    }
    return fail("publish", publish.message || "Publicación falló.", { publish, rollback });
  }
  setStage("publish", "done", publish.message || "Push/deploy OK", {
    branch: publish.branch,
    sha: publish.sha,
  });

  setStage("live", "running", "Actualizando project-infra.json…", { percent: 40 });
  const deployStep = (publish.steps || []).find((s) => s.step === "deploy_one_click");
  const liveUrl = deployStep?.url || "";
  const infra = writeProjectInfra(root, {
    githubRemoteUrl: remoteUrl || prevInfra.githubRemoteUrl || "",
    githubFullName: githubStep.repo?.fullName || prevInfra.githubFullName || "",
    vercelProjectId: vercelEnv.projectId || vercelStep.projectId || prevInfra.vercelProjectId || "",
    vercelProjectName: vercelStep.projectName || prevInfra.vercelProjectName || path.basename(root),
    vercelUrl: liveUrl || prevInfra.vercelUrl || "",
    supabaseUrl: supabaseUrl || prevInfra.supabaseUrl || "",
    supabaseProjectId: gafcoreProjectSlug(root),
    liveUrl: liveUrl || prevInfra.liveUrl || "",
    notes: [
      isUpdate ? "Actualización de publicación (EDITCOREAI)." : "Generado por executeFullStackDeploy (EDITCOREAI).",
      "Tokens solo en bóveda safeStorage de la app; no en el repo.",
    ],
  });
  if (!isUpdate) {
    writeProjectLinkManifest(root, {
      github: remoteUrl ? { remoteUrl } : null,
      vercel: {
        projectId: infra.data.vercelProjectId,
        projectName: infra.data.vercelProjectName,
        url: liveUrl,
      },
      supabase: supabaseUrl
        ? { url: supabaseUrl, projectId: gafcoreProjectSlug(root), linked: true }
        : null,
      notes: infra.data.notes,
    });
  }
  steps.push({ step: "project_infra", ok: true, paths: infra.paths, liveUrl });
  const finalUrl = liveUrl || prevInfra.liveUrl || "";
  setStage("live", "done", finalUrl || "Sin URL pública detectada", { url: finalUrl });

  appendAuditEvent(root, {
    action: isUpdate ? "update_publication" : "fullstack_deploy",
    ok: true,
    branch: publish.branch || "",
    sha: publish.sha || "",
    url: finalUrl,
    message: isUpdate ? "Publicación actualizada" : "Full-stack publish completado",
    steps: steps.map((item) => ({ step: item.step, ok: item.ok !== false })),
  });

  emitProgress(onProgress, {
    type: "complete",
    ok: true,
    mode: isUpdate ? "update" : "full",
    percent: 100,
    stages: stages.map((s) => ({
      id: s.id,
      label: s.label,
      status: s.status,
      message: s.message,
      percent: stagePercentOf(s.status, s.percent),
      url: s.url || "",
    })),
    liveUrl: finalUrl,
    message: finalUrl
      ? (isUpdate ? `Actualizado: ${finalUrl}` : `Publicado: ${finalUrl}`)
      : (isUpdate ? "Actualización completada." : "Pipeline completado."),
  });

  return {
    ok: true,
    completed: true,
    mode: isUpdate ? "update" : "full",
    projectRoot: root,
    stages,
    steps,
    branch: publish.branch || "",
    sha: publish.sha || "",
    liveUrl: finalUrl,
    infra: infra.data,
    message: finalUrl
      ? (isUpdate ? `Publicación actualizada · ${finalUrl}` : `Full-stack listo · ${finalUrl}`)
      : (isUpdate ? "Publicación actualizada." : "Full-stack listo."),
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  STAGES,
  UPDATE_STAGES,
  executeFullStackDeploy,
  writeProjectInfra,
};
