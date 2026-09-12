"use strict";
(async () => {
  const port = Number(process.env.PORT || 9388);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 1;
  const pending = new Map();
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const my = id++;
    pending.set(my, { resolve, reject });
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  const requests = [];
  const failed = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
      return;
    }
    if (m.method === "Network.requestWillBeSent") {
      requests.push({ url: m.params.request.url, type: m.params.type, id: m.params.requestId });
    }
    if (m.method === "Network.loadingFailed") {
      failed.push({ id: m.params.requestId, error: m.params.errorText, canceled: m.params.canceled });
    }
  });
  await call("Network.enable");
  await call("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 15000));
  const evalExpr = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return r.result?.value;
  };
  const state = await evalExpr(`({
    ready: document.readyState,
    bodyLen: (document.body && document.body.innerHTML || '').length,
    hasSend: Boolean(document.getElementById('sendBtn')),
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
  })`);
  console.log(JSON.stringify({
    state,
    requestCount: requests.length,
    requests: requests.slice(0, 30),
    failed,
  }, null, 2));
  ws.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
