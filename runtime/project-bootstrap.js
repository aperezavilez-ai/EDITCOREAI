"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRoadmapSync } = require("./roadmap-sync");

const PROGRAMAS_IA_ROOT = "D:\\PROGRAMAS IA\\";

class ProjectBootstrap {
  constructor(deps = {}) {
    this.getConnections = deps.getConnections || (() => ({}));
    this.getVaultCredentials = deps.getVaultCredentials || ((service) => null);
    this.gitPush = deps.gitPush || null;
    this.vercelDeploy = deps.vercelDeploy || null;
    this.supabaseProvision = deps.supabaseProvision || null;
    this.roadmapSync = deps.roadmapSync || createRoadmapSync();
    this.execCmd = deps.execCmd || ((cmd, opts) => execSync(cmd, { stdio: "pipe", ...opts }));
    this.fetchImpl = deps.fetchImpl || globalThis.fetch;
  }

  /**
   * Inicializa un nuevo proyecto desde cero (Fase 1: Managed por defecto).
   * En modo "managed", crea e inicializa repositorios y enlaces automáticamente
   * usando las credenciales maestras de la bóveda para cero fricción.
   *
   * @param {string} projectName - Nombre del proyecto o ruta
   * @param {object} options
   * @param {string} [options.mode="managed"] - "managed" (Lovable/Cursor style) o "independent"
   * @param {string} [options.stack="vite-react"] - Stack tecnológico
   * @param {boolean} [options.github] - Crear repo en GitHub (defecto true en managed)
   * @param {boolean} [options.vercel] - Crear proyecto en Vercel (defecto true en managed)
   * @param {boolean} [options.supabase] - Crear proyecto Supabase (defecto true en managed)
   */
  async bootstrap(projectName, options = {}) {
    const mode = options.mode || "managed";
    const isManaged = mode === "managed";
    const {
      stack = "vite-react",
      github = isManaged ? true : false,
      vercel = isManaged ? true : false,
      supabase = isManaged ? true : false,
    } = options;

    const baseName = path.basename(projectName);
    const slug = baseName.toLowerCase().replace(/\s+/g, "-").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const projectRoot = path.isAbsolute(projectName) ? projectName : path.join(PROGRAMAS_IA_ROOT, projectName);
    const steps = [];
    const errors = [];
    let repoName = "";
    let vercelProjectId = "";
    let supabaseUrl = "";

    // 1. Crear directorio del proyecto
    if (!fs.existsSync(projectRoot)) {
      fs.mkdirSync(projectRoot, { recursive: true });
      steps.push({ action: "created_directory", target: projectRoot, status: "ok" });
    } else {
      steps.push({ action: "existing_directory", target: projectRoot, status: "ok" });
    }

    // 2. Scaffold de archivos según stack
    const packageJson = {
      name: slug,
      version: "0.1.0",
      private: true,
      scripts: {
        dev: "vite",
        build: "vite build",
        preview: "vite preview",
      },
    };
    const generatedFiles = this.generateStack(projectRoot, stack, packageJson);
    steps.push({ action: "generated_stack", stack, files: generatedFiles, status: "ok" });

    // 3. Inicializar Git local
    const gitDir = path.join(projectRoot, ".git");
    if (!fs.existsSync(gitDir)) {
      try {
        this.execCmd("git init", { cwd: projectRoot });
        this.execCmd("git add -A", { cwd: projectRoot });
        this.execCmd('git commit -m "chore: initial project scaffold"', { cwd: projectRoot });
        steps.push({ action: "git_init", status: "ok" });
      } catch (err) {
        errors.push({ action: "git_init", error: err.message });
      }
    }

    // 4. GitHub Provisioning (Bóveda central en modo Managed)
    if (github) {
      const creds = this.getVaultCredentials("github");
      const token = creds?.githubToken || creds?.token;
      if (token) {
        let owner = "";
        try {
          const me = await this.fetchImpl("https://api.github.com/user", {
            headers: {
              "Authorization": `Bearer ${token}`,
              "Accept": "application/vnd.github+json",
              "User-Agent": "EDITCOREAI-Bootstrap",
            },
          });
          if (me.ok) {
            const data = await me.json();
            owner = String(data?.login || "").trim();
          }
        } catch { /* continuar con slug */ }

        repoName = owner ? `${owner}/${slug}` : slug;
        try {
          this.execCmd(`gh repo create ${repoName} --private --source=. --remote=origin --push`, {
            cwd: projectRoot,
            env: { ...process.env, GH_TOKEN: token },
          });
          steps.push({ action: "github_create", repo: repoName, status: "ok" });
        } catch (e) {
          // Fallback a API REST directa de GitHub
          try {
            const res = await this.fetchImpl("https://api.github.com/user/repos", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/vnd.github+json",
                "User-Agent": "EDITCOREAI-Bootstrap",
              },
              body: JSON.stringify({
                name: slug,
                private: true,
                auto_init: false,
              }),
            });
            if (res.ok) {
              steps.push({ action: "github_create", repo: repoName, status: "ok" });
              try { this.execCmd("git remote remove origin", { cwd: projectRoot }); } catch {}
              this.execCmd(`git remote add origin https://github.com/${repoName}.git`, { cwd: projectRoot });
              this.execCmd("git push -u origin main", {
                cwd: projectRoot,
                env: { ...process.env, GITHUB_TOKEN: token, GH_TOKEN: token },
              });
              steps.push({ action: "github_push", repo: repoName, status: "ok" });
            } else {
              errors.push({ action: "github_create", error: `GitHub API: ${res.status}` });
            }
          } catch (e2) {
            errors.push({ action: "github_create", error: e2.message });
          }
        }
      } else {
        steps.push({ action: "git_local_only", status: "ok", reason: "Sin GitHub token en bóveda; git inicializado localmente" });
      }
    }

    // 5. Vercel Provisioning (Bóveda central en modo Managed)
    if (vercel) {
      const creds = this.getVaultCredentials("vercel");
      const token = creds?.vercelToken || creds?.token;
      if (token) {
        try {
          const res = await this.fetchImpl("https://api.vercel.com/v9/projects", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": "application/json",
              "User-Agent": "EDITCOREAI-Bootstrap",
            },
            body: JSON.stringify({
              name: slug,
              framework: stack.includes("next") ? "nextjs" : "vite",
            }),
          });
          if (res.ok) {
            const data = await res.json();
            vercelProjectId = data.id || "";
            const vercelDir = path.join(projectRoot, ".vercel");
            fs.mkdirSync(vercelDir, { recursive: true });
            fs.writeFileSync(path.join(vercelDir, "project.json"), JSON.stringify({
              projectId: vercelProjectId,
              orgId: creds.vercelTeamId || creds.teamId || "",
              settings: {},
            }, null, 2) + "\n", "utf8");
            steps.push({ action: "vercel_linked", projectId: vercelProjectId, status: "ok" });
          } else {
            errors.push({ action: "vercel_create", error: `Vercel API: ${res.status}` });
          }
        } catch (e) {
          errors.push({ action: "vercel_create", error: e.message });
        }
      } else {
        steps.push({ action: "vercel_skipped", reason: "Sin Vercel token configurado en bóveda" });
      }
    }

    // 6. Supabase Provisioning (Cloud Oficial — Regla 6b)
    if (supabase) {
      const creds = this.getVaultCredentials("supabase") || {};
      const cloudUrl = String(creds.supabaseUrl || creds.url || creds.selfSupabaseUrl || "").trim();
      const cloudKey = String(creds.supabaseAnonKey || creds.supabaseKey || creds.key || creds.selfSupabaseKey || "").trim();

      // Regla 6b: Excluir servidores dados de baja (*.gafcore.com)
      if (cloudUrl && !/supabase\.gafcore\.com/i.test(cloudUrl)) {
        supabaseUrl = cloudUrl;
        const migDir = path.join(projectRoot, "supabase", "migrations");
        fs.mkdirSync(migDir, { recursive: true });
        const initSql = path.join(migDir, "20261119000000_init.sql");
        if (!fs.existsSync(initSql)) {
          fs.writeFileSync(initSql, "-- EDITCOREAI initial managed schema\ncreate table if not exists public.app_metadata (id text primary key, value jsonb, created_at timestamptz default now());\n", "utf8");
        }

        const envLocal = path.join(projectRoot, ".env.local");
        const envLines = [
          `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
          `NEXT_PUBLIC_SUPABASE_ANON_KEY=${cloudKey}`,
          `VITE_SUPABASE_URL=${supabaseUrl}`,
          `VITE_SUPABASE_ANON_KEY=${cloudKey}`,
          `SUPABASE_URL=${supabaseUrl}`,
          `SUPABASE_ANON_KEY=${cloudKey}`,
        ];
        fs.writeFileSync(envLocal, envLines.join("\n") + "\n", "utf8");

        const editcoreDir = path.join(projectRoot, ".editcore");
        fs.mkdirSync(editcoreDir, { recursive: true });
        fs.writeFileSync(path.join(editcoreDir, "connections.json"), JSON.stringify({
          supabase: { url: supabaseUrl, key: cloudKey, mode },
        }, null, 2) + "\n", "utf8");
        steps.push({ action: "supabase_configured", url: supabaseUrl, status: "ok" });
      } else {
        // Preparar estructura local de migraciones para cuando se conecte
        const migDir = path.join(projectRoot, "supabase", "migrations");
        fs.mkdirSync(migDir, { recursive: true });
        steps.push({ action: "supabase_scaffolded", status: "ok", reason: "Estructura supabase/migrations lista" });
      }
    }

    // 7. Escribir project-infra.json (Manifiesto de Infraestructura)
    const infraPayload = {
      version: 1,
      projectName: baseName,
      provisioningMode: mode,
      updatedAt: new Date().toISOString(),
      githubRemoteUrl: repoName ? `https://github.com/${repoName}.git` : "",
      vercelProjectId: vercelProjectId || "",
      supabaseUrl: supabaseUrl || "",
      liveUrl: vercelProjectId ? `https://${slug}.vercel.app` : "",
    };
    fs.writeFileSync(path.join(projectRoot, "project-infra.json"), JSON.stringify(infraPayload, null, 2) + "\n", "utf8");
    const editcoreDir = path.join(projectRoot, ".editcore");
    fs.mkdirSync(editcoreDir, { recursive: true });
    fs.writeFileSync(path.join(editcoreDir, "project-infra.json"), JSON.stringify(infraPayload, null, 2) + "\n", "utf8");

    // 8. Generar y Sincronizar Roadmap
    const roadmapSync = this.roadmapSync || createRoadmapSync();
    const roadmap = roadmapSync.loadOrCreate(projectRoot);
    roadmap.project.status = github || vercel ? "active" : "planning";
    roadmap.project.provisioning = mode;
    roadmap.connections.github.hasLocalGit = true;
    if (repoName) {
      roadmap.connections.github.repo = repoName;
      roadmap.connections.github.remoteUrl = `https://github.com/${repoName}.git`;
    }
    if (vercelProjectId) {
      roadmap.connections.vercel.projectId = vercelProjectId;
      roadmap.connections.vercel.linked = true;
      roadmap.connections.vercel.liveUrl = `https://${slug}.vercel.app`;
    }
    if (supabaseUrl) {
      roadmap.connections.supabase.url = supabaseUrl;
      roadmap.connections.supabase.hasMigrations = true;
    }
    roadmapSync.save(projectRoot, roadmap);
    steps.push({ action: "roadmap_created", status: "ok", provisioning: mode });

    return {
      projectName: baseName,
      projectRoot,
      slug,
      provisioning: mode,
      steps,
      errors,
      success: errors.length === 0,
      infra: infraPayload,
    };
  }

  /**
   * Fase 2: Independiza (eject) un proyecto hacia las cuentas personales del cliente.
   *
   * @param {string} projectRoot - Ruta absoluta o relativa al proyecto
   * @param {object} target - Cuentas personales de destino del cliente
   * @param {object} [target.github] - { remoteUrl, owner, repo, token }
   * @param {object} [target.vercel] - { projectId, orgId, projectName }
   * @param {object} [target.supabase] - { url, anonKey, serviceRoleKey, projectRef }
   */
  async eject(projectRoot, target = {}) {
    const root = path.isAbsolute(projectRoot) ? projectRoot : path.join(PROGRAMAS_IA_ROOT, projectRoot);
    if (!fs.existsSync(root)) {
      throw new Error(`El directorio del proyecto no existe: ${root}`);
    }

    const steps = [];
    const errors = [];
    const now = new Date().toISOString();

    // 1. Transferir / Independizar GitHub
    if (target.github) {
      const gitTarget = target.github;
      const remoteUrl = gitTarget.remoteUrl || (gitTarget.owner && gitTarget.repo ? `https://github.com/${gitTarget.owner}/${gitTarget.repo}.git` : "");
      if (remoteUrl) {
        try {
          try {
            this.execCmd("git remote remove origin", { cwd: root });
          } catch {}
          this.execCmd(`git remote add origin ${remoteUrl}`, { cwd: root });
          const pushEnv = gitTarget.token ? { ...process.env, GH_TOKEN: gitTarget.token, GITHUB_TOKEN: gitTarget.token } : process.env;
          this.execCmd("git push -u origin main", { cwd: root, env: pushEnv });
          steps.push({ action: "github_ejected", remoteUrl, status: "ok" });
        } catch (err) {
          errors.push({ action: "github_eject_failed", error: err.message });
        }
      }
    }

    // 2. Transferir / Independizar Vercel
    if (target.vercel) {
      const vTarget = target.vercel;
      const vercelDir = path.join(root, ".vercel");
      fs.mkdirSync(vercelDir, { recursive: true });
      const projectConfig = {
        projectId: vTarget.projectId || "",
        orgId: vTarget.orgId || vTarget.teamId || "",
        settings: {},
      };
      fs.writeFileSync(path.join(vercelDir, "project.json"), JSON.stringify(projectConfig, null, 2) + "\n", "utf8");
      steps.push({ action: "vercel_ejected", projectId: vTarget.projectId, status: "ok" });
    }

    // 3. Transferir / Independizar Supabase
    if (target.supabase) {
      const sTarget = target.supabase;
      const sUrl = String(sTarget.url || "").trim();
      const sKey = String(sTarget.anonKey || sTarget.key || "").trim();
      if (sUrl) {
        const envLocal = path.join(root, ".env.local");
        let existingEnv = "";
        if (fs.existsSync(envLocal)) existingEnv = fs.readFileSync(envLocal, "utf8");
        const lines = existingEnv.split(/\r?\n/).filter(line => !/^(?:NEXT_PUBLIC_)?(?:VITE_)?SUPABASE_/i.test(line));
        lines.push(`NEXT_PUBLIC_SUPABASE_URL=${sUrl}`);
        lines.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${sKey}`);
        lines.push(`VITE_SUPABASE_URL=${sUrl}`);
        lines.push(`VITE_SUPABASE_ANON_KEY=${sKey}`);
        lines.push(`SUPABASE_URL=${sUrl}`);
        lines.push(`SUPABASE_ANON_KEY=${sKey}`);
        if (sTarget.serviceRoleKey) {
          lines.push(`SUPABASE_SERVICE_ROLE_KEY=${sTarget.serviceRoleKey}`);
        }
        fs.writeFileSync(envLocal, lines.filter(Boolean).join("\n") + "\n", "utf8");
        steps.push({ action: "supabase_ejected", url: sUrl, status: "ok" });
      }
    }

    // 4. Actualizar project-infra.json
    let currentInfra = {};
    const infraPath = path.join(root, "project-infra.json");
    if (fs.existsSync(infraPath)) {
      try { currentInfra = JSON.parse(fs.readFileSync(infraPath, "utf8")); } catch {}
    }
    const updatedInfra = {
      ...currentInfra,
      provisioningMode: "independent",
      ejectedAt: now,
      updatedAt: now,
      githubRemoteUrl: target.github?.remoteUrl || currentInfra.githubRemoteUrl || "",
      vercelProjectId: target.vercel?.projectId || currentInfra.vercelProjectId || "",
      supabaseUrl: target.supabase?.url || currentInfra.supabaseUrl || "",
    };
    fs.writeFileSync(infraPath, JSON.stringify(updatedInfra, null, 2) + "\n", "utf8");
    const editcoreInfra = path.join(root, ".editcore", "project-infra.json");
    if (fs.existsSync(path.dirname(editcoreInfra))) {
      fs.writeFileSync(editcoreInfra, JSON.stringify(updatedInfra, null, 2) + "\n", "utf8");
    }

    // 5. Actualizar Roadmap
    const roadmapSync = this.roadmapSync || createRoadmapSync();
    const roadmap = roadmapSync.loadOrCreate(root);
    roadmap.project.provisioning = "independent";
    roadmap.project.ejectedAt = now;
    if (target.github?.remoteUrl) {
      roadmap.connections.github.remoteUrl = target.github.remoteUrl;
      const m = target.github.remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
      if (m) roadmap.connections.github.repo = `${m[1]}/${m[2]}`;
    }
    if (target.vercel?.projectId) {
      roadmap.connections.vercel.projectId = target.vercel.projectId;
      roadmap.connections.vercel.linked = true;
    }
    if (target.supabase?.url) {
      roadmap.connections.supabase.url = target.supabase.url;
      if (target.supabase.projectRef) roadmap.connections.supabase.projectRef = target.supabase.projectRef;
    }
    roadmapSync.save(root, roadmap);
    steps.push({ action: "roadmap_updated", provisioning: "independent", status: "ok" });

    // 6. Auditoría
    const auditFile = path.join(root, ".editcore", "audit.jsonl");
    try {
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
      fs.appendFileSync(auditFile, JSON.stringify({
        at: now,
        action: "project_ejected_to_independent",
        target: {
          github: Boolean(target.github),
          vercel: Boolean(target.vercel),
          supabase: Boolean(target.supabase),
        },
      }) + "\n", "utf8");
    } catch {}

    return {
      ok: errors.length === 0,
      projectRoot: root,
      provisioning: "independent",
      ejectedAt: now,
      steps,
      errors,
    };
  }

  /**
   * Obtiene el estado actual de aprovisionamiento del proyecto (managed o independent).
   */
  getProvisioningStatus(projectRoot) {
    const root = path.isAbsolute(projectRoot) ? projectRoot : path.join(PROGRAMAS_IA_ROOT, projectRoot);
    let infra = null;
    let roadmap = null;

    const infraPath = path.join(root, "project-infra.json");
    if (fs.existsSync(infraPath)) {
      try { infra = JSON.parse(fs.readFileSync(infraPath, "utf8")); } catch {}
    }

    const roadmapSync = this.roadmapSync || createRoadmapSync();
    try { roadmap = roadmapSync.load(root); } catch {}

    const mode = infra?.provisioningMode || roadmap?.project?.provisioning || "unknown";
    return {
      ok: true,
      projectRoot: root,
      mode,
      isManaged: mode === "managed",
      isIndependent: mode === "independent",
      infra,
      roadmap: roadmap ? { project: roadmap.project, connections: roadmap.connections } : null,
    };
  }

  generateStack(projectRoot, stack, pkg) {
    const files = [];
    const packagePath = path.join(projectRoot, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    files.push("package.json");

    if (stack === "vite-react" || stack === "vite-vue" || stack === "vite") {
      fs.writeFileSync(path.join(projectRoot, "vite.config.js"), "import { defineConfig } from 'vite';\nexport default defineConfig({});\n", "utf8");
      fs.writeFileSync(path.join(projectRoot, "index.html"), "<!DOCTYPE html><html><head><title>App</title></head><body><div id='app'></div><script type='module' src='/src/main.js'></script></body></html>\n", "utf8");
      fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, "src", "main.js"), "import './style.css';\nconsole.log('App ready');\n", "utf8");
      fs.writeFileSync(path.join(projectRoot, "src", "style.css"), "* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui; }\n", "utf8");
      files.push("vite.config.js", "index.html", "src/main.js", "src/style.css");
    }

    if (stack === "nextjs" || stack === "next") {
      fs.mkdirSync(path.join(projectRoot, "app"), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, "public"), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, "app", "layout.js"), "export const metadata = { title: 'App' };\nexport default function RootLayout({ children }) { return <html><body>{children}</body></html>; }\n", "utf8");
      fs.writeFileSync(path.join(projectRoot, "app", "page.js"), "export default function Page() { return <h1>Hello World</h1>; }\n", "utf8");
      pkg.dependencies = pkg.dependencies || {};
      pkg.dependencies.next = "latest";
      pkg.dependencies.react = "latest";
      pkg.dependencies.reactDom = "latest";
      pkg.scripts.build = "next build";
      pkg.scripts.start = "next start";
      pkg.scripts.dev = "next dev";
      fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      files.push("app/layout.js", "app/page.js");
    }

    fs.writeFileSync(path.join(projectRoot, ".gitignore"), "node_modules/\n.env*\n!.env.example\n.next/\nbuild/\ndist/\n.vercel/\n.editcore/\n*.log\n", "utf8");
    files.push(".gitignore");

    return files;
  }
}

function createProjectBootstrap(deps = {}) {
  return new ProjectBootstrap(deps);
}

module.exports = { ProjectBootstrap, createProjectBootstrap };
