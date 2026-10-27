-- TradePilot AI: connectors, risk settings, strategies, trades, signals.

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exchange text not null default 'binance' check (exchange in ('binance')),
  label text not null default '',
  api_key_enc text not null,      -- AES-256-GCM ciphertext (see lib/crypto.ts)
  api_secret_enc text not null,
  testnet boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.risk_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  max_risk_pct numeric not null default 1 check (max_risk_pct > 0 and max_risk_pct <= 10),
  max_open_trades int not null default 3 check (max_open_trades between 1 and 20),
  daily_loss_limit_pct numeric not null default 3 check (daily_loss_limit_pct > 0 and daily_loss_limit_pct <= 50),
  paper_balance numeric not null default 10000 check (paper_balance > 0),
  live_enabled boolean not null default false
);

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('paper','live')),
  connection_id uuid references public.connections(id) on delete set null,
  strategy_id uuid references public.strategies(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  qty numeric not null,
  entry numeric not null,
  stop numeric not null,
  target numeric not null,
  risk_pct numeric not null,
  status text not null default 'open' check (status in ('open','closed')),
  exit_price numeric,
  pnl numeric,
  close_reason text,
  exchange_ref jsonb,
  steps jsonb not null default '[]',   -- full step-by-step log
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);
create index trades_user_idx on public.trades(user_id, opened_at desc);

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  timeframe text not null,
  direction text not null check (direction in ('buy','sell','neutral')),
  strength int not null default 0,
  price numeric not null,
  stop numeric,
  target numeric,
  indicators jsonb not null default '{}',
  context text not null default '',
  sources jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index signals_idx on public.signals(symbol, created_at desc);

alter table public.connections enable row level security;
alter table public.risk_settings enable row level security;
alter table public.strategies enable row level security;
alter table public.trades enable row level security;
alter table public.signals enable row level security;

create policy "connections_own" on public.connections for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "risk_own" on public.risk_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "strategies_own" on public.strategies for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "trades_own" on public.trades for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "signals_read" on public.signals for select to authenticated using (true);
-- signals are written only by the cron route using the service role key.
