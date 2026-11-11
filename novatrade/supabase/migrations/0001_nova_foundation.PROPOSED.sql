-- NovaTrade AI migration 1 of 2: foundation (settings, risk, secrets, connections, order audit).
--
-- STATUS: PROPOSED. NOT APPLIED to any database. Review it, then apply it yourself to the project you choose.
--
-- Conventions
--  * Every new object is prefixed nova_ so it cannot collide with tables you already have.
--  * Every table has Row Level Security ENABLED, with explicit policies.
--  * Secrets (broker keys, AI keys) are stored AES-256-GCM encrypted by the server in nova_secrets.
--    The browser roles (anon, authenticated) have no privileges on that table at all.
--  * Writes that move money or change trust (live mode, connections, audit) happen only through server
--    routes using the service role; there are no client write policies for them.
--  * Admin checks use your existing public.user_roles table (role = 'admin').

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Admin roles table. Created only if your project does not already have one (fresh projects do not).
create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role = 'admin'),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;
revoke all on public.user_roles from anon, authenticated;

create or replace function public.nova_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles r where r.user_id = auth.uid() and r.role = 'admin');
$$;
revoke all on function public.nova_is_admin() from public, anon;
grant execute on function public.nova_is_admin() to authenticated;

create or replace function public.nova_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution settings. Analysis Only is the default.
-- ---------------------------------------------------------------------------
create table public.nova_user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  execution_mode text not null default 'analysis' check (execution_mode in ('analysis', 'paper', 'live')),
  live_enabled boolean not null default false,       -- explicit user opt-in, set by server after typed confirmation
  live_unlocked_at timestamptz,                      -- set by server only after all five unlock checks pass
  emergency_stop boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger nova_user_settings_touch before update on public.nova_user_settings
  for each row execute function public.nova_touch_updated_at();
alter table public.nova_user_settings enable row level security;

create policy "settings: owner read" on public.nova_user_settings for select to authenticated
  using (user_id = auth.uid());
create policy "settings: owner insert analysis" on public.nova_user_settings for insert to authenticated
  with check (user_id = auth.uid() and execution_mode = 'analysis');
create policy "settings: owner update (never to live)" on public.nova_user_settings for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and execution_mode in ('analysis', 'paper'));

-- Column-level privileges: the browser can change mode and emergency stop, never the live flags.
revoke insert, update on public.nova_user_settings from authenticated;
grant insert (user_id) on public.nova_user_settings to authenticated;
grant update (execution_mode, emergency_stop) on public.nova_user_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Risk limits (apply to all four engines)
-- ---------------------------------------------------------------------------
create table public.nova_risk_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  require_stop_loss boolean not null default true,
  max_order_value numeric check (max_order_value > 0),
  max_position_pct numeric check (max_position_pct > 0 and max_position_pct <= 100),
  max_concentration_pct numeric check (max_concentration_pct > 0 and max_concentration_pct <= 100),
  max_leverage numeric check (max_leverage >= 1),
  max_risk_per_trade_pct numeric check (max_risk_per_trade_pct > 0 and max_risk_per_trade_pct <= 100),
  daily_loss_limit numeric check (daily_loss_limit > 0),
  weekly_loss_limit numeric check (weekly_loss_limit > 0),
  max_drawdown_pct numeric check (max_drawdown_pct > 0 and max_drawdown_pct <= 100),
  max_volume_participation_pct numeric check (max_volume_participation_pct > 0 and max_volume_participation_pct <= 100),
  updated_at timestamptz not null default now()
);
create trigger nova_risk_limits_touch before update on public.nova_risk_limits
  for each row execute function public.nova_touch_updated_at();
alter table public.nova_risk_limits enable row level security;
create policy "risk: owner all" on public.nova_risk_limits for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Encrypted secrets. No access for browser roles.
-- ---------------------------------------------------------------------------
create table public.nova_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('broker', 'ai_provider')),
  ciphertext text not null,               -- v1:<iv>:<tag>:<ct>, produced by the server
  hint text,                              -- last 4 characters, for display only
  created_at timestamptz not null default now()
);
create index nova_secrets_user_idx on public.nova_secrets (user_id);
alter table public.nova_secrets enable row level security;
revoke all on public.nova_secrets from anon, authenticated;
-- Intentionally no policies: only the service role (which bypasses RLS) can read or write.

