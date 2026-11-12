-- NovaTrade migration 6: live trading wallet, ledger, equity history, chart cache.
--
-- Safe to run once on top of migrations 1-5 (the deploy workflow applies it for you).
--
-- Security shape
--  * nova_live_wallets holds each user's trading wallet. The private seed is stored AES-256-GCM encrypted by the server.
--    The browser roles (anon, authenticated) have NO privileges on that table at all, so not even the owner can read the ciphertext.
--  * Everything money-related is written by the server with the service role. Clients get read-only access to their own history.

-- 1. The auto-trading agent may now run fully live ('live') as well as with approval ('live_approval').
--    Clients still cannot set either value themselves: their policies only allow analysis / paper.
alter table public.nova_meme_strategy drop constraint if exists nova_meme_strategy_mode_check;
alter table public.nova_meme_strategy add constraint nova_meme_strategy_mode_check check (mode in ('analysis', 'paper', 'live_approval', 'live'));

-- 2. Positions: partial sells keep their realised profit; auto-exit rules can be switched off per position.
alter table public.nova_meme_positions add column if not exists realised_usd numeric not null default 0;
alter table public.nova_meme_positions add column if not exists auto_exit boolean not null default true;

-- A confirmed transaction signature can only ever be recorded once.
create unique index if not exists nova_trade_log_signature_uniq on public.nova_trade_log (tx_signature) where tx_signature is not null;

-- 3. The trading wallet.
create table if not exists public.nova_live_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (char_length(address) between 32 and 44),
  secret_enc text not null,                          -- v1:<iv>:<tag>:<ciphertext>, never returned to any client
  withdraw_to text check (withdraw_to is null or char_length(withdraw_to) between 32 and 44),
  withdraw_pending text,                             -- a changed withdrawal address waits here for 24h before it can be used
  withdraw_pending_at timestamptz,
  last_sig text,                                     -- newest transaction already scanned for deposits
  created_at timestamptz not null default now()
);
alter table public.nova_live_wallets enable row level security;
revoke all on public.nova_live_wallets from anon, authenticated;

-- 4. Deposits, withdrawals and rent reclaims. Read-only for the owner.
create table if not exists public.nova_wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'withdraw', 'reclaim')),
  sol numeric not null,
  usd numeric,                                       -- value at the time it was noticed, from the market price then
  signature text unique,
  created_at timestamptz not null default now()
);
create index if not exists nova_wallet_ledger_user_idx on public.nova_wallet_ledger (user_id, id desc);
alter table public.nova_wallet_ledger enable row level security;
drop policy if exists "ledger: owner read" on public.nova_wallet_ledger;
create policy "ledger: owner read" on public.nova_wallet_ledger for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_wallet_ledger from authenticated;
revoke all on public.nova_wallet_ledger from anon;

-- 5. Growth history for the Home chart (one row per user per mode every few minutes at most).
create table if not exists public.nova_equity_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('paper', 'live')),
  pnl_usd numeric not null,                          -- realised + open profit/loss
  value_usd numeric,                                 -- live: wallet value; paper: null
  at timestamptz not null default now()
);
create index if not exists nova_equity_snapshots_idx on public.nova_equity_snapshots (user_id, mode, at desc);
alter table public.nova_equity_snapshots enable row level security;
drop policy if exists "equity: owner read" on public.nova_equity_snapshots;
create policy "equity: owner read" on public.nova_equity_snapshots for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_equity_snapshots from authenticated;
revoke all on public.nova_equity_snapshots from anon;

-- 6. Short-lived cache so the free chart provider is not hit once per viewer. Server only.
create table if not exists public.nova_chart_cache (
  key text primary key,
  data jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.nova_chart_cache enable row level security;
revoke all on public.nova_chart_cache from anon, authenticated;

-- 7. One live swap at a time per user, so two taps (or a tap and the agent) can never spend the same funds twice.
create table if not exists public.nova_live_lock (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until_at timestamptz not null
);
alter table public.nova_live_lock enable row level security;
revoke all on public.nova_live_lock from anon, authenticated;

create or replace function public.nova_live_acquire(uid uuid, secs integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare got integer;
begin
  insert into public.nova_live_lock (user_id, until_at) values (uid, now() + make_interval(secs => secs))
  on conflict (user_id) do update set until_at = excluded.until_at where public.nova_live_lock.until_at < now();
  get diagnostics got = row_count;
  return got > 0;
end;
$$;
create or replace function public.nova_live_release(uid uuid) returns void
language sql security definer set search_path = public as $$
  update public.nova_live_lock set until_at = now() - interval '1 second' where user_id = uid;
$$;
revoke all on function public.nova_live_acquire(uuid, integer) from public, anon, authenticated;
revoke all on function public.nova_live_release(uuid) from public, anon, authenticated;
grant execute on function public.nova_live_acquire(uuid, integer) to service_role;
grant execute on function public.nova_live_release(uuid) to service_role;
