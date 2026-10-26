-- TradePilot application data. Separate from existing Genesis AI tables.
create extension if not exists pgcrypto;

create table if not exists public.tradepilot_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null check (char_length(name) between 1 and 80),
  password_hash text not null,
  role text not null default 'user' check (role in ('user','teacher','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.tradepilot_teaching_cards (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (kind in ('video','data','note','image')),
  notes text not null default '' check (char_length(notes) <= 5000),
  extracted_text text not null default '',
  tags text[] not null default '{}',
  storage_path text,
  original_filename text,
  created_by uuid not null references public.tradepilot_users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.tradepilot_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.tradepilot_users(id) on delete cascade,
  event_type text not null check (event_type in ('register','login','chat','teach_upload')),
  created_at timestamptz not null default now()
);

create index if not exists tradepilot_users_created_at_idx on public.tradepilot_users(created_at desc);
create index if not exists tradepilot_cards_created_at_idx on public.tradepilot_teaching_cards(created_at desc);
create index if not exists tradepilot_cards_created_by_idx on public.tradepilot_teaching_cards(created_by);
create index if not exists tradepilot_events_created_at_idx on public.tradepilot_events(created_at desc);
create index if not exists tradepilot_events_user_created_at_idx on public.tradepilot_events(user_id, created_at desc);
create index if not exists tradepilot_events_type_idx on public.tradepilot_events(event_type);

alter table public.tradepilot_users enable row level security;
alter table public.tradepilot_teaching_cards enable row level security;
alter table public.tradepilot_events enable row level security;

-- This starter app uses server-only access. Do not grant direct browser access.
revoke all on public.tradepilot_users from anon, authenticated;
revoke all on public.tradepilot_teaching_cards from anon, authenticated;
revoke all on public.tradepilot_events from anon, authenticated;

-- Private storage bucket for teaching uploads; server-side code should use a secret key.
insert into storage.buckets (id, name, public, file_size_limit)
values ('tradepilot-teaching', 'tradepilot-teaching', false, 209715200)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
