"use strict";

/**
 * WEB FETCHER - Descarga y analiza contenido web
 * Soporta HTTP/HTTPS con redirecciones automáticas
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

/**
 * Descarga contenido de una URL
 */
async function fetchUrl(url, options = {}) {
  const maxRedirects = options.maxRedirects || 5;
  const timeout = options.timeout || 30000;
  const userAgent = options.userAgent || "EditCore-AI/2.0";

  return new Promise((resolve, reject) => {
    let redirectCount = 0;

    const doFetch = (currentUrl) => {
      const parsedUrl = new URL(currentUrl);
      const client = parsedUrl.protocol === "https:" ? https : http;

      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "GET",
        headers: {
          "User-Agent": userAgent,
          "Accept": "*/*",
          ...(options.headers || {}),
        },
        timeout,
      };

      const req = client.request(requestOptions, (res) => {
        // Manejar redirecciones
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            reject(new Error(`Demasiadas redirecciones (max ${maxRedirects})`));
            return;
          }

          redirectCount++;
          const redirectUrl = new URL(res.headers.location, currentUrl).href;
          doFetch(redirectUrl);
          return;
        }

        // Error HTTP
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        let data = "";
        let chunks = [];
        let size = 0;
        const maxSize = options.maxSize || 10 * 1024 * 1024; // 10MB default

        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxSize) {
            req.destroy();
            reject(new Error(`Respuesta muy grande (max ${maxSize} bytes)`));
            return;
          }

          chunks.push(chunk);
        });

        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const contentType = res.headers["content-type"] || "";

          // Detectar encoding
          let encoding = "utf8";
          if (contentType.includes("charset=")) {
            const match = contentType.match(/charset=([^;]+)/i);
            if (match) encoding = match[1].trim().toLowerCase();
          }

          try {
            data = buffer.toString(encoding);
          } catch (e) {
            data = buffer.toString("utf8");
          }

          resolve({
            url: currentUrl,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            contentType,
            size,
            data,
            buffer,
          });
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Timeout después de ${timeout}ms`));
      });

      if (options.body) {
        req.write(options.body);
      }

      req.end();
    };

    doFetch(url);
  });
}

/**
 * Extrae texto limpio de HTML
 */
function extractTextFromHtml(html) {
  // Remover scripts y styles
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Remover tags HTML
  text = text.replace(/<[^>]+>/g, " ");

  // Decodificar entidades HTML básicas
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Limpiar espacios múltiples
  text = text.replace(/\s+/g, " ");

  return text.trim();
}

/**
 * Extrae metadata de HTML
 */
function extractMetadata(html) {
  const metadata = {
    title: "",
    description: "",
    keywords: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
  };

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) metadata.title = titleMatch[1].trim();

  // Meta tags
  const metaRegex = /<meta\s+([^>]+)>/gi;
  let metaMatch;

  while ((metaMatch = metaRegex.exec(html)) !== null) {
    const attrs = metaMatch[1];

    // Description
    if (/name=["']?description["']?/i.test(attrs)) {
      const contentMatch = attrs.match(/content=["']?([^"']+)["']?/i);
      if (contentMatch) metadata.description = contentMatch[1];
    }

    // Keywords
    if (/name=["']?keywords["']?/i.test(attrs)) {
      const contentMatch = attrs.match(/content=["']?([^"']+)["']?/i);
      if (contentMatch) metadata.keywords = contentMatch[1];
    }

    // Open Graph
    if (/property=["']?og:title["']?/i.test(attrs)) {
      const contentMatch = attrs.match(/content=["']?([^"']+)["']?/i);
      if (contentMatch) metadata.ogTitle = contentMatch[1];
    }

    if (/property=["']?og:description["']?/i.test(attrs)) {
      const contentMatch = attrs.match(/content=["']?([^"']+)["']?/i);
      if (contentMatch) metadata.ogDescription = contentMatch[1];
    }

    if (/property=["']?og:image["']?/i.test(attrs)) {
      const contentMatch = attrs.match(/content=["']?([^"']+)["']?/i);
      if (contentMatch) metadata.ogImage = contentMatch[1];
    }
  }

  return metadata;
}

/**
 * Extrae links de HTML
 */
function extractLinks(html, baseUrl) {
  const links = [];
  const linkRegex = /<a\s+[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([^<]*)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    const text = match[2].trim();

    // Convertir a URL absoluta
    try {
      href = new URL(href, baseUrl).href;
    } catch (e) {
      // Ignorar links inválidos
      continue;
    }

    links.push({ href, text });
  }

  return links;
}

/**
 * Analiza página web completa
 */
async function analyzePage(url, options = {}) {
  const response = await fetchUrl(url, options);

  const result = {
    url: response.url,
    statusCode: response.statusCode,
    contentType: response.contentType,
    size: response.size,
  };

  // Si es HTML, extraer información
  if (response.contentType.includes("text/html")) {
    result.metadata = extractMetadata(response.data);
    result.text = extractTextFromHtml(response.data);
    result.links = extractLinks(response.data, response.url);
    result.html = response.data;
  } else if (response.contentType.includes("application/json")) {
    try {
      result.json = JSON.parse(response.data);
    } catch (e) {
      result.text = response.data;
    }
  } else {
    result.text = response.data;
  }

  return result;
}

module.exports = {
  fetchUrl,
  extractTextFromHtml,
  extractMetadata,
  extractLinks,
  analyzePage,
};
