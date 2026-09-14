"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { buildProjectTemplate, packageName } = require("./project-template");
const { scaffoldGreenfieldApp } = require("./runtime/greenfield-builder");
const { scaffoldEnterpriseErpBase } = require("./runtime/enterprise-erp");

const PROFESSIONAL_RULES = `
## EDITCOREAI Professional Project Rules

- Use the existing component system before creating a new primitive.
- Use shadcn/ui conventions and Lucide icons for interface controls.
- Keep design tokens semantic; do not hard-code one visual theme across the product.
- Every asynchronous view must implement loading, skeleton, empty, error, and success states.
- Interfaces must work at 375px, 768px, 1280px, and 1440px without overlap or horizontal overflow.
- Preserve keyboard navigation, visible focus, accessible labels, and reduced-motion preferences.
- Always ship micro-interactions (hover/focus/press) plus smooth in-page scroll triggers on new web/PWA surfaces.
- Use Framer Motion or Tailwind transition utilities already in the template; never block primary actions for decoration.
- Responsive asset placeholders belong in \`public/assets/\` (aspect-ratio + fallback). Prefer generate_image / generate_video when configured.
- Validate forms with schemas and show field-level errors.
- Never display simulated progress, fabricated data, or a successful state before the real operation succeeds.
- Run the available lint, test, typecheck, and build commands after material changes.
- Inspect the result in a real browser at desktop and mobile sizes before declaring UI work complete.
`;

const TEMPLATE_CATALOG = Object.freeze([
  {
    id: "blank", name: "Proyecto vacio", group: "Basico",
    description: "Solo README minimo. Sin reglas ni metadatos extra.", source: "builtin", install: false,
  },
  {
    id: "web", name: "Web HTML", group: "Basico",
    description: "HTML, CSS y JavaScript sin framework.", source: "builtin", install: false,
  },
  {
    id: "node", name: "Node.js", group: "Basico",
    description: "Servicio Node.js con pruebas nativas.", source: "builtin", install: false,
  },
  {
    id: "react", name: "React", group: "Basico",
    description: "React y Vite para una aplicacion ligera.", source: "builtin", install: true,
    verifyScripts: ["test", "build"],
  },
  {
    id: "soundonemusic", name: "SOUNDONEMUSIC · Suno SaaS", group: "Profesional",
    description: "React y API Node para generar Style y Lyrics estructurados para Suno AI.",
    source: "builtin", install: true, verifyScripts: ["test", "build"],
    requirements: ["Node.js 20+", "npm"],
  },
  {
    id: "pro-web-app", name: "Web App profesional", group: "Profesional",
    description: "React, Vite, TypeScript, Tailwind CSS, componentes UI accesibles y assets temáticos.",
    source: "builtin", install: true, verifyScripts: ["build"], visualVerify: true,
    requirements: ["Node.js 20+", "npm"],
  },
  {
    id: "lovable-web", name: "Web App profesional", group: "Profesional",
    description: "React, Vite, TypeScript, Tailwind CSS, componentes UI accesibles y assets temáticos.",
    source: "builtin", install: true, verifyScripts: ["build"], visualVerify: true,
    requirements: ["Node.js 20+", "npm"],
  },
  {
    id: "enterprise-erp-base", name: "Enterprise ERP Base", group: "Profesional",
    description: "ERP multi-tenant: RBAC, DataTable densa, shell multi-sucursal, Supabase/Gafcore client, schema-first.",
    source: "builtin", install: true, verifyScripts: ["build"], visualVerify: false,
    requirements: ["Node.js 20+", "npm", "Supabase o Gafcore"],
  },
  {
    id: "next-saas", name: "SaaS profesional Next.js", group: "Profesional",
    description: "Next.js, shadcn/ui, Postgres, Drizzle, Stripe, equipos y roles.",
    source: "github", repository: "https://github.com/nextjs/saas-starter.git",
    revision: "6e33e58b1e553a41fe22e6b941a7229a002de361", license: "MIT",
    install: true, verifyScripts: ["build"], visualVerify: true, requirements: ["Git", "Node.js 20+", "pnpm/Corepack", "Postgres para ejecucion completa"],
  },
  {
    id: "open-saas", name: "Open SaaS avanzado", group: "Profesional",
    description: "Wasp full stack con autenticacion, pagos, correo, jobs, analitica y Playwright.",
    source: "github", repository: "https://github.com/wasp-lang/open-saas.git", sourceSubdir: "template/app",
    revision: "9ee052af84950433c76bffe999b317d24bc0205d", license: "MIT",
    install: false, verifyCommand: ["npx", "--yes", "@wasp.sh/wasp-cli@0.25.0", "build"],
    requirements: ["Git", "Docker Desktop con motor Linux", "Wasp CLI dentro del contenedor"],
  },
]);

