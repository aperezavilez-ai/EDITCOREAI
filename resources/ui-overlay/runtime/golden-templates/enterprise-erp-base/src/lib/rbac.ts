export type Permission =
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
