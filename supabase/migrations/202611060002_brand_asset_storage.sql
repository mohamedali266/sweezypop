begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'brand-assets',
  'brand-assets',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads brand assets" on storage.objects;
create policy "Public reads brand assets"
on storage.objects for select
using (bucket_id = 'brand-assets');

drop policy if exists "Managers upload brand assets" on storage.objects;
create policy "Managers upload brand assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'brand-assets'
  and (storage.foldername(name))[1] = public.current_profile_restaurant_id()
  and public.can_manage_restaurant((storage.foldername(name))[1])
);

drop policy if exists "Managers replace brand assets" on storage.objects;
create policy "Managers replace brand assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'brand-assets'
  and (storage.foldername(name))[1] = public.current_profile_restaurant_id()
  and public.can_manage_restaurant((storage.foldername(name))[1])
)
with check (
  bucket_id = 'brand-assets'
  and (storage.foldername(name))[1] = public.current_profile_restaurant_id()
  and public.can_manage_restaurant((storage.foldername(name))[1])
);

commit;
