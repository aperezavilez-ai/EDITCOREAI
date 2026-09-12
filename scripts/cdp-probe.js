"use strict";
(async () => {
  const port = Number(process.env.PORT || 9366);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === "page" && p.webSocketDebuggerUrl);
  if (!page) throw new Error("no page");
  console.log("url", page.url);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const evalExpr = (expression) => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e6);
    const onmsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== id) return;
      ws.removeEventListener("message", onmsg);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else if (m.result?.exceptionDetails) reject(new Error(m.result.exceptionDetails.exception?.description || "ex"));
      else resolve(m.result?.result);
    };
    ws.addEventListener("message", onmsg);
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  for (const expr of [
    "typeof window.editcoreAgent",
    "typeof window.editcoreSecureConfig",
    "Boolean(document.getElementById('sendBtn'))",
    "document.body && document.body.dataset ? (document.body.dataset.editcoreReady || '') : ''",
    "Object.keys(window).filter((k) => /^editcore/i.test(k)).join(',')",
  ]) {
    try {
      console.log(expr, "=>", await evalExpr(expr));
    } catch (error) {
      console.log(expr, "ERR", error.message);
    }
  }
  ws.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
