
begin;
create table if not exists public.pos_favorites (
 restaurant_id text primary key references public.restaurants(id) on delete cascade,
 item_ids text[] not null default '{}'
);
alter table public.pos_favorites enable row level security;
revoke all on public.pos_favorites from anon,authenticated;
create or replace function public.get_pos_favorites(p_restaurant text)
returns text[] language plpgsql security definer set search_path=public as $$
begin
 if not public.can_operate_pos(p_restaurant) then raise exception 'Access denied'; end if;
 return coalesce((select item_ids from public.pos_favorites where restaurant_id=p_restaurant),'{}');
end $$;
create or replace function public.save_pos_favorites(p_restaurant text,p_items text[])
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.can_operate_pos(p_restaurant) then raise exception 'Access denied'; end if;
 if p_items is null or cardinality(p_items)>500 or exists(
 select 1 from unnest(p_items) x where not exists(select 1 from public.menu_items m where m.id=x and m.restaurant_id=p_restaurant)
 ) then raise exception 'Invalid favorite items'; end if;
 insert into public.pos_favorites values(p_restaurant,array(select distinct unnest(p_items)))
 on conflict(restaurant_id) do update set item_ids=excluded.item_ids;
end $$;
revoke all on function public.get_pos_favorites(text),public.save_pos_favorites(text,text[]) from public,anon;
grant execute on function public.get_pos_favorites(text),public.save_pos_favorites(text,text[]) to authenticated;
commit;
