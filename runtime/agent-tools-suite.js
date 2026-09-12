"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn, execSync } = require("node:child_process");
const { scaffoldGreenfieldApp } = require("./greenfield-builder");

// In-memory active process tracker for background dev servers
const ACTIVE_PROCESSES = new Map();

/**
 * 1. write_file_batch
 * Atomically writes multiple files to workspace at once.
 */
function writeFileBatch(projectRoot, files = []) {
  const root = path.resolve(projectRoot);
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("write_file_batch requiere un array 'files' no vacio.");
  }
  if (files.length > 50) {
    throw new Error("write_file_batch admite un maximo de 50 archivos por llamada.");
  }

  const written = [];
  for (const item of files) {
    const relPath = String(item.path || item.filename || "").trim();
    if (!relPath) continue;
    const content = String(item.content ?? "");
    const fullPath = path.join(root, ...relPath.split("/"));

    // Prevent directory traversal outside root
    if (!fullPath.toLowerCase().startsWith(root.toLowerCase())) {
      throw new Error(`Ruta fuera del workspace no permitida: ${relPath}`);
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    written.push({ path: relPath, bytes: Buffer.byteLength(content, "utf8") });
  }

  return {
    ok: true,
    count: written.length,
    files: written,
  };
}

/**
 * 2. scaffold_project
 * Supports Next.js, Vite React, FastAPI, Express, and Full-Stack templates.
 */
function scaffoldProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const template = String(options.template || "vite-react-ts").toLowerCase();
  const name = String(options.name || options.appName || "editcore-app").trim();
  const prompt = String(options.prompt || "").trim();

  fs.mkdirSync(root, { recursive: true });

  if (template === "vite-react-ts" || template === "vite") {
    return scaffoldGreenfieldApp(root, { appName: name, prompt });
  }

  if (template === "nextjs-fullstack" || template === "nextjs" || template === "next") {
    return scaffoldNextjsApp(root, { name, prompt });
  }

  if (template === "fastapi-python" || template === "fastapi" || template === "python") {
    return scaffoldFastApiApp(root, { name, prompt });
  }

  if (template === "express-ts" || template === "express" || template === "node") {
    return scaffoldExpressApp(root, { name, prompt });
  }

  if (template === "fullstack-next-fastapi" || template === "fullstack") {
    const feRes = scaffoldNextjsApp(path.join(root, "frontend"), { name: `${name}-frontend`, prompt });
    const beRes = scaffoldFastApiApp(path.join(root, "backend"), { name: `${name}-backend`, prompt });

    const composeYaml = `version: "3.8"
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
  backend:
    build: ./backend
    ports:
      - "8000:8000"
`;
    fs.writeFileSync(path.join(root, "docker-compose.yml"), composeYaml, "utf8");

    return {
      ok: true,
      template: "fullstack-next-fastapi",
      filesCount: (feRes.filesCount || 0) + (beRes.filesCount || 0) + 1,
      frontend: feRes,
      backend: beRes,
    };
  }

  // Default fallback to greenfield app
  return scaffoldGreenfieldApp(root, { appName: name, prompt });
}

function scaffoldNextjsApp(root, { name = "next-app", prompt = "" } = {}) {
  const files = {
    "package.json": JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
      version: "1.0.0",
      private: true,
      scripts: {
        dev: "next dev",
        build: "next build",
        start: "next start",
        lint: "next lint",
      },
      dependencies: {
        next: "14.1.0",
        react: "^18.2.0",
        "react-dom": "^18.2.0",
        "lucide-react": "^0.323.0",
        clsx: "^2.1.0",
        "tailwind-merge": "^2.2.1",
      },
      devDependencies: {
        "@types/node": "^20",
        "@types/react": "^18",
        "@types/react-dom": "^18",
        autoprefixer: "^10.0.1",
        postcss: "^8",
        tailwindcss: "^3.3.0",
        typescript: "^5",
      },
    }, null, 2),
    "next.config.js": `/** @type {import('next').NextConfig} */\nconst nextConfig = {};\nmodule.exports = nextConfig;\n`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "es5",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    }, null, 2),
    "tailwind.config.ts": `import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#0284c7",
      },
    },
  },
  plugins: [],
};
export default config;
`,
    "src/app/globals.css": `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`,
    "src/app/layout.tsx": `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "${name}",
  description: "Creado con EDITCOREAI Next.js Scaffold",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
`,
    "src/app/page.tsx": `"use client";

import { Sparkles } from "lucide-react";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-slate-950 to-slate-900">
      <div className="inline-flex items-center gap-2 px-4 py-2 bg-cyan-500/10 border border-cyan-500/20 rounded-full mb-6">
        <Sparkles className="h-4 w-4 text-cyan-400" />
        <span className="text-cyan-400 text-sm font-medium">Aplicacion Next.js 14 Activa</span>
      </div>
      <h1 className="text-4xl font-bold text-white mb-4">${name}</h1>
      <p className="text-slate-400 max-w-md mb-8">${prompt || "Proyecto Next.js generado por EDITCOREAI."}</p>
    </main>
  );
}
`,
    ".gitignore": `node_modules\n.next\nout\nbuild\n.env\n.env.local\n`,
    "README.md": `# ${name}\n\nProyecto Next.js Full-Stack creado con EDITCOREAI.\n\n## Ejecución\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
  };

  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    written.push(rel);
  }

  return { ok: true, template: "nextjs", projectRoot: root, appName: name, filesCount: written.length, files: written };
}

function scaffoldFastApiApp(root, { name = "fastapi-app", prompt = "" } = {}) {
  const files = {
    "requirements.txt": `fastapi>=0.110.0\nuvicorn>=0.28.0\npydantic>=2.6.0\npytest>=8.0.0\npython-dotenv>=1.0.0\n`,
    "main.py": `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="${name}", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "API ${name} activa", "status": "online"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
