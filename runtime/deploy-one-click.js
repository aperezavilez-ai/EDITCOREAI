"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

/**
 * Deploy one-click usando tokens locales (Vercel/Netlify).
 * Sin APIs de pago: usa la cuenta del usuario en Conexiones.
 */

function runProcess(command, args, { cwd, env, timeoutMs = 300_000, shell = false, signal = null } = {}) {
  return new Promise((resolve, reject) => {
    // [EDITCORE-INTEGRAL-B6] Detener llega al proceso del deploy: si
    // la señal ya viene abortada, el proceso ni nace; si aborta en
    // curso, se mata el hijo y el llamador declara la cancelación.
    if (signal?.aborted) {
      const err = new Error("Deploy cancelado antes de lanzarse (Detener).");
      err.code = "DEPLOY_ABORTED";
      err.aborted = true;
      reject(err);
      return;
    }
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: shell === true,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const onAbort = () => {
      try { child.kill(); } catch {}
      const err = new Error("Deploy detenido por el usuario (Detener) mientras el proceso corría.");
      err.code = "DEPLOY_ABORTED";
      err.aborted = true;
      clearTimeout(timer);
      reject(err);
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      if (signal) { try { signal.removeEventListener("abort", onAbort); } catch {} }
      try { child.kill(); } catch {}
      reject(new Error(`Timeout deploy (${timeoutMs}ms)`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (signal) { try { signal.removeEventListener("abort", onAbort); } catch {} }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) { try { signal.removeEventListener("abort", onAbort); } catch {} }
      resolve({ code: Number(code) || 0, stdout, stderr });
    });
  });
}

/** Node real del sistema (nunca el host Electron: eso provoca spawn EINVAL / arranques raros). */
function resolveSystemNode() {
  const candidates = [];
  if (process.platform === "win32") {
    candidates.push(
      path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "node.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs", "node.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "nodejs", "node.exe"),
      path.join(os.homedir(), "scoop", "apps", "nodejs", "current", "node.exe"),
    );
  } else {
    candidates.push("/usr/local/bin/node", "/usr/bin/node");
  }
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  const exe = String(process.execPath || "");
  if (exe && !/electron|EDITCOREAI-host/i.test(exe)) return exe;
  return process.platform === "win32" ? "node.exe" : "node";
}

function detectProvider(projectRoot, requested = "") {
  const forced = String(requested || "").toLowerCase().trim();
  if (forced === "vercel" || forced === "netlify") return forced;
  if (fs.existsSync(path.join(projectRoot, "vercel.json"))) return "vercel";
  if (fs.existsSync(path.join(projectRoot, "netlify.toml"))) return "netlify";
  return "vercel";
}

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Prefiere la carpeta de la app (con .vercel o package build), no el monorepo wrapper. */
function resolveDeployRoot(projectRoot) {
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) return root;

  const nestedVercel = [];
  const nestedBuild = [];
  try {
    for (const name of fs.readdirSync(root)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const abs = path.join(root, name);
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (fs.existsSync(path.join(abs, ".vercel", "project.json"))) nestedVercel.push(abs);
      const pkg = readJsonSafe(path.join(abs, "package.json"));
      if (pkg?.scripts?.build || pkg?.scripts?.dev) nestedBuild.push(abs);
    }
  } catch { /* ignore */ }

  if (fs.existsSync(path.join(root, ".vercel", "project.json"))) return root;
  if (nestedVercel.length === 1) return nestedVercel[0];
  if (nestedBuild.length === 1) return nestedBuild[0];
  return root;
}

