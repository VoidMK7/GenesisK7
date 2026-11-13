-- 0007: let people edit the text of their own posts (and show an "edited" mark).
alter table public.nova_posts add column if not exists edited_at timestamptz;

-- Only the text and the edited mark can be changed by the author; author, media and hidden stay locked.
grant update (body, edited_at) on public.nova_posts to authenticated;
drop policy if exists "posts: edit own" on public.nova_posts;
create policy "posts: edit own" on public.nova_posts for update to authenticated
  using (author = auth.uid() and not hidden)
  with check (author = auth.uid() and not hidden);