`,
    "tests/test_main.py": `from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "online"
`,
    ".gitignore": `__pycache__/\n*.py[cod]\nvenv/\n.env\n.pytest_cache/\n`,
    "README.md": `# ${name}\n\nBackend FastAPI creado con EDITCOREAI.\n\n## Ejecucion\n\`\`\`bash\npip install -r requirements.txt\nuvicorn main:app --reload --port 8000\n\`\`\`\n`,
  };

  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    written.push(rel);
  }

  return { ok: true, template: "fastapi", projectRoot: root, appName: name, filesCount: written.length, files: written };
}

function scaffoldExpressApp(root, { name = "express-app", prompt = "" } = {}) {
  const files = {
    "package.json": JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
      version: "1.0.0",
      private: true,
      main: "dist/index.js",
      scripts: {
        build: "tsc",
        start: "node dist/index.js",
        dev: "ts-node-dev --respawn --transpile-only src/index.ts",
      },
      dependencies: {
        express: "^4.19.2",
        cors: "^2.8.5",
        dotenv: "^16.4.5",
      },
      devDependencies: {
        "@types/express": "^4.17.21",
        "@types/cors": "^2.8.17",
        "@types/node": "^20.12.7",
        "typescript": "^5.4.5",
        "ts-node-dev": "^2.0.0",
      },
    }, null, 2),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        outDir: "./dist",
        rootDir: "./src",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ["src/**/*"],
    }, null, 2),
    "src/index.ts": `import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Servidor Express activo", status: "online" });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(\`Servidor corriendo en http://localhost:\${port}\`);
});
`,
    ".gitignore": `node_modules\ndist\n.env\n`,
    "README.md": `# ${name}\n\nBackend Express TypeScript creado con EDITCOREAI.\n`,
  };

  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf8");
    written.push(rel);
  }

  return { ok: true, template: "express-ts", projectRoot: root, appName: name, filesCount: written.length, files: written };
}

/**
 * 3. manage_process
 * Manages background servers & tasks (start, status, logs, stop, list).
 */