function readVercelIds(projectRoot, connections = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const deployRoot = resolveDeployRoot(root);
  const fromConn = {
    projectId: String(connections.vercelProjectId || "").trim(),
    orgId: String(connections.vercelOrgId || connections.vercelTeamId || "").trim(),
  };
  const infra = readJsonSafe(path.join(root, "project-infra.json"))
    || readJsonSafe(path.join(root, ".editcore", "project-infra.json"))
    || {};
  const link = readJsonSafe(path.join(deployRoot, ".vercel", "project.json"))
    || readJsonSafe(path.join(root, ".vercel", "project.json"))
    || {};
  // Prioridad: .vercel local (fuente de verdad CLI) > infra > conexiones.
  // Evita IDs stale/mock en project-infra.json que rompen el deploy.
  const projectId = String(link.projectId || infra.vercelProjectId || fromConn.projectId || "").trim();
  const orgId = String(
    link.orgId
    || infra.vercelOrgId
    || infra.vercelTeamId
    || fromConn.orgId
    || "",
  ).trim();
  return {
    deployRoot,
    projectId,
    orgId,
    projectName: String(link.projectName || infra.vercelProjectName || "").trim(),
  };
}

function summarizeDeployFailure(combined = "", exitCode = 1) {
  const text = String(combined || "").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const useful = lines.filter((l) => !/^Vercel CLI/i.test(l) && !/^Retrieving project/i.test(l)).slice(-12);
  const snippet = useful.join(" | ").slice(0, 500);
  return snippet || `Deploy fallo (exit ${exitCode}).`;
}

function sanitizeEnv(extra = {}) {
  const out = {};
  for (const [key, value] of Object.entries(extra || {})) {
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

// ============================================================
// [EDITCORE-CONSOLIDADA] PUBLICACIÓN VERIFICADA. El deploy que
// «termina bien» para la CLI puede dejar la app CAÍDA: ALFA LUBES
// quedó en 500 en producción (init_db duplicado + BD efímera
// serverless: «no such table: products») y el agente lo intentó 7
// veces A CIEGAS, porque este camino lanzaba el Vercel CLI y
// terminaba — sin comprobar jamás que la URL respondiera y sin
// ninguna vía para leer los logs del despliegue. Ahora todo deploy
// con URL pasa por el humo: GET real a la URL (y rutas pedidas);
// si algo da >= 500 o la red falla, el resultado es FALLO de
// publicación (ok:false, publishFailed/productionDown) con la
// evidencia del humo y un extracto de los logs del despliegue
// (API de Vercel con el MISMO token que usa el deploy). Nunca más
// un éxito falso sobre una producción caída.
// ============================================================
const SMOKE_TIMEOUT_MS = 10_000;
const SMOKE_RETRY_DELAY_MS = 3_000;
const DEPLOY_LOGS_CAP = 4_000;

async function fetchVercelDeploymentLogs({ token = "", projectId = "", orgId = "", fetchImpl } = {}) {
  if (!token || !projectId) {
    return { logs: null, note: "Sin token o projectId de Vercel para consultar los logs del despliegue." };
  }
  const headers = { Authorization: `Bearer ${token}` };
  const teamQ = orgId ? `&teamId=${encodeURIComponent(orgId)}` : "";
  try {
    const listRes = await fetchImpl(
      `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1${teamQ}`,
      { headers, signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS) },
    );
    if (!listRes?.ok) return { logs: null, note: `Vercel no devolvió el listado de despliegues (HTTP ${listRes?.status || "?"}).` };
    const listJson = await listRes.json().catch(() => null);
    const dep = (Array.isArray(listJson?.deployments) ? listJson.deployments : [])[0];
    const depId = dep?.uid || dep?.id || "";
    if (!depId) return { logs: null, note: "No se encontró un despliegue reciente en Vercel para este proyecto." };
    const evRes = await fetchImpl(
      `https://api.vercel.com/v2/deployments/${encodeURIComponent(depId)}/events?limit=500&direction=backward${teamQ}`,
      { headers, signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS) },
    );
    if (!evRes?.ok) return { logs: null, note: `Vercel no devolvió los eventos del despliegue (HTTP ${evRes?.status || "?"}).` };
    const events = await evRes.json().catch(() => null);
    const lines = (Array.isArray(events) ? events : [])
      .map((e) => String((e?.payload?.text ?? e?.text ?? (typeof e === "string" ? e : "")) || "").replace(/\s+$/g, ""))
      .filter((l) => l.trim());
    const text = lines.join("\n").trim();
    if (!text) return { logs: null, note: "El despliegue no devolvió líneas de log." };
    return { logs: text.slice(-DEPLOY_LOGS_CAP), note: "" };
  } catch (e) {
    return { logs: null, note: `No se pudieron obtener los logs de Vercel (${String(e?.message || e).slice(0, 120)}).` };
  }
}

