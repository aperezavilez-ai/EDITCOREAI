"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { executeServiceRequest } = require("../service-harness");

function runCapture(command, args, { cwd, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`Timeout: ${command}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: Number(code) || 0, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() });
    });
  });
}

async function supabaseHealth(connections) {
  if (!connections.selfSupabaseUrl || !connections.selfSupabaseKey) {
    return { ok: false, skipped: true, message: "Supabase no configurado." };
  }
  try {
    const result = await executeServiceRequest({
      service: "selfsupabase",
      method: "GET",
      path: "/rest/v1/",
      connections,
    });
    return { ok: true, status: result?.status || 200, url: connections.selfSupabaseUrl };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}

function listLocalMigrations(projectRoot) {
  const dir = path.join(projectRoot, "supabase", "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /\.sql$/i.test(name))
    .sort();
}

async function checkMigrationDrift(projectRoot) {
  const local = listLocalMigrations(projectRoot);
  if (!local.length) {
    return { ok: true, skipped: true, localCount: 0, message: "Sin migraciones locales." };
  }
  const bin = process.platform === "win32" ? "supabase.cmd" : "supabase";
  try {
    const result = await runCapture(bin, ["migration", "list"], { cwd: projectRoot, timeoutMs: 120_000 });
    const applied = (result.stdout.match(/Applied/gi) || []).length;
    const pending = local.length - applied;
    return {
      ok: pending <= 0 || result.code === 0,
      localCount: local.length,
      appliedEstimate: applied,
      pendingEstimate: Math.max(0, pending),
      message: pending > 0
        ? `Posibles migraciones pendientes (~${pending}). Ejecuta supabase db push antes de publicar.`
        : "Migraciones al dia (estimado).",
      stdout: result.stdout.slice(0, 1500),
    };
  } catch (error) {
    return {
      ok: true,
      localCount: local.length,
      skipped: true,
      message: `CLI supabase no disponible: ${error?.message || String(error)}`,
    };
  }
}

async function ensureStorageBucket(connections, bucketName = "uploads") {
  if (!connections.selfSupabaseUrl || !connections.selfSupabaseKey) {
    return { ok: false, skipped: true, message: "Supabase no configurado." };
  }
  const name = String(bucketName || "uploads").trim();
  try {
    await executeServiceRequest({
      service: "selfsupabase",
      method: "POST",
      path: "/storage/v1/bucket",
      body: { name, public: false },
      connections,
    });
    return { ok: true, created: true, bucket: name, message: `Bucket ${name} creado.` };
  } catch (error) {
    const msg = error?.message || String(error);
    if (/already exists|duplicate|409/i.test(msg)) {
      return { ok: true, created: false, bucket: name, message: `Bucket ${name} ya existe.` };
    }
    return { ok: false, message: msg };
  }
}

async function manageSupabaseProject(projectRoot, connections, {
  ensureBucket = true,
  bucketName = "uploads",
} = {}) {
  const steps = [];
  try {
    const { assertProjectConnectionTarget, readProjectInfra } = require("./project-connection-isolation");
    const infra = readProjectInfra?.(projectRoot);
    const isolationMode = String(infra?.data?.isolationMode || "").toLowerCase();
    // Proyectos legacy (schema compartido) no bloquean el publish por aislamiento estricto.
    if (isolationMode !== "legacy_shared_schema") {
      assertProjectConnectionTarget(projectRoot, {
        supabaseUrl: connections?.selfSupabaseUrl || connections?.supabaseUrl || "",
        supabaseProjectId: connections?.supabaseProjectId || connections?.gafcoreProjectId || "",
        gatewayUrl: connections?.gafcoreGateway || connections?.gatewayUrl || "",
      });
    } else {
      steps.push({
        step: "connection_isolation",
        ok: true,
        skipped: true,
        message: "Modo legacy_shared_schema: aislamiento estricto omitido.",
      });
    }
  } catch (error) {
    return {
      ok: false,
      steps: [{ step: "connection_isolation", ok: false, message: error?.message || String(error) }],
      message: error?.message || String(error),
      code: error?.code || "PROJECT_CONNECTION_MISMATCH",
    };
  }
  const health = await supabaseHealth(connections);
  steps.push({ step: "supabase_health", ...health });
  const drift = await checkMigrationDrift(projectRoot);
  steps.push({ step: "migration_drift", ...drift });
  let bucket = { ok: true, skipped: true };
  if (ensureBucket) {
    bucket = await ensureStorageBucket(connections, bucketName);
    steps.push({ step: "storage_bucket", ...bucket });
  }
  // Health/drift/bucket con skipped no deben tumbar el pipeline de publicación.
  const hardFail = steps.some((item) => item.ok === false && item.skipped !== true && item.step === "connection_isolation");
  const softIssues = steps.filter((item) => item.ok === false && item.skipped !== true && item.step !== "connection_isolation");
  const ok = !hardFail;
  return {
    ok,
    warning: softIssues.length > 0,
    steps,
    message: hardFail
      ? "Supabase bloqueado por aislamiento de proyecto."
      : softIssues.length
        ? `Supabase operativo con avisos (${softIssues.map((s) => s.step).join(", ")}).`
        : "Supabase verificado.",
  };
}

module.exports = {
  supabaseHealth,
  listLocalMigrations,
  checkMigrationDrift,
  ensureStorageBucket,
  manageSupabaseProject,
};
