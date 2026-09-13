"use strict";

/**
 * Motor de Creación Profesional de Proyectos Web / Apps (Greenfield Builder).
 * Genera aplicaciones modernas con Vite, React, TypeScript, Tailwind CSS,
 * componentes UI accesibles y assets visuales temáticos integrados.
 */

const fs = require("node:fs");
const path = require("node:path");
const { getImagesForProject, generateSvgLogo } = require("./project-assets");

function generatePackageJson(name = "pro-app") {
  return JSON.stringify({
    name: String(name || "pro-app").toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
    private: true,
    version: "1.0.0",
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc && vite build",
      preview: "vite preview",
      lint: "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
    },
    dependencies: {
      "react": "^18.3.1",
      "react-dom": "^18.3.1",
      "lucide-react": "^0.395.0",
      "clsx": "^2.1.1",
      "tailwind-merge": "^2.3.0"
    },
    devDependencies: {
      "@types/node": "^20.14.2",
      "@types/react": "^18.3.3",
      "@types/react-dom": "^18.3.0",
      "@vitejs/plugin-react": "^4.3.0",
      "autoprefixer": "^10.4.19",
      "postcss": "^8.4.38",
      "tailwindcss": "^3.4.4",
      "typescript": "^5.4.5",
      "vite": "^5.2.13"
    }
  }, null, 2);
}

function generateViteConfig() {
  return `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
});
`;
}

function generateTsConfig() {
  return JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      useDefineForClassFields: true,
      lib: ["ES2020", "DOM", "DOM.Iterable"],
      module: "ESNext",
      skipLibCheck: true,
      moduleResolution: "bundler",
      allowImportingTsExtensions: false,
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: "react-jsx",
      strict: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      noFallthroughCasesInSwitch: true,
      baseUrl: ".",
      paths: {
        "@/*": ["./src/*"]
      }
    },
    include: ["src"],
    references: [{ path: "./tsconfig.node.json" }]
  }, null, 2);
}

function generateTsConfigNode() {
  return JSON.stringify({
    compilerOptions: {
      composite: true,
      skipLibCheck: true,
      module: "ESNext",
      moduleResolution: "bundler",
      allowSyntheticDefaultImports: true
    },
    include: ["vite.config.ts"]
  }, null, 2);
}

function generateTailwindConfig() {
  return `/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};
`;
}

function generatePostcssConfig() {
  return `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;
}

function generateIndexCss() {
  return `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 220 20% 98%;
    --foreground: 224 71% 4%;
    --card: 0 0% 100%;
    --card-foreground: 224 71% 4%;
    --primary: 238 82% 59%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 14% 94%;
    --secondary-foreground: 220 30% 16%;
    --muted: 220 14% 96%;
    --muted-foreground: 220 10% 46%;
    --accent: 238 82% 96%;
    --accent-foreground: 238 82% 40%;
    --border: 220 13% 90%;
    --input: 220 13% 90%;
    --ring: 238 82% 59%;
    --radius: 0.75rem;
  }

  .dark {
    --background: 224 71% 4%;
    --foreground: 210 20% 98%;
    --card: 224 71% 6%;
    --card-foreground: 210 20% 98%;
    --primary: 238 82% 65%;
    --primary-foreground: 0 0% 100%;
    --secondary: 215 28% 17%;
    --secondary-foreground: 210 20% 98%;
    --muted: 215 28% 14%;
    --muted-foreground: 217 19% 65%;
    --accent: 238 82% 20%;
    --accent-foreground: 238 82% 80%;
    --border: 215 28% 18%;
    --input: 215 28% 18%;
    --ring: 238 82% 65%;
  }
}

body {
  @apply bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
}
`;
}

function generateIndexHtml(title = "Modern Web Application") {
  return `<!doctype html>