function firstLogErrorLine(logs = "") {
  const lines = String(logs || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  // Primero la línea de excepción CON mensaje («…Error: no such table:
  // products»): es la causa accionable. La cabecera «Traceback…» sola
  // no diagnostica nada, así que no gana aunque aparezca antes.
  const withMessage = lines.find((l) => /[\w.]*(?:Error|Exception|Fault)\s*:\s*\S/i.test(l));
  if (withMessage) return withMessage.slice(0, 300);
  const hit = lines.find((l) => /error|exception|traceback|no such|failed|fatal|unhandled|crash/i.test(l));
  return String(hit || lines[lines.length - 1]).slice(0, 300);
}

// [EDITCORE-INTEGRAL-B8] El humo distingue «responde» de «es la
// app»: 401/403/404 en la RUTA PRINCIPAL ya no cuentan como sano.
//   - down:        status 0 (sin respuesta) o >= 500 en cualquier ruta.
//   - notVerified: la ruta principal responde 401 (SSO), 403 (WAF) o
//                  404 (esa ruta no es la app): hay un servidor, pero
//                  la publicación NO queda verificada.
//   - verified:    la ruta principal responde 2xx/3xx y nada está down.
// Las rutas secundarias conservan su trato: su 401/403/404 no
// desverifica (pueden ser rutas con su propia auth); su caída
// (0/5xx) sí sigue contando como down, como hasta ahora.
const SMOKE_NOT_VERIFIED_STATUSES = [401, 403, 404];

function classifySmoke(smoke = []) {
  const list = Array.isArray(smoke) ? smoke : [];
  const down = list.filter((s) => s.status === 0 || s.status >= 500);
  if (down.length) return { state: "down", verified: false, down, notVerified: [] };
  const main = list[0];
  if (main && SMOKE_NOT_VERIFIED_STATUSES.includes(main.status)) {
    const cause = main.status === 404
      ? `la ruta principal devolvió 404: responde un servidor pero no es la app`
      : main.status === 401
        ? `la ruta principal devolvió 401: responde un servidor pero la app queda tras autenticación (p. ej. SSO de Vercel), no se pudo verificar`
        : `la ruta principal devolvió 403: responde un servidor pero un WAF/proxy bloquea la verificación`;
    return { state: "notVerified", verified: false, down: [], notVerified: [main], cause };
  }
  return { state: "verified", verified: true, down: [], notVerified: [] };
}

async function verifyProductionDeploy({ url, routes = [], provider = "", token = "", projectId = "", orgId = "", deps = {} } = {}) {
  const fetchImpl = typeof deps?.fetchImpl === "function" ? deps.fetchImpl : ((...a) => fetch(...a));
  const sleep = typeof deps?.sleepImpl === "function" ? deps.sleepImpl : ((ms) => new Promise((r) => setTimeout(r, ms)));
  const targets = [String(url || "")].filter(Boolean);
  try {
    const origin = new URL(url).origin;
    for (const r of Array.isArray(routes) ? routes : []) {
      const p = String(r || "").trim();
      if (!p) continue;
      const full = /^https?:\/\//i.test(p) ? p : `${origin}${p.startsWith("/") ? p : `/${p}`}`;
      if (!targets.includes(full)) targets.push(full);
    }
  } catch { /* URL inválida: el humo la reportará como sin respuesta */ }
  const checkAll = async () => {
    const out = [];
    for (const t of targets) {
      try {
        const res = await fetchImpl(t, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS) });
        out.push({ url: t, status: Number(res?.status) || 0 });
      } catch (e) {
        out.push({ url: t, status: 0, error: String(e?.message || e).slice(0, 160) });
      }
    }
    return out;
  };
  let smoke = await checkAll();
  const isDown = () => smoke.some((s) => s.status === 0 || s.status >= 500);
  if (isDown()) {
    // Un solo reintento: la propagación del despliegue y el arranque
    // en frío serverless pueden dar un 5xx transitorio al principio.
    await sleep(SMOKE_RETRY_DELAY_MS);
    smoke = await checkAll();
  }
  if (!isDown()) {
    // [EDITCORE-INTEGRAL-B8] Responder no basta: 401/403/404 en la
    // ruta principal = NO verificado (la causa viaja en el resultado).
    const verdict = classifySmoke(smoke);
    if (verdict.state === "notVerified") {
      return { ok: true, verified: false, smokeNotVerified: true, smokeCause: verdict.cause, smoke };
    }
    return { ok: true, verified: true, smoke };
  }
  let logs = null;
  let logsNote = "";
  if (provider === "vercel") {
    const got = await fetchVercelDeploymentLogs({ token, projectId, orgId, fetchImpl });
    logs = got.logs;
    logsNote = got.note || "";
  } else {
    logsNote = "Los logs automáticos post-despliegue solo están implementados para Vercel; revisa el panel del proveedor.";
  }
  return { ok: false, smoke, logs, logsNote };
}

