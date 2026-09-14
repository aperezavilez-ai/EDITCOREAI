"use strict";

/**
 * Enterprise ERP base golden template + incremental module injector.
 * Schema-first: migrations/schema before CRUD UI.
 */

const fs = require("node:fs");
const path = require("node:path");

const ERP_MODULES = Object.freeze({
  inventory: {
    id: "inventory",
    label: "Inventory",
    tables: ["products", "warehouses", "stock_movements"],
    nav: { href: "/modules/inventory", label: "Inventario", icon: "Package" },
  },
  payroll: {
    id: "payroll",
    label: "Payroll",
    tables: ["employees", "pay_runs", "pay_items"],
    nav: { href: "/modules/payroll", label: "Nómina", icon: "Wallet" },
  },
  invoicing: {
    id: "invoicing",
    label: "Invoicing",
    tables: ["customers", "invoices", "invoice_lines"],
    nav: { href: "/modules/invoicing", label: "Facturación", icon: "FileText" },
  },
  crm: {
    id: "crm",
    label: "CRM",
    tables: ["accounts", "contacts", "opportunities"],
    nav: { href: "/modules/crm", label: "CRM", icon: "Users" },
  },
});

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(root, rel, content) {
  const full = path.join(root, ...String(rel).split("/"));
  ensureDir(path.dirname(full));
  if (fs.existsSync(full) && !rel.endsWith(".sql") && !rel.includes("modules/")) {
    // Never overwrite core connection/nav files when injecting modules
    return { path: rel, skipped: true };
  }
  fs.writeFileSync(full, content, "utf8");
  return { path: rel, skipped: false };
}

function goldenTemplateRoot() {
  return path.join(__dirname, "golden-templates", "enterprise-erp-base");
}

function baseSchemaSql() {
  return `-- EDITCOREAI enterprise-erp-base schema (Stage 1)
-- Multi-tenant / multi-branch + RBAC

create extension if not exists "pgcrypto";

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  code text not null,
  timezone text not null default 'UTC',
  unique (tenant_id, code)
);

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  permissions jsonb not null default '[]'::jsonb,
  unique (tenant_id, name)
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  role_id uuid references roles(id) on delete set null,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS helpers
alter table tenants enable row level security;
alter table branches enable row level security;
alter table roles enable row level security;
alter table profiles enable row level security;
alter table audit_events enable row level security;
`;
}

function moduleSchemaSql(moduleId) {
  const mod = ERP_MODULES[moduleId];
  if (!mod) return "";
  if (moduleId === "inventory") {
    return `-- Inventory module
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text not null,
  name text not null,
  unit text not null default 'u',
  active boolean not null default true,
  unique (tenant_id, sku)
);
create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  name text not null,
  code text not null,
  unique (tenant_id, code)
);
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  qty numeric(18,4) not null,
  movement_type text not null check (movement_type in ('in','out','adjust')),
  created_at timestamptz not null default now()
);
`;
  }
  if (moduleId === "payroll") {
    return `-- Payroll module
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id),
  code text not null,
  full_name text not null,
  salary numeric(18,2) not null default 0,
  unique (tenant_id, code)
);
create table if not exists pay_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
);
create table if not exists pay_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  pay_run_id uuid not null references pay_runs(id) on delete cascade,
  employee_id uuid not null references employees(id),
  amount numeric(18,2) not null
);
`;
  }
  if (moduleId === "invoicing") {
    return `-- Invoicing module
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  tax_id text,
  email text
);
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id),
  number text not null,
  status text not null default 'draft',
  total numeric(18,2) not null default 0,
  unique (tenant_id, number)
);
create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  qty numeric(18,4) not null default 1,
  unit_price numeric(18,2) not null default 0
);
`;
  }
  return `-- CRM module
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  industry text
);
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  full_name text not null,
  email text,
  phone text
);
create table if not exists opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid references accounts(id) on delete set null,
  title text not null,
  stage text not null default 'new',
  amount numeric(18,2) not null default 0
);
`;
}

