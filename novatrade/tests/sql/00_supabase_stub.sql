-- Minimal stand-in for the parts of Supabase the migrations rely on. TEST FIXTURE ONLY: never run on a real project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;

-- pre-existing table in the real project that the migrations depend on
create table public.user_roles (user_id uuid not null references auth.users(id), role text not null check (role = 'admin'), primary key (user_id, role));
grant all on public.user_roles to service_role;
grant select on public.user_roles to authenticated;
create publication supabase_realtime;
