-- NovaTrade migration 4 of 4: storage bucket for profile pictures, banners and post images.
-- STATUS: PROPOSED. NOT APPLIED. Apply after 0003.
--
-- Files live at  <user id>/<anything>  and each user may only write inside their own folder.
-- Bucket limits are the real guard: 25 MB per file, images and short video only.
-- The "5-10 second" banner limit is checked in the browser (video duration) and recorded in
-- nova_profiles.banner_seconds, which the database constrains to 1..10. The server cannot decode video,
-- so a hand-crafted request could still upload a longer clip; the size cap bounds the harm.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nova-media', 'nova-media', true, 26214400,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "nova-media: public read" on storage.objects for select to authenticated, anon using (bucket_id = 'nova-media');
create policy "nova-media: write own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'nova-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "nova-media: replace own files" on storage.objects for update to authenticated
  using (bucket_id = 'nova-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "nova-media: delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'nova-media' and (storage.foldername(name))[1] = auth.uid()::text);
