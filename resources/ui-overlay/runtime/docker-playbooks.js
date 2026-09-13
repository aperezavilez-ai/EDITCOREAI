"use strict";

/**
 * Docker playbooks: plantillas docker/compose + checklist de verificacion.
 */

const fs = require("node:fs");
const path = require("node:path");

const PLAYBOOKS = {
  node: {
    id: "node",
    name: "Node web service",
    dockerfile: `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`,
    compose: `services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    restart: unless-stopped
`,
    checklist: [
      "docker build -t app .",
      "docker compose up -d",
      "curl http://127.0.0.1:3000",
    ],
  },
  static: {
    id: "static",
    name: "Static nginx",
    dockerfile: `FROM nginx:1.27-alpine
COPY ./public /usr/share/nginx/html
EXPOSE 80
`,
    compose: `services:
  web:
    build: .
    ports:
      - "8080:80"
    restart: unless-stopped
`,
    checklist: [
      "docker build -t web .",
      "docker compose up -d",
      "curl http://127.0.0.1:8080",
    ],
  },
};

function listDockerPlaybooks() {
  return Object.values(PLAYBOOKS).map((p) => ({
    id: p.id,
    name: p.name,
    checklist: p.checklist,
  }));
}

function applyDockerPlaybook(projectRoot, playbookId = "node", { write = true } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) throw new Error("Proyecto invalido.");
  const pb = PLAYBOOKS[String(playbookId || "node").toLowerCase()] || PLAYBOOKS.node;
  const dir = path.join(root, ".editcore", "playbooks", "docker", pb.id);
  const files = {
    dockerfile: "Dockerfile",
    compose: "docker-compose.yml",
    readme: "README.md",
  };
  const readme = `# Docker playbook: ${pb.name}

## Checklist
${pb.checklist.map((c) => `- \`${c}\``).join("\n")}

## Notas
- Plantilla EditCore. Ajusta puertos y CMD a tu app.
- No se ejecuta docker automaticamente (seguridad / entorno).
`;

  if (write) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, files.dockerfile), pb.dockerfile, "utf8");
    fs.writeFileSync(path.join(dir, files.compose), pb.compose, "utf8");
    fs.writeFileSync(path.join(dir, files.readme), readme, "utf8");
    // Convenience copies at project root only if missing
    const rootDocker = path.join(root, "Dockerfile");
    const rootCompose = path.join(root, "docker-compose.yml");
    if (!fs.existsSync(rootDocker)) fs.writeFileSync(rootDocker, pb.dockerfile, "utf8");
    if (!fs.existsSync(rootCompose)) fs.writeFileSync(rootCompose, pb.compose, "utf8");
  }

  return {
    ok: true,
    playbook: pb.id,
    name: pb.name,
    outDir: `.editcore/playbooks/docker/${pb.id}`,
    checklist: pb.checklist,
    files: [
      `.editcore/playbooks/docker/${pb.id}/Dockerfile`,
      `.editcore/playbooks/docker/${pb.id}/docker-compose.yml`,
      `.editcore/playbooks/docker/${pb.id}/README.md`,
    ],
  };
}

function resolveComposeFile(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  const candidates = [
    path.join(root, "docker-compose.yml"),
    path.join(root, "docker-compose.yaml"),
    path.join(root, "compose.yml"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return null;
}

function runDockerCompose(projectRoot, { action = "up", detach = true, build = false } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const composeFile = resolveComposeFile(root);
  if (!composeFile) {
    return { ok: false, error: "No hay docker-compose.yml. Usa docker_playbook primero." };
  }
  const { spawnSync } = require("node:child_process");
  const { appendPreviewLog } = require("./log-tail");
  const act = String(action || "up").toLowerCase();
  const args = ["compose", "-f", composeFile];
  if (act === "up") {
    args.push("up");
    if (detach !== false) args.push("-d");
    if (build === true) args.push("--build");
  } else if (act === "down") {
    args.push("down");
  } else if (act === "build") {
    args.push("build");
  } else if (act === "ps") {
    args.push("ps");
  } else {
    return { ok: false, error: `Accion docker no soportada: ${act}` };
  }
  const spawned = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 2_000_000,
  });
  const stdout = String(spawned.stdout || "");
  const stderr = String(spawned.stderr || "");
  try {
    appendPreviewLog(root, `${new Date().toISOString()} docker ${args.join(" ")}\n${stdout}\n${stderr}\n`);
  } catch { /* ignore */ }
  return {
    ok: spawned.status === 0,
    code: spawned.status,
    action: act,
    composeFile: path.relative(root, composeFile).replace(/\\/g, "/"),
    stdout: stdout.slice(0, 8000),
    stderr: stderr.slice(0, 4000),
    error: spawned.error ? String(spawned.error.message || spawned.error) : "",
  };
}

function dockerComposeLogs(projectRoot, { service = "", tail = 100 } = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const composeFile = resolveComposeFile(root);
  if (!composeFile) return { ok: false, error: "No hay docker-compose.yml." };
  const { spawnSync } = require("node:child_process");
  const args = ["compose", "-f", composeFile, "logs", "--no-color", `--tail=${Math.max(20, Number(tail) || 100)}`];
  if (service) args.push(String(service));
  const spawned = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 2_000_000,
  });
  const content = `${spawned.stdout || ""}${spawned.stderr || ""}`;
  try {
    const { appendPreviewLog } = require("./log-tail");
    appendPreviewLog(root, content.slice(-8000));
  } catch { /* ignore */ }
  return {
    ok: spawned.status === 0,
    content: content.slice(0, 12_000),
    code: spawned.status,
  };
}

module.exports = {
  PLAYBOOKS,
  listDockerPlaybooks,
  applyDockerPlaybook,
  resolveComposeFile,
  runDockerCompose,
  dockerComposeLogs,
};
