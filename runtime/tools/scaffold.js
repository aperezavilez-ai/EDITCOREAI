"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Scaffolding 0→100: Next.js App Router + Tailwind + TypeScript (+ stubs Supabase).
 */

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (fs.existsSync(full)) return { path: rel, skipped: true };
  fs.writeFileSync(full, content, "utf8");
  return { path: rel, skipped: false };
}

function scaffoldNextApp({ projectRoot, withSupabase = true } = {}) {
  const root = path.resolve(projectRoot);
  fs.mkdirSync(root, { recursive: true });
  const created = [];

  const files = {
    "package.json": JSON.stringify({
      name: path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g, "-") || "app",
      private: true,
      version: "0.1.0",
      scripts: {
        dev: "next dev --hostname 127.0.0.1 --port 3000",
        build: "next build",
        start: "next start --hostname 127.0.0.1 --port 3000",
        lint: "next lint",
        "typecheck": "tsc --noEmit",
      },
      dependencies: {
        next: "^15.1.0",
        react: "^19.0.0",
        "react-dom": "^19.0.0",
        "lucide-react": "^0.468.0",
        "framer-motion": "^11.15.0",
        clsx: "^2.1.1",
        "tailwind-merge": "^2.6.0",
        ...(withSupabase ? { "@supabase/supabase-js": "^2.47.10" } : {}),
      },
      devDependencies: {
        typescript: "^5.7.2",
        "@types/node": "^22.10.2",
        "@types/react": "^19.0.2",
        "@types/react-dom": "^19.0.2",
        tailwindcss: "^3.4.17",
        postcss: "^8.4.49",
        autoprefixer: "^10.4.20",
      },
    }, null, 2) + "\n",
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
        paths: { "@/*": ["./*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    }, null, 2) + "\n",
    "next.config.ts": `import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  reactStrictMode: true,\n};\n\nexport default nextConfig;\n`,
    "postcss.config.mjs": `/** @type {import('postcss-load-config').Config} */\nconst config = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\nexport default config;\n`,
    "tailwind.config.ts": `import type { Config } from "tailwindcss";\n\nconst config: Config = {\n  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],\n  darkMode: "class",\n  theme: {\n    extend: {\n      fontFamily: {\n        sans: ["Inter", "Geist", "ui-sans-serif", "system-ui", "sans-serif"],\n      },\n      colors: {\n        canvas: "#0b0f14",\n        panel: "#111827",\n      },\n    },\n  },\n  plugins: [],\n};\nexport default config;\n`,
    "app/globals.css": `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root {\n  color-scheme: dark;\n}\n\nhtml, body {\n  min-height: 100%;\n  background: #0b0f14;\n  color: #e5e7eb;\n  font-family: Inter, Geist, ui-sans-serif, system-ui, sans-serif;\n}\n`,
    "app/layout.tsx": `import type { Metadata } from "next";\nimport "./globals.css";\n\nexport const metadata: Metadata = {\n  title: "App",\n  description: "Scaffold EDITCOREAI",\n};\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="es" className="dark">\n      <body className="min-h-screen bg-canvas antialiased">{children}</body>\n    </html>\n  );\n}\n`,
    "app/page.tsx": `export default function HomePage() {\n  return (\n    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-6 px-6 py-16">\n      <p className="text-sm uppercase tracking-[0.2em] text-white/40">EDITCOREAI</p>\n      <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">\n        Listo para construir\n      </h1>\n      <p className="max-w-2xl text-base text-white/60">\n        Scaffold Next.js + Tailwind + TypeScript. Oscuro, limpio y listo para iterar.\n      </p>\n      <div className="rounded-2xl border border-white/10 bg-panel/80 p-6 shadow-2xl shadow-black/40">\n        <p className="text-sm text-white/70">Abre el chat y pide la primera feature.</p>\n      </div>\n    </main>\n  );\n}\n`,
    ".env.example": withSupabase
      ? `NEXT_PUBLIC_SUPABASE_URL=\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\n`
      : `NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000\n`,
    ".gitignore": `node_modules\n.next\nout\ndist\n.env\n.env.local\n.DS_Store\n`,
    "README.md": `# App scaffold (EDITCOREAI)\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
    "next-env.d.ts": `/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n\n// NOTE: This file should not be edited\n`,
  };

  if (withSupabase) {
    files["lib/supabase/client.ts"] = `import { createClient } from "@supabase/supabase-js";\n\nconst url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";\nconst anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";\n\nexport const supabase = createClient(url, anon);\n`;
    files["supabase/migrations/0001_init.sql"] = `-- Migración inicial\n-- CREATE TABLE IF NOT EXISTS public.profiles (\n--   id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,\n--   display_name text,\n--   created_at timestamptz DEFAULT now()\n-- );\n-- ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;\n`;
  }

  for (const [rel, content] of Object.entries(files)) {
    created.push(write(root, rel, content));
  }

  return {
    ok: true,
    root,
    created: created.filter((c) => !c.skipped).map((c) => c.path),
    skipped: created.filter((c) => c.skipped).map((c) => c.path),
    next: ["npm install", "npm run dev", "Completa .env.local desde .env.example"],
  };
}

module.exports = { scaffoldNextApp };