<html lang="es" class="scroll-smooth">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/logo.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
    </style>
  </head>
  <body class="min-h-screen bg-background text-foreground">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function generateUtilsTs() {
  return `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
}

function generateButtonComponent() {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", children, ...props }, ref) => {
    const variants = {
      primary: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm shadow-primary/25",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
      ghost: "hover:bg-accent hover:text-accent-foreground",
      danger: "bg-red-500 text-white hover:bg-red-600 shadow-sm",
    };
    const sizes = {
      sm: "h-8 px-3 text-xs rounded-lg gap-1.5",
      md: "h-10 px-4 text-sm rounded-xl gap-2",
      lg: "h-12 px-6 text-base rounded-xl gap-2.5 font-semibold",
    };
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
`;
}

function generateCardComponent() {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-card p-6 text-card-foreground shadow-sm hover:shadow-md transition-shadow",
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 pb-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-xl font-bold tracking-tight text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("pt-0", className)} {...props} />;
}
`;
}

function generateBadgeComponent() {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "outline" | "success";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "bg-primary/10 text-primary border-primary/20",
    secondary: "bg-secondary text-secondary-foreground border-transparent",
    outline: "text-foreground border-border",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  };
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
`;
}

function generateNavbarComponent(appName = "ProApp", category = "saas") {
  return `import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Sparkles, Menu, X, ArrowRight } from "lucide-react";

export function Navbar() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-indigo-600 text-white shadow-md shadow-primary/30">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
            ${appName}
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">Características</a>
          <a href="#showcase" className="hover:text-foreground transition-colors">Catálogo</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Precios</a>
          <a href="#testimonials" className="hover:text-foreground transition-colors">Testimonios</a>
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <Button variant="ghost">Iniciar Sesión</Button>
          <Button variant="primary">
            Comenzar Gratis <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <button
          className="md:hidden p-2 rounded-lg text-foreground hover:bg-accent"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Abrir menú"
        >
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-b border-border bg-background p-4 space-y-3">
          <a href="#features" className="block text-sm font-medium p-2 hover:bg-accent rounded-lg">Características</a>
          <a href="#showcase" className="block text-sm font-medium p-2 hover:bg-accent rounded-lg">Catálogo</a>
          <a href="#pricing" className="block text-sm font-medium p-2 hover:bg-accent rounded-lg">Precios</a>
          <div className="pt-2 flex flex-col gap-2">
            <Button variant="outline" className="w-full">Iniciar Sesión</Button>
            <Button variant="primary" className="w-full">Comenzar Gratis</Button>
          </div>
        </div>
      )}
    </header>
  );
}
`;
}

function generateHeroComponent(appName = "ProApp", prompt = "") {
  const assets = getImagesForProject(prompt);
  return `import * as React from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ArrowRight, Star, ShieldCheck, Zap } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-32">
      <div className="container mx-auto max-w-7xl px-4 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <Badge variant="default" className="gap-1.5 py-1 px-3.5 text-xs">
              <Zap className="h-3.5 w-3.5 fill-primary" /> Nueva Versión 2.0 Lista
            </Badge>

            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-foreground leading-[1.1]">
              La plataforma definitiva para <span className="bg-gradient-to-r from-primary via-indigo-500 to-purple-600 bg-clip-text text-transparent">escalar tus resultados</span>
            </h1>

            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto lg:mx-0 font-normal leading-relaxed">
              Diseñada con tecnología de vanguardia, experiencia de usuario fluida y alto rendimiento para llevar tu negocio al siguiente nivel.
            </p>

            <div className="flex flex-col sm:flex-row gap-3.5 justify-center lg:justify-start pt-2">
              <Button size="lg" variant="primary">
                Empieza ahora sin costo <ArrowRight className="h-5 w-5" />
              </Button>
              <Button size="lg" variant="outline">
                Ver Demo en Vivo
              </Button>
            </div>

            <div className="pt-6 flex items-center justify-center lg:justify-start gap-6 text-xs text-muted-foreground font-medium">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Sin tarjeta de crédito
              </div>
              <div className="flex items-center gap-1.5">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                4.9/5 estrellas (2,400+ usuarios)
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 relative">
            <div className="relative mx-auto rounded-3xl p-2 bg-gradient-to-tr from-primary/30 to-purple-500/20 shadow-2xl backdrop-blur-xl">
              <img
                src="${assets.heroUrl}"
                alt="${appName} Hero visual"
                className="w-full h-auto rounded-2xl object-cover shadow-lg aspect-[4/3]"
                loading="eager"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
`;
}