async function applyPostDeployVerification(base, { provider = "", production = true, token = "", projectId = "", orgId = "", routes = [], deps = {} } = {}) {
  let verdict = null;
  try {
    verdict = await verifyProductionDeploy({ url: base.url, routes, provider, token, projectId, orgId, deps });
  } catch { verdict = null; }
  if (!verdict) {
    return { ...base, verified: false, smoke: [], smokeNote: "La verificación post-despliegue (humo) no pudo ejecutarse; el deploy terminó pero su salud no quedó comprobada." };
  }
  if (verdict.ok && verdict.smokeNotVerified) {
    // [EDITCORE-INTEGRAL-B8] El deploy SÍ terminó y la URL responde,
    // pero no es verificable como la app: NO es productionDown (eso
    // sigue siendo >=500/sin respuesta, con su camino intacto) y NO
    // se declara «publicación verificada». ok queda en true porque
    // el despliegue ocurrió; verified:false dice la verdad del humo.
    return {
      ...base,
      verified: false,
      smokeNotVerified: true,
      smokeCause: verdict.smokeCause || "",
      smoke: verdict.smoke,
      message: `Deploy terminado y la URL responde, pero la publicación NO quedó verificada: ${verdict.smokeCause || "la ruta principal no devolvió la app"}. No la des por verificada: revisa la protección de acceso (SSO/WAF) o que la ruta principal sea la de la app.`,
    };
  }
  if (verdict.ok) return { ...base, verified: true, smoke: verdict.smoke };
  const bad = verdict.smoke.filter((s) => s.status === 0 || s.status >= 500);
  const states = bad.map((s) => `GET ${s.url} → ${s.status === 0 ? (s.error || "sin respuesta") : `HTTP ${s.status}`}`).join("; ");
  const firstError = firstLogErrorLine(verdict.logs || "");
  const message = production
    ? `El deploy terminó, pero PRODUCCIÓN ESTÁ CAÍDA: ${states}. Esto NO es un deploy exitoso: es una tarea de REPARACIÓN PRIORITARIA. Diagnostica la causa desde los logs del despliegue (campo logs de este resultado), corrígela en el código, verifica en local y vuelve a publicar. No des la publicación por buena.`
    : `El deploy terminó, pero LA URL DEL DESPLIEGUE NO RESPONDE: ${states}. Esto NO es un deploy exitoso: diagnostica la causa desde los logs del despliegue (campo logs de este resultado) antes de darlo por bueno.`;
  // Orden de claves DELIBERADO: el chat recorta el resultado de la
  // herramienta a 2.000 caracteres POR LA CABEZA — lo crítico
  // (veredicto, estados, primera línea de error) va primero; el
  // extracto completo de logs (<= 4.000) viaja detrás para las rutas
  // sin ese recorte (confirmación del usuario, pipeline de Publicar).
  return {
    ok: false,
    publishFailed: true,
    productionDown: production === true,
    // [EDITCORE-INTEGRAL-B8] Caído = tampoco verificado.
    verified: false,
    message,
    smoke: verdict.smoke,
    ...(firstError ? { firstLogError: firstError } : {}),
    logs: verdict.logs,
    ...(verdict.logsNote ? { logsNote: verdict.logsNote } : {}),
    available: base.available,
    provider: base.provider,
    url: base.url,
    exitCode: base.exitCode,
    deployRoot: base.deployRoot,
    projectId: base.projectId,
    output: base.output,
  };
}

