"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { executeServiceRequest } = require("../service-harness");
const { writeLocalEnv, writeProjectLinkManifest } = require("./project-connect");
const { ensureStorageBucket, supabaseHealth } = require("./supabase-manager");

function slugify(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "app";
}

function runCapture(command, args, { cwd, timeoutMs = 180_000 } = {}) {
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

function bootstrapSupabaseFolder(projectRoot, { projectName = "app", projectId = "" } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const supabaseDir = path.join(root, "supabase");
  const migrationsDir = path.join(supabaseDir, "migrations");
  fs.mkdirSync(migrationsDir, { recursive: true });

  const configPath = path.join(supabaseDir, "config.toml");
  if (!fs.existsSync(configPath)) {
    const ref = projectId || slugify(projectName);
    fs.writeFileSync(configPath, [
      `project_id = "${ref}"`,
      "",
      "[api]",
      "enabled = true",
      "port = 54321",
      "",
      "[db]",
      "port = 54322",
      "major_version = 15",
      "",
    ].join("\n"), "utf8");
  }

  const migrationPath = path.join(migrationsDir, "00000000000000_editcore_init.sql");
  if (!fs.existsSync(migrationPath)) {
    fs.writeFileSync(migrationPath, [
      "-- EditCore bootstrap",
      "create table if not exists public.profiles (",
      "  id uuid primary key,",
      "  email text,",
      "  display_name text,",
      "  created_at timestamptz not null default now()",
      ");",
      "alter table public.profiles enable row level security;",
      "create policy \"profiles_read_own\" on public.profiles",
      "  for select using (auth.uid() = id);",
      "",
    ].join("\n"), "utf8");
  }

  return {
    ok: true,
    supabaseDir,
    configPath,
    migrationPath,
    message: "Carpeta supabase/ inicializada con migracion base.",
  };
}

async function trySupabaseCloudCreate(connections, { name, orgId = "", region = "us-east-1" } = {}) {
  const token = String(connections.supabaseCloudToken || connections.supabaseManagementToken || "").trim();
  const organizationId = String(orgId || connections.supabaseOrgId || "").trim();
  if (!token || !organizationId) {
    return { ok: false, skipped: true, message: "Supabase Cloud: falta supabaseCloudToken o supabaseOrgId en Conexiones." };
  }
  try {
    const response = await fetch("https://api.supabase.com/v1/projects", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: String(name || "editcore-app").slice(0, 64),
        organization_id: organizationId,
        region,
        db_pass: connections.supabaseDbPassword || undefined,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, message: data?.message || data?.error || `HTTP ${response.status}` };
    }
    return {
      ok: true,
      created: true,
      projectId: data.id || data.ref || "",
      url: data.endpoint || data.api_url || "",
      anonKey: data.anon_key || "",
      serviceKey: data.service_role_key || "",
      raw: data,
    };
  } catch (error) {
    return { ok: false, message: error?.message || String(error) };
  }
}

async function pushMigrations(projectRoot) {
  const bin = process.platform === "win32" ? "supabase.cmd" : "supabase";
  try {
    const result = await runCapture(bin, ["db", "push"], { cwd: projectRoot, timeoutMs: 300_000 });
    return {
      ok: result.code === 0,
      message: result.code === 0 ? "supabase db push OK" : (result.stderr || result.stdout || "db push fallo"),
      code: result.code,
    };
  } catch (error) {
    return { ok: false, skipped: true, message: error?.message || String(error) };
  }
}

/**
 * Crea/enlaza Supabase para el proyecto activo desde el panel.
 * Self-hosted (GafCore): bootstrap local + env + bucket + db push si CLI existe.
 * Cloud opcional si hay supabaseCloudToken + orgId.
 */
