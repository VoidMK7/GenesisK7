-- NovaTrade AI migration 2 of 2: paper trading, strategies, copy trading, research, training centre.
-- STATUS: PROPOSED. NOT APPLIED. Requires 0001 first.

-- ---------------------------------------------------------------------------
-- Paper trading ledger (server-written)
-- ---------------------------------------------------------------------------
create table public.nova_paper_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cash numeric not null check (cash >= 0),
  start_cash numeric not null check (start_cash > 0),
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);
create table public.nova_paper_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  asset_class text not null default 'crypto',
  qty numeric not null check (qty > 0),
  avg_price numeric not null check (avg_price > 0),
  primary key (user_id, symbol)
);
alter table public.nova_paper_accounts enable row level security;
alter table public.nova_paper_positions enable row level security;
create policy "paper accounts: owner read" on public.nova_paper_accounts for select to authenticated using (user_id = auth.uid());
create policy "paper positions: owner read" on public.nova_paper_positions for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_paper_accounts, public.nova_paper_positions from authenticated;

-- ---------------------------------------------------------------------------
-- AI provider connections (optional, per user). Keys live in nova_secrets.
-- ---------------------------------------------------------------------------
create table public.nova_ai_providers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'gemini', 'ollama', 'openai_compatible')),
  model text,
  base_url text,
  secret_id uuid references public.nova_secrets(id) on delete set null,
  tasks text[] not null default '{}',
  last_tested_at timestamptz,
  last_test_ok boolean,
  updated_at timestamptz not null default now()
);
alter table public.nova_ai_providers enable row level security;
create policy "ai providers: owner read" on public.nova_ai_providers for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_ai_providers from authenticated;

-- ---------------------------------------------------------------------------
-- Strategies and the activity feed (reasoning history)
-- ---------------------------------------------------------------------------
create table public.nova_strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  engine text not null check (engine in ('copy', 'algo', 'autonomous', 'hybrid')),
  symbol text not null,
  market text not null,
  name text not null,
  direction text not null check (direction in ('long', 'short', 'neutral')),
  payload jsonb not null,                 -- full proposal incl. simulation, evidence, invalidation
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'executed', 'closed', 'expired')),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  moderation text not null default 'none' check (moderation in ('none', 'pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create index nova_strategies_user_idx on public.nova_strategies (user_id, created_at desc);
alter table public.nova_strategies enable row level security;
create policy "strategies: owner read" on public.nova_strategies for select to authenticated using (user_id = auth.uid());
create policy "strategies: public approved read" on public.nova_strategies for select to authenticated
  using (visibility = 'public' and moderation = 'approved');
create policy "strategies: admin read" on public.nova_strategies for select to authenticated
  using (public.nova_is_admin());
-- Moderation: admins may change only the moderation column. Owners have no update policy at all.
create policy "strategies: admin moderate" on public.nova_strategies for update to authenticated
  using (public.nova_is_admin()) with check (public.nova_is_admin());
revoke insert, update, delete on public.nova_strategies from authenticated;
grant update (moderation) on public.nova_strategies to authenticated;

create table public.nova_strategy_events (
  id bigint generated always as identity primary key,
  strategy_id uuid not null references public.nova_strategies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,                     -- generated, simulated, ranked, approved, order_submitted, filled, closed, lesson ...
  message text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index nova_strategy_events_idx on public.nova_strategy_events (strategy_id, id);
alter table public.nova_strategy_events enable row level security;
create policy "strategy events: owner read" on public.nova_strategy_events for select to authenticated using (user_id = auth.uid());
create policy "strategy events: public strategy read" on public.nova_strategy_events for select to authenticated
  using (exists (select 1 from public.nova_strategies s where s.id = strategy_id and s.visibility = 'public' and s.moderation = 'approved'));
revoke insert, update, delete on public.nova_strategy_events from authenticated;

create table public.nova_backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  market text not null,
  interval text not null,
  strategy text not null,
  params jsonb not null default '{}'::jsonb,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index nova_backtests_user_idx on public.nova_backtests (user_id, created_at desc);
alter table public.nova_backtests enable row level security;
create policy "backtests: owner read" on public.nova_backtests for select to authenticated using (user_id = auth.uid());
create policy "backtests: owner delete" on public.nova_backtests for delete to authenticated using (user_id = auth.uid());
revoke insert, update on public.nova_backtests from authenticated;

-- ---------------------------------------------------------------------------
-- Copy trading marketplace. Records come only from the platform's own broker-confirmed fills.
-- ---------------------------------------------------------------------------
create table public.nova_trader_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 3 and 32),
  bio text check (char_length(bio) <= 500),
  is_public boolean not null default false,
  allow_copy boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index nova_trader_name_idx on public.nova_trader_profiles (lower(display_name));
alter table public.nova_trader_profiles enable row level security;
create policy "profiles: owner all" on public.nova_trader_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "profiles: public read" on public.nova_trader_profiles for select to authenticated using (is_public);

create table public.nova_trader_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  record_source text not null check (record_source in ('broker_verified', 'self_reported', 'hypothetical')),
  trades integer not null default 0,
  days integer not null default 0,
  win_rate_pct numeric,
  max_drawdown_pct numeric,
  return_pct numeric,
  computed_at timestamptz not null default now()
);
alter table public.nova_trader_stats enable row level security;
create policy "stats: owner read" on public.nova_trader_stats for select to authenticated using (user_id = auth.uid());
create policy "stats: public profile read" on public.nova_trader_stats for select to authenticated
  using (exists (select 1 from public.nova_trader_profiles p where p.user_id = nova_trader_stats.user_id and p.is_public));
revoke insert, update, delete on public.nova_trader_stats from authenticated;

create table public.nova_trader_open_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  direction text not null check (direction in ('long', 'short')),
  qty numeric not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
alter table public.nova_trader_open_positions enable row level security;
create policy "open positions: owner read" on public.nova_trader_open_positions for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.nova_trader_open_positions from authenticated;

create table public.nova_follows (
  follower uuid not null references auth.users(id) on delete cascade,
  leader uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, leader),
  check (follower <> leader)
);
alter table public.nova_follows enable row level security;
create policy "follows: owner all" on public.nova_follows for all to authenticated
  using (follower = auth.uid()) with check (follower = auth.uid());