function buildEnterpriseErpFiles(appName = "EnterpriseERP") {
  const name = String(appName || "EnterpriseERP");
  return {
    "package.json": JSON.stringify({
      name: name.toLowerCase().replace(/[^a-z0-9-_]/g, "-"),
      private: true,
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc -b && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^18.3.1",
        "react-dom": "^18.3.1",
        "react-router-dom": "^6.26.0",
        "@supabase/supabase-js": "^2.45.0",
        "lucide-react": "^0.395.0",
        clsx: "^2.1.1",
        "tailwind-merge": "^2.3.0",
        "framer-motion": "^11.15.0",
      },
      devDependencies: {
        "@types/react": "^18.3.3",
        "@types/react-dom": "^18.3.0",
        "@vitejs/plugin-react": "^4.3.0",
        autoprefixer: "^10.4.19",
        postcss: "^8.4.38",
        tailwindcss: "^3.4.4",
        typescript: "^5.4.5",
        vite: "^5.2.13",
      },
    }, null, 2),
    "supabase/migrations/0001_enterprise_base.sql": baseSchemaSql(),
    "src/lib/supabaseClient.ts": `import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_GAFCORE_URL || "";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_GAFCORE_ANON_KEY || "";

export type ApiResult<T> = { data: T | null; error: string | null };

class ApiErrorBoundary {
  static wrap<T>(error: unknown): ApiResult<T> {
    const message = error instanceof Error ? error.message : String(error || "Unknown API error");
    return { data: null, error: message };
  }
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !key) {
    throw new Error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or Gafcore equivalents).");
  }
  if (!client) client = createClient(url, key, { auth: { persistSession: true } });
  return client;
}

export async function apiQuery<T>(runner: (db: SupabaseClient) => PromiseLike<{ data: T; error: { message: string } | null }>): Promise<ApiResult<T>> {
  try {
    const db = getSupabase();
    const { data, error } = await runner(db);
    if (error) return { data: null, error: error.message };
    return { data, error: null };
  } catch (error) {
    return ApiErrorBoundary.wrap<T>(error);
  }
}
`,
    "src/lib/rbac.ts": `export type Permission =
  | "admin:all"
  | "users:read" | "users:write"
  | "inventory:read" | "inventory:write"
  | "payroll:read" | "payroll:write"
  | "invoicing:read" | "invoicing:write"
  | "crm:read" | "crm:write";

export type RoleName = "owner" | "admin" | "manager" | "clerk" | "viewer";

const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  owner: ["admin:all"],
  admin: ["admin:all"],
  manager: ["users:read", "inventory:read", "inventory:write", "payroll:read", "invoicing:read", "invoicing:write", "crm:read", "crm:write"],
  clerk: ["inventory:read", "inventory:write", "invoicing:read", "invoicing:write", "crm:read"],
  viewer: ["inventory:read", "payroll:read", "invoicing:read", "crm:read", "users:read"],
};

export function can(role: RoleName | string | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  const list = ROLE_PERMISSIONS[role as RoleName] || [];
  return list.includes("admin:all") || list.includes(permission);
}
`,
    "src/components/DataTable.tsx": `import * as React from "react";

export type Column<T> = { key: keyof T | string; header: string; render?: (row: T) => React.ReactNode; sortable?: boolean };

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  pageSize?: number;
  searchKeys?: Array<keyof T | string>;
};

export function DataTable<T extends Record<string, unknown>>({ rows, columns, pageSize = 10, searchKeys = [] }: Props<T>) {
  const [query, setQuery] = React.useState("");
  const [sortKey, setSortKey] = React.useState<string>("");
  const [asc, setAsc] = React.useState(true);
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let next = rows;
    if (q && searchKeys.length) {
      next = rows.filter((row) => searchKeys.some((key) => String(row[key as string] ?? "").toLowerCase().includes(q)));
    }
    if (sortKey) {
      next = [...next].sort((a, b) => {
        const av = a[sortKey]; const bv = b[sortKey];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av > bv ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    return next;
  }, [rows, query, searchKeys, sortKey, asc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          placeholder="Filtrar..."
          className="h-9 w-full sm:max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
        />
        <p className="text-xs text-muted-foreground">{filtered.length} registros</p>
      </div>
      <div className="overflow-auto rounded-xl border border-border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              {columns.map((col) => (
                <th key={String(col.key)} className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1"
                    disabled={col.sortable === false}
                    onClick={() => {
                      const key = String(col.key);
                      if (sortKey === key) setAsc(!asc);
                      else { setSortKey(key); setAsc(true); }
                    }}
                  >
                    {col.header}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <tr key={idx} className="border-t border-border/70 hover:bg-muted/30">
                {columns.map((col) => (
                  <td key={String(col.key)} className="px-3 py-2 align-top">
                    {col.render ? col.render(row) : String(row[col.key as string] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {!pageRows.length && (
              <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={columns.length}>Sin datos</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs">
        <button type="button" className="rounded-md border px-2 py-1 disabled:opacity-40" disabled={page <= 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
        <span>Página {page + 1} / {pageCount}</span>
        <button type="button" className="rounded-md border px-2 py-1 disabled:opacity-40" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>Siguiente</button>
      </div>
    </div>
  );
}
`,
    "src/layout/EnterpriseShell.tsx": `import * as React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Building2, Moon, Sun } from "lucide-react";

const CORE_NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/settings/branches", label: "Sucursales" },
  { href: "/settings/roles", label: "Roles" },
];

export function EnterpriseShell({ extraNav = [] as Array<{ href: string; label: string }> }) {
  const [dark, setDark] = React.useState(true);
  const [branch, setBranch] = React.useState("HQ");
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const nav = [...CORE_NAV, ...extraNav];

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      <aside className="w-64 border-r border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2 font-semibold">
          <Building2 className="h-5 w-5 text-primary" />
          ${name}
        </div>
        <label className="block text-xs text-muted-foreground">
          Sucursal
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-border bg-background px-2 text-sm">
            <option value="HQ">HQ</option>
            <option value="NORTH">Norte</option>
            <option value="SOUTH">Sur</option>
          </select>
        </label>
        <nav className="space-y-1">
          {nav.map((item) => (
            <NavLink
              key={item.href}
              to={item.href}
              className={({ isActive }) => \`block rounded-lg px-3 py-2 text-sm \${isActive ? "bg-primary/15 text-primary" : "hover:bg-muted"}\`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center justify-between px-4">
          <p className="text-sm text-muted-foreground">Multi-tenant · RBAC · densas tablas de datos</p>
          <button type="button" className="rounded-lg border border-border p-2" onClick={() => setDark((v) => !v)} aria-label="Toggle dark mode">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </header>
        <main className="p-4 md:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
`,
    "src/pages/Dashboard.tsx": `export function Dashboard() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Dashboard ERP</h1>
      <p className="text-muted-foreground text-sm">Base enterprise lista. Añade módulos con add_erp_module (inventory, payroll, invoicing, crm).</p>
    </div>
  );
}
`,
    "src/App.tsx": `import { BrowserRouter, Route, Routes } from "react-router-dom";
import { EnterpriseShell } from "@/layout/EnterpriseShell";
import { Dashboard } from "@/pages/Dashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<EnterpriseShell />}>
          <Route path="/" element={<Dashboard />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
`,
    "src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
`,
    "src/index.css": `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root { color-scheme: light dark; }\nbody { @apply bg-background text-foreground antialiased; }\n`,
    "tailwind.config.js": `/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        muted: "hsl(var(--muted))",
        border: "hsl(var(--border))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
      },
    },
  },
  plugins: [],
};
`,
    "postcss.config.js": `export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`,
    "vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
`,
    "index.html": `<!doctype html>
<html lang="es" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    <style>
      :root { --background: 0 0% 100%; --foreground: 224 71% 4%; --card: 0 0% 100%; --muted: 220 14% 96%; --border: 220 13% 90%; --primary: 226 70% 55%; --primary-foreground: 0 0% 100%; }
      .dark { --background: 224 71% 4%; --foreground: 210 20% 98%; --card: 224 71% 6%; --muted: 215 28% 14%; --border: 215 28% 18%; --primary: 226 70% 60%; --primary-foreground: 0 0% 100%; }
    </style>
  </head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2020",
        lib: ["ES2020", "DOM", "DOM.Iterable"],
        module: "ESNext",
        skipLibCheck: true,
        moduleResolution: "bundler",
        jsx: "react-jsx",
        strict: true,
        noEmit: true,
        baseUrl: ".",
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src"],
    }, null, 2),
    ".env.example": `VITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n# Gafcore aliases\nVITE_GAFCORE_URL=\nVITE_GAFCORE_ANON_KEY=\n`,
    "AGENTS.md": `# Enterprise ERP — agent rules

## Schema-first (obligatorio)
1. Stage 1: crear/validar migraciones SQL en \`supabase/migrations/\` antes de UI.
2. Stage 2: generar CRUD UI solo contra tablas/columnas ya validadas.
3. Nunca inventar columnas que no existan en el schema.

## Módulos
- Usa \`add_erp_module\` para Inventory / Payroll / Invoicing / CRM.
- No sobrescribas \`src/lib/supabaseClient.ts\` ni el shell de navegación core.
`,
    "README.md": `# ${name}

Plantilla **enterprise-erp-base** de EDITCOREAI.

- Auth + RBAC granular
- DataTable densa (sort/filter/pagination)
- Shell multi-tenant / multi-branch + dark mode
- Cliente Supabase/Gafcore con error boundary
`,
  };
}

