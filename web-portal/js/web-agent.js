// Agente de la web: mismo contrato que editcoreAgent/editcoreChat del preload de escritorio, contra la IA del
// servidor de EditCoreAI (saldo del usuario) y con herramientas sobre los archivos del proyecto en el navegador.
(function () {
  "use strict";

  const C = window.EditCoreCuentas;
  const FS = () => window.EditCoreWebFs;
  const MAX_STEPS = 40;
  const TOOL_RESULT_LIMIT = 24000;
  const WRITE_TOOLS = new Set(["write_file", "replace_in_file", "delete_file"]);

  const sets = {
    progress: new Set(), thought: new Set(), exploreStart: new Set(), exploreEnd: new Set(),
    diffProposed: new Set(), diffApplied: new Set(), taskComplete: new Set(), complete: new Set(),
    error: new Set(), approval: new Set(), chunk: new Set(),
  };
  const emit = (set, payload) => set.forEach((fn) => { try { fn(payload); } catch (error) { console.warn("[web-agent]", error); } });
  const listen = (set) => (cb) => {
    if (typeof cb !== "function") return () => {};
    set.add(cb);
    return () => set.delete(cb);
  };
  const runs = new Map();
  const approvals = new Map();
  let chatController = null;

  const cloudBase = () => `${String(window.EDITCOREAI_CUENTAS?.url || "").replace(/\/+$/, "")}/functions/v1/ai-proxy/v1`;

  function codeError(code, message, status = 0) {
    return Object.assign(new Error(message), { code, status });
  }

  async function resolveModel(requested) {
    const wanted = String(requested || "").replace(/^(?:meai|apicredits)\//i, "").trim();
    let list = [];
    try { list = await C.listModels(); } catch { list = []; }
    if (wanted && wanted.toLowerCase() !== "auto" && (!list.length || list.includes(wanted))) return wanted;
    return list.find((m) => /claude-sonnet-4[.-]6/i.test(m)) || list.find((m) => /claude-sonnet/i.test(m)) || list[0] || wanted;
  }

  // Marcas de caché (system, primer mensaje del usuario y el último user/tool): el proveedor relee ese prefijo
  // a una fracción del precio en los pasos siguientes del mismo turno y en turnos seguidos.
  function withCacheControl(messages) {
    let rolling = -1;
    for (let i = messages.length - 1; i > 1; i -= 1) {
      const m = messages[i];
      if ((m?.role === "user" || m?.role === "tool") && typeof m.content === "string" && m.content) { rolling = i; break; }
    }
    return messages.map((msg, idx) => {
      if (typeof msg.content !== "string" || !msg.content) return msg;
      if (msg.role === "system" || (msg.role === "user" && idx <= 1) || idx === rolling) {
        return { ...msg, content: [{ type: "text", text: msg.content, cache_control: { type: "ephemeral" } }] };
      }
      return msg;
    });
  }

  // Sin datos del servidor durante este tiempo se corta el intento (y se reintenta si aún no se mostró texto).
  const IDLE_TIMEOUT_MS = 180000;

  // Llamada en streaming compatible con OpenAI, con herramientas. Devuelve texto, llamadas a herramientas y uso.
  async function completion({ model, messages, tools, signal: outerSignal, onDelta }) {
    const idleCtl = new AbortController();
    let idleTimer = null;
    let idleFired = false;
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idleFired = true; idleCtl.abort(); }, IDLE_TIMEOUT_MS);
    };
    const onOuterAbort = () => idleCtl.abort();
    if (outerSignal?.aborted) idleCtl.abort();
    else outerSignal?.addEventListener?.("abort", onOuterAbort, { once: true });
    touch();
    try {
      return await completionAttempt({ model, messages, tools, signal: idleCtl.signal, onDelta, touch, isIdle: () => idleFired && !outerSignal?.aborted });
    } catch (error) {
      if (idleFired && !outerSignal?.aborted) throw codeError("STREAM_CUT", "La IA dejó de responder. Intenta de nuevo o elige otro modelo.");
      throw error;
    } finally {
      clearTimeout(idleTimer);
      outerSignal?.removeEventListener?.("abort", onOuterAbort);
    }
  }

  async function completionAttempt({ model, messages, tools, signal, onDelta, touch, isIdle }) {
    const send = async (token) => fetch(`${cloudBase()}/chat/completions`, {
      method: "POST",
      headers: { apikey: window.EDITCOREAI_CUENTAS?.anonKey || "", Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model, messages: withCacheControl(messages), stream: true, stream_options: { include_usage: true }, ...(tools?.length ? { tools, tool_choice: "auto" } : {}) }),
      signal,
    });
    let token = await C.getAccessToken();
    if (!token) throw codeError("NO_SESSION", "Inicia sesión con Google para continuar.");
    let res;
    try {
      res = await send(token);
      if (res.status === 401) {
        token = await C.getAccessToken({ forceRefresh: true });
        if (!token) throw codeError("SESSION_EXPIRED", "Tu sesión expiró. Vuelve a iniciar sesión.", 401);
        res = await send(token);
      }
    } catch (error) {
      if (error?.name === "AbortError" || error?.code) throw error;
      throw codeError("NETWORK", "No hay conexión con el servidor de EditCoreAI. Intenta de nuevo en un momento.");
    }
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      const err = data?.error;
      const code = (typeof err === "object" && err?.code) || (res.status === 402 ? "OUT_OF_CREDITS" : "SERVER");
      const message = code === "OUT_OF_CREDITS"
        ? "Tu saldo no alcanza para esta consulta. Recarga para seguir usando la IA de EditCoreAI."
        : String((typeof err === "object" ? err?.message : err) || data?.message || "El servidor de EditCoreAI no respondió. Intenta de nuevo.");
      throw codeError(code, message, res.status);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let finish = "";
    let usage = null;
    const calls = [];
    const handle = (line) => {
      const payload = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!payload || payload === "[DONE]") return;
      let chunk;
      try { chunk = JSON.parse(payload); } catch { return; }
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const delta = choice.delta || {};
      if (delta.content) {
        content += delta.content;
        onDelta?.(delta.content);
      }
      for (const tc of delta.tool_calls || []) {
        const i = Number.isInteger(tc.index) ? tc.index : calls.length;
        calls[i] ||= { id: "", name: "", arguments: "" };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].name += tc.function.name;
        if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
      }
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        touch();
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) handle(line);
      }
      if (buffer) handle(buffer);
    } catch (error) {
      if (error?.name === "AbortError") {
        // Se colgó a mitad de una respuesta ya visible: se conserva el texto y se marca como cortada.
        if (isIdle() && content.trim()) return { content, toolCalls: [], finish: "cut", usage };
        throw error;
      }
    }
    const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));
    if (!content.trim() && !toolCalls.length) throw codeError("STREAM_CUT", "La IA cortó la respuesta antes de terminar. Intenta de nuevo o elige otro modelo.");
    return { content, toolCalls, finish: finish || "cut", usage };
  }

  const RETRYABLE = new Set(["STREAM_CUT", "NETWORK"]);
  async function completionWithRetry(args, retries = 2) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await completion(args);
      } catch (error) {
        const transient = RETRYABLE.has(error?.code) || [429, 502, 503, 504].includes(Number(error?.status));
        if (error?.name === "AbortError" || !transient || attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }

  const TOOLS = [
    { name: "list_files", description: "Lista archivos y carpetas del proyecto. path relativo a la raíz ('' = raíz).", parameters: { type: "object", properties: { path: { type: "string" } } } },
    { name: "read_file", description: "Lee un archivo del proyecto.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "search_files", description: "Busca texto en los archivos del proyecto. Devuelve archivo, línea y fragmento.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "write_file", description: "Crea o reemplaza un archivo completo del proyecto.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
    { name: "replace_in_file", description: "Reemplaza un fragmento exacto de un archivo (old_text debe existir tal cual).", parameters: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
    { name: "delete_file", description: "Borra un archivo o carpeta del proyecto.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    { name: "check_connections", description: "Estado real de las conexiones (GitHub, Vercel, Supabase) y de la publicación del proyecto, con los pasos que faltan. No muestra tokens. Llámalo antes de guiar al usuario a conectar o publicar.", parameters: { type: "object", properties: {} } },
    { name: "publish_project", description: "Publica el proyecto: sube todos los archivos a un repositorio privado de GitHub del usuario (lo crea si no existe) y, si Vercel está conectado, lo deja en vivo y devuelve la URL. Siempre pide confirmación al usuario.", parameters: { type: "object", properties: { repoName: { type: "string" } } } },
  ];
  const EXTERNAL_TOOLS = new Set(["publish_project"]);
  const toolDefs = (allowWrite) => TOOLS.filter((t) => allowWrite || (!WRITE_TOOLS.has(t.name) && !EXTERNAL_TOOLS.has(t.name))).map((t) => ({ type: "function", function: t }));

  function unifiedDiff(before, after) {
    const lines = [];
    for (const line of String(before || "").split("\n").slice(0, 40)) if (before) lines.push(`-${line}`);
    for (const line of String(after || "").split("\n").slice(0, 80)) lines.push(`+${line}`);
    return lines.join("\n");
  }

  function askApproval(runId, message, detail, diff) {
    const requestId = `web-approval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return new Promise((resolve) => {
      approvals.set(requestId, resolve);
      emit(sets.approval, { requestId, runId, message, detail, diff });
    });
  }

  async function execTool(name, args, ctx) {
    const fs = FS();
    const root = ctx.root;
    const rel = (value) => fs.relFromAny(root, value);
    switch (name) {
      case "check_connections": {
        const a = await window.editcoreProject.assessConnections({ projectRoot: root });
        const services = { github: Boolean(a.connections?.github?.configured), vercel: Boolean(a.connections?.vercel?.configured), supabase: Boolean(a.connections?.supabase?.configured) };
        const nextSteps = [];
        if (!services.github) nextSteps.push("Conectar GitHub: ⚙ Conexiones → GitHub → pegar un token de github.com/settings/tokens (permiso «repo»).");
        if (!services.vercel) nextSteps.push("Conectar Vercel: ⚙ Conexiones → Vercel → pegar un token de vercel.com/account/tokens.");
        if (services.github) nextSteps.push(a.liveUrl ? "Ya está publicado: publish_project sube los cambios nuevos." : "Publicar: llamar publish_project.");
        return { ok: true, services, repo: a.remoteUrl || "", liveUrl: a.liveUrl || "", readyToPublish: a.readyToPublish, nextSteps };
      }
      case "publish_project": {
        if (!ctx.allowWrite) throw new Error("Publicar requiere un modo con permiso de cambios.");
        const project = root.split("/").pop();
        const ok = await askApproval(ctx.runId, `El agente quiere publicar «${project}» en tu GitHub y dejarlo en vivo`, project, "");
        if (!ok) throw new Error("Publicación cancelada por el usuario.");
        const r = await window.editcoreProject.fullStackDeploy({ projectRoot: root, repoName: args.repoName || "", mode: "update" });
        return { ok: r.ok, message: r.message, repo: r.remoteUrl || "", liveUrl: r.liveUrl || "", steps: (r.steps || []).map((s) => ({ step: s.step, ok: s.ok, skipped: Boolean(s.skipped), message: s.message })) };
      }
      case "list_files": {
        const all = await fs.all(root);
        const base = rel(args.path || "");
        const paths = Object.keys(all).filter((p) => !base || p === base || p.startsWith(`${base}/`)).sort();
        return { ok: true, files: paths.slice(0, 400), total: paths.length };
      }
      case "read_file": {
        const file = await fs.read(root, rel(args.path));
        return { ok: true, path: file.path, content: file.content };
      }
      case "search_files": {
        const q = String(args.query || "").toLowerCase();
        if (!q) throw new Error("Falta query.");
        const all = await fs.all(root);
        const hits = [];
        for (const [path, text] of Object.entries(all)) {
          String(text).split("\n").forEach((line, i) => {
            if (hits.length < 80 && line.toLowerCase().includes(q)) hits.push({ path, line: i + 1, text: line.trim().slice(0, 200) });
          });
        }
        return { ok: true, matches: hits };
      }
      case "write_file":
      case "replace_in_file":
      case "delete_file": {
        if (!ctx.allowWrite) throw new Error("Permiso de solo lectura: no puedo modificar archivos.");
        const path = rel(args.path);
        if (!path) throw new Error("Falta path.");
        let before = null;
        try { before = (await fs.read(root, path)).content; } catch { before = null; }
        let after = null;
        if (name === "write_file") after = String(args.content ?? "");
        if (name === "replace_in_file") {
          if (before === null) throw new Error(`No existe el archivo: ${path}`);
          const oldText = String(args.old_text ?? "");
          if (!oldText || !before.includes(oldText)) throw new Error("old_text no aparece tal cual en el archivo. Léelo de nuevo con read_file.");
          after = before.replace(oldText, String(args.new_text ?? ""));
        }
        const diff = name === "delete_file" ? unifiedDiff(before, "") : unifiedDiff(name === "replace_in_file" ? args.old_text : before, name === "replace_in_file" ? args.new_text : after);
        if (ctx.permissionMode === "step" && !ctx.planAuthorized) {
          const verb = name === "delete_file" ? "borrar" : before === null ? "crear" : "modificar";
          const ok = await askApproval(ctx.runId, `El agente quiere ${verb} ${path}`, path, diff);
          if (!ok) throw new Error("Cambio rechazado por el usuario.");
        }
        if (name === "delete_file") await fs.remove(root, path);
        else await fs.write(root, path, after);
        return { ok: true, path, changed: true, created: before === null, diff, before, after };
      }
      default:
        throw new Error(`Herramienta desconocida: ${name}`);
    }
  }

  // Lo que el agente web siempre sabe de sí mismo (texto fijo: se relee desde la caché del prompt).
  const SELF_KNOWLEDGE = [
    "=== QUIÉN ERES: EDITCOREAI WEB ===",
    "- Eres el agente de EditCoreAI, un IDE con IA en español. Esta es la versión web (www.editcore.mx/app); también existe la app de escritorio para Windows, con terminal, npm y más herramientas, que se descarga desde la misma página.",
    "- El usuario usa saldo prepago en dólares (recarga de 20 USD con Mercado Pago; regalo de bienvenida al registrarse). Cada consulta descuenta según el modelo elegido en Modelos («Auto» elige el más adecuado).",
    "- Herramientas reales en esta versión: list_files, read_file, search_files, write_file, replace_in_file, delete_file, check_connections y publish_project. No inventes otras.",
    "- Los proyectos se guardan en la cuenta del usuario, en este navegador. La memoria de la conversación es el historial de este chat.",
    "- Conexiones (⚙ Conexiones): GitHub, Vercel y Supabase propio. Los tokens se guardan en la cuenta del usuario: nunca los pidas en el chat ni los muestres.",
    "- Ahorro de tokens: el inicio del prompt se cachea entre pasos y turnos. No releas archivos que ya leíste en esta conversación.",
    "=== FIN QUIÉN ERES ===",
  ].join("\n");

  const CONNECT_GUIDE = [
    "=== GUÍA: CONECTAR Y PUBLICAR DE PRINCIPIO A FIN ===",
    "El usuario quiere conectar servicios o publicar. Suele no ser técnico: llévalo paso a paso hasta que su proyecto quede en vivo con una URL. No lo dejes a medias.",
    "1. Llama check_connections y muestra en una lista corta qué está listo (✅) y qué falta (⬜).",
    "2. Si falta una cuenta, da UNA instrucción a la vez, con los clics exactos, y espera a que diga «listo»:",
    "   - GitHub: crear cuenta en github.com si no tiene → foto de perfil → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → marcar «repo» → Generate → copiar. En EditCoreAI: ⚙ Conexiones → GitHub → pegar → Guardar.",
    "   - Vercel: crear cuenta en vercel.com (puede entrar con su cuenta de GitHub) → vercel.com/account/tokens → Create → copiar. En EditCoreAI: ⚙ Conexiones → Vercel → pegar → Guardar.",
    "   - Supabase (solo si la app usa base de datos): ⚙ Conexiones → Supabase propio → URL y clave de su servidor. Nunca Supabase Cloud.",
    "   Cuando diga «listo», vuelve a llamar check_connections para confirmarlo: no lo supongas.",
    "3. Antes de publicar, revisa que index.html y sus archivos estén completos y sin errores evidentes.",
    "4. Publica con publish_project (EditCoreAI pide la confirmación al usuario).",
    "5. Cierra con la URL en vivo, el repositorio de GitHub y cómo publicar cambios después («dime “publica” y lo hago»).",
    "Si un paso falla, explica la causa en palabras simples, corrige lo que se pueda y reintenta. Pide al usuario solo lo que únicamente él puede hacer: crear una cuenta o pegar un token.",
    "=== FIN GUÍA ===",
  ].join("\n");
  const CONNECT_INTENT = /\b(github|vercel|supabase|netlify|publica\w*|publicar|deploy\w*|despleg\w*|desplieg\w*|conect\w*|hosting|dominio|en l[ií]nea|online|sube(lo)?)\b/i;

  // El proveedor cachea por prefijo exacto: el system es fijo por proyecto y lo variable (guía, instrucciones
  // extra) va dentro del mensaje del turno.
  function systemMessage(projectName) {
    const policy = String(window.EditCoreEliteCommunication?.ELITE_COMMUNICATION_POLICY || window.ELITE_COMMUNICATION_POLICY || "");
    const stable = [
      policy,
      "",
      "CONTEXTO: EDITCOREAI WEB",
      `- Trabajas sobre el proyecto «${projectName}», guardado en la cuenta del usuario dentro de EditCoreAI web.`,
      "- Usa las herramientas: nunca pegues archivos completos en el chat.",
      "- No hay terminal, npm ni servidor: construye apps web estáticas (HTML, CSS y JavaScript del navegador) que funcionen abriendo index.html. La vista previa del centro se actualiza sola al escribir archivos.",
      "- Antes de editar un archivo existente, léelo. Para cambios pequeños usa replace_in_file.",
      "- Al terminar, resume en 2 a 5 líneas qué hiciste y qué archivos tocaste.",
      "- Nunca nombres a los proveedores o intermediarios de IA de EditCoreAI.",
      "",
      SELF_KNOWLEDGE,
    ].join("\n");
    return { role: "system", content: stable };
  }

  function turnContext(input) {
    return [
      CONNECT_INTENT.test(String(input.prompt || "")) ? CONNECT_GUIDE : "",
      input.systemPrompt ? `INSTRUCCIONES ADICIONALES:\n${input.systemPrompt}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function imagesToParts(images = []) {
    return (Array.isArray(images) ? images : []).map((img) => {
      const url = img?.dataUrl || img?.url || (img?.base64 ? `data:${img.mimeType || img.mime || "image/png"};base64,${img.base64}` : "");
      return url ? { type: "image_url", image_url: { url } } : null;
    }).filter(Boolean);
  }
  function userMessage(prompt, images, documents, context = "") {
    const docs = (Array.isArray(documents) ? documents : []).map((d) => `\n\n[Archivo adjunto: ${d?.name || "documento"}]\n${String(d?.text || d?.content || "").slice(0, 40000)}`).join("");
    const head = context ? `=== CONTEXTO DE EDITCOREAI PARA ESTE TURNO (lo agrega el IDE, no el usuario) ===\n${context}\n=== FIN CONTEXTO ===\n\n` : "";
    const text = `${head}${String(prompt || "")}${docs}`;
    const parts = imagesToParts(images);
    return parts.length ? { role: "user", content: [{ type: "text", text }, ...parts] } : { role: "user", content: text };
  }
  const historyMessages = (history) => (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && String(m.content || "").trim())
    .slice(-24)
    .map((m) => ({ role: m.role, content: String(m.content) }));

  function addUsage(total, u) {
    if (!u) return;
    total.prompt_tokens += Number(u.prompt_tokens || 0);
    total.completion_tokens += Number(u.completion_tokens || 0);
    total.total_tokens = total.prompt_tokens + total.completion_tokens;
  }

  async function run(input = {}) {
    const runId = String(input.runId || `web-run-${Date.now()}`);
    const root = String(input.projectRoot || "").trim();
    if (!root) throw new Error("Abre o crea un proyecto para usar el agente.");
    const controller = new AbortController();
    runs.set(runId, controller);
    const progress = (payload) => emit(sets.progress, { runId, projectId: input.projectId || "", ...payload });
    const allowWrite = input.allowWrite !== false && input.permissionMode !== "readonly";
    const ctx = { root, runId, allowWrite, permissionMode: input.permissionMode || "step", planAuthorized: input.planAuthorized === true || input.permissionMode === "full" };
    const projectName = root.split("/").pop();
    const model = await resolveModel(input.model);
    const messages = [systemMessage(projectName), ...historyMessages(input.history), userMessage(input.prompt, input.images, input.documents, turnContext(input))];
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, provider_calls: 0, model };
    const changed = new Set();
    const steps = [];
    let finalText = "";
    let toolCount = 0;
    let completed = false;
    try {
      for (let step = 0; step < MAX_STEPS; step += 1) {
        if (step > 0) progress({ phase: "narration_reset" });
        const res = await completionWithRetry({
          model,
          messages,
          tools: toolDefs(allowWrite),
          signal: controller.signal,
          onDelta: (text) => progress({ phase: "narration_delta", text, index: step }),
        });
        usage.provider_calls += 1;
        addUsage(usage, res.usage);
        messages.push({ role: "assistant", content: res.content || null, ...(res.toolCalls.length ? { tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })) } : {}) });
        if (!res.toolCalls.length) {
          completed = res.finish !== "cut";
          finalText = completed ? res.content : `${res.content}\n\n⚠️ La conexión se cortó y la respuesta quedó incompleta. Escribe «continúa» para seguir.`;
          break;
        }
        for (const call of res.toolCalls) {
          toolCount += 1;
          let args = {};
          try { args = JSON.parse(call.arguments || "{}"); } catch { args = {}; }
          const index = toolCount;
          progress({ phase: "tool", name: call.name, input: args, stage: "start", index });
          let result;
          let ok = true;
          try {
            result = await execTool(call.name, args, ctx);
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            ok = false;
            result = { ok: false, error: error?.message || String(error) };
          }
          const files = result?.changed ? [result.path] : [];
          for (const f of files) changed.add(f);
          progress({ phase: "tool", name: call.name, input: args, stage: "done", ok, index, changedFiles: files, diff: result?.diff || "" });
          if (files.length) {
            emit(sets.diffApplied, { runId, filePath: result.path, unifiedDiff: result.diff || "", applied: true });
            FS().notify(root, files);
          }
          steps.push({ tool: call.name, input: args, ok });
          const { before, after, diff, ...forModel } = result || {};
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(forModel).slice(0, TOOL_RESULT_LIMIT) });
        }
      }
      if (!finalText && !completed) finalText = toolCount ? "Llegué al límite de pasos de esta respuesta. Escribe «continúa» para seguir." : "";
      if (!String(finalText || "").trim() && changed.size) finalText = `Listo. Cambié ${changed.size === 1 ? "este archivo" : "estos archivos"}:\n\n${[...changed].map((f) => `- \`${f}\``).join("\n")}\n\nLa vista previa ya muestra el resultado.`;
      if (!String(finalText || "").trim() && toolCount) finalText = "Revisé el proyecto y no hizo falta cambiar archivos.";
      if (finalText) progress({ phase: "final_report", text: finalText });
      const report = { completed: completed || Boolean(finalText), changedFiles: [...changed], toolCount, stopReason: completed ? "" : "step_limit", outcome: "completed" };
      emit(sets.complete, { runId, report, changedFiles: report.changedFiles, completed: report.completed });
      window.EditCoreWebBridge?.notifyBalance?.();
      return { ok: true, runId, taskId: input.taskId || runId, text: finalText, report, usage, steps };
    } catch (error) {
      const cancelled = error?.name === "AbortError";
      const message = cancelled ? "Ejecución detenida por el usuario." : (error?.message || String(error));
      emit(sets.error, { runId, error: message, code: error?.code || "" });
      window.EditCoreWebBridge?.notifyBalance?.();
      if (error?.code === "OUT_OF_CREDITS") window.dispatchEvent(new CustomEvent("editcore:out-of-credits"));
      return { ok: false, runId, taskId: input.taskId || runId, text: message, error: message, code: error?.code || "", incomplete: true, report: { completed: false, changedFiles: [...changed], toolCount, stopReason: message }, usage, steps };
    } finally {
      runs.delete(runId);
    }
  }

  async function chat(input = {}) {
    chatController?.abort();
    chatController = new AbortController();
    const model = await resolveModel(input.model);
    const messages = [];
    if (input.systemPrompt) messages.push({ role: "system", content: String(input.systemPrompt) });
    messages.push(...historyMessages(input.history), userMessage(input.prompt, input.images, input.documents));
    try {
      const res = await completionWithRetry({ model, messages, signal: chatController.signal, onDelta: (text) => emit(sets.chunk, text) }, 1);
      emit(sets.chunk, { done: true });
      window.EditCoreWebBridge?.notifyBalance?.();
      const text = res.finish === "cut" ? `${res.content}\n\n⚠️ La conexión se cortó y la respuesta quedó incompleta.` : res.content;
      return { ok: true, text, usage: { ...(res.usage || {}), provider_calls: 1, model } };
    } catch (error) {
      if (error?.code === "OUT_OF_CREDITS") window.dispatchEvent(new CustomEvent("editcore:out-of-credits"));
      throw error;
    } finally {
      chatController = null;
    }
  }

  const cancelRun = async (input = {}) => {
    const id = String(input?.runId || "");
    if (id && runs.has(id)) runs.get(id).abort();
    else runs.forEach((c) => c.abort());
    return { ok: true };
  };

  window.editcoreAgent = Object.assign(window.editcoreAgent || {}, {
    run,
    cancel: cancelRun,
    async steer() { return { ok: false, error: "Escribe tu indicación cuando termine la respuesta actual." }; },
    async verifyModel(input = {}) { return { chatOK: true, toolOK: true, model: input.model || "" }; },
    async setPermission(mode) { return { ok: true, mode }; },
    async privacyGet() { return { ok: true, mode: "standard" }; },
    async privacySet() { return { ok: true }; },
    async respondApproval(input = {}) {
      const resolve = approvals.get(String(input.requestId || ""));
      if (resolve) { approvals.delete(String(input.requestId)); resolve(input.approved === true); }
      return true;
    },
    onProgress: listen(sets.progress),
    onThoughtStream: listen(sets.thought),
    onExplorationStart: listen(sets.exploreStart),
    onExplorationEnd: listen(sets.exploreEnd),
    onDiffProposed: listen(sets.diffProposed),
    onDiffApplied: listen(sets.diffApplied),
    onTaskComplete: listen(sets.taskComplete),
    onComplete: listen(sets.complete),
    onError: listen(sets.error),
    onApprovalRequest: listen(sets.approval),
  });
  window.editcoreChat = Object.assign(window.editcoreChat || {}, {
    chat,
    async cancel() { chatController?.abort(); return { ok: true }; },
  });
  window.editcoreStream = Object.assign(window.editcoreStream || {}, {
    onChunk: (cb) => { if (typeof cb === "function") sets.chunk.add(cb); },
    offChunk: () => sets.chunk.clear(),
  });
  window.EditCoreWebAgent = { run, chat, cancelAll: () => { runs.forEach((c) => c.abort()); chatController?.abort(); } };
})();
