"use strict";

const { createCloudVaultBridge } = require("./cloud-vault-bridge");

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const TIMEOUT_MS = 10000;

class ConnectionVerifier {
  constructor(deps = {}) {
    this.getConnections = deps.getConnections || (() => ({}));
    this.getVaultCredentials = deps.getVaultCredentials || ((service) => null);
    this.cloudVaultBridge = deps.cloudVaultBridge || null;
    this.cache = new Map();
    this.customServerUrl = deps.customServerUrl || null;
  }

  async verifyAll() {
    const [github, vercel, supabase, server] = await Promise.all([
      this.verifyGithub(),
      this.verifyVercel(),
      this.verifySupabase(),
      this.verifyServer(),
    ]);

    return {
      github,
      vercel,
      supabase,
      server,
      checkedAt: new Date().toISOString(),
    };
  }

  async verifyGithub() {
    return this.cached("github", async () => {
      const creds = this.getVaultCredentials("github");
      if (!creds?.githubToken) {
        return { status: "no_configured", message: "No hay GitHub token configurado" };
      }

      try {
        const res = await fetch("https://api.github.com/user", {
          headers: {
            "Authorization": `Bearer ${creds.githubToken}`,
            "Accept": "application/vnd.github+json",
            "User-Agent": "EDITCOREAI-ConnectionVerifier",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) {
          const data = await res.json();
          return {
            status: "ok",
            user: data.login,
            name: data.name,
            id: data.id,
            message: `Conectado como @${data.login}`,
          };
        }

        const err = await res.text().catch(() => "");
        return {
          status: "error",
          code: res.status,
          message: `GitHub API error: ${res.status} ${res.statusText} ${err}`,
        };
      } catch (e) {
        return {
          status: "error",
          message: `Error de red GitHub: ${e.message}`,
        };
      }
    });
  }

  async verifyVercel() {
    return this.cached("vercel", async () => {
      const creds = this.getVaultCredentials("vercel");
      if (!creds?.vercelToken) {
        return { status: "no_configured", message: "No hay Vercel token configurado" };
      }

      try {
        const res = await fetch("https://api.vercel.com/v2/user", {
          headers: {
            "Authorization": `Bearer ${creds.vercelToken}`,
            "User-Agent": "EDITCOREAI-ConnectionVerifier",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) {
          const data = await res.json();
          return {
            status: "ok",
            user: data.user?.username || data.user?.email,
            id: data.user?.id,
            team: data.user?.teamId,
            message: `Conectado como ${data.user?.username || data.user?.email}`,
          };
        }

        const err = await res.text().catch(() => "");
        return {
          status: "error",
          code: res.status,
          message: `Vercel API error: ${res.status} ${res.statusText} ${err}`,
        };
      } catch (e) {
        return {
          status: "error",
          message: `Error de red Vercel: ${e.message}`,
        };
      }
    });
  }

  async verifySupabase() {
    return this.cached("supabase", async () => {
      const creds = this.getVaultCredentials("supabase");
      if (!creds?.selfSupabaseUrl || !creds?.selfSupabaseKey) {
        return { status: "no_configured", message: "No hay Supabase URL/Key configurados" };
      }

      // Normalizar URL: quitar /rest/v1 si existe
      let baseUrl = creds.selfSupabaseUrl;
      if (baseUrl.includes("/rest/v1")) {
        baseUrl = baseUrl.split("/rest/v1")[0];
      }
      if (baseUrl.endsWith("/")) baseUrl = baseUrl.slice(0, -1);

      try {
        // Intentar health check simple
        const res = await fetch(`${baseUrl}/rest/v1/`, {
          headers: {
            "apikey": creds.selfSupabaseKey,
            "Authorization": `Bearer ${creds.selfSupabaseKey}`,
            "User-Agent": "EDITCOREAI-ConnectionVerifier",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok || res.status === 401 || res.status === 403) {
          // 401/403 significa que el endpoint existe pero la key no tiene permisos - la conexion funciona
          return {
            status: "ok",
            url: baseUrl,
            message: `Supabase conectado: ${baseUrl}`,
          };
        }

        const err = await res.text().catch(() => "");
        return {
          status: "error",
          code: res.status,
          message: `Supabase error: ${res.status} ${res.statusText} ${err}`,
        };
      } catch (e) {
        return {
          status: "error",
          message: `Error de red Supabase: ${e.message}`,
        };
      }
    });
  }

  async verifyServer() {
    return this.cached("server", async () => {
      const creds = this.getVaultCredentials("server");
      const serverUrl = this.customServerUrl || creds?.customServerUrl || creds?.serverHost;

      if (!serverUrl) {
        return { status: "no_configured", message: "No hay servidor configurado" };
      }

      try {
        const healthUrl = `${serverUrl.replace(/\/+$/, "")}/health`;
        const res = await fetch(healthUrl, {
          headers: {
            "User-Agent": "EDITCOREAI-ConnectionVerifier",
            ...(creds?.customServerToken ? { "Authorization": `Bearer ${creds.customServerToken}` } : {}),
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          return {
            status: "ok",
            url: serverUrl,
            message: `Servidor conectado: ${serverUrl}`,
            health: data,
          };
        }

        const err = await res.text().catch(() => "");
        return {
          status: "error",
          code: res.status,
          message: `Servidor error: ${res.status} ${res.statusText} ${err}`,
        };
      } catch (e) {
        return {
          status: "error",
          message: `Error de red servidor: ${e.message}`,
        };
      }
    });
  }

  async cached(key, fn) {
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return { ...cached.value, cached: true };
    }

    const value = await fn();
    this.cache.set(key, { value, timestamp: now });
    return { ...value, cached: false };
  }

  invalidate(key) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}

function createConnectionVerifier(deps = {}) {
  return new ConnectionVerifier(deps);
}

module.exports = { ConnectionVerifier, createConnectionVerifier };