async function manageProcess(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const action = String(options.action || "list").toLowerCase();
  const command = String(options.command || "").trim();
  const port = Number(options.port) || 0;
  const procId = String(options.processId || options.id || (port ? `port-${port}` : "dev-server")).trim();

  if (action === "start") {
    if (!command) throw new Error("manage_process action='start' requiere un 'command'.");
    
    // Check if process already running
    if (ACTIVE_PROCESSES.has(procId)) {
      const existing = ACTIVE_PROCESSES.get(procId);
      if (existing && !existing.killed) {
        return { ok: true, status: "already_running", processId: procId, port: existing.port, pid: existing.pid };
      }
    }

    const child = spawn(command, {
      shell: true,
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    const logs = [];
    child.stdout.on("data", (data) => {
      logs.push(data.toString());
      if (logs.length > 200) logs.shift();
    });
    child.stderr.on("data", (data) => {
      logs.push(`[ERR] ${data.toString()}`);
      if (logs.length > 200) logs.shift();
    });

    const procInfo = {
      processId: procId,
      command,
      port,
      pid: child.pid,
      child,
      logs,
      startedAt: new Date().toISOString(),
      killed: false,
    };

    child.on("exit", (code) => {
      procInfo.killed = true;
      procInfo.exitCode = code;
    });

    ACTIVE_PROCESSES.set(procId, procInfo);

    // Give process 1.5s to boot and check if port opens
    await new Promise((r) => setTimeout(r, 1500));
    const portOpen = port ? await isPortListening(port) : false;

    return {
      ok: true,
      status: "started",
      processId: procId,
      pid: child.pid,
      port,
      portListening: portOpen,
      logsSample: logs.slice(-10).join(""),
    };
  }

  if (action === "status" || action === "check") {
    const existing = ACTIVE_PROCESSES.get(procId);
    const portOpen = port ? await isPortListening(port) : false;

    if (!existing) {
      return { ok: true, status: "not_found", processId: procId, portListening: portOpen };
    }

    return {
      ok: true,
      processId: procId,
      command: existing.command,
      pid: existing.pid,
      running: !existing.child.killed && !existing.killed,
      port: existing.port,
      portListening: portOpen,
      startedAt: existing.startedAt,
    };
  }

  if (action === "logs") {
    const existing = ACTIVE_PROCESSES.get(procId);
    if (!existing) return { ok: false, error: `No existe proceso registrado con id '${procId}'.` };
    return { ok: true, processId: procId, logs: existing.logs.slice(-50).join("") };
  }

  if (action === "stop" || action === "kill") {
    const existing = ACTIVE_PROCESSES.get(procId);
    if (!existing) return { ok: true, status: "already_stopped", processId: procId };
    try {
      existing.child.kill("SIGTERM");
      existing.killed = true;
    } catch {}
    ACTIVE_PROCESSES.delete(procId);
    return { ok: true, status: "stopped", processId: procId };
  }

  // Action: list
  const list = [];
  for (const [id, info] of ACTIVE_PROCESSES.entries()) {
    list.push({
      processId: id,
      command: info.command,
      pid: info.pid,
      port: info.port,
      running: !info.child.killed && !info.killed,
      startedAt: info.startedAt,
    });
  }
  return { ok: true, count: list.length, processes: list };
}

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * 4. manage_dependencies
 */
function manageDependencies(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const manager = String(options.manager || "npm").toLowerCase();
  const action = String(options.action || "install").toLowerCase();
  const packages = Array.isArray(options.packages) ? options.packages.map(String) : [];
  const isDev = options.dev === true;

  let cmd = "";
  if (manager === "npm") {
    if (action === "install") cmd = "npm install";
    else if (action === "add") cmd = `npm install ${isDev ? "-D " : ""}${packages.join(" ")}`;
    else if (action === "remove") cmd = `npm uninstall ${packages.join(" ")}`;
  } else if (manager === "pip") {
    if (action === "install") cmd = "pip install -r requirements.txt";
    else if (action === "add") cmd = `pip install ${packages.join(" ")}`;
    else if (action === "remove") cmd = `pip uninstall -y ${packages.join(" ")}`;
  } else {
    cmd = `npm install ${packages.join(" ")}`;
  }

  try {
    const output = execSync(cmd, { cwd: root, encoding: "utf8", timeout: 120000 });
    return { ok: true, manager, action, commandExecuted: cmd, output: output.slice(-500) };
  } catch (err) {
    return { ok: false, manager, action, error: err.message, stderr: err.stderr ? String(err.stderr).slice(-500) : "" };
  }
}

/**
 * 5. verify_project_health
 */
function verifyProjectHealth(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const issues = [];
  const checks = [];

  // Check 1: Existence of package.json or requirements.txt
  const hasPkgJson = fs.existsSync(path.join(root, "package.json"));
  const hasPyReqs = fs.existsSync(path.join(root, "requirements.txt"));
  const hasMainPy = fs.existsSync(path.join(root, "main.py"));

  if (!hasPkgJson && !hasPyReqs && !hasMainPy) {
    issues.push("No se encontro package.json ni requirements.txt ni main.py en la raiz del proyecto.");
  } else {
    checks.push("Manifest de proyecto detectado correctamente.");
  }

  // Check 2: TypeScript check if tsconfig.json exists
  const hasTsConfig = fs.existsSync(path.join(root, "tsconfig.json"));
  if (hasTsConfig && hasPkgJson) {
    try {
      execSync("npx tsc --noEmit", { cwd: root, encoding: "utf8", timeout: 30000 });
      checks.push("TypeScript check: OK (sin errores de tipo).");
    } catch (err) {
      issues.push(`TypeScript check fallo: ${String(err.stdout || err.message).slice(0, 300)}`);
    }
  }

  // Check 3: Check node_modules if package.json exists
  if (hasPkgJson && !fs.existsSync(path.join(root, "node_modules"))) {
    issues.push("node_modules no existe. Ejecuta 'npm install' antes de iniciar el servidor.");
  }

  const healthy = issues.length === 0;
  return {
    ok: healthy,
    healthy,
    checksCount: checks.length,
    checks,
    issuesCount: issues.length,
    issues,
    summary: healthy
      ? "Proyecto integro y listo para desarrollo/produccion."
      : `Detectados ${issues.length} problemas en el proyecto.`,
  };
}

/**
 * 6. orchestrate_project_build
 */
function orchestrateProjectBuild(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const spec = String(options.spec || options.prompt || "Proyecto web moderno").trim();
  const template = String(options.template || "vite-react-ts");
  const name = String(options.name || "pro-app");

  // Step 1: Scaffold
  const scaffoldResult = scaffoldProject(root, { template, name, prompt: spec });

  // Step 2: Healthcheck initial
  const healthResult = verifyProjectHealth(root);

  return {
    ok: true,
    phase: "orchestrated_completion",
    scaffold: scaffoldResult,
    health: healthResult,
    recommendedNextSteps: [
      "Ejecuta manage_dependencies con action='install' si las dependencias no han sido instaladas.",
      "Usa manage_process con action='start' command='npm run dev' port=3000 para arrancar el servidor.",
      "Inspecciona la vista previa con inspect_preview o browser_interact.",
    ],
  };
}

module.exports = {
  writeFileBatch,
  scaffoldProject,
  manageProcess,
  manageDependencies,
  verifyProjectHealth,
  orchestrateProjectBuild,
};