async function deployOneClick(projectRoot, input = {}, { connections = {}, deps = {}, signal = null } = {}) {
  const run = typeof deps?.runProcessImpl === "function" ? deps.runProcessImpl : runProcess;
  // [EDITCORE-INTEGRAL-B6] La señal del turno viaja también en
  // input/deps por las costuras de prueba; una sola fuente efectiva.
  const turnSignal = signal || input?.signal || deps?.signal || null;
  const root = path.resolve(String(projectRoot || ""));
  if (!root || !fs.existsSync(root)) throw new Error("deploy_one_click requiere projectRoot valido.");
  // [EDITCORE-INTEGRAL-B8] Compatibilidad declarada: el esquema viejo
  // del kernel definía un único parámetro `target` y hay llamadores
  // vivos con {target:"vercel"} (cloud-vault-bridge). Se traduce aquí,
  // en el consumidor: target="vercel"|"netlify" ⇒ provider;
  // target="production" ⇒ production:true. El esquema nuevo
  // (provider/production) manda cuando viene presente.
  const legacyTarget = typeof input?.target === "string" ? input.target.trim().toLowerCase() : "";
  const provider = detectProvider(root, input.provider || (legacyTarget === "vercel" || legacyTarget === "netlify" ? legacyTarget : ""));
  const production = input.production !== undefined ? input.production !== false : legacyTarget !== "preview";
  // [EDITCORE-INTEGRAL-B6] Abortada ANTES de lanzar ⇒ no publica.
  if (turnSignal?.aborted) {
    return { ok: false, aborted: true, cancelledBeforeLaunch: true, available: true, provider, message: "Deploy cancelado antes de lanzarse (Detener): no se publicó nada." };
  }
  let deployLaunched = false;

  if (provider === "vercel") {
    const token = String(connections.vercelToken || process.env.VERCEL_TOKEN || "").trim();
    if (!token) {
      return {
        ok: false,
        available: false,
        provider,
        message: "Vercel no configurado. Añade el token en Conexiones (vercel.com/account/tokens).",
      };
    }
    const ids = readVercelIds(root, connections);
    const deployRoot = ids.deployRoot || root;
    const vercelArgs = ["--yes"];
    if (production) vercelArgs.push("--prod");
    let command;
    let commandArgs;
    let shell = false;
    // Preferir vercel empaquetado en EditCoreAI + Node del sistema (nunca Electron host).
    const nodeBin = resolveSystemNode();
    let vcJs = "";
    try {
      vcJs = require.resolve("vercel/dist/vc.js");
    } catch {
      const localVc = path.join(__dirname, "..", "node_modules", "vercel", "dist", "vc.js");
      if (fs.existsSync(localVc)) vcJs = localVc;
    }
    if (vcJs) {
      command = nodeBin;
      commandArgs = [vcJs, ...vercelArgs];
      shell = false;
    } else if (process.platform === "win32") {
      const comspec = process.env.ComSpec || "cmd.exe";
      command = comspec;
      commandArgs = ["/d", "/s", "/c", ["npx", "--yes", "vercel", ...vercelArgs].join(" ")];
      shell = false;
    } else {
      command = "npx";
      commandArgs = ["--yes", "vercel", ...vercelArgs];
      shell = false;
    }
    try {
      deployLaunched = true;
      const result = await run(command, commandArgs, {
        cwd: deployRoot,
        shell,
        signal: turnSignal || undefined,
        env: sanitizeEnv((() => {
          const envExtra = { VERCEL_TOKEN: token };
          // Vercel exige ORG_ID + PROJECT_ID juntos; si falta uno, no enviar ninguno
          // y dejar que la CLI use .vercel/project.json del cwd.
          if (ids.projectId && ids.orgId) {
            envExtra.VERCEL_PROJECT_ID = ids.projectId;
            envExtra.VERCEL_ORG_ID = ids.orgId;
          }
          return envExtra;
        })()),
        timeoutMs: 480_000,
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      const urlMatch = combined.match(/https:\/\/[^\s"'<>]+\.vercel\.app(?:\/[^\s"'<>]*)?/i);
      const ok = result.code === 0;
      const cleanUrl = urlMatch ? urlMatch[0].replace(/[).,",']+$/g, "") : "";
      const base = {
        ok,
        available: true,
        provider: "vercel",
        url: cleanUrl,
        exitCode: result.code,
        deployRoot,
        projectId: ids.projectId,
        output: combined.slice(-4000),
        message: ok
          ? (cleanUrl ? `Deploy OK → ${cleanUrl}` : "Deploy OK")
          : summarizeDeployFailure(combined, result.code),
      };
      // [EDITCORE-INTEGRAL-B6] El request YA salió cuando la
      // cancelación llega tras el proceso: no se puede «des-enviar»
      // — el resultado lo DICE (riesgo (d) del Bloque 6), nunca lo
      // oculta tras un «cancelado» a secas.
      if (turnSignal?.aborted && deployLaunched) {
        return { ...base, cancellationLate: true, abortedAfterLaunch: true, message: `La cancelación llegó tarde: el despliegue ${cleanUrl || "de Vercel"} sí salió. ${base.message}` };
      }
      // [EDITCORE-CONSOLIDADA] Humo post-despliegue: la CLI puede
      // decir «OK» con la app caída (error de runtime, no de build).
      if (ok && cleanUrl) {
        return await applyPostDeployVerification(base, {
          provider: "vercel",
          production,
          token,
          projectId: ids.projectId,
          orgId: ids.orgId,
          routes: Array.isArray(input.smokeRoutes) ? input.smokeRoutes : [],
          deps,
        });
      }
      return base;
    } catch (error) {
      const msg = String(error?.message || error).slice(0, 400);
      // [EDITCORE-INTEGRAL-B6] Aborto en curso: el proceso se mató,
      // pero el request pudo haber llegado ya al proveedor — se
      // declara la incertidumbre en vez de prometer «no salió».
      if (error?.aborted || error?.code === "DEPLOY_ABORTED" || turnSignal?.aborted) {
        return { ok: false, aborted: true, abortedAfterLaunch: deployLaunched, available: true, provider: "vercel", deployRoot, projectId: ids.projectId, message: deployLaunched ? "Deploy detenido a mitad de proceso: el proceso local se mató, pero el despliegue pudo haber llegado ya a Vercel — verifícalo en el panel antes de reintentar." : "Deploy cancelado antes de lanzarse (Detener): no se publicó nada." };
      }
      return {
        ok: false,
        available: true,
        provider: "vercel",
        deployRoot,
        projectId: ids.projectId,
        message: /EINVAL/i.test(msg)
          ? "No se pudo lanzar Vercel CLI en Windows (spawn EINVAL). Revisa que Node/npx estén en PATH o reinstala Node.js."
          : msg,
        hint: "Instala Node.js + Vercel CLI (`npm i -g vercel`) y verifica el token en Conexiones.",
      };
    }
  }

  if (provider === "netlify") {
    const token = String(connections.netlifyToken || process.env.NETLIFY_AUTH_TOKEN || "").trim();
    if (!token) {
      return {
        ok: false,
        available: false,
        provider,
        message: "Netlify no configurado. Anade netlifyToken en Conexiones (token personal gratis).",
      };
    }
    const args = ["deploy"];
    if (production) args.push("--prod");
    if (connections.netlifySiteId) args.push("--site", String(connections.netlifySiteId));
    args.push("--dir", String(input.dir || "dist"));
    try {
      deployLaunched = true;
      const result = await run(
        process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "netlify",
        process.platform === "win32"
          ? ["/d", "/s", "/c", ["netlify", ...args].join(" ")]
          : args,
        {
          cwd: root,
          shell: false,
          signal: turnSignal || undefined,
          env: sanitizeEnv({ NETLIFY_AUTH_TOKEN: token }),
        },
      );
      const combined = `${result.stdout}\n${result.stderr}`;
      const urlMatch = combined.match(/https:\/\/[^\s]+\.netlify\.app[^\s]*/i);
      const base = {
        ok: result.code === 0,
        available: true,
        provider: "netlify",
        url: urlMatch ? urlMatch[0].replace(/[).,]+$/, "") : "",
        exitCode: result.code,
        output: combined.slice(-4000),
        message: result.code === 0 ? "Deploy OK" : summarizeDeployFailure(combined, result.code),
      };
      // [EDITCORE-INTEGRAL-B6] Cancelación tardía declarada (Netlify).
      if (turnSignal?.aborted && deployLaunched) {
        return { ...base, cancellationLate: true, abortedAfterLaunch: true, message: `La cancelación llegó tarde: el despliegue ${base.url || "de Netlify"} sí salió. ${base.message}` };
      }
      // [EDITCORE-CONSOLIDADA] Humo post-despliegue también en Netlify
      // (sin logs automáticos: verifyProductionDeploy lo anota).
      if (base.ok && base.url) {
        return await applyPostDeployVerification(base, {
          provider: "netlify",
          production,
          routes: Array.isArray(input.smokeRoutes) ? input.smokeRoutes : [],
          deps,
        });
      }
      return base;
    } catch (error) {
      // [EDITCORE-INTEGRAL-B6] Aborto en curso (Netlify).
      if (error?.aborted || error?.code === "DEPLOY_ABORTED" || turnSignal?.aborted) {
        return { ok: false, aborted: true, abortedAfterLaunch: deployLaunched, available: true, provider: "netlify", message: deployLaunched ? "Deploy detenido a mitad de proceso: el proceso local se mató, pero el despliegue pudo haber llegado ya a Netlify — verifícalo en el panel antes de reintentar." : "Deploy cancelado antes de lanzarse (Detener): no se publicó nada." };
      }
      return {
        ok: false,
        available: true,
        provider: "netlify",
        message: String(error?.message || error).slice(0, 400),
      };
    }
  }

  return { ok: false, available: false, provider, message: `Proveedor de deploy no soportado: ${provider}` };
}

module.exports = {
  deployOneClick,
  detectProvider,
  resolveDeployRoot,
  readVercelIds,
  resolveSystemNode,
  // [EDITCORE-CONSOLIDADA] Verificación post-despliegue (probable).
  verifyProductionDeploy,
  fetchVercelDeploymentLogs,
  // [EDITCORE-INTEGRAL-B8] Clasificación del humo (responde ≠ es la app).
  classifySmoke,
  SMOKE_NOT_VERIFIED_STATUSES,
};
