const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn, spawnSync } = require("node:child_process");
const { promisify } = require("node:util");
const crypto = require("node:crypto");

const DEFAULT_DATA_FOLDER = path.join(os.homedir(), ".editcore", "n8n");
const DEFAULT_N8N_IMAGE = "n8nio/n8n:latest";
const DEFAULT_CADDY_IMAGE = "caddy:2";

class N8nManager {
  constructor(options = {}) {
    this.dataFolder = options.dataFolder || DEFAULT_DATA_FOLDER;
    this.n8nImage = options.n8nImage || DEFAULT_N8N_IMAGE;
    this.caddyImage = options.caddyImage || DEFAULT_CADDY_IMAGE;
    this.mode = options.mode || "single"; // single | queue
    this.stateFile = path.join(this.dataFolder, ".editcore-n8n-state.json");
  }

  _ensureDir() {
    fs.mkdirSync(this.dataFolder, { recursive: true });
    fs.mkdirSync(path.join(this.dataFolder, "caddy_config"), { recursive: true });
    fs.mkdirSync(path.join(this.dataFolder, "local_files"), { recursive: true });
  }

  _readState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        return JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
      }
    } catch {
      // ignore
    }
    return {};
  }

  _writeState(state) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), "utf8");
  }

  _generateSecret(bytes = 32) {
    return crypto.randomBytes(bytes).toString("hex");
  }

  _composeTemplate() {
    if (this.mode === "queue") {
      return this._queueCompose();
    }
    return this._singleCompose();
  }

  _singleCompose() {
    return `services:
  caddy:
    image: ${this.caddyImage}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ${this.dataFolder}/caddy_config:/etc/caddy
      - ${this.dataFolder}/caddy_data:/data
      - ${this.dataFolder}/local_files:/usr/share/caddy
    environment:
      - CADDY_EMAIL=${"${SSL_EMAIL}"}
    networks:
      - n8n_net

  n8n:
    image: ${this.n8nImage}
    restart: unless-stopped
    environment:
      - N8N_ENCRYPTION_KEY=${"${N8N_ENCRYPTION_KEY}"}
      - N8N_HOST=${"${SUBDOMAIN}"}.${"${DOMAIN_NAME}"}
      - N8N_PROTOCOL=https
      - N8N_PORT=5678
      - GENERIC_TIMEZONE=${"${GENERIC_TIMEZONE}"}
      - WEBHOOK_URL=https://${"${SUBDOMAIN}"}.${"${DOMAIN_NAME}"}/
      - N8N_EDITOR_BASE_URL=https://${"${SUBDOMAIN}"}.${"${DOMAIN_NAME}"}/
    volumes:
      - ${this.dataFolder}/local_files:/home/node/.n8n
    depends_on:
      caddy:
        condition: service_healthy
    networks:
      - n8n_net
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:5678/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

networks:
  n8n_net:
    driver: bridge
`;
  }

  _queueCompose() {
    return `services:
  caddy:
    image: ${this.caddyImage}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ${this.dataFolder}/caddy_config:/etc/caddy
      - ${this.dataFolder}/caddy_data:/data
      - ${this.dataFolder}/local_files:/usr/share/caddy
    environment:
      - CADDY_EMAIL=${"${SSL_EMAIL}"}
    networks:
      - n8n_net

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_USER=n8n
      - POSTGRES_PASSWORD=${"${POSTGRES_PASSWORD}"}
      - POSTGRES_NON_ROOT_USER=n8n_app
      - POSTGRES_NON_ROOT_PASSWORD=${"${POSTGRES_NON_ROOT_PASSWORD}"}
      - POSTGRES_DB=n8n
    volumes:
      - ${this.dataFolder}/postgres:/var/lib/postgresql/data
    networks:
      - n8n_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U n8n"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - ${this.dataFolder}/redis:/data
    networks:
      - n8n_net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  n8n:
    image: ${this.n8nImage}
    restart: unless-stopped
    environment:
      - N8N_ENCRYPTION_KEY=${"${N8N_ENCRYPTION_KEY}"}
      - N8N_HOST=${"${SUBDOMAIN}"}.${"${DOMAIN_NAME}"}
      - N8N_PROTOCOL=https
      - N8N_PORT=5678
      - GENERIC_TIMEZONE=${"${GENERIC_TIMEZONE}"}
      - WEBHOOK_URL=https://${"${SUBDOMAIN}"}.${"${DOMAIN_NAME}"}/
      - N8N_EDITOR_BASE_URL=https://${"${SUBDOMAIN}"}.${"${DOMAIN_NAME}"}/
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=${"${POSTGRES_PASSWORD}"}
      - QUEUE_BULL_PREFIX=queue
      - QUEUE_BULL_REDIS_HOST=redis
      - QUEUE_BULL_REDIS_PORT=6379
      - EXECUTIONS_MODE=queue
    volumes:
      - ${this.dataFolder}/local_files:/home/node/.n8n
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      caddy:
        condition: service_healthy
    networks:
      - n8n_net
    deploy:
      replicas: 1
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:5678/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  n8n-worker:
    image: ${this.n8nImage}
    restart: unless-stopped
    environment:
      - N8N_ENCRYPTION_KEY=${"${N8N_ENCRYPTION_KEY}"}
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=postgres
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n
      - DB_POSTGRESDB_USER=n8n
      - DB_POSTGRESDB_PASSWORD=${"${POSTGRES_PASSWORD}"}
      - QUEUE_BULL_PREFIX=queue
      - QUEUE_BULL_REDIS_HOST=redis
      - QUEUE_BULL_REDIS_PORT=6379
      - EXECUTIONS_MODE=queue
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - n8n_net
    deploy:
      replicas: 1

networks:
  n8n_net:
    driver: bridge
`;
  }

  _caddyfile(domain, subdomain) {
    const fqdn = `${subdomain}.${domain}`;
    return `${fqdn} {
  reverse_proxy http://n8n:5678
  encode gzip
  tls ${"${SSL_EMAIL}"}
}
`;
  }

  _envExample() {
    if (this.mode === "queue") {
      return `DATA_FOLDER=${this.dataFolder}
DOMAIN_NAME=example.com
SUBDOMAIN=n8n
SSL_EMAIL=admin@example.com
GENERIC_TIMEZONE=Etc/UTC
N8N_IMAGE_TAG=latest
N8N_ENCRYPTION_KEY=REPLACE_WITH_OPENSSL_32HEX
POSTGRES_PASSWORD=REPLACE_WITH_OPENSSL_32HEX
POSTGRES_NON_ROOT_PASSWORD=REPLACE_WITH_OPENSSL_32HEX
`;
    }
    return `DATA_FOLDER=${this.dataFolder}
DOMAIN_NAME=example.com
SUBDOMAIN=n8n
SSL_EMAIL=admin@example.com
GENERIC_TIMEZONE=Etc/UTC
N8N_IMAGE_TAG=latest
N8N_ENCRYPTION_KEY=REPLACE_WITH_OPENSSL_32HEX
`;
  }

  async _runCommand(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: true, stdio: "pipe", ...options });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      child.on("close", (code) => {
        if (code === 0) resolve({ code, stdout, stderr });
        else reject(new Error(`Command failed: ${command} ${args.join(" ")}\n${stderr || stdout}`));
      });
    });
  }

  async _dockerAvailable() {
    try {
      await this._runCommand("docker", ["--version"]);
      await this._runCommand("docker", ["compose", "version"]);
      return true;
    } catch {
      return false;
    }
  }

  async _composePs() {
    try {
      const { stdout } = await this._runCommand("docker", ["compose", "-f", path.join(this.dataFolder, "docker-compose.yml"), "ps", "--format", "json"], { cwd: this.dataFolder });
      return JSON.parse(stdout || "[]");
    } catch {
      return [];
    }
  }

  async _n8nHealth() {
    try {
      const { stdout } = await this._runCommand("docker", ["compose", "-f", path.join(this.dataFolder, "docker-compose.yml"), "exec", "-T", "n8n", "wget", "-qO-", "http://localhost:5678/healthz"], { cwd: this.dataFolder });
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  async _publicHealth(fqdn) {
    try {
      const { stdout } = await this._runCommand("curl", ["-fsS", "--retry", "5", "--retry-delay", "10", `https://${fqdn}/healthz`]);
      return JSON.parse(stdout);
    } catch {
      return null;
    }
  }

  async _logs(service = "n8n", tail = 200) {
    try {
      const { stdout } = await this._runCommand("docker", ["compose", "-f", path.join(this.dataFolder, "docker-compose.yml"), "logs", "--tail", String(tail), service], { cwd: this.dataFolder });
      return stdout;
    } catch (error) {
      return `Failed to read logs: ${error.message}`;
    }
  }

  async status() {
    const state = this._readState();
    const fqdn = state.fqdn || `${state.subdomain || "n8n"}.${state.domain || "example.com"}`;
    const composeExists = fs.existsSync(path.join(this.dataFolder, "docker-compose.yml"));
    const envExists = fs.existsSync(path.join(this.dataFolder, ".env"));
    const dockerAvailable = await this._dockerAvailable();
    const services = composeExists ? await this._composePs() : [];
    const n8nHealth = composeExists ? await this._n8nHealth() : null;
    const publicHealth = composeExists && state.fqdn ? await this._publicHealth(fqdn) : null;

    return {
      mode: this.mode,
      dataFolder: this.dataFolder,
      fqdn,
      dockerAvailable,
      composeExists,
      envExists,
      services,
      n8nHealth,
      publicHealth,
      ready: Boolean(n8nHealth && n8nHealth.status === "ok" && publicHealth && publicHealth.status === "ok"),
      state,
    };
  }

  async generateProject({ domain, subdomain = "n8n", sslEmail, timezone = "Etc/UTC", mode } = {}) {
    if (mode) this.mode = mode;
    this._ensureDir();

    const encryptionKey = this._generateSecret(32);
    const postgresPassword = this.mode === "queue" ? this._generateSecret(32) : null;
    const postgresNonRootPassword = this.mode === "queue" ? this._generateSecret(32) : null;

    const compose = this._composeTemplate();
    const caddyfile = this._caddyfile(domain, subdomain);
    const env = this._envExample()
      .replace("example.com", domain)
      .replace("admin@example.com", sslEmail)
      .replace("Etc/UTC", timezone)
      .replace("REPLACE_WITH_OPENSSL_32HEX", encryptionKey);

    const finalEnv = this.mode === "queue"
      ? env.replace("REPLACE_WITH_OPENSSL_32HEX", postgresPassword).replace("REPLACE_WITH_OPENSSL_32HEX", postgresNonRootPassword)
      : env;

    fs.writeFileSync(path.join(this.dataFolder, "docker-compose.yml"), compose, "utf8");
    fs.writeFileSync(path.join(this.dataFolder, "caddy_config", "Caddyfile"), caddyfile, "utf8");
    fs.writeFileSync(path.join(this.dataFolder, ".env"), finalEnv, "utf8");
    fs.chmodSync(path.join(this.dataFolder, ".env"), "600");

    const state = {
      mode: this.mode,
      domain,
      subdomain,
      sslEmail,
      timezone,
      fqdn: `${subdomain}.${domain}`,
      encryptionKey,
      postgresPassword,
      postgresNonRootPassword,
      createdAt: new Date().toISOString(),
    };
    this._writeState(state);

    return {
      dataFolder: this.dataFolder,
      fqdn: state.fqdn,
      encryptionKey,
      postgresPassword,
      postgresNonRootPassword,
      files: [
        path.join(this.dataFolder, "docker-compose.yml"),
        path.join(this.dataFolder, "caddy_config", "Caddyfile"),
        path.join(this.dataFolder, ".env"),
      ],
    };
  }

  async start() {
    const state = this._readState();
    if (!fs.existsSync(path.join(this.dataFolder, "docker-compose.yml"))) {
      throw new Error("Project not generated. Call generateProject first.");
    }
    await this._runCommand("docker", ["compose", "-f", path.join(this.dataFolder, "docker-compose.yml"), "up", "-d"], { cwd: this.dataFolder });
    return await this.status();
  }

  async stop() {
    await this._runCommand("docker", ["compose", "-f", path.join(this.dataFolder, "docker-compose.yml"), "down"], { cwd: this.dataFolder });
    return await this.status();
  }

  async logs(service = "n8n", tail = 200) {
    return {
      service,
      tail,
      output: await this._logs(service, tail),
    };
  }

  async verify() {
    const state = this._readState();
    const fqdn = state.fqdn || `${state.subdomain || "n8n"}.${state.domain || "example.com"}`;
    const status = await this.status();
    const certLog = await this._runCommand("docker", ["compose", "-f", path.join(this.dataFolder, "docker-compose.yml"), "logs", "--tail", "300", "caddy"], { cwd: this.dataFolder }).catch((error) => ({ stderr: error.message, stdout: "" }));
    return {
      status,
      fqdn,
      certLog: certLog.stdout || certLog.stderr || "",
      publicUrl: `https://${fqdn}`,
    };
  }
}

module.exports = { N8nManager };