-- ---------------------------------------------------------------------------
-- Broker / exchange connections (metadata; the key itself is in nova_secrets)
-- ---------------------------------------------------------------------------
create table public.nova_broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  label text,
  environment text not null check (environment in ('paper', 'live')),
  account_ref text,
  secret_id uuid references public.nova_secrets(id) on delete set null,
  permissions jsonb not null default '[]'::jsonb,
  withdrawal_permission boolean,          -- null = could not be verified (live stays locked)
  trading_permission boolean,
  permissions_verified boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'connected', 'error', 'disconnected')),
  last_error text,
  last_tested_at timestamptz,
  execution_test_passed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint nova_no_withdrawal_keys check (withdrawal_permission is distinct from true)
);
create index nova_broker_connections_user_idx on public.nova_broker_connections (user_id);
alter table public.nova_broker_connections enable row level security;
create policy "connections: owner read" on public.nova_broker_connections for select to authenticated
  using (user_id = auth.uid());
create policy "connections: admin read" on public.nova_broker_connections for select to authenticated
  using (public.nova_is_admin());
revoke insert, update, delete on public.nova_broker_connections from authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent order submission: one row per (user, key). The primary key blocks duplicates.
-- ---------------------------------------------------------------------------
create table public.nova_order_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  status text not null default 'claimed' check (status in ('claimed', 'completed')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, idempotency_key)
);
alter table public.nova_order_requests enable row level security;
create policy "order requests: owner read" on public.nova_order_requests for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.nova_order_requests from authenticated;

-- ---------------------------------------------------------------------------
-- Order audit log. Append-only: UPDATE and DELETE are rejected for every role.
-- ---------------------------------------------------------------------------
create table public.nova_order_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.nova_broker_connections(id) on delete set null,
  engine text check (engine in ('copy', 'algo', 'autonomous', 'hybrid')),
  mode text not null check (mode in ('analysis', 'paper', 'live')),
  idempotency_key text not null,
  event text not null check (event in ('analysis_only', 'submitted', 'accepted', 'rejected', 'modified', 'cancelled', 'filled', 'blocked_by_risk', 'blocked_by_gate')),
  broker_order_id text,                   -- set only when the broker returned one
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index nova_order_audit_user_idx on public.nova_order_audit (user_id, id desc);
create index nova_order_audit_filled_idx on public.nova_order_audit (id) where event = 'filled' and mode = 'live';

create or replace function public.nova_audit_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'nova_order_audit is append-only';
end;
$$;
create trigger nova_order_audit_no_update before update or delete on public.nova_order_audit
  for each row execute function public.nova_audit_immutable();

alter table public.nova_order_audit enable row level security;
create policy "audit: owner read" on public.nova_order_audit for select to authenticated
  using (user_id = auth.uid());
create policy "audit: admin read" on public.nova_order_audit for select to authenticated
  using (public.nova_is_admin());
revoke insert, update, delete on public.nova_order_audit from authenticated;

-- ---------------------------------------------------------------------------
-- Rolling equity memory (peak / day start / week start) used by the risk engine
-- ---------------------------------------------------------------------------
create table public.nova_equity_memory (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,                    -- 'paper' or a connection id
  memory jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);
alter table public.nova_equity_memory enable row level security;
create policy "equity memory: owner read" on public.nova_equity_memory for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.nova_equity_memory from authenticated;

-- ---------------------------------------------------------------------------
-- Security events, notifications, subscriptions, platform config, API usage
-- ---------------------------------------------------------------------------
create table public.nova_security_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.nova_security_events enable row level security;
create policy "security events: admin read" on public.nova_security_events for select to authenticated
  using (public.nova_is_admin());
revoke insert, update, delete on public.nova_security_events from authenticated;

create table public.nova_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index nova_notifications_user_idx on public.nova_notifications (user_id, created_at desc);
alter table public.nova_notifications enable row level security;
create policy "notifications: owner read" on public.nova_notifications for select to authenticated
  using (user_id = auth.uid());
create policy "notifications: owner mark read" on public.nova_notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.nova_notifications from authenticated;
grant update (read) on public.nova_notifications to authenticated;

create table public.nova_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  updated_at timestamptz not null default now()
);
alter table public.nova_subscriptions enable row level security;
create policy "subscriptions: owner read" on public.nova_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy "subscriptions: admin all" on public.nova_subscriptions for all to authenticated
  using (public.nova_is_admin()) with check (public.nova_is_admin());

create table public.nova_platform_config (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.nova_platform_config enable row level security;
create policy "platform config: admin all" on public.nova_platform_config for all to authenticated
  using (public.nova_is_admin()) with check (public.nova_is_admin());

create table public.nova_api_usage (
  day date not null default current_date,
  provider text not null,
  calls integer not null default 0,
  errors integer not null default 0,
  primary key (day, provider)
);
alter table public.nova_api_usage enable row level security;
create policy "api usage: admin read" on public.nova_api_usage for select to authenticated
  using (public.nova_is_admin());
revoke insert, update, delete on public.nova_api_usage from authenticated;
