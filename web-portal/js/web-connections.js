// Conexiones y Publicar en la web: mismo contrato que editcoreConnections / editcoreProject.fullStackDeploy de
// escritorio, pero hablando directo desde el navegador con las APIs de GitHub, Vercel y el Supabase propio del
// usuario. Los tokens son los de Conexiones (guardados en la cuenta, en este navegador); nunca salen a otro lado.
(function () {
  "use strict";

  const B = () => window.EditCoreWebBridge;
  const FS = () => window.EditCoreWebFs;
  const progressListeners = new Set();
  const emit = (payload) => progressListeners.forEach((fn) => { try { fn(payload); } catch { /* ignore */ } });

  async function connections() {
    const secure = (await window.editcoreSecureConfig.load().catch(() => ({}))) || {};
    const c = secure["editcore-connections"] || {};
    return {
      githubToken: String(c.githubToken || "").trim(),
      vercelToken: String(c.vercelToken || "").trim(),
      supabaseUrl: String(c.selfSupabaseUrl || "").trim().replace(/\/+$/, ""),
      supabaseKey: String(c.selfSupabaseKey || "").trim(),
    };
  }

  async function api(base, token, path, { method = "GET", body } = {}) {
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw Object.assign(new Error("Sin conexión con el servicio. Revisa tu internet."), { status: 0 });
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const msg = data?.message || data?.error?.message || `Error ${res.status}`;
      throw Object.assign(new Error(res.status === 401 || res.status === 403 ? `Token rechazado (${msg}). Revísalo en Conexiones.` : msg), { status: res.status, data });
    }
    return data;
  }
  const gh = (token, path, opts) => api("https://api.github.com", token, path, opts);
  const vc = (token, path, opts) => api("https://api.vercel.com", token, path, opts);

  async function supabaseCheck(url, key) {
    if (!/^https?:\/\//i.test(url)) throw new Error("La URL de Supabase debe empezar con https://");
    let res;
    try {
      res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    } catch {
      throw new Error("No responde el servidor de Supabase en esa URL.");
    }
    if (res.status === 401 || res.status === 403) throw new Error("Supabase rechazó la API Key.");
    if (res.status >= 500) throw new Error(`Supabase respondió ${res.status}.`);
    return true;
  }

  async function validate() {
    const c = await connections();
    const out = [];
    const check = async (service, configured, fn) => {
      if (!configured) return out.push({ service, configured: false, ok: false });
      try {
        out.push({ service, configured: true, ok: true, account: await fn() });
      } catch (error) {
        out.push({ service, configured: true, ok: false, error: error?.message || String(error) });
      }
    };
    await check("github", Boolean(c.githubToken), async () => (await gh(c.githubToken, "/user")).login);
    await check("vercel", Boolean(c.vercelToken), async () => {
      const u = await vc(c.vercelToken, "/v2/user");
      return u?.user?.username || u?.user?.email || "verificada";
    });
    await check("selfsupabase", Boolean(c.supabaseUrl && c.supabaseKey), async () => {
      await supabaseCheck(c.supabaseUrl, c.supabaseKey);
      return new URL(c.supabaseUrl).host;
    });
    out.push({ service: "ssh", configured: false, ok: false });
    return out;
  }

  async function operatorMemory() {
    const c = await connections();
    const lines = [];
    if (c.githubToken) lines.push("- GitHub conectado (Publicar crea el repositorio y sube los archivos del proyecto).");
    if (c.vercelToken) lines.push("- Vercel conectado (Publicar deja la app en vivo con su URL).");
    if (c.supabaseUrl && c.supabaseKey) lines.push(`- Supabase propio: ${c.supabaseUrl}`);
    return { ok: true, memory: lines.length ? `Conexiones del usuario (web):\n${lines.join("\n")}` : "" };
  }

  const metaKey = (root) => `publish|${String(root || "").replace(/\/+$/, "")}`;
  const projectSlug = (root) => String(root || "").replace(/\/+$/, "").split("/").pop() || "proyecto";

  async function assessConnections(input = {}) {
    const root = String(input.projectRoot || "");
    const c = await connections();
    const files = root ? Object.keys(await FS().all(root)) : [];
    const meta = (root && (await B().kv.get(metaKey(root)))) || {};
    return {
      ok: true,
      readyToPublish: Boolean(c.githubToken && files.length),
      connections: {
        github: { configured: Boolean(c.githubToken) },
        vercel: { configured: Boolean(c.vercelToken) },
        supabase: { configured: Boolean(c.supabaseUrl && c.supabaseKey) },
      },
      missing: [],
      remoteUrl: meta.repoUrl || "",
      liveUrl: meta.liveUrl || "",
    };
  }

  // Sube todos los archivos del proyecto en un solo commit (el repositorio queda igual que el proyecto).
  async function pushToGitHub(token, root, repoName, message) {
    const login = (await gh(token, "/user")).login;
    const name = B().slugify(repoName || projectSlug(root));
    let repo;
    try {
      repo = await gh(token, `/repos/${login}/${name}`);
    } catch (error) {
      if (error.status !== 404) throw error;
      repo = await gh(token, "/user/repos", { method: "POST", body: { name, private: true, auto_init: true, description: "Creado con EditCoreAI" } });
    }
    const branch = repo.default_branch || "main";
    let parent = null;
    for (let i = 0; i < 5 && !parent; i += 1) {
      try {
        parent = (await gh(token, `/repos/${login}/${name}/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
      } catch (error) {
        if (error.status !== 404 && error.status !== 409) throw error;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    const files = await FS().all(root);
    const tree = await gh(token, `/repos/${login}/${name}/git/trees`, {
      method: "POST",
      body: { tree: Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content: String(content) })) },
    });
    const commit = await gh(token, `/repos/${login}/${name}/git/commits`, {
      method: "POST",
      body: { message, tree: tree.sha, parents: parent ? [parent] : [] },
    });
    if (parent) await gh(token, `/repos/${login}/${name}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", body: { sha: commit.sha, force: true } });
    else await gh(token, `/repos/${login}/${name}/git/refs`, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
    return { repoUrl: repo.html_url, branch, sha: commit.sha, fileCount: Object.keys(files).length };
  }

  async function deployToVercel(token, root, name) {
    const files = await FS().all(root);
    const dep = await vc(token, "/v13/deployments?skipAutoDetectionConfirmation=1", {
      method: "POST",
      body: {
        name: B().slugify(name || projectSlug(root)),
        target: "production",
        files: Object.entries(files).map(([file, data]) => ({ file, data: String(data), encoding: "utf-8" })),
        projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
      },
    });
    let info = dep;
    for (let i = 0; i < 40 && !/READY|ERROR|CANCELED/.test(String(info.readyState || "")); i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      info = await vc(token, `/v13/deployments/${dep.id}`);
    }
    if (info.readyState === "ERROR" || info.readyState === "CANCELED") throw new Error("Vercel no pudo publicar la app. Revisa el proyecto en tu panel de Vercel.");
    const host = (Array.isArray(info.alias) && info.alias.find((a) => a.endsWith(".vercel.app"))) || info.alias?.[0] || info.url;
    return { url: host ? `https://${host}` : "", ready: info.readyState === "READY" };
  }

  async function fullStackDeploy(input = {}) {
    const root = String(input.projectRoot || "");
    const c = await connections();
    const update = input.mode === "update";
    const stages = [
      { id: "github", label: "GitHub Repo", status: "pending", percent: 0 },
      { id: "vercel", label: "Vercel Link", status: "pending", percent: 0 },
      { id: "supabase", label: "Supabase DB", status: "pending", percent: 0 },
      { id: "publish", label: "Push + Deploy", status: "pending", percent: 0 },
      { id: "live", label: "Live URL", status: "pending", percent: 0 },
    ];
    const steps = [];
    const set = (id, status, message) => {
      const s = stages.find((x) => x.id === id);
      s.status = status;
      s.percent = status === "done" || status === "skipped" ? 100 : status === "running" ? 50 : s.percent;
      if (message) s.message = message;
      const done = stages.filter((x) => x.status === "done" || x.status === "skipped").length;
      emit({ type: "stage", stages: stages.map((x) => ({ ...x })), percent: Math.round((done / stages.length) * 100), message });
    };
    const meta = (await B().kv.get(metaKey(root))) || {};
    if (!root) return { ok: false, message: "Abre un proyecto antes de publicar.", stages, steps };
    if (!c.githubToken) return { ok: false, message: "Para publicar hace falta GitHub en Conexiones.", stages, steps };
    let liveUrl = meta.liveUrl || "";
    let ok = true;
    try {
      set("github", "running", "Subiendo archivos a GitHub…");
      const pushed = await pushToGitHub(c.githubToken, root, input.repoName || meta.repoName, update ? "Actualización desde EditCoreAI" : "Publicado desde EditCoreAI");
      meta.repoUrl = pushed.repoUrl;
      meta.repoName = input.repoName || meta.repoName || projectSlug(root);
      steps.push({ step: "github", ok: true, message: `${pushed.fileCount} archivos en ${pushed.repoUrl}`, branch: pushed.branch, sha: pushed.sha });
      set("github", "done", `GitHub: ${pushed.repoUrl}`);

      if (c.vercelToken) {
        set("vercel", "running", "Publicando en Vercel…");
        set("publish", "running");
        const dep = await deployToVercel(c.vercelToken, root, meta.repoName);
        liveUrl = dep.url || liveUrl;
        steps.push({ step: "deploy_one_click", ok: true, message: dep.ready ? "App en vivo" : "Vercel sigue terminando la publicación", url: liveUrl });
        set("vercel", "done");
        set("publish", "done", "Publicado en Vercel");
      } else {
        steps.push({ step: "vercel", ok: true, skipped: true, message: "Sin Vercel en Conexiones: solo se subió a GitHub." });
        set("vercel", "skipped");
        set("publish", "done", "Subido a GitHub");
      }

      if (c.supabaseUrl && c.supabaseKey) {
        set("supabase", "running", "Revisando Supabase…");
        try {
          await supabaseCheck(c.supabaseUrl, c.supabaseKey);
          steps.push({ step: "supabase", ok: true, message: `Conectado (${new URL(c.supabaseUrl).host})` });
          set("supabase", "done");
        } catch (error) {
          steps.push({ step: "supabase", ok: false, message: error.message });
          set("supabase", "error", error.message);
        }
      } else {
        steps.push({ step: "supabase", ok: true, skipped: true, message: "Sin Supabase en Conexiones." });
        set("supabase", "skipped");
      }
      set("live", liveUrl ? "done" : "skipped", liveUrl ? `En vivo: ${liveUrl}` : "");
    } catch (error) {
      ok = false;
      const running = stages.find((s) => s.status === "running");
      if (running) set(running.id, "error", error.message);
      steps.push({ step: running?.id || "publish", ok: false, message: error?.message || String(error) });
    }
    meta.liveUrl = liveUrl;
    meta.publishedAt = Date.now();
    await B().kv.set(metaKey(root), meta);
    const message = ok ? (liveUrl ? `Publicado: ${liveUrl}` : "Subido a GitHub.") : (steps[steps.length - 1]?.message || "No se pudo publicar.");
    emit({ type: "complete", ok, stages: stages.map((x) => ({ ...x })), liveUrl, percent: ok ? 100 : undefined, message });
    return { ok, message, stages, steps, liveUrl, remoteUrl: meta.repoUrl || "" };
  }

  const ns = (name, impl) => { window[name] = Object.assign(window[name] || {}, impl); };
  ns("editcoreConnections", {
    validate,
    operatorMemory,
    async importLocal() { return { ok: true, validation: await validate(), imported: {} }; },
  });
  ns("editcoreProject", {
    assessConnections,
    fullStackDeploy,
    onFullStackProgress: (cb) => {
      if (typeof cb !== "function") return () => {};
      progressListeners.add(cb);
      return () => progressListeners.delete(cb);
    },
    async publish(input = {}) { return fullStackDeploy({ ...input, mode: "update" }); },
    async deploy(input = {}) {
      const r = await fullStackDeploy({ ...input, mode: "update" });
      return { ok: r.ok, url: r.liveUrl, provider: "vercel", message: r.message };
    },
    async connectServices(input = {}) { return fullStackDeploy({ ...input, mode: "full" }); },
    async onboard(input = {}) { return fullStackDeploy({ ...input, mode: "full" }); },
    async syncVercelEnv() { return { ok: true, skipped: true }; },
  });

  // Textos del panel Conexiones que en escritorio hablan de "esta computadora".
  document.addEventListener("DOMContentLoaded", () => {
    const p = document.querySelector("#connectionsDialog .dlg-head p");
    if (p) p.textContent = "Se guardan en tu cuenta, en este navegador; nadie más las ve. Publicar sube el proyecto a tu GitHub y lo deja en vivo con Vercel.";
  });
})();
