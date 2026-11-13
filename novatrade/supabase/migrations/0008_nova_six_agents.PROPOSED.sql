-- 0008: six agents (Researcher and Sniper added), rotation exits, per-user agent settings and an auditable lessons table.

-- agent names allowed in the activity feed and trade log
alter table public.nova_agent_events drop constraint if exists nova_agent_events_agent_check;
alter table public.nova_agent_events add constraint nova_agent_events_agent_check
  check (agent in ('scanner', 'analyst', 'executor', 'risk', 'system', 'researcher', 'sniper'));
alter table public.nova_trade_log drop constraint if exists nova_trade_log_agent_check;
alter table public.nova_trade_log add constraint nova_trade_log_agent_check
  check (agent in ('scanner', 'analyst', 'executor', 'risk', 'copy', 'user', 'researcher', 'sniper'));

-- a position can now be closed because the Rotator found a stronger coin
alter table public.nova_meme_positions drop constraint if exists nova_meme_positions_exit_reason_check;
alter table public.nova_meme_positions add constraint nova_meme_positions_exit_reason_check
  check (exit_reason in ('take_profit', 'stop_loss', 'trailing_stop', 'manual', 'copy_exit', 'risk', 'rotation'));

-- per-user agent settings: sniper on/off, rotation on/off, survival plan (start, target, days)
alter table public.nova_meme_strategy add column if not exists agents jsonb not null default '{}'::jsonb;

-- what the agents recorded and what actually happened. Written by the server only; the owner can read it.
create table if not exists public.nova_agent_lessons (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  position_id uuid,
  agent text not null check (agent in ('scanner', 'analyst', 'executor', 'risk', 'researcher', 'sniper', 'rotator')),
  token_address text,
  symbol text,
  entry_score numeric,
  expected_pct numeric,
  actual_pct numeric,
  exit_reason text,
  mode text not null default 'paper' check (mode in ('paper', 'live')),
  note text check (char_length(note) <= 400),
  created_at timestamptz not null default now()
);
create index if not exists nova_agent_lessons_user_idx on public.nova_agent_lessons (user_id, id desc);
alter table public.nova_agent_lessons enable row level security;
revoke all on public.nova_agent_lessons from anon, authenticated;
grant select on public.nova_agent_lessons to authenticated;
drop policy if exists "lessons: owner read" on public.nova_agent_lessons;
create policy "lessons: owner read" on public.nova_agent_lessons for select to authenticated using (user_id = auth.uid());
