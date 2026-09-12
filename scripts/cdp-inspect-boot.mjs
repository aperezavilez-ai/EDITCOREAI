const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = pages.find((p) => p.type === "page") || pages[0];
if (!page?.webSocketDebuggerUrl) {
  console.log(JSON.stringify({ error: "no page", pages }, null, 2));
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
const expr = `({
  href: location.href,
  ready: document.readyState,
  editcoreReady: document.body?.dataset?.editcoreReady || null,
  welcomeHidden: document.getElementById("welcomeScreen")?.hidden,
  welcomeOpen: document.body?.classList?.contains("welcome-open"),
  bodyText: (document.body?.innerText || "").slice(0, 250),
  hasShowWelcome: typeof showWelcomeScreen === "function",
  err: window.__lastError || null
})`;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout")), 10000);
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== 1) return;
    clearTimeout(timer);
    console.log(JSON.stringify(msg.result, null, 2));
    ws.close();
    resolve();
  });
  ws.addEventListener("error", reject);
});
