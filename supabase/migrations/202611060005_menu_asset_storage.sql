begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-assets',
  'menu-assets',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public reads menu assets" on storage.objects;
create policy "Public reads menu assets"
on storage.objects for select
using (bucket_id = 'menu-assets');

drop policy if exists "Managers upload menu assets" on storage.objects;
create policy "Managers upload menu assets"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'menu-assets'
  and (storage.foldername(name))[1] = public.current_profile_restaurant_id()
  and public.can_manage_restaurant((storage.foldername(name))[1])
);

drop policy if exists "Managers replace menu assets" on storage.objects;
create policy "Managers replace menu assets"
on storage.objects for update to authenticated
using (
  bucket_id = 'menu-assets'
  and (storage.foldername(name))[1] = public.current_profile_restaurant_id()
  and public.can_manage_restaurant((storage.foldername(name))[1])
)
with check (
  bucket_id = 'menu-assets'
  and (storage.foldername(name))[1] = public.current_profile_restaurant_id()
  and public.can_manage_restaurant((storage.foldername(name))[1])
);

drop policy if exists "Managers delete menu assets" on storage.objects;
create policy "Managers delete menu assets"
on storage.objects for delete to authenticated
using (
  bucket_id = 'menu-assets'
  and (storage.foldername(name))[1] = public.current_profile_restaurant_id()
  and public.can_manage_restaurant((storage.foldername(name))[1])
);

commit;
