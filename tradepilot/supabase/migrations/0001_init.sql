-- TradePilot AI: schema, row-level security, storage, admin stats.
-- Run in the Supabase SQL editor (or `supabase db push`).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'user' check (role in ('user','teacher','admin')),
  created_at timestamptz not null default now()
);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null check (kind in ('video','data','note','image')),
  notes text not null default '',
  content_text text not null default '',
  tags text[] not null default '{}',
  file_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('register','login','chat','teach_upload')),
  created_at timestamptz not null default now()
);
create index events_created_idx on public.events(created_at);
create index events_user_idx on public.events(user_id);

-- Role helper (security definer so policies on profiles don't recurse)
create or replace function public.has_role(roles text[])
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = any(roles));
$$;

-- Auto-create a profile for every new auth user. Everyone starts as 'user'.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.events enable row level security;

-- profiles: read your own; admins read all and are the ONLY ones who can change roles
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.has_role(array['admin']));
create policy "profiles_admin_update" on public.profiles for update
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

-- cards: only teachers/admins. The chat server reads them with the service role key.
create policy "cards_teacher_all" on public.cards for all
  using (public.has_role(array['teacher','admin']))
  with check (public.has_role(array['teacher','admin']));

-- events: users log their own activity; only admins read
create policy "events_insert_own" on public.events for insert with check (user_id = auth.uid());
create policy "events_admin_select" on public.events for select using (public.has_role(array['admin']));

-- private storage bucket for teaching uploads
insert into storage.buckets (id, name, public) values ('teaching', 'teaching', false)
  on conflict (id) do nothing;
create policy "teaching_files_teacher_all" on storage.objects for all
  using (bucket_id = 'teaching' and public.has_role(array['teacher','admin']))
  with check (bucket_id = 'teaching' and public.has_role(array['teacher','admin']));

-- admin dashboard numbers in one call
create or replace function public.admin_stats()
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if not public.has_role(array['admin']) then raise exception 'forbidden'; end if;
  select json_build_object(
    'total_users', (select count(*) from profiles),
    'active_7d',   (select count(distinct user_id) from events where created_at > now() - interval '7 days'),
    'chats',       (select count(*) from events where type = 'chat'),
    'logins',      (select count(*) from events where type = 'login'),
    'cards',       (select count(*) from cards),
    'teachers',    (select count(*) from profiles where role = 'teacher'),
    'daily', (select json_agg(json_build_object(
        'day', d::date,
        'signups', (select count(*) from profiles where created_at::date = d::date),
        'active',  (select count(distinct user_id) from events where created_at::date = d::date)
      ) order by d)
      from generate_series((current_date - 13)::timestamp, current_date::timestamp, interval '1 day') d),
    'per_user', (select coalesce(json_object_agg(user_id, c), '{}'::json)
      from (select user_id, count(*) c from events group by user_id) x)
  ) into r;
  return r;
end $$;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- AFTER you sign up, make yourself the first admin (replace the email):
-- update public.profiles set role = 'admin' where email = 'you@example.com';
