-- NovaTrade core schema. Apply in Supabase SQL Editor or with Supabase CLI.
-- Do not store exchange API secrets in these tables.
create extension if not exists pgcrypto;

create table if not exists public.research_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Research note' check (char_length(title) <= 180),
  content text not null check (char_length(content) <= 10000),
  source_url text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists research_notes_user_created_idx on public.research_notes(user_id, created_at desc);
alter table public.research_notes enable row level security;
drop policy if exists "Users can read their own research notes" on public.research_notes;
create policy "Users can read their own research notes" on public.research_notes for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create their own research notes" on public.research_notes;
create policy "Users can create their own research notes" on public.research_notes for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can update their own research notes" on public.research_notes;
create policy "Users can update their own research notes" on public.research_notes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own research notes" on public.research_notes;
create policy "Users can delete their own research notes" on public.research_notes for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.strategy_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) <= 180),
  market text not null default 'crypto',
  timeframe text not null default '1d',
  parameters jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  mode text not null default 'simulation' check (mode in ('simulation','paper')),
  created_at timestamptz not null default now()
);
create index if not exists strategy_runs_user_created_idx on public.strategy_runs(user_id, created_at desc);
alter table public.strategy_runs enable row level security;
drop policy if exists "Users can read their own strategy runs" on public.strategy_runs;
create policy "Users can read their own strategy runs" on public.strategy_runs for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can create their own strategy runs" on public.strategy_runs;
create policy "Users can create their own strategy runs" on public.strategy_runs for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can delete their own strategy runs" on public.strategy_runs;
create policy "Users can delete their own strategy runs" on public.strategy_runs for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.watchlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null check (char_length(symbol) <= 32),
  market text not null default 'crypto',
  created_at timestamptz not null default now(),
  unique(user_id, market, symbol)
);
alter table public.watchlist_items enable row level security;
drop policy if exists "Users can read their own watchlist" on public.watchlist_items;
create policy "Users can read their own watchlist" on public.watchlist_items for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users can add to their own watchlist" on public.watchlist_items;
create policy "Users can add to their own watchlist" on public.watchlist_items for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users can remove from their own watchlist" on public.watchlist_items;
create policy "Users can remove from their own watchlist" on public.watchlist_items for delete to authenticated using ((select auth.uid()) = user_id);

-- Research/demo only. No order-execution schema is included.
