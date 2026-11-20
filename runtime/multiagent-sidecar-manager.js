/**
 * EditCore AI - MultiAgent Sidecar Process Manager
 * Manages the lifecycle of the Python Agno + OpenHands sidecar engine.
 * Ensures strict cleanup on exit (zero orphaned processes).
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { MultiAgentToolGateway } = require('./multiagent-tool-gateway');

class MultiAgentSidecarManager {
  constructor(options = {}) {
    this.port = options.port || 55410;
    this.host = options.host || '127.0.0.1';
    this.token = crypto.randomBytes(16).toString('hex');
    this.process = null;
    this.projectRoot = options.projectRoot || path.resolve(__dirname, '..');
    this.dataDir = options.dataDir || path.join(this.projectRoot, 'multiagent-engine', 'data');
    this.pythonPath = this._resolvePython();
    this.gatewayPort = options.gatewayPort || (this.port + 20);
    this.gateway = new MultiAgentToolGateway({
      port: this.gatewayPort,
      host: this.host,
      token: this.token,
      projectRoot: this.projectRoot
    });
  }

  _resolvePython() {
    // 1. Check research_multiagent/poc_venv
    const venvPython = path.join('D:', 'PROGRAMAS IA', 'research_multiagent', 'poc_venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPython)) {
      return venvPython;
    }
    // 2. Default to python
    return 'python';
  }

  async _findFreePort(startingPort) {
    const net = require('net');
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => {
        resolve(this._findFreePort(startingPort + 1));
      });
      srv.once('listening', () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
      srv.listen(startingPort, this.host);
    });
  }

  async start() {
    if (this.process) {
      return { status: 'already_running', port: this.port };
    }

    // Start Node.js tool gateway first
    await this.gateway.start();
    this.gatewayPort = this.gateway.port;
    console.log(`[MultiAgentSidecar] Tool & Skill Gateway online at http://${this.host}:${this.gatewayPort}`);

    this.port = await this._findFreePort(this.port);

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    const scriptPath = path.join(this.projectRoot, 'multiagent-engine', 'server.py');
    const args = [
      scriptPath,
      '--host', this.host,
      '--port', String(this.port),
      '--token', this.token,
      '--data-dir', this.dataDir
    ];

    const env = {
      ...process.env,
      EDITCORE_AGENT_TOKEN: this.token,
      EDITCORE_GATEWAY_URL: `http://${this.host}:${this.gatewayPort}`,
      PYTHONUNBUFFERED: '1'
    };

    console.log(`[MultiAgentSidecar] Starting engine on ${this.host}:${this.port} using ${this.pythonPath}...`);

    this.process = spawn(this.pythonPath, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true
    });

    this.process.stdout.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.log(`[MultiAgent:out] ${line}`);
    });

    this.process.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) console.warn(`[MultiAgent:err] ${line}`);
    });

    this.process.on('close', (code) => {
      console.log(`[MultiAgentSidecar] Process exited with code ${code}`);
      this.process = null;
      this.isReady = false;
    });

    // Cleanup hook on Node exit
    this._setupCleanupHooks();

    // Poll health until online (up to 15s)
    const online = await this._waitForHealth(15000);
    if (!online) {
      this.stop();
      throw new Error('[MultiAgentSidecar] Timeout waiting for engine to become healthy');
    }

    this.isReady = true;
    console.log(`[MultiAgentSidecar] Engine is HEALTHY and READY on port ${this.port}`);
    return { status: 'ready', port: this.port, host: this.host, token: this.token };
  }

  _setupCleanupHooks() {
    const cleanup = () => this.stop();
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  async _waitForHealth(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await this._checkHealth();
        if (res && res.status === 'healthy') {
          return true;
        }
      } catch (e) {
        // Waiting for server to bind
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }

  _checkHealth() {
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: this.host,
          port: this.port,
          path: '/health',
          timeout: 2000
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Healthcheck timed out'));
      });
    });
  }

  stop() {
    if (this.process && this.process.pid) {
      const pid = this.process.pid;
      console.log(`[MultiAgentSidecar] Terminating sidecar process PID ${pid}...`);
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } else {
          this.process.kill('SIGKILL');
        }
      } catch (e) {
        // Process might already be dead
      }
      this.process = null;
      this.isReady = false;
    }
    if (this.gateway) {
      this.gateway.stop();
    }
  }

  getEndpoint() {
    return {
      baseUrl: `http://${this.host}:${this.port}`,
      token: this.token,
      isReady: this.isReady
    };
  }
}

module.exports = { MultiAgentSidecarManager };