function generateShowcaseComponent(prompt = "") {
  const assets = getImagesForProject(prompt);
  return `import * as React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ArrowUpRight } from "lucide-react";

export function Showcase() {
  const items = ${JSON.stringify(assets.products.slice(0, 4), null, 2)};

  return (
    <section id="showcase" className="py-20 bg-muted/40 border-y border-border/40">
      <div className="container mx-auto max-w-7xl px-4 sm:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
          <Badge variant="default">Explora el Catálogo</Badge>
          <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
            Diseñado para exigencias profesionales
          </h2>
          <p className="text-muted-foreground text-base sm:text-lg">
            Cada detalle ha sido cuidadosamente creado para ofrecer una experiencia estética y funcional sin compromisos.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {items.map((item, idx) => (
            <Card key={idx} className="group overflow-hidden p-0 border-border/80">
              <div className="overflow-hidden aspect-video relative">
                <img
                  src={item.url}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-5 space-y-3">
                <CardHeader className="p-0">
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                  <CardDescription>Calidad y rendimiento garantizados</CardDescription>
                </CardHeader>
                <CardContent className="p-0 pt-2 flex items-center justify-between">
                  <Badge variant="success">Disponible</Badge>
                  <Button variant="ghost" size="sm">
                    Detalles <ArrowUpRight className="h-4 w-4" />
                  </Button>
                </CardContent>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
`;
}

function generateFooterComponent(appName = "ProApp") {
  return `import * as React from "react";
import { Sparkles } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border bg-card py-12 text-sm text-muted-foreground">
      <div className="container mx-auto max-w-7xl px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2 font-bold text-foreground">
          <div className="h-6 w-6 rounded-lg bg-primary flex items-center justify-center text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          ${appName}
        </div>
        <p className="text-center sm:text-left">
          © {new Date().getFullYear()} ${appName}. Todos los derechos reservados.
        </p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-foreground transition-colors">Privacidad</a>
          <a href="#" className="hover:text-foreground transition-colors">Términos</a>
          <a href="#" className="hover:text-foreground transition-colors">Contacto</a>
        </div>
      </div>
    </footer>
  );
}
`;
}

function generateAppTsx(appName = "ProApp", prompt = "") {
  return `import * as React from "react";
import { Navbar } from "@/components/layout/Navbar";
import { Hero } from "@/components/sections/Hero";
import { Showcase } from "@/components/sections/Showcase";
import { Footer } from "@/components/layout/Footer";

export function App() {
  return (
    <div className="min-h-screen flex flex-col bg-background selection:bg-primary/20">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <Showcase />
      </main>
      <Footer />
    </div>
  );
}

export default App;
`;
}

function generateMainTsx() {
  return `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

function generateInputComponent() {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, label, ...props }, ref) => {
    return (
      <div className="w-full space-y-1.5">
        {label && <label className="text-sm font-medium text-foreground">{label}</label>}
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all",
            error && "border-destructive focus-visible:ring-destructive",
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";
`;
}

function generateDialogComponent() {
  return `import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-50 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl transition-transform duration-200">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}
`;
}