const OMIT_NAMES = new Set([".git", "node_modules", ".next", "dist", "build", ".wasp"]);
const BUILD_ENVIRONMENTS = Object.freeze({
  "next-saas": {
    POSTGRES_URL: "postgresql://editcore:editcore@127.0.0.1:5432/editcore_build",
    STRIPE_SECRET_KEY: "sk_test_editcore_build_verification",
    STRIPE_WEBHOOK_SECRET: "whsec_editcore_build_verification",
    BASE_URL: "http://127.0.0.1:3000",
    AUTH_SECRET: "editcore-build-verification-only-not-for-production",
  },
});

function publicTemplate(template) {
  const { repository, revision, sourceSubdir, verifyScripts, verifyCommand, ...visible } = template;
  return { ...visible, repository: repository || "", requirements: template.requirements || [] };
}

function getTemplate(templateId) {
  const template = TEMPLATE_CATALOG.find((item) => item.id === String(templateId || "blank"));
  if (!template) throw new Error("Plantilla no permitida.");
  return template;
}

function executableName(name) {
  return process.platform === "win32" && ["npm", "npx", "pnpm", "bun"].includes(name) ? `${name}.cmd` : name;
}

function cmdArgument(value) {
  const text = String(value);
  if (/[^a-zA-Z0-9_./:@=-]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const output = [];
    const executable = executableName(command);
    const usesCommandShim = process.platform === "win32" && executable.endsWith(".cmd");
    const child = spawn(usesCommandShim ? (process.env.ComSpec || "cmd.exe") : executable, usesCommandShim
      ? ["/d", "/s", "/c", [executable, ...args].map(cmdArgument).join(" ")]
      : args, {
      cwd: options.cwd,
      windowsHide: true,
      shell: false,
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", BROWSER: "none", ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const abort = () => {
      if (child.exitCode !== null) return;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      else child.kill("SIGTERM");
    };
    if (options.signal) {
      if (options.signal.aborted) abort();
      options.signal.addEventListener("abort", abort, { once: true });
    }
    const collect = (chunk) => {
      const text = String(chunk || "");
      output.push(text);
      options.onOutput?.(text);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("exit", (code) => {
      options.signal?.removeEventListener("abort", abort);
      const text = output.join("").slice(-120_000);
      if (options.signal?.aborted) return reject(Object.assign(new Error("Creacion cancelada por el usuario."), { code: "ABORT_ERR" }));
      if (code !== 0) return reject(Object.assign(new Error(`${command} ${args.join(" ")} termino con codigo ${code}.\n${text.slice(-4000)}`), { command, args, output: text, exitCode: code }));
      resolve({ command: [command, ...args].join(" "), output: text, exitCode: code });
    });
  });
}

function copyTree(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    filter: (entry) => !OMIT_NAMES.has(path.basename(entry)),
  });
}

function appendRules(projectRoot) {
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  const current = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, "utf8").trimEnd() : "# Project Instructions";
  if (!current.includes("## EDITCOREAI Professional Project Rules")) fs.writeFileSync(agentsPath, `${current}\n${PROFESSIONAL_RULES}\n`, "utf8");
  fs.writeFileSync(path.join(projectRoot, "instructions.md"), `# Design and Engineering Instructions\n${PROFESSIONAL_RULES}\n`, "utf8");
  const roadmapPath = path.join(projectRoot, "ROADMAP.md");
  if (!fs.existsSync(roadmapPath)) {
    fs.writeFileSync(roadmapPath, `# ${path.basename(projectRoot)} — ROADMAP\n\nIndice compacto para agentes. Leer ANTES de explorar el repo. Actualizar al cerrar cada tarea. No pegar codigo.\n\n## Estado\n- Fase: scaffold\n\n## Mapa\n- README.md\n\n## Tarea activa\n- Scaffold inicial\n\n## Siguiente\n- Implementar el pedido del usuario y actualizar este archivo.\n`, "utf8");
  }
}