create table public.nova_copy_subscriptions (
  id uuid primary key default gen_random_uuid(),
  follower uuid not null references auth.users(id) on delete cascade,
  leader uuid not null references auth.users(id) on delete cascade,
  allocation numeric not null check (allocation > 0),
  connection_id uuid references public.nova_broker_connections(id) on delete set null,  -- required when the follower trades live
  max_trade_pct numeric not null default 10 check (max_trade_pct >= 1 and max_trade_pct <= 100),
  stop_loss_pct numeric not null default 5 check (stop_loss_pct > 0 and stop_loss_pct <= 50),
  status text not null default 'active' check (status in ('active', 'stopped')),
  stopped_reason text,
  cursor_audit_id bigint not null default 0,
  created_at timestamptz not null default now(),
  stopped_at timestamptz,
  check (follower <> leader)
);
create unique index nova_copy_one_active on public.nova_copy_subscriptions (follower, leader) where status = 'active';
alter table public.nova_copy_subscriptions enable row level security;
create policy "copy: follower read" on public.nova_copy_subscriptions for select to authenticated using (follower = auth.uid());
revoke insert, update, delete on public.nova_copy_subscriptions from authenticated;

-- ---------------------------------------------------------------------------
-- Admin AI Training Centre. Nothing here modifies any model; approved text is retrieved as cited context only.
-- ---------------------------------------------------------------------------
create table public.nova_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null check (kind in ('text', 'pdf', 'image', 'audio_video', 'youtube', 'url', 'trade_records')),
  status text not null default 'pending_review' check (status in ('pending_review', 'approved', 'rejected')),
  storage_path text,
  source_url text,
  extracted_text text,
  note text,
  uploaded_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.nova_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.nova_knowledge_sources(id) on delete cascade,
  ordinal integer not null,
  text text not null,
  embedding jsonb,                        -- optional vector from an embeddings provider
  unique (source_id, ordinal)
);
create table public.nova_knowledge_collections (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);
create table public.nova_collection_sources (
  collection_id uuid not null references public.nova_knowledge_collections(id) on delete cascade,
  source_id uuid not null references public.nova_knowledge_sources(id) on delete cascade,
  primary key (collection_id, source_id)
);
create table public.nova_engine_assignments (
  engine text not null check (engine in ('copy', 'algo', 'autonomous', 'hybrid')),
  collection_id uuid not null references public.nova_knowledge_collections(id) on delete cascade,
  primary key (engine, collection_id)
);
create table public.nova_knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  note text not null,
  snapshot jsonb not null,                -- { engine: [sourceId,...] } at the time of the snapshot
  is_active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index nova_one_active_version on public.nova_knowledge_versions (is_active) where is_active;
create table public.nova_eval_cases (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  expect_source_id uuid references public.nova_knowledge_sources(id) on delete set null,
  expect_terms text[] not null default '{}',
  created_at timestamptz not null default now()
);
create table public.nova_eval_runs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid references public.nova_knowledge_versions(id) on delete set null,
  report jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table public.nova_retrieval_log (
  id bigint generated always as identity primary key,
  engine text,
  query text not null,
  source_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['nova_knowledge_sources','nova_knowledge_chunks','nova_knowledge_collections','nova_collection_sources','nova_engine_assignments','nova_knowledge_versions','nova_eval_cases','nova_eval_runs','nova_retrieval_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.nova_is_admin()) with check (public.nova_is_admin())', t || ': admin only', t);
  end loop;
end $$;

-- Private storage bucket for training files, admin only.
insert into storage.buckets (id, name, public) values ('nova-training', 'nova-training', false) on conflict (id) do nothing;
create policy "nova-training: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'nova-training' and public.nova_is_admin());
create policy "nova-training: admin write" on storage.objects for insert to authenticated
  with check (bucket_id = 'nova-training' and public.nova_is_admin());
create policy "nova-training: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'nova-training' and public.nova_is_admin());

-- Realtime for the live activity feed and notifications (only if the publication exists, as on Supabase).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.nova_strategy_events, public.nova_notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Defence in depth: signed-out visitors (anon) never need any NovaTrade table.
-- Row Level Security already hides rows; this removes the privilege as well.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'nova\_%' escape '\'
  loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