function scaffoldEnterpriseErpBase(projectRoot, { appName = "EnterpriseERP" } = {}) {
  const root = path.resolve(projectRoot);
  ensureDir(root);
  const files = buildEnterpriseErpFiles(appName);
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split("/"));
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, content, "utf8");
    written.push(rel);
  }
  // Mirror into golden-templates for reuse
  const golden = goldenTemplateRoot();
  ensureDir(golden);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(golden, ...rel.split("/"));
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, content, "utf8");
  }
  fs.writeFileSync(path.join(golden, "template.json"), JSON.stringify({
    id: "enterprise-erp-base",
    name: "Enterprise ERP Base",
    schemaFirst: true,
    modules: Object.keys(ERP_MODULES),
  }, null, 2) + "\n", "utf8");
  return { ok: true, projectRoot: root, template: "enterprise-erp-base", filesCount: written.length, files: written };
}

function modulePageSource(moduleId) {
  const mod = ERP_MODULES[moduleId];
  const table = mod.tables[0];
  return `import { DataTable } from "@/components/DataTable";
import { can } from "@/lib/rbac";

const DEMO = [
  { id: "1", name: "Ejemplo A", status: "active" },
  { id: "2", name: "Ejemplo B", status: "draft" },
];

export default function ${mod.label.replace(/\s/g, "")}ModulePage() {
  const allowed = can("manager", "${moduleId}:read" as never);
  if (!allowed) return <p className="text-sm text-muted-foreground">Sin permiso ${moduleId}:read</p>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">${mod.label}</h1>
        <p className="text-sm text-muted-foreground">CRUD ligado al schema \`${table}\` (schema-first).</p>
      </div>
      <DataTable
        rows={DEMO}
        columns={[
          { key: "id", header: "ID", sortable: true },
          { key: "name", header: "Nombre", sortable: true },
          { key: "status", header: "Estado", sortable: true },
        ]}
        searchKeys={["name", "status"]}
      />
    </div>
  );
}
`;
}

