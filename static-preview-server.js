"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(String(process.argv[2] || ""));
const port = Number(process.argv[3]);
const entry = String(process.argv[4] || "index.html").replace(/\\/g, "/").replace(/^\/+/, "");
if (!root || !Number.isInteger(port) || port < 1 || !fs.existsSync(path.join(root, entry))) {
  throw new Error("Servidor estatico: raiz o puerto invalido.");
}

const mime = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".mjs": "text/javascript; charset=utf-8", ".htm": "text/html; charset=utf-8", ".gif": "image/gif", ".wasm": "application/wasm",
  ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".txt": "text/plain; charset=utf-8", ".map": "application/json; charset=utf-8",
};

function resolveRequest(urlValue) {
  const pathname = decodeURIComponent(new URL(urlValue || "/", "http://127.0.0.1").pathname);
  const relative = pathname.replace(/^\/+/, "") || entry;
  // Puede servir la raíz de un proyecto de escritorio: nunca exponer .env, .git ni node_modules.
  if (relative.split("/").some((segment) => segment.startsWith(".") || segment === "node_modules")) return "";
  const target = path.resolve(root, relative);
  const inside = target === root || target.startsWith(`${root}${path.sep}`);
  if (!inside) return "";
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  if (!path.extname(relative)) return path.join(root, entry);
  return "";
}

const server = http.createServer(async (request, response) => {
  const urlValue = String(request.url || "/");
  // Proxy CORS-safe hacia Supabase (u orígenes https permitidos) para frontends estáticos.
  if (urlValue.startsWith("/__editcore_proxy__/")) {
    try {
      const targetRaw = decodeURIComponent(urlValue.slice("/__editcore_proxy__/".length));
      const target = new URL(targetRaw);
      if (!/^https?:$/i.test(target.protocol)) throw new Error("protocol");
      const hostOk = /^(?:.+\.)?supabase\.(?:gafcore|qatcore)\.com$/i.test(target.hostname)
        || target.hostname === "gafcore-gateway.vercel.app";
      if (!hostOk) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Host no permitido en proxy EditCore.");
        return;
      }
      const incoming = request.headers || {};
      const headers = {
        accept: incoming.accept || "*/*",
        "content-type": incoming["content-type"] || "",
        authorization: incoming.authorization || "",
        apikey: incoming.apikey || "",
      };
      Object.keys(headers).forEach((k) => { if (!headers[k]) delete headers[k]; });
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bodyBuf = Buffer.concat(chunks);
      const upstream = await fetch(target.toString(), {
        method: request.method || "GET",
        headers,
        body: ["GET", "HEAD"].includes(String(request.method || "GET").toUpperCase()) ? undefined : bodyBuf,
      });
      const outHeaders = {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, accept, prefer",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      };
      if (String(request.method || "").toUpperCase() === "OPTIONS") {
        response.writeHead(204, outHeaders);
        response.end();
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, outHeaders);
      response.end(buf);
      return;
    } catch {
      response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      response.end("Proxy EditCore falló.");
      return;
    }
  }
  if (String(request.method || "").toUpperCase() === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, accept, prefer",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }
  const target = resolveRequest(urlValue);
  if (!target) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    response.end("Not found");
    return;
  }
  const entryDir = path.posix.dirname(entry);
  if (entryDir !== "." && target === path.join(root, entry)) {
    // Entrada en subcarpeta servida en "/": sus rutas relativas deben resolverse desde su carpeta.
    let html = fs.readFileSync(target, "utf8");
    if (!/<base\s/i.test(html)) {
      const baseTag = `<base href="/${entryDir.split("/").map(encodeURIComponent).join("/")}/">`;
      html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${baseTag}`) : `${baseTag}${html}`;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    response.end(html);
    return;
  }
  response.writeHead(200, {
    "Content-Type": mime[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  fs.createReadStream(target).on("error", () => response.destroy()).pipe(response);
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`http://127.0.0.1:${port}\n`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
