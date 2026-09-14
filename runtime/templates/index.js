"use strict";

/**
 * Catalogo de plantillas por defecto de EDITCOREAI.
 * animated-pwa: React/Vite + Tailwind transitions + Framer Motion + PWA stubs.
 */

const path = require("node:path");
const fs = require("node:fs");

const ANIMATED_PWA_ID = "animated-pwa";

const ANIMATED_PWA_DEPENDENCIES = Object.freeze({
  "framer-motion": "^11.15.0",
});

const ANIMATED_PWA_DEV_DEPENDENCIES = Object.freeze({
  // Tailwind transition utilities ship with tailwindcss; keep explicit for template docs.
});

function animatedPwaStaticFiles(appName = "ProApp") {
  const title = String(appName || "ProApp");
  return {
    "public/assets/.gitkeep": "",
    "public/manifest.webmanifest": JSON.stringify({
      name: title,
      short_name: title.slice(0, 12),
      description: `${title} — PWA generada por EDITCOREAI`,
      start_url: "/",
      display: "standalone",
      background_color: "#0b0f14",
      theme_color: "#4f46e5",
      icons: [
        { src: "/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
      ],
    }, null, 2) + "\n",
    "public/sw.js": `/* EDITCOREAI animated-pwa service worker (offline shell). */
const CACHE = "editcore-pwa-v1";
const PRECACHE = ["/", "/index.html", "/logo.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match("/index.html")))
  );
});
`,
    "src/components/motion/FadeIn.tsx": `import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

type FadeInProps = {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
};

/** Micro-interaccion de entrada con respeto a prefers-reduced-motion. */
export function FadeIn({ children, className, delay = 0, y = 16 }: FadeInProps) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}
`,
    "src/hooks/useSmoothAnchorScroll.ts": `import * as React from "react";

/** Smooth scroll para anclas internas (#section) sin romper navegacion normal. */
export function useSmoothAnchorScroll(enabled = true) {
  React.useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href^='#']") as HTMLAnchorElement | null;
      if (!anchor) return;
      const id = anchor.getAttribute("href")?.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      event.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [enabled]);
}
`,
  };
}

function mergeAnimatedPwaPackageJson(pkg = {}) {
  const next = typeof pkg === "string" ? JSON.parse(pkg) : { ...pkg };
  next.dependencies = {
    ...(next.dependencies || {}),
    ...ANIMATED_PWA_DEPENDENCIES,
  };
  return next;
}

function listTemplateIds() {
  return [ANIMATED_PWA_ID];
}

function getTemplateRoot(id = ANIMATED_PWA_ID) {
  return path.join(__dirname, String(id || ANIMATED_PWA_ID));
}

function ensureTemplateScaffoldOnDisk() {
  const root = getTemplateRoot(ANIMATED_PWA_ID);
  fs.mkdirSync(root, { recursive: true });
  const metaPath = path.join(root, "template.json");
  if (!fs.existsSync(metaPath)) {
    fs.writeFileSync(metaPath, JSON.stringify({
      id: ANIMATED_PWA_ID,
      name: "Animated PWA Web",
      description: "React/Vite + Tailwind transitions + Framer Motion + PWA shell",
      dependencies: ANIMATED_PWA_DEPENDENCIES,
      default: true,
    }, null, 2) + "\n", "utf8");
  }
  return root;
}

module.exports = {
  ANIMATED_PWA_ID,
  ANIMATED_PWA_DEPENDENCIES,
  ANIMATED_PWA_DEV_DEPENDENCIES,
  animatedPwaStaticFiles,
  mergeAnimatedPwaPackageJson,
  listTemplateIds,
  getTemplateRoot,
  ensureTemplateScaffoldOnDisk,
};
