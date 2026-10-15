begin;

create schema if not exists maintenance_backup_20261015;
revoke all on schema maintenance_backup_20261015 from public, anon, authenticated;

create table maintenance_backup_20261015.restaurants as table public.restaurants;
create table maintenance_backup_20261015.profiles as table public.profiles;
create table maintenance_backup_20261015.categories as table public.categories;
create table maintenance_backup_20261015.menu_items as table public.menu_items;
create table maintenance_backup_20261015.opening_hours as table public.opening_hours;
create table maintenance_backup_20261015.orders as table public.orders;
create table maintenance_backup_20261015.order_lines as table public.order_lines;

revoke all on all tables in schema maintenance_backup_20261015 from public, anon, authenticated;

commit;