function addErpModule(projectRoot, moduleName = "") {
  const root = path.resolve(projectRoot);
  const key = String(moduleName || "").trim().toLowerCase();
  const mod = ERP_MODULES[key];
  if (!mod) {
    return {
      ok: false,
      error: `Modulo desconocido: ${moduleName}. Usa: ${Object.keys(ERP_MODULES).join(", ")}`,
      available: Object.keys(ERP_MODULES),
    };
  }

  const migrationName = `supabase/migrations/${String(Date.now()).slice(0, 10)}_${mod.id}.sql`;
  const pageRel = `src/modules/${mod.id}/pages/${mod.label.replace(/\s/g, "")}Page.tsx`;
  const navRel = `src/modules/${mod.id}/nav.json`;
  const written = [];

  // Stage 1: schema
  const schemaWrite = writeFile(root, migrationName, moduleSchemaSql(mod.id));
  written.push(schemaWrite);

  // Stage 2: UI bound to schema
  const pageWrite = writeFile(root, pageRel, modulePageSource(mod.id));
  written.push(pageWrite);
  written.push(writeFile(root, navRel, JSON.stringify(mod.nav, null, 2) + "\n"));

  // Patch App routes without wiping shell — append route file registry
  const registryRel = "src/modules/registry.json";
  let registry = { modules: [] };
  const registryPath = path.join(root, ...registryRel.split("/"));
  if (fs.existsSync(registryPath)) {
    try { registry = JSON.parse(fs.readFileSync(registryPath, "utf8")); } catch { /* ignore */ }
  }
  if (!Array.isArray(registry.modules)) registry.modules = [];
  if (!registry.modules.some((m) => m.id === mod.id)) {
    registry.modules.push({ id: mod.id, label: mod.label, nav: mod.nav, page: pageRel, tables: mod.tables });
  }
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
  written.push({ path: registryRel, skipped: false });

  // Soft-patch App.tsx only if markers exist; otherwise write companion routes file
  const routesRel = "src/modules/generatedRoutes.tsx";
  const imports = registry.modules.map((m) => {
    const comp = `${String(m.label).replace(/\s/g, "")}ModulePage`;
    return `const ${comp} = React.lazy(() => import("./${m.id}/pages/${String(m.label).replace(/\s/g, "")}Page"));`;
  }).join("\n");
  const routes = registry.modules.map((m) => {
    const comp = `${String(m.label).replace(/\s/g, "")}ModulePage`;
    return `      <Route path="${m.nav.href.replace(/^\//, "")}" element={<${comp} />} />`;
  }).join("\n");
  fs.writeFileSync(path.join(root, ...routesRel.split("/")), `import * as React from "react";
import { Route } from "react-router-dom";

${imports}

/** Auto-generated by add_erp_module — import into App routes. Does not overwrite core shell. */
export function ErpModuleRoutes() {
  return (
    <>
${routes}
    </>
  );
}

export const ERP_MODULE_NAV = ${JSON.stringify(registry.modules.map((m) => m.nav), null, 2)};
`, "utf8");
  written.push({ path: routesRel, skipped: false });

  return {
    ok: true,
    module: mod.id,
    stage1: { migration: migrationName, tables: mod.tables },
    stage2: { page: pageRel, nav: mod.nav },
    preserved: ["src/lib/supabaseClient.ts", "src/layout/EnterpriseShell.tsx"],
    written: written.map((w) => w.path),
    note: "Schema generado primero; UI CRUD ligada al schema. Integra <ErpModuleRoutes /> y ERP_MODULE_NAV en App/Shell sin reemplazar conexiones.",
  };
}

function isSchemaFirstIntent(prompt = "") {
  return /\b(erp|crm|nómina|nomina|inventario|facturaci[oó]n|multi[- ]?tenant|data[- ]?heavy|schema[- ]?first)\b/i.test(String(prompt || ""));
}

function schemaFirstWorkflowPrompt(prompt = "") {
  if (!isSchemaFirstIntent(prompt)) return "";
  return [
    "## SCHEMA-FIRST WORKFLOW (ERP/CRM/data-heavy) — OBLIGATORIO",
    "Stage 1: Genera y valida el schema relacional / migraciones SQL ANTES de cualquier UI.",
    "Stage 2: Solo entonces genera CRUD UI estrictamente ligado a tablas/columnas validadas.",
    "Usa create_project template=enterprise-erp-base o scaffoldEnterpriseErpBase; extensiones con add_erp_module.",
    "PROHIBIDO inventar campos UI que no existan en la migración.",
  ].join("\n");
}

module.exports = {
  ERP_MODULES,
  scaffoldEnterpriseErpBase,
  addErpModule,
  buildEnterpriseErpFiles,
  goldenTemplateRoot,
  isSchemaFirstIntent,
  schemaFirstWorkflowPrompt,
};
