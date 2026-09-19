-- ==============================================================================
-- EDITCOREAI - ESQUEMA COMPLETO CON SISTEMA DE CRÉDITOS
-- Supabase: https://supabase.gafcore.com/editcore-ai
-- Ejecutar en SQL Editor de Supabase GafCore
-- ==============================================================================

-- 1. EXTENSIONES
create extension if not exists "uuid-ossp";

-- ==============================================================================
-- 2. TABLA DE PERFILES DE USUARIO
-- ==============================================================================
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  role text default 'user' check (role in ('admin', 'user', 'auditor')),
  is_unlimited boolean default false,
  credits_balance numeric(12,4) default 25,
  total_credits_purchased numeric(12,4) default 0,
  total_credits_used numeric(12,4) default 0,
  avatar_url text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.profiles enable row level security;

create policy "usuarios ven su perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "usuarios actualizan su perfil"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "admin acceso total perfiles"
  on public.profiles for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or email = 'aperezavilez@gmail.com')
    )
  );

-- ==============================================================================
-- 3. TABLA DE TRANSACCIONES (LEDGER COMPLETO)
-- ==============================================================================
create table if not exists public.credit_transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  amount numeric(12,4) not null,  -- positivo = ingreso, negativo = consumo
  type text check (type in (
    'recharge_stripe',
    'recharge_mercadopago',
    'usage_ai',
    'voucher',
    'admin_gift',
    'welcome_bonus',
    'refund'
  )) not null,
  model_used text,
  tokens_input int default 0,
  tokens_output int default 0,
  cost_usd numeric(10,6) default 0,  -- costo real al proveedor en USD
  reference_id text,
  description text,
  balance_after numeric(12,4),  -- saldo del usuario después de la transacción
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.credit_transactions enable row level security;

create policy "usuarios ven sus transacciones"
  on public.credit_transactions for select
  using (auth.uid() = user_id);

create policy "admin ve todas las transacciones"
  on public.credit_transactions for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or email = 'aperezavilez@gmail.com')
    )
  );

-- ==============================================================================
-- 4. TABLA DE ÓRDENES DE PAGO
-- ==============================================================================
create table if not exists public.payment_orders (
  id text primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  user_email text not null,
  gateway text check (gateway in ('stripe', 'mercadopago')) not null,
  credits int not null,
  amount_usd numeric(10,2) not null,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected', 'refunded')),
  gateway_payment_id text,
  created_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.payment_orders enable row level security;

create policy "usuarios ven sus ordenes"
  on public.payment_orders for select
  using (auth.uid() = user_id);

-- ==============================================================================
-- 5. TABLA DE POOL DEL ADMINISTRADOR (saldo maestro de créditos)
-- ==============================================================================
create table if not exists public.admin_pool (
  id int primary key default 1,  -- solo 1 fila
  total_credits_issued numeric(16,4) default 0,    -- créditos emitidos a usuarios
  total_credits_consumed numeric(16,4) default 0,  -- créditos consumidos en IA
  total_revenue_usd numeric(12,2) default 0,       -- dinero recibido de usuarios
  total_cost_usd numeric(12,2) default 0,          -- costo real pagado a proveedores
  updated_at timestamptz default timezone('utc'::text, now()) not null
);

-- Inicializar la fila del pool
insert into public.admin_pool (id) values (1) on conflict (id) do nothing;

-- Solo admin puede ver/editar
alter table public.admin_pool enable row level security;

create policy "solo admin ve el pool"
  on public.admin_pool for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and (role = 'admin' or email = 'aperezavilez@gmail.com')
    )
  );

