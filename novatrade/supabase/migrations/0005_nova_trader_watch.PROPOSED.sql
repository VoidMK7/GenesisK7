-- NovaTrade migration 5: follow top traders by performance, and watch every trade they make.
-- STATUS: PROPOSED. NOT APPLIED. Apply after 0003 (and 0004).
--
-- Watching is READ-ONLY: the server reads public on-chain transactions for the wallets people follow.
-- A wallet's cursor is shared by everyone following it, so ten followers cost one RPC poll, not ten.

create table public.nova_autofollow (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  min_trades integer not null default 30 check (min_trades >= 1),
  min_win_rate_pct numeric not null default 55 check (min_win_rate_pct between 0 and 100),
  min_pnl_usd numeric not null default 5000,
  max_stale_hours integer not null default 48 check (max_stale_hours between 1 and 720),
  max_followed integer not null default 5 check (max_followed between 1 and 25),
  on_trade text not null default 'notify' check (on_trade in ('notify', 'notify_and_mirror')),   -- mirror = paper copy / approval request, never silent live trades
  updated_at timestamptz not null default now()
);
create trigger nova_autofollow_touch before update on public.nova_autofollow for each row execute function public.nova_touch_updated_at();
alter table public.nova_autofollow enable row level security;
create policy "autofollow: owner all" on public.nova_autofollow for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.nova_autofollow from anon;

create table public.nova_followed_traders (
  user_id uuid not null references auth.users(id) on delete cascade,
  chain text not null check (chain in ('solana', 'ethereum', 'base', 'bsc')),
  wallet_address text not null check (char_length(wallet_address) between 26 and 64),
  handle text not null check (char_length(handle) <= 60),
  platform text,
  source text not null check (source in ('auto', 'manual')),
  reason text,                                           -- why the AI followed (the numbers), or null for manual
  followed_at timestamptz not null default now(),
  primary key (user_id, chain, wallet_address)
);
create index nova_followed_wallet_idx on public.nova_followed_traders (chain, wallet_address);
alter table public.nova_followed_traders enable row level security;
create policy "followed: owner read" on public.nova_followed_traders for select to authenticated using (user_id = auth.uid());
create policy "followed: owner unfollow" on public.nova_followed_traders for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.nova_followed_traders from authenticated;       -- validated and inserted by the server
revoke all on public.nova_followed_traders from anon;

create table public.nova_watch_cursors (
  chain text not null,
  wallet_address text not null,
  last_signature text,
  last_checked_at timestamptz,
  last_error text,
  primary key (chain, wallet_address)
);
alter table public.nova_watch_cursors enable row level security;
revoke all on public.nova_watch_cursors from authenticated, anon;                 -- server only

create table public.nova_observed_trades (
  id bigint generated always as identity primary key,
  chain text not null,
  wallet_address text not null,
  signature text not null,
  side text not null check (side in ('buy', 'sell')),
  token_address text not null,
  token_amount numeric not null,
  quote text not null check (quote in ('SOL', 'USD')),
  quote_amount numeric not null,
  usd numeric,                                           -- null when the quote could not be priced
  block_time timestamptz,
  detected_at timestamptz not null default now(),
  unique (chain, wallet_address, signature)
);
create index nova_observed_wallet_idx on public.nova_observed_trades (chain, wallet_address, id desc);
alter table public.nova_observed_trades enable row level security;
-- Visible only for wallets the viewer follows.
create policy "observed: followers read" on public.nova_observed_trades for select to authenticated
  using (exists (select 1 from public.nova_followed_traders f where f.user_id = auth.uid() and f.chain = nova_observed_trades.chain and f.wallet_address = nova_observed_trades.wallet_address));
revoke insert, update, delete on public.nova_observed_trades from authenticated;
revoke all on public.nova_observed_trades from anon;

-- One notification per (follower, observed trade), so a retried run never double-notifies.
create table public.nova_trade_alerts (
  user_id uuid not null references auth.users(id) on delete cascade,
  observed_id bigint not null references public.nova_observed_trades(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, observed_id)
);
alter table public.nova_trade_alerts enable row level security;
create policy "alerts: owner read" on public.nova_trade_alerts for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_trade_alerts from authenticated;
revoke all on public.nova_trade_alerts from anon;