function generateTabsComponent() {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  className,
}: {
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex space-x-1 rounded-xl bg-muted p-1 border border-border/50", className)}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all",
              isActive
                ? "bg-background text-foreground shadow-sm font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
`;
}

function generateTableComponent() {
  return `import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({
  headers,
  rows,
  className,
}: {
  headers: string[];
  rows: (string | React.ReactNode)[][];
  className?: string;
}) {
  return (
    <div className={cn("w-full overflow-hidden rounded-xl border border-border bg-card", className)}>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-muted/50 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className="px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-foreground">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
`;
}

function generateChartWidgetComponent() {
  return `import * as React from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./Card";

export function ChartWidget({
  title = "Métricas Clave",
  description = "Rendimiento y crecimiento reciente",
  data = [40, 65, 55, 80, 70, 95, 110],
  labels = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"],
}: {
  title?: string;
  description?: string;
  data?: number[];
  labels?: string[];
}) {
  const max = Math.max(...data, 1);
  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full">
            <TrendingUp className="h-3.5 w-3.5" />
            +24.5%
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-3 h-40 pt-4">
          {data.map((val, idx) => {
            const heightPct = Math.round((val / max) * 100);
            return (
              <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                <div
                  style={{ height: \`\${heightPct}%\` }}
                  className="w-full rounded-t-md bg-primary/80 group-hover:bg-primary transition-all duration-300 relative"
                >
                  <span className="opacity-0 group-hover:opacity-100 absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] font-semibold bg-popover text-popover-foreground px-1.5 py-0.5 rounded shadow transition-opacity pointer-events-none">
                    {val}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground font-medium">{labels[idx]}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
`;
}

function scaffoldGreenfieldApp(projectRoot, { prompt = "", appName = "ProApp" } = {}) {
  const root = path.resolve(projectRoot);
  fs.mkdirSync(root, { recursive: true });

  const files = {
    "package.json": generatePackageJson(appName),
    "vite.config.ts": generateViteConfig(),
    "tsconfig.json": generateTsConfig(),
    "tsconfig.node.json": generateTsConfigNode(),
    "tailwind.config.js": generateTailwindConfig(),
    "postcss.config.js": generatePostcssConfig(),
    "index.html": generateIndexHtml(appName),
    "public/logo.svg": generateSvgLogo({ name: appName }),
    "src/index.css": generateIndexCss(),
    "src/lib/utils.ts": generateUtilsTs(),
    "src/components/ui/Button.tsx": generateButtonComponent(),
    "src/components/ui/Card.tsx": generateCardComponent(),
    "src/components/ui/Badge.tsx": generateBadgeComponent(),
    "src/components/ui/Input.tsx": generateInputComponent(),
    "src/components/ui/Dialog.tsx": generateDialogComponent(),
    "src/components/ui/Tabs.tsx": generateTabsComponent(),
    "src/components/ui/Table.tsx": generateTableComponent(),
    "src/components/ui/ChartWidget.tsx": generateChartWidgetComponent(),
    "src/components/layout/Navbar.tsx": generateNavbarComponent(appName),
    "src/components/layout/Footer.tsx": generateFooterComponent(appName),
    "src/components/sections/Hero.tsx": generateHeroComponent(appName, prompt),
    "src/components/sections/Showcase.tsx": generateShowcaseComponent(prompt),
    "src/App.tsx": generateAppTsx(appName, prompt),
    "src/main.tsx": generateMainTsx(),
    "README.md": `# ${appName}\n\nAplicación profesional creada con EditCore AI.\n\n## Tecnologías\n- React + Vite + TypeScript\n- Tailwind CSS + UI Components\n- Lucide Icons\n\n## Ejecución\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`,
  };

  const written = [];
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(root, ...relPath.split("/"));
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
    written.push(relPath);
  }

  return {
    ok: true,
    projectRoot: root,
    appName,
    filesCount: written.length,
    files: written,
  };
}

module.exports = {
  scaffoldGreenfieldApp,
  generatePackageJson,
  generateViteConfig,
  generateTailwindConfig,
  generateIndexCss,
};
