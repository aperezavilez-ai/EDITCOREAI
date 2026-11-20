"use strict";

/**
 * Navegación web autónoma (Puppeteer → Playwright → fetch).
 * Truncado estricto para no saturar el contexto del modelo.
 */

const CONTENT_CAP = 5000;

function assertHttpUrl(url) {
  const raw = String(url || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("URL inválida");
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error("Solo se permiten URLs http/https");
  }
  return parsed.href;
}

function stripHtmlToText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeWithPuppeteer(url) {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const puppeteer = require("puppeteer");
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 EditCoreAI/1.0",
    );
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    const content = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script, style, noscript");
      scripts.forEach((s) => s.remove());
      return (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    });
    const title = await page.title().catch(() => "");
    await browser.close();
    browser = null;
    return {
      ok: true,
      engine: "puppeteer",
      url,
      title,
      content: String(content || "").slice(0, CONTENT_CAP),
      bytes: String(content || "").length,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

async function scrapeWithPlaywright(url) {
  // eslint-disable-next-line import/no-extraneous-dependencies
  const { chromium } = require("playwright");
  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    const content = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script, style, noscript");
      scripts.forEach((s) => s.remove());
      return (document.body?.innerText || "").replace(/\s+/g, " ").trim();
    });
    const title = await page.title().catch(() => "");
    await browser.close();
    browser = null;
    return {
      ok: true,
      engine: "playwright",
      url,
      title,
      content: String(content || "").slice(0, CONTENT_CAP),
      bytes: String(content || "").length,
    };
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  }
}

async function scrapeWithFetch(url) {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
    headers: {
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      "User-Agent": "EditCoreAI/1.0 (+local-agent; docs-ingest)",
    },
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} al abrir ${url}` };
  }
  const ct = String(res.headers.get("content-type") || "");
  const raw = await res.text();
  let content = raw;
  if (/html|xml/i.test(ct) || /<html/i.test(raw.slice(0, 500))) {
    content = stripHtmlToText(raw);
  }
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return {
    ok: true,
    engine: "fetch",
    url,
    title: titleMatch ? stripHtmlToText(titleMatch[1]).slice(0, 200) : "",
    content: String(content || "").slice(0, CONTENT_CAP),
    bytes: String(content || "").length,
    note: "Fallback fetch (sin JS). Instala puppeteer para sitios dinámicos: npm i puppeteer",
  };
}

/**
 * Navega a una URL y extrae el texto de la página.
 */
async function scrapeWebPage(url) {
  let href;
  try {
    href = assertHttpUrl(url);
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }

  const errors = [];

  try {
    require.resolve("puppeteer");
    return await scrapeWithPuppeteer(href);
  } catch (err) {
    errors.push(`puppeteer: ${String(err.message || err).slice(0, 160)}`);
  }

  try {
    require.resolve("playwright");
    return await scrapeWithPlaywright(href);
  } catch (err) {
    errors.push(`playwright: ${String(err.message || err).slice(0, 160)}`);
  }

  try {
    return await scrapeWithFetch(href);
  } catch (err) {
    return {
      ok: false,
      error: String(err.message || err).slice(0, 400),
      tried: errors,
    };
  }
}

module.exports = {
  scrapeWebPage,
  CONTENT_CAP,
};
