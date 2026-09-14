import * as React from "react";
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
          NovaERP
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
              className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? "bg-primary/15 text-primary" : "hover:bg-muted"}`}
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