function writeSkeleton(projectRoot, template) {
  const relative = template.id === "next-saas" ? "components/ui/skeleton.tsx"
    : template.id === "open-saas" ? "src/client/components/ui/skeleton.tsx" : "";
  if (!relative) return;
  const target = path.join(projectRoot, relative);
  if (fs.existsSync(target)) return;
  const importPath = template.id === "next-saas" ? "@/lib/utils" : "../../utils";
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `import * as React from "react";\n\nimport { cn } from "${importPath}";\n\nfunction Skeleton({ className, ...props }: React.ComponentProps<"div">) {\n  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;\n}\n\nexport { Skeleton };\n`, "utf8");
}

function writeVisualQualityTest(projectRoot, template) {
  if (!template.visualVerify || template.id === "soundonemusic") return;
  const isNext = template.id === "next-saas";
  const command = isNext
    ? "npx --yes pnpm@10.15.0 run dev --hostname 127.0.0.1 --port 4173"
    : "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort";
  const env = isNext ? `,\n    env: {\n      ...process.env,\n      POSTGRES_URL: "postgresql://editcore:editcore@127.0.0.1:5432/editcore_build",\n      STRIPE_SECRET_KEY: "sk_test_editcore_build_verification",\n      STRIPE_WEBHOOK_SECRET: "whsec_editcore_build_verification",\n      BASE_URL: "http://127.0.0.1:4173",\n      AUTH_SECRET: "editcore-build-verification-only-not-for-production"\n    }` : "";
  fs.writeFileSync(path.join(projectRoot, "playwright.config.ts"), `import { defineConfig, devices } from "@playwright/test";\n\nexport default defineConfig({\n  testDir: "./tests/e2e",\n  timeout: 60_000,\n  reporter: "list",\n  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },\n  webServer: {\n    command: ${JSON.stringify(command)},\n    url: "http://127.0.0.1:4173",\n    reuseExistingServer: false,\n    timeout: 180_000${env}\n  },\n  projects: [\n    { name: "desktop", use: { ...devices["Desktop Chrome"] } },\n    { name: "mobile", use: { ...devices["Pixel 7"] } }\n  ]\n});\n`, "utf8");
  const testDir = path.join(projectRoot, "tests", "e2e");
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, "ui-quality.spec.ts"), `import { expect, test } from "@playwright/test";\n\ntest("home renders without horizontal overflow", async ({ page }, testInfo) => {\n  await page.goto("/", { waitUntil: "networkidle" });\n  await expect(page.locator("body")).toBeVisible();\n  const headingVisible = await page.locator("h1, h2").first().isVisible().catch(() => false);\n  expect(headingVisible).toBe(true);\n  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);\n  expect(overflow).toBe(false);\n  const screenshot = await page.screenshot({ fullPage: true, animations: "disabled" });\n  expect(screenshot.byteLength).toBeGreaterThan(1000);\n  await testInfo.attach("home", { body: screenshot, contentType: "image/png" });\n});\n`, "utf8");
}

function applyTemplateAdapters(projectRoot, template) {
  if (template.id === "next-saas") {
    const pricingPath = path.join(projectRoot, "app", "(dashboard)", "pricing", "page.tsx");
    if (fs.existsSync(pricingPath)) {
      const source = fs.readFileSync(pricingPath, "utf8").replace("export const revalidate = 3600;", "export const dynamic = 'force-dynamic';");
      fs.writeFileSync(pricingPath, source, "utf8");
    }
  }
  if (template.id === "open-saas") {
    const emailPath = path.join(projectRoot, "src", "server", "emailSender.wasp.ts");
    if (fs.existsSync(emailPath)) {
      const source = fs.readFileSync(emailPath, "utf8").replace('provider: "Dummy"', 'provider: "SendGrid"');
      fs.writeFileSync(emailPath, source, "utf8");
    }
  }
  writeSkeleton(projectRoot, template);
  writeVisualQualityTest(projectRoot, template);
}