async function createSupabaseProject(projectRoot, connections = {}, {
  projectName = "",
  useCloud = false,
  bucketName = "uploads",
  pushDb = true,
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const steps = [];
  const name = projectName || path.basename(root);
  if (!root || !fs.existsSync(root)) {
    return { ok: false, message: "projectRoot invalido.", steps };
  }
  try {
    const { assertProjectConnectionTarget } = require("./project-connection-isolation");
    assertProjectConnectionTarget(root, {
      supabaseUrl: connections.selfSupabaseUrl || connections.supabaseUrl || "",
      supabaseProjectId: connections.supabaseProjectId || connections.gafcoreProjectId || "",
      gatewayUrl: connections.gafcoreGateway || connections.gatewayUrl || "",
    });
  } catch (error) {
    return { ok: false, message: error?.message || String(error), code: error?.code || "PROJECT_CONNECTION_MISMATCH", steps };
  }

  let cloud = { ok: true, skipped: true };
  let activeConnections = { ...connections };
  if (useCloud) {
    cloud = await trySupabaseCloudCreate(connections, { name });
    steps.push({ step: "supabase_cloud_create", ...cloud });
    if (cloud.ok && cloud.url && cloud.anonKey) {
      activeConnections = {
        ...activeConnections,
        selfSupabaseUrl: cloud.url,
        selfSupabaseKey: cloud.serviceKey || cloud.anonKey,
      };
    } else if (!cloud.skipped && !cloud.ok) {
      return { ok: false, message: cloud.message, steps };
    }
  }

  if (!activeConnections.selfSupabaseUrl || !activeConnections.selfSupabaseKey) {
    return { ok: false, message: "Configura Supabase propio en Conexiones o usa Cloud con token/org.", steps };
  }

  const health = await supabaseHealth(activeConnections);
  steps.push({ step: "supabase_health", ...health });
  if (!health.ok && !health.skipped) {
    return { ok: false, message: health.message || "Supabase no responde.", steps };
  }

  const bootstrap = bootstrapSupabaseFolder(root, {
    projectName: name,
    projectId: cloud.projectId || slugify(name),
  });
  steps.push({ step: "supabase_bootstrap", ...bootstrap });

  const env = writeLocalEnv(root, {
    SUPABASE_URL: String(activeConnections.selfSupabaseUrl).replace(/\/+$/, ""),
    NEXT_PUBLIC_SUPABASE_URL: String(activeConnections.selfSupabaseUrl).replace(/\/+$/, ""),
    VITE_SUPABASE_URL: String(activeConnections.selfSupabaseUrl).replace(/\/+$/, ""),
    SUPABASE_ANON_KEY: String(activeConnections.selfSupabaseKey),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: String(activeConnections.selfSupabaseKey),
    VITE_SUPABASE_ANON_KEY: String(activeConnections.selfSupabaseKey),
    SUPABASE_SERVICE_ROLE_KEY: String(activeConnections.selfSupabaseKey),
  });
  steps.push({ step: "env_local", ok: true, path: env.path, keys: env.keys });

  const bucket = await ensureStorageBucket(activeConnections, bucketName);
  steps.push({ step: "storage_bucket", ...bucket });

  if (pushDb) {
    const push = await pushMigrations(root);
    steps.push({ step: "db_push", ...push });
  }

  const manifest = writeProjectLinkManifest(root, {
    supabase: {
      url: String(activeConnections.selfSupabaseUrl).replace(/\/+$/, ""),
      projectId: cloud.projectId || slugify(name),
      createdAt: new Date().toISOString(),
    },
    notes: [
      "Proyecto Supabase creado/enlazado desde panel EditCore.",
      cloud.created ? "Origen: Supabase Cloud API." : "Origen: Supabase propio (GafCore/self-hosted).",
    ],
  });
  steps.push({ step: "manifest", ok: true, path: manifest.path });

  const ok = steps.every((item) => item.ok !== false || item.skipped === true);
  return {
    ok,
    completed: ok,
    projectRoot: root,
    steps,
    connectionsPatch: cloud.ok && cloud.url ? {
      selfSupabaseUrl: activeConnections.selfSupabaseUrl,
      selfSupabaseKey: activeConnections.selfSupabaseKey,
      supabaseProjectId: cloud.projectId || "",
    } : null,
    message: ok
      ? (cloud.created ? "Proyecto Supabase Cloud creado y enlazado." : "Proyecto Supabase enlazado en esta carpeta.")
      : "Creacion Supabase incompleta; revisa pasos.",
  };
}

module.exports = {
  slugify,
  bootstrapSupabaseFolder,
  trySupabaseCloudCreate,
  createSupabaseProject,
  pushMigrations,
};
