"use strict";

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createCloudVaultBridge } = require("./cloud-vault-bridge");
const { createConnectionVerifier } = require("./connection-verifier");
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
  }

  /**
   * Inicializa un nuevo proyecto desde cero.
   * @param {string} projectName - Nombre del proyecto
   * @param {object} options
   * @param {string} options.stack - Stack tecnologico
   * @param {boolean} options.github - Crear repo en GitHub
   * @param {boolean} options.vercel - Crear proyecto en Vercel
   * @param {boolean} options.supabase - Crear proyecto Supabase
   * @param {boolean} options.server - Crear deploy en servidor
   */
  async bootstrap(projectName, options = {}) {
    const {
      stack = "vite-react",
      github = false,
      vercel = false,
      supabase = false,
      server = false,
    } = options;

    const slug = projectName.toLowerCase().replace(/\s+/g, "-").normalize("NFD").replace(/[̀-ͯ]/g, "");
    const projectRoot = path.join(PROGRAMAS_IA_ROOT, projectName);
    const steps = [];
    const errors = [];

    // Crear directorio del proyecto
    if (!fs.existsSync(projectRoot)) {
      fs.mkdirSync(projectRoot, { recursive: true });
      steps.push({ action: "created_directory", target: projectRoot, status: "ok" });
    } else {
      steps.push({ action: "existing_directory", target: projectRoot, status: "ok" });
    }

    // Inicializar git
    if (github) {
      try {
        execSync("git init", { cwd: projectRoot, stdio: "pipe" });
        steps.push({ action: "git_init", status: "ok" });

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

        // Generar proyecto basico segun stack
        const generatedFiles = this.generateStack(projectRoot, stack, packageJson);
        steps.push({ action: "generated_stack", stack, files: generatedFiles, status: "ok" });

        // Commit inicial
        execSync("git add -A", { cwd: projectRoot, stdio: "pipe" });
        execSync('git commit -m "chore: initial project scaffold"', { cwd: projectRoot, stdio: "pipe" });
        steps.push({ action: "initial_commit", status: "ok" });

        // Crear repo en GitHub
        const creds = this.getVaultCredentials("github");
        if (creds?.githubToken) {
          let owner = "";
          try {
            const me = await fetch("https://api.github.com/user", {
              headers: {
                "Authorization": `Bearer ${creds.githubToken}`,
                "Accept": "application/vnd.github+json",
                "User-Agent": "EDITCOREAI-Bootstrap",
              },
            });
            if (me.ok) owner = String((await me.json())?.login || "").trim();
          } catch { /* gh usa la cuenta del token */ }
          const repoName = owner ? `${owner}/${slug}` : slug;
          try {
            // Usar GitHub CLI si esta disponible
            execSync(`gh repo create ${repoName} --private --source=. --remote=origin --push`, {
              cwd: projectRoot,
              env: { ...process.env, GH_TOKEN: creds.githubToken },
              stdio: "pipe",
            });
            steps.push({ action: "github_create", repo: repoName, status: "ok" });
          } catch (e) {
            // Si falla gh, crear manualmente via API
            try {
              const res = await fetch("https://api.github.com/user/repos", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${creds.githubToken}`,
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
                // Push manual
                try {
                  execSync("git remote remove origin", { cwd: projectRoot, stdio: "pipe" });
                } catch {}
                execSync(`git remote add origin https://github.com/${repoName}.git`, { cwd: projectRoot, stdio: "pipe" });
                execSync("git push -u origin main", { cwd: projectRoot, env: { ...process.env, GITHUB_TOKEN: creds.githubToken }, stdio: "pipe" });
                steps.push({ action: "github_push", repo: repoName, status: "ok" });
              } else {
                errors.push({ action: "github_create", error: `GitHub API: ${res.status}` });
              }
            } catch (e2) {
              errors.push({ action: "github_create", error: e2.message });
            }
          }
        } else {
          errors.push({ action: "github_skip", reason: "No hay GitHub token configurado" });
        }
      } catch (e) {
        errors.push({ action: "git_init", error: e.message });
      }
    } else if (github === false) {
      // Inicializar git sin GitHub
      try {
        execSync("git init", { cwd: projectRoot, stdio: "pipe" });
        execSync("git add -A", { cwd: projectRoot, stdio: "pipe" });
        execSync('git commit -m "chore: initial project scaffold"', { cwd: projectRoot, stdio: "pipe" });
        steps.push({ action: "git_local_only", status: "ok" });
      } catch (e) {
        errors.push({ action: "git_init", error: e.message });
      }
    }

    // Vercel
    if (vercel) {
      const creds = this.getVaultCredentials("vercel");
      if (creds?.vercelToken) {
        try {
          const res = await fetch("https://api.vercel.com/v9/projects", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${creds.vercelToken}`,
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
            steps.push({ action: "vercel_create", projectId: data.id, status: "ok" });
            // Crear .vercel/project.json
            const vercelDir = path.join(projectRoot, ".vercel");
            fs.mkdirSync(vercelDir, { recursive: true });
            fs.writeFileSync(path.join(vercelDir, "project.json"), JSON.stringify({
              projectId: data.id,
              orgId: creds.vercelTeamId || "",
              settings: {},
            }, null, 2));
            steps.push({ action: "vercel_linked", projectId: data.id, status: "ok" });
          } else {
            errors.push({ action: "vercel_create", error: `Vercel API: ${res.status}` });
          }
        } catch (e) {
          errors.push({ action: "vercel_create", error: e.message });
        }
      } else {
        errors.push({ action: "vercel_skip", reason: "No hay Vercel token configurado" });
      }
    }

    // Supabase
    if (supabase) {
      const creds = this.getVaultCredentials("supabase");
      if (creds?.selfSupabaseUrl && creds?.selfSupabaseKey) {
        // Usar path basado en slug en el servidor self-hosted
        const supabaseUrl = `${creds.selfSupabaseUrl.replace(/\/+$/, "")}/${slug}`;
        // Crear .editcore/connections.json
        const editcoreDir = path.join(projectRoot, ".editcore");
        fs.mkdirSync(editcoreDir, { recursive: true });
        fs.writeFileSync(path.join(editcoreDir, "connections.json"), JSON.stringify({
          supabase: { url: supabaseUrl, key: creds.selfSupabaseKey },
        }, null, 2));
        steps.push({ action: "supabase_configured", url: supabaseUrl, status: "ok" });
      } else {
        errors.push({ action: "supabase_skip", reason: "No hay Supabase configurado" });
      }
    }

    // Generar roadmap inicial
    const roadmapSync = createRoadmapSync();
    const roadmap = roadmapSync.loadOrCreate(projectRoot);
    roadmap.project.status = github || vercel ? "active" : "planning";
    roadmap.connections.github.hasLocalGit = github || steps.some(s => s.action === "git_local_only");
    roadmapSync.save(projectRoot, roadmap);
    steps.push({ action: "roadmap_created", status: "ok" });

    return {
      projectName,
      projectRoot,
      slug,
      steps,
      errors,
      success: errors.length === 0,
    };
  }

  generateStack(projectRoot, stack, pkg) {
    const files = [];

    // Crear package.json
    const packagePath = path.join(projectRoot, "package.json");
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
    files.push("package.json");

    if (stack === "vite-react" || stack === "vite-vue" || stack === "vite") {
      fs.writeFileSync(path.join(projectRoot, "vite.config.js"), "import { defineConfig } from 'vite'\nexport default defineConfig({})");
      fs.writeFileSync(path.join(projectRoot, "index.html"), "<!DOCTYPE html><html><head><title>App</title></head><body><div id='app'></div><script type='module' src='/src/main.js'></script></body></html>");
      fs.mkdirSync(path.join(projectRoot, "src"), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, "src", "main.js"), "import './style.css'\nconsole.log('App ready')");
      fs.writeFileSync(path.join(projectRoot, "src", "style.css"), "* { margin: 0; padding: 0; box-sizing: border-box; }\nbody { font-family: system-ui; }");
      files.push("vite.config.js", "index.html", "src/main.js", "src/style.css");
    }

    if (stack === "nextjs" || stack === "next") {
      fs.mkdirSync(path.join(projectRoot, "app"), { recursive: true });
      fs.mkdirSync(path.join(projectRoot, "public"), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, "app", "layout.js"), "export const metadata = { title: 'App' }\nexport default function RootLayout({ children }) { return <html><body>{children}</body></html> }");
      fs.writeFileSync(path.join(projectRoot, "app", "page.js"), "export default function Page() { return <h1>Hello World</h1> }");
      pkg.dependencies = pkg.dependencies || {};
      pkg.dependencies.next = "latest";
      pkg.dependencies.react = "latest";
      pkg.dependencies.reactDom = "latest";
      pkg.scripts.build = "next build";
      pkg.scripts.start = "next start";
      pkg.scripts.dev = "next dev";
      fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
      files.push("app/layout.js", "app/page.js");
    }

    // .gitignore basico
    fs.writeFileSync(path.join(projectRoot, ".gitignore"), "node_modules/\n.env*\n!.env.example\n.next/\nbuild/\ndist/\n.vercel/\n.editcore/\n*.log\n");
    files.push(".gitignore");

    return files;
  }
}

function createProjectBootstrap(deps = {}) {
  return new ProjectBootstrap(deps);
}

module.exports = { ProjectBootstrap, createProjectBootstrap };
