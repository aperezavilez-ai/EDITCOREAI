"use strict";
(async () => {
  const port = Number(process.env.PORT || 9377);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) throw new Error("no page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let nextId = 1;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const onmsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onmsg);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    };
    ws.addEventListener("message", onmsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalExpr = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "ex");
    return r.result?.value;
  };
  await call("Runtime.enable");
  await call("Console.enable");
  const errors = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params?.exceptionDetails?.exception?.description || JSON.stringify(m.params));
    }
    if (m.method === "Console.messageAdded" && /error/i.test(m.params?.message?.level || "")) {
      errors.push(m.params.message.text);
    }
  });
  const info = await evalExpr(`({
    url: location.href,
    title: document.title,
    ready: document.readyState,
    bodyLen: (document.body && document.body.innerHTML || '').length,
    bodyText: (document.body && document.body.innerText || '').slice(0, 400),
    hasSend: Boolean(document.getElementById('sendBtn')),
    hasWelcome: Boolean(document.getElementById('welcomeScreen')),
    scripts: [...document.scripts].map((s) => s.src || 'inline').slice(0, 20),
    editcoreReady: document.body && document.body.dataset ? (document.body.dataset.editcoreReady || '') : '',
  })`);
  // Trigger a probe for script errors by checking last error
  const lastError = await evalExpr(`window.__editcoreBootError || null`);
  console.log(JSON.stringify({ info, lastError, errors: errors.slice(0, 20) }, null, 2));
  ws.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
