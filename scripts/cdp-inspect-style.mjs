const pages = await (await fetch("http://127.0.0.1:9222/json")).json();
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
const expr = `(() => {
  const w = document.querySelector(".welcome-screen");
  const t = document.querySelector(".welcome-title");
  const cs = (el) => el ? {
    display: getComputedStyle(el).display,
    visibility: getComputedStyle(el).visibility,
    opacity: getComputedStyle(el).opacity,
    bg: getComputedStyle(el).backgroundColor,
    color: getComputedStyle(el).color,
    z: getComputedStyle(el).zIndex,
    rect: el.getBoundingClientRect()
  } : null;
  return {
    body: cs(document.body),
    welcome: cs(w),
    title: cs(t),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    sheets: document.styleSheets.length,
    cssOk: [...document.styleSheets].map(s => { try { return s.href || "inline:" + s.cssRules.length; } catch(e) { return "err:" + e.message; } })
  };
})()`;
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout")), 10000);
  ws.addEventListener("open", () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } })));
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== 1) return;
    clearTimeout(timer);
    console.log(JSON.stringify(msg.result, null, 2));
    ws.close();
    resolve();
  });
});