-- ==============================================================================
-- 6. TABLA DE VOUCHERS / CUPONES
-- ==============================================================================
create table if not exists public.vouchers (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,
  credits_value int not null,
  max_uses int default 1,
  times_used int default 0,
  expires_at timestamptz,
  created_by uuid references public.profiles(id),
  is_active boolean default true,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

alter table public.vouchers enable row level security;

create policy "usuarios pueden ver vouchers activos"
  on public.vouchers for select
  using (is_active = true);

-- Insertar vouchers de ejemplo para el admin
insert into public.vouchers (code, credits_value, max_uses, is_active)
values
  ('EDITCORE100', 100, 10, true),
  ('PROMO2026', 50, 100, true),
  ('ADMINVIP', 500, 5, true)
on conflict (code) do nothing;

-- ==============================================================================
-- 7. FUNCIÓN ATÓMICA: DESCONTAR CRÉDITOS SEGURO (sin race conditions)
-- ==============================================================================
create or replace function public.deduct_credits(
  p_user_id uuid,
  p_credits numeric,
  p_model text,
  p_tokens_in int,
  p_tokens_out int,
  p_description text
)
returns json
language plpgsql
security definer
as $$
declare
  v_profile public.profiles%rowtype;
  v_new_balance numeric;
  v_cost_usd numeric;
begin
  -- Bloquear fila para actualización atómica
  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- Admins nunca se bloquean
  if v_profile.is_unlimited or v_profile.email = 'aperezavilez@gmail.com' then
    -- Igual registramos el uso para estadísticas
    insert into public.credit_transactions
      (user_id, amount, type, model_used, tokens_input, tokens_output, description, balance_after)
    values
      (p_user_id, -p_credits, 'usage_ai', p_model, p_tokens_in, p_tokens_out, p_description, 999999);

    return json_build_object('ok', true, 'unlimited', true, 'balance', 999999);
  end if;

  -- Verificar saldo suficiente
  if v_profile.credits_balance <= 0 then
    return json_build_object(
      'ok', false,
      'error', 'CREDITS_EXHAUSTED',
      'balance', v_profile.credits_balance
    );
  end if;

  -- Calcular nuevo saldo
  v_new_balance := greatest(0, v_profile.credits_balance - p_credits);

  -- Actualizar perfil
  update public.profiles
  set
    credits_balance = v_new_balance,
    total_credits_used = total_credits_used + p_credits,
    updated_at = now()
  where id = p_user_id;

  -- Registrar en ledger
  insert into public.credit_transactions
    (user_id, amount, type, model_used, tokens_input, tokens_output, description, balance_after)
  values
    (p_user_id, -p_credits, 'usage_ai', p_model, p_tokens_in, p_tokens_out, p_description, v_new_balance);

  -- Actualizar estadísticas del pool admin
  update public.admin_pool
  set
    total_credits_consumed = total_credits_consumed + p_credits,
    updated_at = now()
  where id = 1;

  return json_build_object(
    'ok', true,
    'credits_deducted', p_credits,
    'new_balance', v_new_balance,
    'low_balance', v_new_balance < 10,
    'exhausted', v_new_balance <= 0
  );
end;
$$;

-- ==============================================================================
-- 8. FUNCIÓN: AÑADIR CRÉDITOS (recargas, vouchers, regalos)
-- ==============================================================================
create or replace function public.add_credits(
  p_user_id uuid,
  p_credits numeric,
  p_type text,
  p_reference_id text default null,
  p_description text default null
)
returns json
language plpgsql
security definer
as $$
declare
  v_new_balance numeric;
begin
  update public.profiles
  set
    credits_balance = credits_balance + p_credits,
    total_credits_purchased = total_credits_purchased + p_credits,
    updated_at = now()
  where id = p_user_id
  returning credits_balance into v_new_balance;

  if not found then
    return json_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  -- Registrar en ledger
  insert into public.credit_transactions
    (user_id, amount, type, reference_id, description, balance_after)
  values
    (p_user_id, p_credits, p_type, p_reference_id, p_description, v_new_balance);

  -- Actualizar pool admin
  update public.admin_pool
  set
    total_credits_issued = total_credits_issued + p_credits,
    updated_at = now()
  where id = 1;

  return json_build_object(
    'ok', true,
    'credits_added', p_credits,
    'new_balance', v_new_balance
  );
end;
$$;

-- ==============================================================================
-- 9. FUNCIÓN: CANJEAR VOUCHER
-- ==============================================================================
create or replace function public.redeem_voucher(
  p_user_id uuid,
  p_code text
)
returns json
language plpgsql
security definer
as $$
declare
  v_voucher public.vouchers%rowtype;
  v_new_balance numeric;
begin
  -- Buscar voucher válido
  select * into v_voucher
  from public.vouchers
  where code = upper(p_code) and is_active = true
  for update;

  if not found then
    return json_build_object('ok', false, 'error', 'VOUCHER_NOT_FOUND', 'message', 'Cupón inválido o ya no disponible.');
  end if;

  -- Verificar usos disponibles
  if v_voucher.times_used >= v_voucher.max_uses then
    return json_build_object('ok', false, 'error', 'VOUCHER_EXHAUSTED', 'message', 'Este cupón ya alcanzó su límite de usos.');
  end if;

  -- Verificar expiración
  if v_voucher.expires_at is not null and v_voucher.expires_at < now() then
    return json_build_object('ok', false, 'error', 'VOUCHER_EXPIRED', 'message', 'Este cupón ha expirado.');
  end if;

  -- Incrementar uso del voucher
  update public.vouchers
  set
    times_used = times_used + 1,
    is_active = (times_used + 1 < max_uses)
  where id = v_voucher.id;

  -- Añadir créditos al usuario
  update public.profiles
  set
    credits_balance = credits_balance + v_voucher.credits_value,
    total_credits_purchased = total_credits_purchased + v_voucher.credits_value,
    updated_at = now()
  where id = p_user_id
  returning credits_balance into v_new_balance;

  -- Registrar en ledger
  insert into public.credit_transactions
    (user_id, amount, type, reference_id, description, balance_after)
  values
    (p_user_id, v_voucher.credits_value, 'voucher', v_voucher.code,
     'Cupón canjeado: ' || v_voucher.code, v_new_balance);

  return json_build_object(
    'ok', true,
    'credits_added', v_voucher.credits_value,
    'new_balance', v_new_balance,
    'message', '¡Cupón canjeado! Se añadieron ' || v_voucher.credits_value || ' créditos a tu cuenta.'
  );
end;
$$;

-- ==============================================================================
-- 10. TRIGGER: CREAR PERFIL AUTOMÁTICAMENTE AL REGISTRARSE
-- ==============================================================================
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_is_admin boolean;
  v_welcome_credits numeric := 25;
begin
  v_is_admin := (new.email = 'aperezavilez@gmail.com');

  if v_is_admin then
    -- Admin: saldo ilimitado
    insert into public.profiles (id, email, full_name, role, is_unlimited, credits_balance)
    values (new.id, new.email, 'Alfonso Perez Avilez', 'admin', true, 999999)
    on conflict (id) do update
      set role = 'admin', is_unlimited = true, credits_balance = 999999;
  else
    -- Usuario normal: 25 créditos de bienvenida
    insert into public.profiles (id, email, full_name, role, is_unlimited, credits_balance)
    values (new.id, new.email, split_part(new.email, '@', 1), 'user', false, v_welcome_credits)
    on conflict (id) do nothing;

    -- Registrar bono de bienvenida en el ledger
    insert into public.credit_transactions
      (user_id, amount, type, description, balance_after)
    values
      (new.id, v_welcome_credits, 'welcome_bonus', 'Bono de bienvenida — 25 créditos gratis', v_welcome_credits);

    -- Actualizar pool admin (créditos emitidos como bienvenida)
    update public.admin_pool
    set total_credits_issued = total_credits_issued + v_welcome_credits
    where id = 1;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==============================================================================
-- 11. VISTA: DASHBOARD ADMIN — resumen de usuarios y consumo
-- ==============================================================================
create or replace view public.admin_user_summary as
select
  p.id,
  p.email,
  p.role,
  p.is_unlimited,
  round(p.credits_balance, 2) as credits_balance,
  round(p.total_credits_purchased, 2) as total_purchased,
  round(p.total_credits_used, 2) as total_used,
  p.created_at,
  count(ct.id) filter (where ct.type = 'usage_ai') as total_ai_calls,
  count(po.id) filter (where po.status = 'approved') as total_payments
from public.profiles p
left join public.credit_transactions ct on ct.user_id = p.id
left join public.payment_orders po on po.user_id = p.id
group by p.id, p.email, p.role, p.is_unlimited, p.credits_balance,
         p.total_credits_purchased, p.total_credits_used, p.created_at;
