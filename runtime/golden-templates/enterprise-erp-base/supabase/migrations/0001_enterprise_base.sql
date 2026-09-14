-- EDITCOREAI enterprise-erp-base schema (Stage 1)
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