function customizeProject(projectRoot, input, template) {
  const packagePath = path.join(projectRoot, "package.json");
  if (fs.existsSync(packagePath)) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    pkg.name = packageName(input.name);
    pkg.private = true;
    if (template.group === "Profesional") {
      pkg.dependencies ||= {};
      pkg.dependencies.motion ||= "12.42.2";
    }
    if (template.id === "next-saas") {
      // The pinned upstream lockfile omits this Radix runtime edge under pnpm 10.
      pkg.dependencies["@radix-ui/react-use-controllable-state"] ||= "1.2.2";
    }
    if (template.id === "open-saas") {
      pkg.dependencies["@hookform/resolvers"] = "5.1.1";
      pkg.overrides = {
        ...(pkg.overrides || {}),
        "@sendgrid/mail": "8.1.6",
        "@sendgrid/client": "8.1.6",
        axios: "1.18.1",
        morgan: "1.11.0",
        uuid: "11.1.1",
      };
    }
    if (template.visualVerify) {
      pkg.devDependencies ||= {};
      pkg.devDependencies["@playwright/test"] ||= "1.62.1";
      pkg.scripts ||= {};
      pkg.scripts["test:e2e"] = "playwright test";
    }
    fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  }
  appendRules(projectRoot);
  applyTemplateAdapters(projectRoot, template);
  const metadataDir = path.join(projectRoot, ".editcore");
  fs.mkdirSync(metadataDir, { recursive: true });
  fs.writeFileSync(path.join(metadataDir, "template.json"), `${JSON.stringify({
    schemaVersion: 1,
    template: template.id,
    templateName: template.name,
    repository: template.repository || "builtin",
    revision: template.revision || "builtin",
    license: template.license || "project",
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
}

function packageManager(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, "pnpm-lock.yaml"))) return "pnpm";
  if ((fs.existsSync(path.join(projectRoot, "bun.lock")) || fs.existsSync(path.join(projectRoot, "bun.lockb"))) && !fs.existsSync(path.join(projectRoot, "package-lock.json"))) return "bun";
  return "npm";
}

function scriptCommands(projectRoot, template) {
  if (template.id === "open-saas") {
    const containerArgs = ["run", "--rm", "--mount", `type=bind,source=${path.resolve(projectRoot)},target=/workspace`, "-w", "/workspace", "node:24-bookworm-slim"];
    const dockerArgs = [
      ...containerArgs, "npx", "--yes", "--min-release-age=0",
      "--package", "@wasp.sh/wasp-cli@0.25.0",
      "--package", "@wasp.sh/wasp-cli-linux-x64-glibc@0.25.0",
      "wasp",
    ];
    return [
      { command: "docker", args: [...dockerArgs, "install"], label: "Instalando dependencias Open SaaS en Linux", env: {} },
      {
        command: "docker",
        args: [...containerArgs, "npm", "install", "react-router@8.3.0", "--no-save", "--no-audit", "--no-fund", "--min-release-age=0"],
        label: "Instalando el parche de seguridad de React Router",
        env: {},
      },
      { command: "docker", args: [...dockerArgs, "build"], label: "Compilando Open SaaS en Linux con Docker", env: {} },
      {
        command: "docker",
        args: [...containerArgs, "npm", "install", "react-router@8.3.0", "--workspace", "wasp", "--no-save", "--no-audit", "--no-fund", "--min-release-age=0"],
        label: "Verificando React Router seguro en el SDK de Wasp",
        env: {},
      },
      {
        command: "docker",
        args: [...containerArgs, "npm", "run", "build", "--prefix", ".wasp/out/sdk/wasp"],
        label: "Recompilando el SDK de Wasp actualizado",
        env: {},
      },
      { command: "docker", args: [...containerArgs, "npm", "audit", "--omit=dev", "--audit-level=high"], label: "Auditando dependencias de produccion", env: {} },
    ];
  }
  if (template.verifyCommand) return [{ command: template.verifyCommand[0], args: template.verifyCommand.slice(1), label: "Compilando con Wasp", env: {} }];
  const packagePath = path.join(projectRoot, "package.json");
  if (!fs.existsSync(packagePath)) return [];
  const scripts = JSON.parse(fs.readFileSync(packagePath, "utf8")).scripts || {};
  const manager = packageManager(projectRoot);
  const commands = (template.verifyScripts || []).filter((name) => scripts[name]).map((name) => ({
    command: manager === "pnpm" ? "npx" : manager,
    args: manager === "pnpm" ? ["--yes", "pnpm@10.15.0", "run", name] : ["run", name],
    label: `Ejecutando ${name}`,
    env: BUILD_ENVIRONMENTS[template.id] || {},
  }));
  if (template.visualVerify && scripts["test:e2e"]) {
    commands.push({ command: "npx", args: ["playwright", "install", "chromium"], label: "Instalando navegador de verificacion", env: {} });
    commands.push({
      command: manager === "pnpm" ? "npx" : manager,
      args: manager === "pnpm" ? ["--yes", "pnpm@10.15.0", "run", "test:e2e"] : ["run", "test:e2e"],
      label: "Verificando interfaz en escritorio y movil",
      env: BUILD_ENVIRONMENTS[template.id] || {},
    });
  }
  return commands;
}

class ProjectScaffoldService {
  listTemplates() {
    return TEMPLATE_CATALOG
      .filter((item) => item.id !== "soundonemusic")
      .map(publicTemplate);
  }

  async create(input, options = {}) {
    const startedAt = Date.now();
    const name = String(input?.name || "").trim();
    const template = getTemplate(input?.template);
    buildProjectTemplate({ name, template: template.source === "builtin" ? template.id : "blank" });
    const parent = path.resolve(String(input.parentPath || ""));
    if (!parent || !fs.existsSync(parent)) throw new Error("La carpeta de destino no existe.");
    const projectRoot = path.resolve(parent, name);
    if (path.dirname(projectRoot) !== parent) throw new Error("Ruta de proyecto invalida.");
    if (fs.existsSync(projectRoot) && fs.readdirSync(projectRoot).length) throw new Error("La carpeta del proyecto ya existe y no esta vacia.");
    const report = { ok: false, template: template.id, startedAt: new Date(startedAt).toISOString(), commands: [] };
    const progress = (percent, stage, message) => options.onProgress?.({ percent, stage, message, state: "running" });
    let tempRoot = "";
    try {
      progress(2, "preflight", "Validando destino y herramientas");
      if (template.id === "open-saas") {
        report.commands.push(await runProcess("docker", ["info", "--format", "{{.ServerVersion}}"], { signal: options.signal, onOutput: options.onOutput }));
      }
      fs.mkdirSync(projectRoot, { recursive: true });
      if (template.id === "pro-web-app" || template.id === "lovable-web") {
        progress(18, "files", "Generando aplicacion web profesional");
        scaffoldGreenfieldApp(projectRoot, {
          prompt: input.description || input.prompt || input.name || "",
          appName: name,
        });
      } else if (template.id === "enterprise-erp-base") {
        progress(18, "files", "Generando enterprise ERP base (schema-first)");
        scaffoldEnterpriseErpBase(projectRoot, { appName: name });
      } else if (template.source === "builtin") {
        progress(18, "files", "Creando estructura local");
        const built = buildProjectTemplate({ name, template: template.id });
        for (const [relative, content] of Object.entries(built.files)) {
          const target = path.join(projectRoot, relative);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, content, "utf8");
        }
      } else {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "editcore-template-"));
        const checkout = path.join(tempRoot, "repository");
        progress(10, "download", `Descargando ${template.name}`);
        report.commands.push(await runProcess("git", ["clone", "--filter=blob:none", "--no-checkout", template.repository, checkout], { signal: options.signal, onOutput: options.onOutput }));
        report.commands.push(await runProcess("git", ["-C", checkout, "fetch", "--depth", "1", "origin", template.revision], { signal: options.signal, onOutput: options.onOutput }));
        report.commands.push(await runProcess("git", ["-C", checkout, "checkout", "--detach", "FETCH_HEAD"], { signal: options.signal, onOutput: options.onOutput }));
        const revision = (await runProcess("git", ["-C", checkout, "rev-parse", "HEAD"], { signal: options.signal })).output.trim();
        if (revision !== template.revision) throw new Error("La revision descargada no coincide con la plantilla verificada.");
        progress(32, "files", "Copiando la plantilla verificada");
        const sourceRoot = path.join(checkout, template.sourceSubdir || "");
        if (!fs.existsSync(sourceRoot)) throw new Error("La carpeta fuente de la plantilla no existe.");
        copyTree(sourceRoot, projectRoot);
      }
      progress(43, "configure", template.id === "blank" ? "Finalizando proyecto vacio" : "Aplicando nombre, metadatos y reglas profesionales");
      if (template.id !== "blank") customizeProject(projectRoot, input, template);
      if (template.install && input.install !== false) {
        const manager = packageManager(projectRoot);
        progress(52, "install", `Instalando dependencias con ${manager}`);
        const installCommand = manager === "pnpm" ? "npx" : manager;
        const installArgs = manager === "npm" ? ["install", "--no-audit", "--no-fund"]
          : manager === "pnpm" ? ["--yes", "pnpm@10.15.0", "install", "--no-frozen-lockfile"] : ["install"];
        report.commands.push(await runProcess(installCommand, installArgs, { cwd: projectRoot, signal: options.signal, onOutput: options.onOutput }));
      }
      const checks = (template.install && input.install === false) ? [] : scriptCommands(projectRoot, template);
      for (let index = 0; index < checks.length; index++) {
        const check = checks[index];
        progress(68 + Math.round((index / Math.max(1, checks.length)) * 24), "verify", check.label);
        const commandResult = await runProcess(check.command, check.args, { cwd: projectRoot, signal: options.signal, onOutput: options.onOutput, env: check.env });
        report.commands.push({ ...commandResult, environment: Object.keys(check.env || {}) });
      }
      progress(96, "report", "Guardando evidencia verificable");
      report.ok = true;
      report.finishedAt = new Date().toISOString();
      report.durationMs = Date.now() - startedAt;
      report.root = projectRoot;
      report.commands = report.commands.map((item) => ({ command: item.command, exitCode: item.exitCode, outputTail: item.output.slice(-2000) }));
      if (template.id !== "blank") {
        fs.mkdirSync(path.join(projectRoot, ".editcore"), { recursive: true });
        fs.writeFileSync(path.join(projectRoot, ".editcore", "scaffold-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
        const packagePath = path.join(projectRoot, "package.json");
        const packageData = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, "utf8")) : {};
        const entries = fs.readdirSync(projectRoot, { withFileTypes: true }).filter((entry) => !["node_modules", ".git"].includes(entry.name));
        fs.writeFileSync(path.join(projectRoot, ".editcore", "project.json"), `${JSON.stringify({
          schemaVersion: 1,
          name,
          root: projectRoot,
          packageName: String(packageData.name || ""),
          scripts: Object.keys(packageData.scripts || {}),
          topLevelEntries: entries.length,
          savedAt: new Date().toISOString(),
        }, null, 2)}\n`, "utf8");
      }
      options.onProgress?.({ percent: 100, stage: "complete", message: "Proyecto creado y verificado", state: "complete" });
      return { root: projectRoot, name, template: template.id, report };
    } catch (error) {
      report.finishedAt = new Date().toISOString();
      report.durationMs = Date.now() - startedAt;
      report.error = error?.message || String(error);
      if (fs.existsSync(projectRoot)) {
        const metadataDir = path.join(projectRoot, ".editcore");
        fs.mkdirSync(metadataDir, { recursive: true });
        fs.writeFileSync(path.join(metadataDir, "scaffold-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      options.onProgress?.({ percent: 100, stage: "error", message: report.error, state: error?.code === "ABORT_ERR" ? "cancelled" : "error" });
      throw error;
    } finally {
      if (tempRoot && fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

module.exports = { ProjectScaffoldService, TEMPLATE_CATALOG, PROFESSIONAL_RULES, getTemplate, runProcess, customizeProject, scriptCommands };
