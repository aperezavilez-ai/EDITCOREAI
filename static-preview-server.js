"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(String(process.argv[2] || ""));
const port = Number(process.argv[3]);
if (!root || !Number.isInteger(port) || port < 1 || !fs.existsSync(path.join(root, "index.html"))) {
  throw new Error("Servidor estatico: raiz o puerto invalido.");
}

const mime = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
};

function resolveRequest(urlValue) {
  const pathname = decodeURIComponent(new URL(urlValue || "/", "http://127.0.0.1").pathname);
  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const target = path.resolve(root, relative);
  const inside = target === root || target.startsWith(`${root}${path.sep}`);
  if (!inside) return "";
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  if (!path.extname(relative)) return path.join(root, "index.html");
  return "";
}

const server = http.createServer((request, response) => {
  const target = resolveRequest(request.url);
  if (!target) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(target).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(target).on("error", () => response.destroy()).pipe(response);
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`http://127.0.0.1:${port}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
