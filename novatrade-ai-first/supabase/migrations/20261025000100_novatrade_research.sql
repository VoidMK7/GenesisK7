-- Additive, owner-scoped research tables. No order/execution tables by design.
create table if not exists public.market_observations (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 market text not null check (market in ('crypto','forex','stocks','indices','commodities')),
 symbol text not null check (char_length(symbol) <= 64), provider text not null,
 observed_at timestamptz not null, payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.chart_analyses (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 market text not null check (market in ('crypto','forex','stocks','indices','commodities')),
 symbol text, timeframe text, image_path text, prompt text not null default '',
 findings jsonb not null default '{}'::jsonb, source_refs jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists public.prediction_outcomes (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 analysis_id uuid references public.chart_analyses(id) on delete set null,
 symbol text not null, horizon text not null, forecast jsonb not null,
 outcome jsonb, evaluated_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists public.research_sources (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 url text not null, title text not null default '', publisher text not null default '',
 published_at timestamptz, retrieved_at timestamptz not null default now(),
 summary text not null default '', content_hash text, tags text[] not null default '{}'
);
create index if not exists market_observations_user_symbol_time_idx on public.market_observations(user_id,symbol,observed_at desc);
create index if not exists chart_analyses_user_created_idx on public.chart_analyses(user_id,created_at desc);
create index if not exists prediction_outcomes_user_created_idx on public.prediction_outcomes(user_id,created_at desc);
create index if not exists research_sources_user_created_idx on public.research_sources(user_id,retrieved_at desc);
alter table public.market_observations enable row level security;
alter table public.chart_analyses enable row level security;
alter table public.prediction_outcomes enable row level security;
alter table public.research_sources enable row level security;
drop policy if exists market_observations_owner_all on public.market_observations;
create policy market_observations_owner_all on public.market_observations for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists chart_analyses_owner_all on public.chart_analyses;
create policy chart_analyses_owner_all on public.chart_analyses for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists prediction_outcomes_owner_all on public.prediction_outcomes;
create policy prediction_outcomes_owner_all on public.prediction_outcomes for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists research_sources_owner_all on public.research_sources;
create policy research_sources_owner_all on public.research_sources for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.market_observations, public.chart_analyses, public.prediction_outcomes, public.research_sources to authenticated;
