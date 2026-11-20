/**
 * EditCore AI - MultiAgent Tool & Skill Gateway
 * Bridges the Python MultiAgent Engine with the full suite of 74 Node.js tools
 * and 100+ Skills installed in EditCore AI.
 */

const http = require('http');
const { DEFINITIONS, execute } = require('./tools/tools');
const { listAllSkills, loadSkillBody } = require('./skills-engine');

class MultiAgentToolGateway {
  constructor(options = {}) {
    this.port = options.port || 55430;
    this.host = options.host || '127.0.0.1';
    this.token = options.token || '';
    this.server = null;
    this.defaultProjectRoot = options.projectRoot || process.cwd();
  }

  async start() {
    if (this.server) return { status: 'already_running', port: this.port };

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Authenticate request
        const reqToken = req.headers['x-editcore-token'];
        if (this.token && reqToken !== this.token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Unauthorized gateway access' }));
        }

        const url = new URL(req.url, `http://${this.host}:${this.port}`);

        try {
          // 1. GET /api/tools - List all 74 tools
          if (req.method === 'GET' && url.pathname === '/api/tools') {
            const toolList = DEFINITIONS.map((d) => ({
              name: d?.function?.name || d?.name,
              description: d?.function?.description || d?.description || '',
              parameters: d?.function?.parameters || d?.parameters || {}
            })).filter((t) => t.name);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ tools: toolList, count: toolList.length }));
          }

          // 2. POST /api/tools/execute - Execute any of the 74 tools
          if (req.method === 'POST' && url.pathname === '/api/tools/execute') {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', async () => {
              try {
                const data = JSON.parse(body || '{}');
                const toolName = data.tool;
                const toolArgs = data.args || {};
                const root = data.projectRoot || this.defaultProjectRoot;
                const allowWrite = data.allowWrite !== false;
                const helpers = data.helpers || {};

                if (!toolName) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  return res.end(JSON.stringify({ ok: false, error: 'Missing "tool" field' }));
                }

                const result = await execute(toolName, toolArgs, root, allowWrite, helpers);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: true, result }));
              } catch (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ ok: false, error: err.message }));
              }
            });
            return;
          }

          // 3. GET /api/skills - List all skills
          if (req.method === 'GET' && url.pathname === '/api/skills') {
            const skills = listAllSkills(this.defaultProjectRoot);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ skills, count: skills.length }));
          }

          // 4. GET /api/skills/:slug - Load specific skill body
          if (req.method === 'GET' && url.pathname.startsWith('/api/skills/')) {
            const slug = url.pathname.replace('/api/skills/', '').trim();
            const skillBody = loadSkillBody(slug, this.defaultProjectRoot);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ slug, content: skillBody }));
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      const tryListen = (p) => {
        const onErr = (err) => {
          this.server.removeListener('listening', onListen);
          if (err.code === 'EADDRINUSE') {
            this.port = p + 1;
            tryListen(this.port);
          } else {
            reject(err);
          }
        };
        const onListen = () => {
          this.server.removeListener('error', onErr);
          this.port = p;
          resolve({ status: 'running', port: this.port, host: this.host });
        };
        this.server.once('error', onErr);
        this.server.once('listening', onListen);
        this.server.listen(p, this.host);
      };

      tryListen(this.port);
    });
  }

  stop() {
    if (this.server) {
      try {
        this.server.close();
      } catch (e) {}
      this.server = null;
    }
  }
}

module.exports = { MultiAgentToolGateway };
