begin;

alter table public.restaurants add column if not exists app_icon_url text;
alter table public.restaurants add column if not exists favicon_url text;

commit;
