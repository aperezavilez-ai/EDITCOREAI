"use strict";

const path = require("node:path");
const { connectProject, writeProjectLinkManifest } = require("./project-connect");
const { syncEnvToVercel } = require("./vercel-env-sync");
const { manageSupabaseProject } = require("./supabase-manager");
const { prePublishValidation } = require("./project-maintainer");
const { publishProject } = require("./publish-pipeline");
const { sshDeploy } = require("./ssh-deploy");
const { appendAuditEvent } = require("./project-audit");
const { connectionSummary } = require("../service-harness");

/**
 * Aprovisionamiento completo: conectar + sync envs + Supabase + validar + publicar opcional.
 */
async function provisionProject(projectRoot, connections = {}, {
  repoName = "",
  syncVercel = true,
  manageSupabase = true,
  validateBeforePublish = true,
  firstDeploy = false,
  sshAfterPublish = false,
  commitMessage = "",
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const steps = [];
  const fail = (step, message, extra = {}) => ({
    ok: false,
    completed: false,
    projectRoot: root,
    steps: [...steps, { step, ok: false, message, ...extra }],
    message,
  });

  if (!root) return fail("root", "projectRoot invalido.");

  const connected = await connectProject(root, connections, {
    createGithub: true,
    createVercel: true,
    linkSupabase: true,
    repoName: repoName || path.basename(root),
  });
  steps.push({ step: "connect", ok: connected.ok, message: connected.message, detail: connected.steps?.length || 0 });
  if (!connected.ok) return fail("connect", connected.message || "Conexion fallo", { partial: connected });

  let vercelEnv = { ok: true, skipped: true };
  if (syncVercel) {
    vercelEnv = await syncEnvToVercel(root, connections, {
      projectId: connected.steps?.find((item) => item.step === "vercel_project")?.projectId
        || connections.vercelProjectId
        || "",
      projectName: repoName || path.basename(root),
    });
    steps.push({ step: "vercel_env_sync", ...vercelEnv });
  }

  // Enriquecer connections con projectId resuelto ANTES de publish/deploy.
  const publishConnections = {
    ...connections,
    vercelProjectId: String(
      vercelEnv.projectId
      || connected.steps?.find((item) => item.step === "vercel_project")?.projectId
      || connections.vercelProjectId
      || "",
    ).trim(),
  };

  let supabase = { ok: true, skipped: true };
  if (manageSupabase) {
    supabase = await manageSupabaseProject(root, publishConnections, { ensureBucket: true });
    steps.push({ step: "supabase_manage", ok: supabase.ok, message: supabase.message });
  }

  if (validateBeforePublish) {
    const validation = await prePublishValidation(root);
    steps.push({ step: "pre_publish_validation", ok: validation.ok, message: validation.message, detail: validation.steps });
    if (!validation.ok) {
      appendAuditEvent(root, { action: "provision", ok: false, message: validation.message, steps });
      return fail("pre_publish_validation", validation.message);
    }
  }

  let publish = { ok: true, skipped: true };
  if (firstDeploy) {
    publish = await publishProject(root, {
      mode: "project",
      connections: publishConnections,
      deploy: true,
      supabasePush: true,
      commitMessage: commitMessage || `chore: initial provision ${path.basename(root)}`,
    });
    steps.push({ step: "first_publish", ok: publish.ok, message: publish.message, branch: publish.branch, sha: publish.sha });
    if (!publish.ok) {
      appendAuditEvent(root, { action: "provision", ok: false, message: publish.message, steps: publish.steps });
      return {
        ok: false,
        completed: false,
        projectRoot: root,
        steps,
        message: publish.message || "Primer deploy fallo.",
        publish,
      };
    }
  }

  let ssh = { ok: true, skipped: true };
  if (sshAfterPublish && connectionSummary(publishConnections).server.configured) {
    ssh = await sshDeploy(root, publishConnections);
    steps.push({ step: "ssh_deploy", ...ssh });
  }

  const checklist = {
    github: Boolean(connected.assessment?.remoteUrl),
    vercel: vercelEnv.skipped ? "opcional" : vercelEnv.ok,
    supabase: supabase.skipped ? "opcional" : supabase.ok,
    envSynced: vercelEnv.synced || 0,
    published: firstDeploy && publish.ok,
    ssh: ssh.skipped ? "omitido" : ssh.ok,
  };

  writeProjectLinkManifest(root, {
    github: connected.assessment?.remoteUrl ? { remoteUrl: connected.assessment.remoteUrl } : null,
    vercel: publishConnections.vercelProjectId
      ? { projectId: publishConnections.vercelProjectId }
      : (vercelEnv.projectId ? { projectId: vercelEnv.projectId } : null),
    supabase: publishConnections.selfSupabaseUrl
      ? { url: String(publishConnections.selfSupabaseUrl).replace(/\/+$/, "") }
      : null,
    notes: [
      `Provisionado: ${new Date().toISOString()}`,
      `Checklist: ${JSON.stringify(checklist)}`,
    ],
  });
  steps.push({ step: "checklist", ok: true, checklist });

  appendAuditEvent(root, {
    action: "provision",
    ok: true,
    message: "Proyecto aprovisionado.",
    branch: publish.branch || connected.assessment?.branch || "",
    sha: publish.sha || "",
    steps: steps.map((item) => ({ step: item.step, ok: item.ok !== false })),
  });

  return {
    ok: true,
    completed: true,
    projectRoot: root,
    steps,
    checklist,
    message: firstDeploy
      ? "Proyecto aprovisionado y publicado."
      : "Proyecto aprovisionado (conectado y listo para publicar).",
    assessment: connected.assessment,
  };
}

module.exports = {
  provisionProject,
};
